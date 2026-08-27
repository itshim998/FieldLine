import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { jobRepository } from '../src/jobs/job.repository.js';
import { DocumentIngestionWorker } from '../src/jobs/document-ingestion.worker.js';
import { WorkerRunner } from '../src/jobs/worker-runner.js';
import { DocumentIngestionService, ProcessEvidenceResult } from '../src/services/ingestion/document-ingestion.types.js';

describe('Job Recovery — Stale Processing Job Recovery & Execution', () => {
  let projectId: string;
  let evidenceId: string;
  let projectUploadDir: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });

    const project = projectRepository.create({
      name: 'Delhi-Mumbai Expressway Package 7',
      code: 'DME-P7'
    });
    projectId = project.id;

    projectUploadDir = path.resolve(process.cwd(), 'uploads', projectId);
    if (!fs.existsSync(projectUploadDir)) {
      fs.mkdirSync(projectUploadDir, { recursive: true });
    }
    fs.writeFileSync(path.join(projectUploadDir, 'recovery_report.csv'), 'Date,Activity,Progress\n2026-08-25,Excavation,100%');

    const ev = evidenceRepository.create({
      projectId,
      fileName: 'recovery_report.csv',
      filePath: `${projectId}/recovery_report.csv`,
      fileType: 'text',
      mimeType: 'text/csv'
    });
    evidenceId = ev.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(projectUploadDir)) {
      try {
        fs.rmSync(projectUploadDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  it('should recover stale processing job after restart and successfully process it to completed', async () => {
    // 1. Create a processing job with a stale locked_at timestamp (e.g. 15 minutes ago)
    const job = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId }
    });

    const db = getDatabase();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'processing',
          locked_at = ?,
          started_at = ?,
          attempt_count = 1
      WHERE id = ?
    `).run(fifteenMinutesAgo, fifteenMinutesAgo, job.id);

    const staleJob = jobRepository.getById(job.id);
    expect(staleJob?.status).toBe('processing');
    expect(staleJob?.lockedAt).toBe(fifteenMinutesAgo);

    // 2. Perform stale job recovery (threshold = 5 minutes)
    const recoveredCount = jobRepository.requeueStaleProcessingJobs(5 * 60 * 1000);
    expect(recoveredCount).toBe(1);

    // 3. Verify status transitioned back to 'queued' and locked_at was cleared
    const recoveredJob = jobRepository.getById(job.id);
    expect(recoveredJob?.status).toBe('queued');
    expect(recoveredJob?.lockedAt).toBeNull();

    // 4. Start worker and verify it claims and processes the recovered job
    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn().mockResolvedValue({
        evidence: evidenceRepository.getById(evidenceId)!,
        progressUpdate: { id: 'pu-recovered', projectId, reportDate: '2026-08-25', status: 'received' },
        normalizedDocument: { sourceType: 'csv', text: 'Excavation 100%', textLength: 15 },
        extraction: { items: [{ reference: 'Excavation', progress_percent: 100, status: 'completed' }] },
        matches: [{ id: 'm-rec-1', activityId: 'act-rec-1', confidenceScore: 1.0 }]
      } as unknown as ProcessEvidenceResult)
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    const hadJob = await runner.processNextJob();
    expect(hadJob).toBe(true);

    const completedJob = jobRepository.getById(job.id);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.attemptCount).toBe(2); // Initial attempt (1) + recovered attempt (2)
    expect(completedJob?.result).toEqual({
      evidenceId,
      progressUpdateId: 'pu-recovered',
      matchCount: 1,
      sourceType: 'csv'
    });
  });
});
