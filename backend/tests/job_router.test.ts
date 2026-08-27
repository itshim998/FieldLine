import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { jobRepository } from '../src/jobs/job.repository.js';
import { workerRunner } from '../src/jobs/worker-runner.js';

describe('Job Router — Async Job Enqueueing, Status API, & Project Isolation', () => {
  let app: ReturnType<typeof createApp>;
  let projectId1: string;
  let projectId2: string;
  let evidenceId1: string;

  const testTempDir = path.resolve(process.cwd(), 'test-job-router-artifacts');
  const validFile = path.join(testTempDir, 'daily_log.csv');

  beforeAll(() => {
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    fs.writeFileSync(validFile, 'Date,Activity,Progress\n2026-08-25,Trenching,40%');
  });

  afterAll(() => {
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const p1Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Project One', code: 'PRJ-1' });
    projectId1 = p1Res.body.project.id;

    const p2Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Project Two', code: 'PRJ-2' });
    projectId2 = p2Res.body.project.id;

    const evRes = await request(app)
      .post(`/api/projects/${projectId1}/evidence`)
      .attach('file', validFile);
    evidenceId1 = evRes.body.evidence.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return 202 Accepted when enqueueing a document ingestion job', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId1}/evidence/${evidenceId1}/process`)
      .send();

    expect(res.status).toBe(202);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.id).toBeDefined();
    expect(res.body.job.projectId).toBe(projectId1);
    expect(res.body.job.jobType).toBe('document_ingestion');
    expect(res.body.job.status).toBe('queued');
    expect(res.body.job.createdAt).toBeDefined();
  });

  it('should reuse existing active job when requesting processing on already queued/processing evidence', async () => {
    // First request creates the job
    const res1 = await request(app)
      .post(`/api/projects/${projectId1}/evidence/${evidenceId1}/process`)
      .send();
    expect(res1.status).toBe(202);
    const jobId1 = res1.body.job.id;

    // Second request returns the exact same active job without creating a duplicate
    const res2 = await request(app)
      .post(`/api/projects/${projectId1}/evidence/${evidenceId1}/process`)
      .send();
    expect(res2.status).toBe(202);
    expect(res2.body.job.id).toBe(jobId1);

    const jobs = jobRepository.listByProjectId(projectId1);
    expect(jobs).toHaveLength(1);
  });

  it('should return sanitized job details for all state transitions (queued, processing, completed, failed)', async () => {
    // 1. Queued state
    const job = jobRepository.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: evidenceId1 }
    });

    const queuedRes = await request(app).get(`/api/projects/${projectId1}/jobs/${job.id}`);
    expect(queuedRes.status).toBe(200);
    expect(queuedRes.body.job.status).toBe('queued');
    expect(queuedRes.body.job.startedAt).toBeUndefined();
    expect(queuedRes.body.job.completedAt).toBeUndefined();
    expect(queuedRes.body.job.result).toBeUndefined();

    // 2. Processing state
    jobRepository.claimNextQueued();
    const processingRes = await request(app).get(`/api/projects/${projectId1}/jobs/${job.id}`);
    expect(processingRes.status).toBe(200);
    expect(processingRes.body.job.status).toBe('processing');
    expect(processingRes.body.job.startedAt).toBeDefined();
    expect(processingRes.body.job.completedAt).toBeUndefined();

    // 3. Completed state
    jobRepository.markCompleted(job.id, {
      evidenceId: evidenceId1,
      progressUpdateId: 'pu-300',
      matchCount: 1,
      sourceType: 'csv'
    });
    const completedRes = await request(app).get(`/api/projects/${projectId1}/jobs/${job.id}`);
    expect(completedRes.status).toBe(200);
    expect(completedRes.body.job.status).toBe('completed');
    expect(completedRes.body.job.completedAt).toBeDefined();
    expect(completedRes.body.job.result).toEqual({
      evidenceId: evidenceId1,
      progressUpdateId: 'pu-300',
      matchCount: 1,
      sourceType: 'csv'
    });

    // 4. Failed state (create separate job to test failed response)
    const failJob = jobRepository.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-fail' }
    });
    jobRepository.claimNextQueued();
    jobRepository.markFailed(failJob.id, 'C:\\Users\\Secret\\app\\error.ts: Failed to parse OCR');

    const failedRes = await request(app).get(`/api/projects/${projectId1}/jobs/${failJob.id}`);
    expect(failedRes.status).toBe(200);
    expect(failedRes.body.job.status).toBe('failed');
    expect(failedRes.body.job.completedAt).toBeDefined();
    expect(failedRes.body.job.errorMessage).not.toContain('C:\\Users\\Secret');
    expect(failedRes.body.job.errorMessage).toContain('Failed to parse OCR');
  });

  it('should enforce Project Isolation: return 404 when accessing another project\'s job', async () => {
    const job = jobRepository.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: evidenceId1 }
    });

    // Project 1 can access
    const res1 = await request(app).get(`/api/projects/${projectId1}/jobs/${job.id}`);
    expect(res1.status).toBe(200);

    // Project 2 accessing Project 1 job returns 404
    const res2 = await request(app).get(`/api/projects/${projectId2}/jobs/${job.id}`);
    expect(res2.status).toBe(404);
  });

  it('should list jobs scoped to project', async () => {
    jobRepository.create({
      projectId: projectId1,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-1' }
    });
    jobRepository.create({
      projectId: projectId2,
      jobType: 'document_ingestion',
      payload: { evidenceId: 'ev-2' }
    });

    const res = await request(app).get(`/api/projects/${projectId1}/jobs?type=document_ingestion`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].projectId).toBe(projectId1);
  });
});
