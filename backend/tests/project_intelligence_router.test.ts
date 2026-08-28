import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { projectIntelligenceSchema } from '../src/validation/intelligence.schema.js';

describe('Pass 17 — Project Intelligence Router Endpoints (GET /api/projects/:projectId/intelligence)', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testScheduleId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);
    const progressRepo = new SqliteActivityProgressRepository(() => db);
    const eventRepo = new SqliteProjectEventRepository(() => db);

    // 1. Create project
    const pRes = await request(app)
      .post('/api/projects')
      .send({ name: 'Freight Corridor Package 1', code: 'FCP-01' });
    testProjectId = pRes.body.project.id;

    // 2. Create schedule
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    // 3. Create activities
    const act1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-001',
      name: 'Subgrade Preparation',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });

    // Delayed observation (overdue)
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1.id,
      actualPercent: 40,
      status: 'in_progress',
      asOfDate: '2026-08-15'
    });

    // Event on asOfDate
    eventRepo.create({
      projectId: testProjectId,
      eventType: 'progress_updated',
      summary: 'Subgrade reported 40%',
      createdAt: '2026-08-15 10:00:00'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should return 200 with structured intelligence facts conforming to schema', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/intelligence`)
      .query({ asOfDate: '2026-08-15', recentDays: 7, approachingDays: 14 });

    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(testProjectId);
    expect(res.body.asOfDate).toBe('2026-08-15');

    // Validate structure against Zod schema
    const parseResult = projectIntelligenceSchema.safeParse(res.body);
    expect(parseResult.success).toBe(true);

    expect(res.body.delayed).toHaveLength(1);
    expect(res.body.delayed[0].externalId).toBe('ACT-001');
    expect(res.body.recentChanges).toHaveLength(1);
  });

  it('should use default parameters when query parameters are omitted', async () => {
    const res = await request(app).get(`/api/projects/${testProjectId}/intelligence`);
    expect(res.status).toBe(200);
    expect(res.body.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(res.body.delayed)).toBe(true);
    expect(Array.isArray(res.body.atRisk)).toBe(true);
    expect(Array.isArray(res.body.completedToday)).toBe(true);
    expect(Array.isArray(res.body.behindSchedule)).toBe(true);
    expect(Array.isArray(res.body.approachingMilestones)).toBe(true);
    expect(Array.isArray(res.body.staleActivities)).toBe(true);
    expect(Array.isArray(res.body.recentChanges)).toBe(true);
  });

  it('should return 400 when invalid query parameters are supplied', async () => {
    const res1 = await request(app)
      .get(`/api/projects/${testProjectId}/intelligence`)
      .query({ asOfDate: 'not-a-date' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .get(`/api/projects/${testProjectId}/intelligence`)
      .query({ recentDays: 0 });
    expect(res2.status).toBe(400);

    const res3 = await request(app)
      .get(`/api/projects/${testProjectId}/intelligence`)
      .query({ approachingDays: -1 });
    expect(res3.status).toBe(400);
  });

  it('should return 404 when project does not exist', async () => {
    const res = await request(app).get(
      '/api/projects/ffffffff-ffff-ffff-ffff-ffffffffffff/intelligence'
    );
    expect(res.status).toBe(404);
  });
});
