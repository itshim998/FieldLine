import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import {
  matchReportResponseSchema,
  activityMatchListResponseSchema
} from '../src/validation/activity-matching.schema.js';

describe('Activity Matching Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testProject2Id: string;
  let testUpdateId: string;
  let testScheduleId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);

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

    // 3. Create schedule & activities for project 1
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-101',
      name: 'Foundation Excavation',
      location: 'Block B',
      wbsCode: '3.1',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-15'
    });

    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-102',
      name: 'Foundation Concrete Pour',
      location: 'Block B',
      wbsCode: '3.2',
      plannedStart: '2026-09-16',
      plannedFinish: '2026-09-30'
    });

    // 4. Create progress update for project 1
    const u1Res = await request(app)
      .post(`/api/projects/${testProjectId}/progress-updates`)
      .send({
        reportDate: '2026-08-26',
        reporterName: 'Sanjay Deshmukh',
        rawText: 'Foundation excavation is progressing well at Block B.'
      });
    testUpdateId = u1Res.body.progressUpdate.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('POST /api/projects/:projectId/progress-updates/:updateId/matches', () => {
    it('should match structured facts and return candidates with 200 OK', async () => {
      const payload = {
        extraction: {
          items: [
            {
              reference: 'foundation excavation work',
              location: 'Block B',
              progress_percent: 60,
              status: 'in_progress'
            }
          ]
        }
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.matches).toBeDefined();
      expect(res.body.matches).toHaveLength(1);

      const m = res.body.matches[0];
      expect(m.fact.reference).toBe('foundation excavation work');
      expect(m.bestMatch).not.toBeNull();
      expect(m.bestMatch.activityExternalId).toBe('ACT-101');
      expect(m.bestMatch.confidenceScore).toBeGreaterThanOrEqual(0.80);
      expect(m.alternatives.length).toBeGreaterThanOrEqual(1);

      const parsed = matchReportResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should reject malformed extraction payload with 400 Bad Request', async () => {
      const res1 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`)
        .send({});
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: '', // empty reference invalid
                location: null,
                progress_percent: 150, // invalid > 100
                status: 'invalid_status'
              }
            ]
          }
        });
      expect(res2.status).toBe(400);
    });

    it('should return 404 when project does not exist', async () => {
      const payload = {
        extraction: {
          items: [
            {
              reference: 'foundation work',
              location: null,
              progress_percent: 50,
              status: 'in_progress'
            }
          ]
        }
      };

      const res = await request(app)
        .post(`/api/projects/non-existent-proj/progress-updates/${testUpdateId}/matches`)
        .send(payload);

      expect(res.status).toBe(404);
    });

    it('should return 404 when progress update does not exist', async () => {
      const payload = {
        extraction: {
          items: [
            {
              reference: 'foundation work',
              location: null,
              progress_percent: 50,
              status: 'in_progress'
            }
          ]
        }
      };

      const res = await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/non-existent-update/matches`)
        .send(payload);

      expect(res.status).toBe(404);
    });

    it('should return 404 when progress update belongs to another project (strict isolation)', async () => {
      const payload = {
        extraction: {
          items: [
            {
              reference: 'foundation work',
              location: null,
              progress_percent: 50,
              status: 'in_progress'
            }
          ]
        }
      };

      // testUpdateId belongs to testProjectId, but request uses testProject2Id
      const res = await request(app)
        .post(`/api/projects/${testProject2Id}/progress-updates/${testUpdateId}/matches`)
        .send(payload);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/projects/:projectId/progress-updates/:updateId/matches', () => {
    it('should return saved matches for a progress update', async () => {
      // First run matching to generate suggestions
      await request(app)
        .post(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: 'foundation excavation',
                location: 'Block B',
                progress_percent: 60,
                status: 'in_progress'
              }
            ]
          }
        });

      const res = await request(app)
        .get(`/api/projects/${testProjectId}/progress-updates/${testUpdateId}/matches`);

      expect(res.status).toBe(200);
      expect(res.body.matches).toBeDefined();
      expect(res.body.matches).toHaveLength(1);
      expect(res.body.matches[0].status).toBe('confirmed');
      expect(res.body.matches[0].confidenceTier).toBe('high');
      expect(res.body.matches[0].projectId).toBe(testProjectId);
      expect(res.body.matches[0].progressUpdateId).toBe(testUpdateId);

      const parsed = activityMatchListResponseSchema.safeParse(res.body);
      expect(parsed.success).toBe(true);
    });

    it('should return 404 for cross-project access attempt on matches', async () => {
      const res = await request(app)
        .get(`/api/projects/${testProject2Id}/progress-updates/${testUpdateId}/matches`);

      expect(res.status).toBe(404);
    });
  });
});
