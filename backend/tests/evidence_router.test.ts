import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import {
  evidenceResponseSchema,
  evidenceListResponseSchema
} from '../src/validation/evidence.schema.js';

describe('Evidence Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testProject2Id: string;
  let testUpdateId: string;

  const testTempDir = path.resolve(process.cwd(), 'test-router-artifacts');
  const dummyFilePath = path.join(testTempDir, 'test_site_memo.pdf');

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
    fs.writeFileSync(dummyFilePath, 'DUMMY PDF CONTENT FOR FIELDLINE PASS 13');

    // Create test project 1
    const p1Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Hyderabad Metro Phase 2', code: 'HMR-P2' });
    testProjectId = p1Res.body.project.id;

    // Create test project 2
    const p2Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Kolkata East-West Metro', code: 'KEWM-01' });
    testProject2Id = p2Res.body.project.id;

    // Create progress update in Project 1
    const uRes = await request(app)
      .post(`/api/projects/${testProjectId}/progress-updates`)
      .send({
        reportDate: '2026-08-24',
        reporterName: 'Amit Verma',
        reporterRole: 'Site Engineer',
        rawText: 'Pier casting underway at chainage 12+400.'
      });
    testUpdateId = uRes.body.progressUpdate.id;
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup
      }
    }
  });

  describe('POST /api/projects/:projectId/evidence', () => {
    it('should upload an evidence file and return 201 with valid metadata', async () => {
      const res = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath)
        .field('progressUpdateId', testUpdateId);

      expect(res.status).toBe(201);
      expect(res.body.evidence).toBeDefined();
      expect(res.body.evidence.projectId).toBe(testProjectId);
      expect(res.body.evidence.progressUpdateId).toBe(testUpdateId);
      expect(res.body.evidence.fileName).toBe('test_site_memo.pdf');
      expect(res.body.evidence.fileType).toBe('pdf');
      expect(res.body.evidence.fileSizeBytes).toBeGreaterThan(0);

      const parsed = evidenceResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return 400 ValidationError when no file is uploaded', async () => {
      const res = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .field('progressUpdateId', testUpdateId);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('No file uploaded');
    });

    it('should return 404 when project does not exist', async () => {
      const res = await request(app)
        .post('/api/projects/non-existent-proj-id/evidence')
        .attach('file', dummyFilePath);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/evidence', () => {
    it('should list all evidence records for the project', async () => {
      // Upload two files
      await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath);

      const res = await request(app).get(`/api/projects/${testProjectId}/evidence`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.evidence)).toBe(true);
      expect(res.body.evidence.length).toBe(1);

      const parsed = evidenceListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });
  });

  describe('GET /api/projects/:projectId/evidence/:evidenceId', () => {
    it('should retrieve single evidence record', async () => {
      const uploadRes = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath);

      const evidenceId = uploadRes.body.evidence.id;

      const res = await request(app).get(
        `/api/projects/${testProjectId}/evidence/${evidenceId}`
      );

      expect(res.status).toBe(200);
      expect(res.body.evidence.id).toBe(evidenceId);
      expect(res.body.evidence.fileName).toBe('test_site_memo.pdf');
    });

    it('should return 404 for missing evidence record', async () => {
      const res = await request(app).get(
        `/api/projects/${testProjectId}/evidence/non-existent-id`
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/evidence/:evidenceId/content', () => {
    it('should serve the physical file content with proper headers', async () => {
      const uploadRes = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath);

      const evidenceId = uploadRes.body.evidence.id;

      const res = await request(app).get(
        `/api/projects/${testProjectId}/evidence/${evidenceId}/content`
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('pdf');
      expect(res.headers['content-disposition']).toContain('test_site_memo.pdf');
      const textContent = res.text || (Buffer.isBuffer(res.body) ? res.body.toString('utf-8') : '');
      expect(textContent).toBe('DUMMY PDF CONTENT FOR FIELDLINE PASS 13');
    });
  });

  describe('GET /api/projects/:projectId/progress-updates/:updateId/evidence', () => {
    it('should retrieve evidence attached to progress report', async () => {
      await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath)
        .field('progressUpdateId', testUpdateId);

      const res = await request(app).get(
        `/api/projects/${testProjectId}/progress-updates/${testUpdateId}/evidence`
      );

      expect(res.status).toBe(200);
      expect(res.body.evidence).toHaveLength(1);
      expect(res.body.evidence[0].progressUpdateId).toBe(testUpdateId);
    });
  });

  describe('GET /api/projects/:projectId/activities/:activityId/evidence', () => {
    it('should trace evidence for an activity via ActivityProgress', async () => {
      // 1. Upload evidence attached to progress report
      const uploadRes = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath)
        .field('progressUpdateId', testUpdateId);

      const evId = uploadRes.body.evidence.id;

      // 2. Create schedule and activity in Project 1
      const schedRes = await request(app)
        .post(`/api/projects/${testProjectId}/schedules/import`)
        .attach(
          'file',
          Buffer.from(
            'Activity ID,Activity Name,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-01,Pier 12 Pour,2026-08-01,2026-08-31,100,m3'
          ),
          'schedule.csv'
        );

      const actRes = await request(app).get(
        `/api/projects/${testProjectId}/schedules/${schedRes.body.schedule.id}/activities`
      );
      const activityId = actRes.body.activities[0].id;

      // 3. Create match and normalize progress linking to this update
      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: 'Pier 12 Pour',
                location: null,
                progress_percent: 60,
                status: 'in_progress'
              }
            ]
          }
        });

      const getMatchesRes = await request(app).get(
        `/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`
      );
      const matchId = getMatchesRes.body.matches[0].id;

      const progRes = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send({
          matchId,
          fact: {
            reference: 'Pier 12 Pour',
            location: null,
            progress_percent: 60,
            status: 'in_progress'
          },
          allowSuggested: true
        });
      expect(progRes.status).toBe(200);

      // 4. Trace evidence for activity
      const traceRes = await request(app).get(
        `/api/projects/${testProjectId}/activities/${activityId}/evidence`
      );

      expect(traceRes.status).toBe(200);
      expect(traceRes.body.evidence).toHaveLength(1);
      expect(traceRes.body.evidence[0].id).toBe(evId);
    });
  });

  describe('DELETE /api/projects/:projectId/evidence/:evidenceId', () => {
    it('should delete evidence and return success', async () => {
      const uploadRes = await request(app)
        .post(`/api/projects/${testProjectId}/evidence`)
        .attach('file', dummyFilePath);

      const evidenceId = uploadRes.body.evidence.id;

      const delRes = await request(app).delete(
        `/api/projects/${testProjectId}/evidence/${evidenceId}`
      );

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      const getRes = await request(app).get(
        `/api/projects/${testProjectId}/evidence/${evidenceId}`
      );
      expect(getRes.status).toBe(404);
    });
  });
});
