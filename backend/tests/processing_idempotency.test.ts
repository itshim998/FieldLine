import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { workerRunner } from '../src/jobs/worker-runner.js';

describe('Pass 16 — Document Processing Idempotency & Repeatability', () => {
  let projectId: string;
  let evidenceId: string;
  let evidenceService: DefaultEvidenceService;
  let jobService: DefaultJobService;
  let ingestionService: DefaultDocumentIngestionService;
  let worker: DocumentIngestionWorker;

  const testUploadDir = 'test-idempotency-artifacts';
  const uploadRoot = path.resolve(process.cwd(), testUploadDir);

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });

    if (!fs.existsSync(uploadRoot)) {
      fs.mkdirSync(uploadRoot, { recursive: true });
    }

    const project = projectRepository.create({
      name: 'Delhi-Meerut RRTS Corridor',
      code: 'DMRRTS-16'
    });
    projectId = project.id;

    // Create a schedule and activity
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
      externalId: 'ACT-RRTS-01',
      name: 'Viaduct Pier P-102 Concrete Pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31',
      plannedQuantity: 120,
      unit: 'm3'
    });

    evidenceService = new DefaultEvidenceService(
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
            reference: 'ACT-RRTS-01: Viaduct Pier P-102 Concrete Pour',
            location: 'Zone C',
            progress_percent: 60,
            status: 'in_progress'
          }
        ]
      }) as any
    });

    ingestionService = new DefaultDocumentIngestionService({
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
    const tempCsvPath = path.join(uploadRoot, 'temp_daily_report.csv');
    fs.writeFileSync(
      tempCsvPath,
      'Report Date: 2026-08-25\nDate,Work Item,Location,Progress,Status\n2026-08-25,Viaduct Pier P-102,Zone C,60%,in_progress'
    );

    const uploaded = await evidenceService.uploadEvidence(projectId, {
      originalname: 'daily_report.csv',
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

  it('first process request creates one queued job', async () => {
    const job = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(job).toBeDefined();
    expect(job.status).toBe('queued');
    expect(job.projectId).toBe(projectId);
    expect((job.payload as { evidenceId: string }).evidenceId).toBe(evidenceId);

    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs).toHaveLength(1);
    expect(allJobs[0].id).toBe(job.id);
  });

  it('repeated process request while job is queued returns the existing queued job', async () => {
    const job1 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);
    const job2 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(job2.id).toBe(job1.id);
    expect(job2.status).toBe('queued');

    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs).toHaveLength(1);
  });

  it('repeated process request while job is processing returns the existing processing job', async () => {
    const job1 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    // Claim the job so it transitions to 'processing'
    const claimed = jobRepository.claimNextQueued();
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe('processing');

    const job2 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(job2.id).toBe(job1.id);
    expect(job2.status).toBe('processing');

    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs).toHaveLength(1);
  });

  it('completed process request returns the existing completed job idempotently', async () => {
    // 1. Enqueue job
    const job = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    // 2. Worker claims and processes job
    const claimed = jobRepository.claimNextQueued();
    expect(claimed).not.toBeNull();

    // Mock/spy processEvidence to track invocations
    const spy = vi.spyOn(ingestionService, 'processEvidence');
    await worker.process(claimed!);

    expect(spy).toHaveBeenCalledTimes(1);

    const completedJob = jobRepository.getByIdAndProjectId(job.id, projectId);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.result).toBeDefined();

    // 3. Repeated process request after completion
    const repeatedJob = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(repeatedJob.id).toBe(job.id);
    expect(repeatedJob.status).toBe('completed');

    // Verify DocumentIngestionService was NOT called again
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('completed process request does not create duplicate ProgressUpdates or ActivityMatches', async () => {
    // 1. Process to completion
    const job = await jobService.enqueueDocumentIngestion(projectId, evidenceId);
    const claimed = jobRepository.claimNextQueued();
    await worker.process(claimed!);

    const initialUpdates = progressUpdateRepository.listByProjectId(projectId);
    expect(initialUpdates).toHaveLength(1);
    const initialMatches = activityMatchRepository.listByProjectId(projectId);
    expect(initialMatches.length).toBeGreaterThan(0);

    // 2. Call process again multiple times
    const rep1 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);
    const rep2 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(rep1.status).toBe('completed');
    expect(rep2.status).toBe('completed');

    // 3. Verify exactly 1 ProgressUpdate exists
    const finalUpdates = progressUpdateRepository.listByProjectId(projectId);
    expect(finalUpdates).toHaveLength(1);
    expect(finalUpdates[0].id).toBe(initialUpdates[0].id);

    // 4. Verify match set has not duplicated
    const finalMatches = activityMatchRepository.listByProjectId(projectId);
    expect(finalMatches).toHaveLength(initialMatches.length);
  });

  it('permits an explicit new processing attempt if previous job failed before project-state commit', async () => {
    // 1. Enqueue job
    const job1 = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    // 2. Mark job1 as failed
    jobRepository.markFailed(job1.id, 'Simulated transient extraction failure');
    const failedJob = jobRepository.getByIdAndProjectId(job1.id, projectId);
    expect(failedJob?.status).toBe('failed');

    // 3. Explicit retry request
    const retryJob = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    expect(retryJob.id).not.toBe(job1.id);
    expect(retryJob.status).toBe('queued');

    // Old failed job remains in database as historical record
    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs).toHaveLength(2);
    expect(allJobs.some(j => j.id === job1.id && j.status === 'failed')).toBe(true);
    expect(allJobs.some(j => j.id === retryJob.id && j.status === 'queued')).toBe(true);
  });

  it('handles post-commit job-status failure: project state remains valid and retry produces NO duplicate ProgressUpdate or ActivityMatches', async () => {
    // 1. Enqueue job
    const job = await jobService.enqueueDocumentIngestion(projectId, evidenceId);
    const claimed = jobRepository.claimNextQueued();
    expect(claimed).not.toBeNull();

    // 2. Mock jobRepository.markCompleted to throw once (simulating failure during markCompleted)
    const originalMarkCompleted = jobRepository.markCompleted.bind(jobRepository);
    let throwCount = 1;
    vi.spyOn(jobRepository, 'markCompleted').mockImplementation((id, res) => {
      if (throwCount > 0) {
        throwCount--;
        throw new Error('Simulated SQLite Lock / Crash during markCompleted');
      }
      return originalMarkCompleted(id, res);
    });

    // 3. Worker executes process
    await worker.process(claimed!);

    // 4. Verify ProgressUpdate exists
    const updates = progressUpdateRepository.listByProjectId(projectId);
    expect(updates).toHaveLength(1);
    const puId = updates[0].id;

    // 5. Verify Evidence points to that ProgressUpdate
    const ev = evidenceRepository.getByIdAndProjectId(evidenceId, projectId);
    expect(ev?.progressUpdateId).toBe(puId);

    // 6. Verify suggested matches exist
    const initialMatches = activityMatchRepository.listByProgressUpdateId(puId, projectId);
    expect(initialMatches.length).toBeGreaterThan(0);

    // 7. Retry / re-enqueue the same job for this evidence
    const retryJob = await jobService.enqueueDocumentIngestion(projectId, evidenceId);

    // If job was queued, process with worker
    if (retryJob.status === 'queued') {
      const retryClaimed = jobRepository.claimNextQueued();
      if (retryClaimed) {
        await worker.process(retryClaimed);
      }
    }

    // 8. Verify NO second ProgressUpdate was created
    const finalUpdates = progressUpdateRepository.listByProjectId(projectId);
    expect(finalUpdates).toHaveLength(1);
    expect(finalUpdates[0].id).toBe(puId);

    // 9. Verify NO duplicate ActivityMatches
    const finalMatches = activityMatchRepository.listByProjectId(projectId);
    expect(finalMatches).toHaveLength(initialMatches.length);
  });
});
