import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { jobRepository } from '../src/jobs/job.repository.js';
import { DocumentIngestionWorker } from '../src/jobs/document-ingestion.worker.js';
import { WorkerRunner } from '../src/jobs/worker-runner.js';
import { DocumentIngestionService, ProcessEvidenceResult } from '../src/services/ingestion/document-ingestion.types.js';

describe('Job Worker & WorkerRunner — Processing Execution & Failure Isolation', () => {
  let projectId: string;
  let evidenceId: string;
  let projectUploadDir: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });

    const project = projectRepository.create({
      name: 'Coastal Road Package 2',
      code: 'CRP-2'
    });
    projectId = project.id;

    projectUploadDir = path.resolve(process.cwd(), 'uploads', projectId);
    if (!fs.existsSync(projectUploadDir)) {
      fs.mkdirSync(projectUploadDir, { recursive: true });
    }
    fs.writeFileSync(path.join(projectUploadDir, 'sample_report.csv'), 'Date,Activity,Progress\n2026-08-25,Paving,50%');

    const ev = evidenceRepository.create({
      projectId,
      fileName: 'sample_report.csv',
      filePath: `${projectId}/sample_report.csv`,
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

  it('should process a queued job and transition it to completed with bounded result', async () => {
    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn().mockResolvedValue({
        evidence: evidenceRepository.getById(evidenceId)!,
        progressUpdate: { id: 'pu-100', projectId, reportDate: '2026-08-25', status: 'received' },
        normalizedDocument: { sourceType: 'csv', text: 'Paving 50%', textLength: 10 },
        extraction: { items: [{ reference: 'Paving', progress_percent: 50, status: 'in_progress' }] },
        matches: [{ id: 'm-1', activityId: 'act-1', confidenceScore: 0.95 }]
      } as unknown as ProcessEvidenceResult)
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker, { pollingIntervalMs: 50 });

    const job = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId }
    });

    const hadJob = await runner.processNextJob();
    expect(hadJob).toBe(true);

    const updatedJob = jobRepository.getById(job.id);
    expect(updatedJob?.status).toBe('completed');
    expect(updatedJob?.result).toEqual({
      evidenceId,
      progressUpdateId: 'pu-100',
      matchCount: 1,
      sourceType: 'csv'
    });
    expect(mockIngestionService.processEvidence).toHaveBeenCalledWith(projectId, evidenceId);
  });

  it('should mark job as failed when DocumentIngestionService throws an error', async () => {
    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn().mockRejectedValue(new Error('Corrupt document binary or unreadable stream'))
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    const job = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId }
    });

    const hadJob = await runner.processNextJob();
    expect(hadJob).toBe(true);

    const updatedJob = jobRepository.getById(job.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.errorMessage).toContain('Corrupt document binary or unreadable stream');
  });

  it('should maintain Failure Isolation: Worker remains alive and processes next job when previous job fails', async () => {
    // Job A fails, Job B succeeds
    fs.writeFileSync(path.join(projectUploadDir, 'second_report.csv'), 'Date,Activity,Progress\n2026-08-25,Grading,70%');
    const ev2 = evidenceRepository.create({
      projectId,
      fileName: 'second_report.csv',
      filePath: `${projectId}/second_report.csv`,
      fileType: 'text',
      mimeType: 'text/csv'
    });

    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn()
        .mockRejectedValueOnce(new Error('AI extraction model rate limit exceeded'))
        .mockResolvedValueOnce({
          evidence: ev2,
          progressUpdate: { id: 'pu-200', projectId, reportDate: '2026-08-25', status: 'received' },
          normalizedDocument: { sourceType: 'csv', text: 'Second doc', textLength: 10 },
          extraction: { items: [] },
          matches: []
        } as unknown as ProcessEvidenceResult)
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    // Create Job A then Job B
    const jobA = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId }
    });

    const jobB = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId: ev2.id }
    });

    // Process Job A
    const processedA = await runner.processNextJob();
    expect(processedA).toBe(true);
    const resA = jobRepository.getById(jobA.id);
    expect(resA?.status).toBe('failed');
    expect(resA?.errorMessage).toContain('AI extraction model rate limit exceeded');

    // Process Job B — worker is still alive and processes Job B successfully!
    const processedB = await runner.processNextJob();
    expect(processedB).toBe(true);
    const resB = jobRepository.getById(jobB.id);
    expect(resB?.status).toBe('completed');
    expect(resB?.result).toBeDefined();
  });

  it('should mark job failed when job payload is malformed', async () => {
    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn()
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    const job = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: {} as any // missing evidenceId
    });

    const hadJob = await runner.processNextJob();
    expect(hadJob).toBe(true);

    const updatedJob = jobRepository.getById(job.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.errorMessage).toContain('Malformed job payload');
  });

  it('should mark job failed when evidence does not exist or has been deleted', async () => {
    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn()
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    const job = jobRepository.create({
      projectId,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'non-existent-ev-id' }
    });

    const hadJob = await runner.processNextJob();
    expect(hadJob).toBe(true);

    const updatedJob = jobRepository.getById(job.id);
    expect(updatedJob?.status).toBe('failed');
    expect(updatedJob?.errorMessage).toContain('not found for project');
  });

  it('should execute Concurrency Sanity Test: processes multiple queued jobs in order without collision', async () => {
    const processedJobs: string[] = [];

    const mockIngestionService: DocumentIngestionService = {
      extractDocument: vi.fn(),
      processEvidence: vi.fn().mockImplementation(async (_pId: string, evId: string) => {
        processedJobs.push(evId);
        return {
          evidence: evidenceRepository.getById(evId)!,
          progressUpdate: { id: `pu-${evId}`, projectId, reportDate: '2026-08-25', status: 'received' },
          normalizedDocument: { sourceType: 'csv', text: 'Text', textLength: 4 },
          extraction: { items: [] },
          matches: []
        } as unknown as ProcessEvidenceResult;
      })
    };

    const worker = new DocumentIngestionWorker(mockIngestionService, evidenceRepository, jobRepository);
    const runner = new WorkerRunner(jobRepository, worker);

    // Create 3 evidence items and queued jobs
    const evIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(path.join(projectUploadDir, `file_${i}.csv`), 'Date,Activity,Progress\n2026-08-25,Work,10%');
      const ev = evidenceRepository.create({
        projectId,
        fileName: `file_${i}.csv`,
        filePath: `${projectId}/file_${i}.csv`,
        fileType: 'text'
      });
      evIds.push(ev.id);
      jobRepository.create({
        projectId,
        jobType: 'document_ingestion',
        payload: { evidenceId: ev.id }
      });
    }

    // Run sequentially with single runner
    let count = 0;
    while (await runner.processNextJob()) {
      count++;
    }

    expect(count).toBe(3);
    expect(processedJobs).toEqual(evIds);

    const allJobs = jobRepository.listByProjectId(projectId);
    expect(allJobs.every((j) => j.status === 'completed')).toBe(true);
  });
});
