import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { workerRunner } from '../src/jobs/worker-runner.js';
import { adminAuthHeader, workerAuthHeader } from './helpers/auth-test-helper.js';

describe('Document Ingestion Router — POST /projects/:projectId/evidence/:evidenceId/process (Pass 15 Async)', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let evidenceId: string;

  const testTempDir = path.resolve(process.cwd(), 'test-doc-ingestion-router-artifacts');
  const validCsvFile = path.join(testTempDir, 'field_notes.csv');
  const emptyFile = path.join(testTempDir, 'empty.csv');

  beforeAll(() => {
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    fs.writeFileSync(
      validCsvFile,
      'Date,Work Item,Location,Progress,Status\n2026-08-25,Pier P1 Pour,Zone A,60%,in_progress'
    );
    fs.writeFileSync(emptyFile, '');
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

    const pRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Navi Mumbai International Airport', code: 'NMIA' });
    projectId = pRes.body.project.id;

    const evRes = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .set(workerAuthHeader(projectId))
      .attach('file', validCsvFile);
    evidenceId = evRes.body.evidence.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should enqueue document ingestion job and return 202 Accepted with queued job', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
      .set(adminAuthHeader(projectId))
      .send();

    expect(res.status).toBe(202);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.id).toBeDefined();
    expect(res.body.job.projectId).toBe(projectId);
    expect(res.body.job.jobType).toBe('document_ingestion');
    expect(res.body.job.status).toBe('queued');
    expect(res.body.job.createdAt).toBeDefined();

    // Verify worker can process this enqueued job
    const processed = await workerRunner.processNextJob();
    expect(processed).toBe(true);

    const statusRes = await request(app)
      .get(`/api/projects/${projectId}/jobs/${res.body.job.id}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.job.status).toBe('completed');
    expect(statusRes.body.job.result).toBeDefined();
    expect(statusRes.body.job.result.evidenceId).toBe(evidenceId);
  });

  it('should return 404 for non-existent project', async () => {
    const res = await request(app)
      .post(`/api/projects/non-existent-proj/evidence/${evidenceId}/process`)
      .set(adminAuthHeader('non-existent-proj'))
      .send();

    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent evidence', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/non-existent-ev/process`)
      .set(adminAuthHeader(projectId))
      .send();

    expect(res.status).toBe(404);
  });

  it('should enqueue unprocessable / empty evidence file and worker marks it failed', async () => {
    const emptyEvRes = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .set(workerAuthHeader(projectId))
      .attach('file', emptyFile);
    const emptyEvId = emptyEvRes.body.evidence.id;

    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/${emptyEvId}/process`)
      .set(adminAuthHeader(projectId))
      .send();

    expect(res.status).toBe(202);
    expect(res.body.job).toBeDefined();
    expect(res.body.job.status).toBe('queued');

    // Run worker
    const processed = await workerRunner.processNextJob();
    expect(processed).toBe(true);

    const statusRes = await request(app)
      .get(`/api/projects/${projectId}/jobs/${res.body.job.id}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.job.status).toBe('failed');
    expect(statusRes.body.job.errorMessage).toBeDefined();
  });
});
