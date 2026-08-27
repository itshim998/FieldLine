import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { projectRiskStatusSchema } from '../src/validation/risk.schema.js';

describe('Pass 12 — Delay and Risk Engine Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testScheduleId: string;
  let act1Id: string;
  let act2Id: string;
  let act3Id: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    const db = getDatabase();
    const scheduleRepo = new SqliteScheduleRepository(() => db);
    const activityRepo = new SqliteActivityRepository(() => db);
    const progressRepo = new SqliteActivityProgressRepository(() => db);

    // 1. Create project
    const p1Res = await request(app)
      .post('/api/projects')
      .send({ name: 'Expressway Tunnel Package 4', code: 'ETP-04' });
    testProjectId = p1Res.body.project.id;

    // 2. Create schedule
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    // 3. Create activities
    // Act 1: 2026-08-01 to 2026-08-10 (Completed)
    const a1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-001',
      name: 'Site Clearing',
      location: 'Portal North',
      wbsCode: '1.0',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10',
      plannedQuantity: 1000,
      unit: 'm2'
    });
    act1Id = a1.id;

    // Act 2: 2026-08-01 to 2026-08-15 (Delayed as of 2026-08-20 with only 40% actual)
    const a2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-002',
      name: 'Tunnel Portal Excavation',
      location: 'Portal North',
      wbsCode: '2.0',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 500,
      unit: 'm3'
    });
    act2Id = a2.id;

    // Act 3: 2026-08-10 to 2026-08-30 (At Risk as of 2026-08-20: planned 50%, actual 20% -> variance -30%)
    const a3 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-003',
      name: 'Porewater Drainage',
      location: 'Shaft 1',
      wbsCode: '3.0',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-30',
      plannedQuantity: 100,
      unit: 'm'
    });
    act3Id = a3.id;

    // Progress updates
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1Id,
      actualPercent: 100,
      status: 'completed',
      asOfDate: '2026-08-09'
    });

    progressRepo.create({
      projectId: testProjectId,
      activityId: act2Id,
      actualPercent: 40,
      status: 'in_progress',
      asOfDate: '2026-08-12'
    });

    progressRepo.create({
      projectId: testProjectId,
      activityId: act3Id,
      actualPercent: 20,
      status: 'in_progress',
      asOfDate: '2026-08-18'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('GET /api/projects/:projectId/risk-status should return 200 with valid schema and correct classifications', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status?asOfDate=2026-08-20`)
      .expect(200);

    // Validate response payload against Zod schema
    const parseResult = projectRiskStatusSchema.safeParse(res.body);
    expect(parseResult.success).toBe(true);

    expect(res.body.projectId).toBe(testProjectId);
    expect(res.body.asOfDate).toBe('2026-08-20');
    expect(res.body.activities).toHaveLength(3);

    const act1 = res.body.activities.find((a: { activityId: string }) => a.activityId === act1Id);
    expect(act1.classification).toBe('COMPLETED');
    expect(act1.reasons[0].code).toBe('completed');

    const act2 = res.body.activities.find((a: { activityId: string }) => a.activityId === act2Id);
    expect(act2.classification).toBe('DELAYED');
    expect(act2.reasons[0].code).toBe('overdue');

    const act3 = res.body.activities.find((a: { activityId: string }) => a.activityId === act3Id);
    expect(act3.classification).toBe('AT_RISK');
    expect(act3.reasons[0].code).toBe('strong_negative_variance');

    expect(res.body.summary).toEqual({
      totalActivities: 3,
      completed: 1,
      delayed: 1,
      atRisk: 1,
      ahead: 0,
      onTrack: 0,
      overdueCount: 1
    });
  });

  it('GET /api/projects/:projectId/risk-status without asOfDate query should use default current date', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status`)
      .expect(200);

    expect(res.body.projectId).toBe(testProjectId);
    expect(typeof res.body.asOfDate).toBe('string');
    expect(res.body.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.activities).toHaveLength(3);
  });

  it('GET /api/projects/:projectId/risk-status should return 400 for invalid asOfDate format', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status?asOfDate=not-a-date`)
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it('GET /api/projects/:projectId/risk-status should return 400 for invalid month in asOfDate', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status?asOfDate=2026-13-01`)
      .expect(400);

    expect(res.body.error).toBeDefined();
  });

  it('GET /api/projects/:projectId/risk-status should return 404 if project does not exist', async () => {
    const res = await request(app)
      .get('/api/projects/non-existent-proj-id/risk-status?asOfDate=2026-08-20')
      .expect(404);

    expect(res.body.error).toBeDefined();
  });

  it('should be completely read-only and idempotent across repeated calls', async () => {
    const res1 = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status?asOfDate=2026-08-20`)
      .expect(200);

    const res2 = await request(app)
      .get(`/api/projects/${testProjectId}/risk-status?asOfDate=2026-08-20`)
      .expect(200);

    expect(res1.body.summary).toEqual(res2.body.summary);
    expect(res1.body.activities).toEqual(res2.body.activities);
  });
});
