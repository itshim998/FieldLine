import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { scheduleRepository } from '../src/repositories/schedule.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { activityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { progressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { activityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { DefaultDocumentIngestionService } from '../src/services/ingestion/document-ingestion.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';

describe('Pass 16 — Transactional Failure Safety and State Preservation', () => {
  let projectId: string;
  let activityId: string;
  let evidenceId: string;
  let evidenceService: DefaultEvidenceService;
  let matchingService: ActivityMatchingService;

  const testUploadDir = 'test-tx-isolation-artifacts';
  const uploadRoot = path.resolve(process.cwd(), testUploadDir);

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });

    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const project = projectRepository.create({
      name: 'Mumbai Coastal Road Project',
      code: 'MCRP-16'
    });
    projectId = project.id;

    const schedule = scheduleRepository.create({
      projectId,
      name: 'Baseline Schedule',
      sourceFileName: 'baseline.csv',
      sourceType: 'csv',
      isBaseline: true
    });

    const act = activityRepository.create({
      projectId,
      scheduleId: schedule.id,
      externalId: 'ACT-MCRP-01',
      name: 'Pier Foundation P16',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31',
      plannedQuantity: 100,
      unit: 'm3'
    });
    activityId = act.id;

    evidenceService = new DefaultEvidenceService(
      evidenceRepository,
      projectRepository,
      undefined,
      undefined,
      testUploadDir
    );

    matchingService = new ActivityMatchingService({
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      activityRepo: activityRepository,
      activityMatchRepo: activityMatchRepository
    });

    // Create and upload valid evidence file
    const tempCsvPath = path.join(uploadRoot, 'temp_site_report.csv');
    fs.writeFileSync(
      tempCsvPath,
      'Report Date: 2026-08-26\nDate,Work Item,Location,Progress,Status\n2026-08-26,Pier Foundation P16,Sector 4,75%,in_progress'
    );

    const uploaded = await evidenceService.uploadEvidence(projectId, {
      originalname: 'site_report.csv',
      path: tempCsvPath,
      size: fs.statSync(tempCsvPath).size,
      mimetype: 'text/csv'
    });
    evidenceId = uploaded.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(uploadRoot)) {
      try {
        fs.rmSync(uploadRoot, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('rolls back completely when AI extraction throws — zero project-state rows created', async () => {
    const failingAiService: AIService = {
      generateText: async () => { throw new Error('AI Model Execution Timeout'); },
      extractStructured: async () => { throw new Error('AI Extraction Rate Limit Exceeded'); }
    };
    const failingExtractionService = new FieldProgressExtractionService(failingAiService);

    const ingestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      activityMatchRepo: activityMatchRepository,
      extractionService: failingExtractionService,
      matchingService
    });

    await expect(
      ingestionService.processEvidence(projectId, evidenceId)
    ).rejects.toThrow('AI Extraction Rate Limit Exceeded');

    // Verify 0 ProgressUpdates created
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(0);

    // Verify 0 ActivityMatches created
    const matches = activityMatchRepository.listByProjectId(projectId);
    expect(matches).toHaveLength(0);

    // Verify Evidence remains unattached
    const evidence = evidenceRepository.getByIdAndProjectId(evidenceId, projectId);
    expect(evidence?.progressUpdateId).toBeNull();
  });

  it('rolls back ProgressUpdate and Evidence attachment if match persistence fails during transaction', () => {
    // Calling commitDocumentIngestionTransaction directly with an invalid activity ID triggers a SQLite foreign key error
    expect(() => {
      progressUpdateRepository.commitDocumentIngestionTransaction({
        progressUpdate: {
          projectId,
          reportDate: '2026-08-26',
          sourceType: 'text',
          rawText: 'Report raw text',
          status: 'received'
        },
        evidenceId,
        suggestedMatches: [
          {
            projectId,
            progressUpdateId: '', // placeholder, repo sets this
            evidenceId,
            activityId: 'non-existent-activity-id-violating-fk',
            confidenceScore: 0.95,
            matchMethod: 'exact_id',
            status: 'suggested'
          }
        ]
      });
    }).toThrow();

    // ProgressUpdate should be completely rolled back (not present in DB)
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(0);

    // Evidence should remain completely unattached
    const evidence = evidenceRepository.getByIdAndProjectId(evidenceId, projectId);
    expect(evidence?.progressUpdateId).toBeNull();
  });

  it('rolls back ProgressUpdate if Evidence attachment fails during transaction', () => {
    // Pass a non-existent evidenceId to commitDocumentIngestionTransaction
    expect(() => {
      progressUpdateRepository.commitDocumentIngestionTransaction({
        progressUpdate: {
          projectId,
          reportDate: '2026-08-26',
          sourceType: 'text',
          rawText: 'Report raw text',
          status: 'received'
        },
        evidenceId: 'non-existent-evidence-id',
        suggestedMatches: []
      });
    }).toThrow('could not be linked');

    // Verify no orphan ProgressUpdate remains
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(0);
  });

  it('preserves existing canonical ActivityProgress exactly (e.g. 60%) when a new processing attempt fails', async () => {
    // 1. Establish existing canonical ActivityProgress = 60%
    const existingProgress = activityProgressRepository.create({
      projectId,
      activityId,
      actualPercent: 60.0,
      actualQuantity: 60,
      actualStart: '2026-08-05',
      status: 'in_progress',
      asOfDate: '2026-08-20',
      notes: 'Initial confirmed pour'
    });

    expect(existingProgress.actualPercent).toBe(60.0);

    // Verify initial state
    const priorState = activityProgressRepository.getById(existingProgress.id);
    expect(priorState?.actualPercent).toBe(60.0);

    // 2. Execute a new document-processing attempt that encounters a transaction failure
    const failingProgressRepo = Object.create(progressUpdateRepository);
    failingProgressRepo.commitDocumentIngestionTransaction = () => {
      throw new Error('Simulated transaction failure during ingestion');
    };

    const failingIngestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: failingProgressRepo,
      activityMatchRepo: activityMatchRepository,
      matchingService
    });

    await expect(
      failingIngestionService.processEvidence(projectId, evidenceId)
    ).rejects.toThrow('Simulated transaction failure during ingestion');

    // 3. MANDATORY ASSERTION: Existing ActivityProgress must remain exactly 60.0%
    const postFailureProgress = activityProgressRepository.getById(existingProgress.id);
    expect(postFailureProgress).not.toBeNull();
    expect(postFailureProgress?.actualPercent).toBe(60.0);
    expect(postFailureProgress?.actualQuantity).toBe(60);
    expect(postFailureProgress?.status).toBe('in_progress');
    expect(postFailureProgress?.notes).toBe('Initial confirmed pour');

    // Total activity progress records for project must remain exactly 1
    const allProgressRecords = activityProgressRepository.listByProjectId(projectId);
    expect(allProgressRecords).toHaveLength(1);
  });
});
