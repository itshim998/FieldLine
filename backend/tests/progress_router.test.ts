import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { activityProgressResponseSchema } from '../src/validation/progress-normalization.schema.js';
import { workerAuthHeader } from './helpers/auth-test-helper.js';

describe('Pass 10 — Progress Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testProject2Id: string;
  let testUpdateId: string;
  let testScheduleId: string;
  let testActivityId: string;
  let testConfirmedMatchId: string;
  let testSuggestedMatchId: string;
  let testRejectedMatchId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);
    const matchRepo = new SqliteActivityMatchRepository(() => db);

    // 1. Create project 1
    const p1Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Navi Mumbai International Airport', code: 'NMIA-01' });
    testProjectId = p1Res.body.project.id;

    // 2. Create project 2
    const p2Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Western Dedicated Freight Corridor', code: 'WDFC-02' });
    testProject2Id = p2Res.body.project.id;

    // 3. Create schedule & activity for project 1
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    const a1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation',
      location: 'Block B',
      wbsCode: '3.1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15',
      plannedQuantity: 500,
      unit: 'm3'
    });
    testActivityId = a1.id;

    // 4. Create progress update for project 1
    const u1Res = await request(app)
      .post(`/api/projects/${testProjectId}/progress-updates`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-26',
        reporterName: 'Sanjay Deshmukh',
        rawText: 'Foundation excavation is progressing at Block B.'
      });
    testUpdateId = u1Res.body.progressUpdate.id;

    // 5. Create matches
    const mConfirmed = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      status: 'confirmed'
    });
    testConfirmedMatchId = mConfirmed.id;

    const mSuggested = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.75,
      matchMethod: 'text_similarity',
      status: 'suggested'
    });
    testSuggestedMatchId = mSuggested.id;

    const mRejected = matchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testUpdateId,
      activityId: testActivityId,
      confidenceScore: 0.35,
      matchMethod: 'wbs_location',
      status: 'rejected'
    });
    testRejectedMatchId = mRejected.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('POST /api/projects/:projectId/progress-updates/:updateId/progress', () => {
    it('normalizes progress with reported percentage and confirmed match returning 200 OK', async () => {
      const payload = {
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.progress).toBeDefined();
      expect(res.body.progress.actualPercent).toBe(60);
      expect(res.body.progress.status).toBe('in_progress');
      expect(res.body.progress.activityId).toBe(testActivityId);

      const parsed = activityProgressResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('normalizes progress with quantity-derived math', async () => {
      const payload = {
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: null,
          status: 'in_progress'
        },
        actualQuantity: 300,
        quantityUnit: 'm3'
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.progress.actualPercent).toBe(60);
      expect(res.body.progress.actualQuantity).toBe(300);
      expect(res.body.progress.notes).toContain('Quantity-derived progress');
    });

    it('rejects suggested match when allowSuggested is false', async () => {
      const payload = {
        matchId: testSuggestedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        },
        allowSuggested: false
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('suggested');
    });

    it('accepts suggested match when allowSuggested is explicitly true', async () => {
      const payload = {
        matchId: testSuggestedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        },
        allowSuggested: true
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.progress.actualPercent).toBe(60);
    });

    it('rejects rejected match even with allowSuggested=true', async () => {
      const payload = {
        matchId: testRejectedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        },
        allowSuggested: true
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('rejected');
    });

    it('rejects when no numeric percentage is available', async () => {
      const payload = {
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: null,
          status: 'in_progress'
        }
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('no deterministic actual percentage is available');
    });


    it('returns 404 for cross-project scoping violations', async () => {
      const payload = {
        matchId: testConfirmedMatchId,
        fact: {
          reference: 'foundation excavation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      };

      const res = await request(app)
        .post(`/api/projects/${testProject2Id}/progress-updates/${testUpdateId}/progress`)
        .send(payload);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/activities/:activityId/progress', () => {
    it('retrieves observation history and latest observation for an activity', async () => {
      // Record progress 1
      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send({
          matchId: testConfirmedMatchId,
          fact: {
            reference: 'excavation',
            location: 'Block B',
            progress_percent: 40,
            status: 'in_progress'
          },
          asOfDate: '2026-08-20'
        });

      // Record progress 2
      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/progress`)
        .send({
          matchId: testConfirmedMatchId,
          fact: {
            reference: 'excavation',
            location: 'Block B',
            progress_percent: 65,
            status: 'in_progress'
          },
          asOfDate: '2026-08-26'
        });

      // Fetch history
      const listRes = await request(app)
        .get(`/api/projects/${testProjectId}/activities/${testActivityId}/progress`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.progress).toHaveLength(2);
      expect(listRes.body.progress[0].asOfDate).toBe('2026-08-26');
      expect(listRes.body.progress[0].actualPercent).toBe(65);

      // Fetch latest
      const latestRes = await request(app)
        .get(`/api/projects/${testProjectId}/activities/${testActivityId}/progress/latest`);

      expect(latestRes.status).toBe(200);
      expect(latestRes.body.progress).toBeDefined();
      expect(latestRes.body.progress.asOfDate).toBe('2026-08-26');
      expect(latestRes.body.progress.actualPercent).toBe(65);
    });
  });
});
