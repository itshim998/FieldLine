import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';

describe('Document Ingestion Router — POST /projects/:projectId/evidence/:evidenceId/process', () => {
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
      .attach('file', validCsvFile);
    evidenceId = evRes.body.evidence.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should synchronously process evidence document and return 200 with extraction result', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.evidence).toBeDefined();
    expect(res.body.evidence.id).toBe(evidenceId);
    expect(res.body.evidence.progressUpdateId).toBe(res.body.progressUpdate.id);

    expect(res.body.progressUpdate).toBeDefined();
    expect(res.body.progressUpdate.projectId).toBe(projectId);
    expect(res.body.progressUpdate.rawText).toContain('Pier P1 Pour');

    expect(res.body.normalizedDocument).toBeDefined();
    expect(res.body.normalizedDocument.sourceType).toBe('csv');
    expect(res.body.normalizedDocument.textLength).toBeGreaterThan(0);

    expect(res.body.extraction).toBeDefined();
    expect(res.body.extraction.items).toBeDefined();
    expect(Array.isArray(res.body.extraction.items)).toBe(true);
  });

  it('should return 404 for non-existent project', async () => {
    const res = await request(app)
      .post(`/api/projects/non-existent-proj/evidence/${evidenceId}/process`)
      .send();

    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent evidence', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/non-existent-ev/process`)
      .send();

    expect(res.status).toBe(404);
  });

  it('should return 400 for unprocessable / empty evidence file', async () => {
    const emptyEvRes = await request(app)
      .post(`/api/projects/${projectId}/evidence`)
      .attach('file', emptyFile);
    const emptyEvId = emptyEvRes.body.evidence.id;

    const res = await request(app)
      .post(`/api/projects/${projectId}/evidence/${emptyEvId}/process`)
      .send();

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
