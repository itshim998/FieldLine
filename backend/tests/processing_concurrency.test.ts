import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { scheduleRepository } from '../src/repositories/schedule.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { progressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { activityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { jobRepository } from '../src/jobs/job.repository.js';
import { DefaultJobService } from '../src/jobs/job.service.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { DefaultDocumentIngestionService } from '../src/services/ingestion/document-ingestion.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { DocumentIngestionWorker } from '../src/jobs/document-ingestion.worker.js';

describe('Pass 16 — Backend-Level Concurrent Processing Protection', () => {
  let projectId: string;
  let evidenceId: string;
  let jobService: DefaultJobService;
  let worker: DocumentIngestionWorker;

  const testUploadDir = 'test-concurrency-artifacts';
  const uploadRoot = path.resolve(process.cwd(), testUploadDir);

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });

    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const project = projectRepository.create({
      name: 'Chennai Port Connectivity Highway',
      code: 'CPCH-16'
    });
    projectId = project.id;

    const schedule = scheduleRepository.create({
      projectId,
      name: 'Baseline Schedule',
      sourceFilename: 'baseline.csv',
      sourceType: 'csv',
      isBaseline: true
    });

    activityRepository.create({
      projectId,
      scheduleId: schedule.id,
      externalId: 'ACT-CPCH-01',
      name: 'Pavement Subgrade Compaction',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31',
      plannedQuantity: 500,
      unit: 'm2'
    });

    const evidenceService = new DefaultEvidenceService(
      evidenceRepository,
      projectRepository,
      undefined,
      undefined,
      testUploadDir
    );

    jobService = new DefaultJobService({
      jobRepo: jobRepository,
      projectRepo: projectRepository,
      evidenceRepo: evidenceRepository
    });

    const mockExtractionService = new FieldProgressExtractionService({
      generateText: async () => 'OK',
      extractStructured: async () => ({
        items: [
          {
            reference: 'ACT-CPCH-01: Pavement Subgrade Compaction',
            location: 'Chainage 14+200',
            progress_percent: 80,
            status: 'in_progress'
          }
        ]
      }) as any
    });

    const ingestionService = new DefaultDocumentIngestionService({
      evidenceRepo: evidenceRepository,
      evidenceService,
      projectRepo: projectRepository,
      progressUpdateRepo: progressUpdateRepository,
      activityMatchRepo: activityMatchRepository,
      extractionService: mockExtractionService
    });

    worker = new DocumentIngestionWorker({
      ingestionService,
      evidenceRepo: evidenceRepository,
      jobRepo: jobRepository
    });

    // Create and upload valid evidence file
    const tempCsvPath = path.join(uploadRoot, 'temp_compaction_report.csv');
    fs.writeFileSync(
      tempCsvPath,
      'Report Date: 2026-08-25\nDate,Work Item,Location,Progress,Status\n2026-08-25,Pavement Subgrade Compaction,Chainage 14+200,80%,in_progress'
    );

    const uploaded = await evidenceService.uploadEvidence(projectId, {
      originalname: 'compaction_report.csv',
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

  it('multiple concurrent process requests against same evidence produce one logical completed result', async () => {
    // 1. Simulate 10 simultaneous enqueue requests
    const enqueuePromises = Array.from({ length: 10 }).map(() =>
      jobService.enqueueDocumentIngestion(projectId, evidenceId)
    );

    const enqueuedJobs = await Promise.all(enqueuePromises);

    // All promises must resolve to the EXACT SAME job ID
    const firstJobId = enqueuedJobs[0].id;
    for (const job of enqueuedJobs) {
      expect(job.id).toBe(firstJobId);
      expect(job.projectId).toBe(projectId);
    }

    // Exactly 1 job record exists in the database
    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs).toHaveLength(1);
    expect(allJobs[0].id).toBe(firstJobId);

    // 2. Claim and process the single job
    const claimed = jobRepository.claimNextQueued();
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(firstJobId);

    await worker.process(claimed!);

    const completedJob = jobRepository.getByIdAndProjectId(firstJobId, projectId);
    expect(completedJob?.status).toBe('completed');

    // 3. Fire another batch of 10 concurrent requests after completion
    const repeatedPromises = Array.from({ length: 10 }).map(() =>
      jobService.enqueueDocumentIngestion(projectId, evidenceId)
    );
    const repeatedJobs = await Promise.all(repeatedPromises);

    for (const repJob of repeatedJobs) {
      expect(repJob.id).toBe(firstJobId);
      expect(repJob.status).toBe('completed');
    }

    // 4. Assert invariants on project truth:
    // Exactly ONE ProgressUpdate
    const allUpdates = progressUpdateRepository.listByProjectId(projectId);
    expect(allUpdates).toHaveLength(1);

    // Exactly ONE set of suggested ActivityMatches for this progress update
    const matches = activityMatchRepository.listByProgressUpdateId(allUpdates[0].id, projectId);
    expect(matches.length).toBeGreaterThan(0);

    // All matches belong to this single update
    const totalMatches = activityMatchRepository.listByProjectId(projectId);
    expect(totalMatches).toHaveLength(matches.length);

    // Evidence is attached to this single update
    const updatedEvidence = evidenceRepository.getByIdAndProjectId(evidenceId, projectId);
    expect(updatedEvidence?.progressUpdateId).toBe(allUpdates[0].id);
  });
});
