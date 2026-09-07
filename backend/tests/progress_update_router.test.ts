import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import {
  progressUpdateResponseSchema,
  progressUpdateListResponseSchema
} from '../src/validation/progress-update.schema.js';
import { workerAuthHeader } from './helpers/auth-test-helper.js';

describe('Progress Update Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testProject2Id: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    // Seed test projects
    const p1Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Navi Mumbai International Airport', code: 'NMIA-01' });
    testProjectId = p1Res.body.project.id;

    const p2Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Western Dedicated Freight Corridor', code: 'WDFC-02' });
    testProject2Id = p2Res.body.project.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('POST /api/projects/:projectId/progress-updates', () => {
    it('should create a manual progress update and return 201 Created', async () => {
      const payload = {
        reportDate: '2026-08-26',
        reporterName: 'Sanjay Deshmukh',
        reporterRole: 'Senior Site Supervisor',
        rawText: 'Foundation work at Block B is 60% complete. Concrete pouring started today.'
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.progressUpdate).toBeDefined();
      expect(res.body.progressUpdate.projectId).toBe(testProjectId);
      expect(res.body.progressUpdate.reportDate).toBe('2026-08-26');
      expect(res.body.progressUpdate.reporterName).toBe('Sanjay Deshmukh');
      expect(res.body.progressUpdate.reporterRole).toBe('Senior Site Supervisor');
      expect(res.body.progressUpdate.rawText).toBe(payload.rawText);
      expect(res.body.progressUpdate.sourceType).toBe('manual');
      expect(res.body.progressUpdate.status).toBe('received');
      expect(res.body.progressUpdate.createdAt).toBeDefined();
      expect(res.body.progressUpdate.updatedAt).toBeDefined();

      const parsed = progressUpdateResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should force sourceType to "manual" and status to "received" even if client attempts to spoof them', async () => {
      const payload = {
        reportDate: '2026-08-26',
        reporterName: 'Attacker',
        rawText: 'Trying to spoof fields',
        sourceType: 'pdf',
        status: 'reviewed'
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.progressUpdate.sourceType).toBe('manual');
      expect(res.body.progressUpdate.status).toBe('received');
    });

    it('should reject request when rawText is missing or whitespace only', async () => {
      const res1 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-26'
        });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-26',
          rawText: '   \n  '
        });
      expect(res2.status).toBe(400);
    });

    it('should reject request when reportDate is invalid or non-existent calendar date', async () => {
      const res1 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-02-31', // Invalid leap day / Feb 31
          rawText: 'Valid text'
        });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: 'not-a-date',
          rawText: 'Valid text'
        });
      expect(res2.status).toBe(400);
    });

    it('should return 404 Not Found when submitting to a non-existent project', async () => {
      const res = await request(app)
        .post('/api/projects/non-existent-proj-id/progress-updates')
        .set(workerAuthHeader('non-existent-proj-id'))
        .send({
          reportDate: '2026-08-26',
          rawText: 'Orphan update'
        });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/progress-updates', () => {
    it('should return an empty array for a project without progress updates', async () => {
      const res = await request(app)
        .get(`/api/projects/${testProjectId}/progress-updates`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ progressUpdates: [] });

      const parsed = progressUpdateListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return all updates for a project ordered newest-first', async () => {
      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-20',
          rawText: 'Early work report'
        });

      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-26',
          rawText: 'Recent work report'
        });

      // Update for second project (should not appear in project 1)
      await request(app)
        .post(`/api/projects/${testProject2Id}/progress-updates`)
        .set(workerAuthHeader(testProject2Id))
        .send({
          reportDate: '2026-08-26',
          rawText: 'Project 2 report'
        });

      const res = await request(app)
        .get(`/api/projects/${testProjectId}/progress-updates`);

      expect(res.status).toBe(200);
      expect(res.body.progressUpdates).toHaveLength(2);
      expect(res.body.progressUpdates[0].reportDate).toBe('2026-08-26');
      expect(res.body.progressUpdates[0].rawText).toBe('Recent work report');
      expect(res.body.progressUpdates[1].reportDate).toBe('2026-08-20');
      expect(res.body.progressUpdates[1].rawText).toBe('Early work report');

      const parsed = progressUpdateListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return 404 when requesting updates for a non-existent project', async () => {
      const res = await request(app)
        .get('/api/projects/unknown-proj-id/progress-updates');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/progress-updates/:updateId', () => {
    it('should retrieve a specific progress update by ID', async () => {
      const createRes = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-26',
          reporterName: 'Anil Mehta',
          reporterRole: 'Quality Inspector',
          rawText: 'Girders hoisted successfully on Span S-04.'
        });

      const updateId = createRes.body.progressUpdate.id;

      const res = await request(app)
        .get(`/api/projects/${testProjectId}/progress-updates/${updateId}`);

      expect(res.status).toBe(200);
      expect(res.body.progressUpdate).toBeDefined();
      expect(res.body.progressUpdate.id).toBe(updateId);
      expect(res.body.progressUpdate.projectId).toBe(testProjectId);
      expect(res.body.progressUpdate.reporterName).toBe('Anil Mehta');
      expect(res.body.progressUpdate.rawText).toBe('Girders hoisted successfully on Span S-04.');

      const parsed = progressUpdateResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should reject cross-project access with 404 Not Found (strict isolation)', async () => {
      const createRes = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates`)
        .set(workerAuthHeader(testProjectId))
        .send({
          reportDate: '2026-08-26',
          rawText: 'Secret project update'
        });

      const updateId = createRes.body.progressUpdate.id;

      // Try to access testProjectId's update using testProject2Id
      const res = await request(app)
        .get(`/api/projects/${testProject2Id}/progress-updates/${updateId}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when update ID does not exist', async () => {
      const res = await request(app)
        .get(`/api/projects/${testProjectId}/progress-updates/non-existent-update-id`);

      expect(res.status).toBe(404);
    });

    it('should return 404 when project does not exist', async () => {
      const res = await request(app)
        .get('/api/projects/unknown-proj-id/progress-updates/some-update-id');

      expect(res.status).toBe(404);
    });
  });
});
