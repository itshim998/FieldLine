import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { SqliteJobRepository, JobRepository } from '../src/jobs/job.repository.js';

describe('JobRepository — In-Process Processing Jobs', () => {
  let jobRepo: JobRepository;
  let projectId1: string;
  let projectId2: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    jobRepo = new SqliteJobRepository();

    const p1 = projectRepository.create({ name: 'Project Alpha', code: 'PRJ-A' });
    const p2 = projectRepository.create({ name: 'Project Beta', code: 'PRJ-B' });
    projectId1 = p1.id;
    projectId2 = p2.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should create a queued job with default values', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-123' }
    });

    expect(job.id).toBeDefined();
    expect(job.projectId).toBe(projectId1);
    expect(job.jobType).toBe('document_ingestion');
    expect(job.status).toBe('queued');
    expect(job.payload).toEqual({ evidenceId: 'ev-123' });
    expect(job.attemptCount).toBe(0);
    expect(job.lockedAt).toBeNull();
    expect(job.startedAt).toBeNull();
    expect(job.completedAt).toBeNull();
  });

  it('should create a job and record project event atomically with createWithEvent', () => {
    const job = jobRepo.createWithEvent(
      {
        projectId: projectId1,
        jobType: 'document_ingestion',
        payload: { evidenceId: 'ev-999' }
      },
      {
        projectId: projectId1,
        eventType: 'processing_job_queued',
        summary: 'Job queued for testing'
      }
    );

    expect(job.id).toBeDefined();
    expect(job.status).toBe('queued');

    const db = getDatabase();
    const event = db.prepare(
      "SELECT * FROM project_events WHERE entity_id = ? AND event_type = 'processing_job_queued'"
    ).get(job.id) as any;
    expect(event).toBeDefined();
    expect(event.project_id).toBe(projectId1);
  });

  it('should retrieve a project-scoped job by ID and project ID', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-123' }
    });

    const retrieved = jobRepo.getByIdAndProjectId(job.id, projectId1);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(job.id);
  });

  it('should enforce cross-project lookup isolation', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-proj1' }
    });

    // Attempt to access Project 1 job using Project 2 ID
    const crossProjectLookup = jobRepo.getByIdAndProjectId(job.id, projectId2);
    expect(crossProjectLookup).toBeNull();
  });

  it('should list jobs for a specific project', () => {
    jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-1' }
    });
    jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-2' }
    });
    jobRepo.create({
      projectId: projectId2,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-3' }
    });

    const p1Jobs = jobRepo.listByProjectId(projectId1);
    expect(p1Jobs).toHaveLength(2);

    const p2Jobs = jobRepo.listByProjectId(projectId2);
    expect(p2Jobs).toHaveLength(1);
  });

  it('should find existing active document ingestion job for the same evidence', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-duplicate-check' }
    });

    const existing = jobRepo.findExistingActiveDocumentIngestionJob(projectId1, 'ev-duplicate-check');
    expect(existing).not.toBeNull();
    expect(existing?.id).toBe(job.id);

    // Different evidence should return null
    const other = jobRepo.findExistingActiveDocumentIngestionJob(projectId1, 'ev-other');
    expect(other).toBeNull();

    // Cross-project lookup should return null
    const crossProj = jobRepo.findExistingActiveDocumentIngestionJob(projectId2, 'ev-duplicate-check');
    expect(crossProj).toBeNull();
  });

  it('should claim next queued job atomically and increment attempt count', () => {
    const job1 = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-first' }
    });

    const claimed = jobRepo.claimNextQueued();
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(job1.id);
    expect(claimed?.status).toBe('processing');
    expect(claimed?.attemptCount).toBe(1);
    expect(claimed?.lockedAt).not.toBeNull();
    expect(claimed?.startedAt).not.toBeNull();
  });

  it('should not claim already processing jobs (returns null when queue is empty)', () => {
    jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-1' }
    });

    // Claim first job
    const firstClaim = jobRepo.claimNextQueued();
    expect(firstClaim).not.toBeNull();

    // Attempt second claim - no queued jobs remain
    const secondClaim = jobRepo.claimNextQueued();
    expect(secondClaim).toBeNull();
  });

  it('should mark job completed with result payload', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-complete-test' }
    });

    jobRepo.claimNextQueued();

    const completed = jobRepo.markCompleted(job.id, {
      evidenceId: 'ev-complete-test',
      progressUpdateId: 'pu-123',
      matchCount: 2,
      sourceType: 'xlsx'
    });

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe('completed');
    expect(completed?.completedAt).not.toBeNull();
    expect(completed?.lockedAt).toBeNull();
    expect(completed?.result).toEqual({
      evidenceId: 'ev-complete-test',
      progressUpdateId: 'pu-123',
      matchCount: 2,
      sourceType: 'xlsx'
    });
  });

  it('should mark job failed with error message', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-fail-test' }
    });

    jobRepo.claimNextQueued();

    const failed = jobRepo.markFailed(job.id, 'Failed to parse corrupt PDF document');
    expect(failed).not.toBeNull();
    expect(failed?.status).toBe('failed');
    expect(failed?.completedAt).not.toBeNull();
    expect(failed?.lockedAt).toBeNull();
    expect(failed?.errorMessage).toBe('Failed to parse corrupt PDF document');
  });

  it('should requeue stale processing jobs whose lock has expired', () => {
    const job = jobRepo.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-stale' }
    });

    // Manually set to processing with a timestamp from 10 minutes ago
    const db = getDatabase();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare(`
      UPDATE processing_jobs
      SET status = 'processing',
          locked_at = ?,
          started_at = ?
      WHERE id = ?
    `).run(tenMinutesAgo, tenMinutesAgo, job.id);

    // Requeue with 5-minute lease threshold
    const requeuedCount = jobRepo.requeueStaleProcessingJobs(5 * 60 * 1000);
    expect(requeuedCount).toBe(1);

    const refreshed = jobRepo.getById(job.id);
    expect(refreshed?.status).toBe('queued');
    expect(refreshed?.lockedAt).toBeNull();
  });
});
