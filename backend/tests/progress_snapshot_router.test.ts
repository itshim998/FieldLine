import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { projectProgressSnapshotSchema } from '../src/validation/progress-snapshot.schema.js';

describe('Pass 11 — Planned vs Actual Progress Snapshot Router Endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let testProjectId: string;
  let testScheduleId: string;
  let act1Id: string;
  let act2Id: string;

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
      .send({ name: 'High Speed Rail Package 1', code: 'HSR-01' });
    testProjectId = p1Res.body.project.id;

    // 2. Create schedule
    const s1 = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = s1.id;

    // 3. Create activities
    // Act 1: 2026-08-01 to 2026-08-20 (20 days)
    const a1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-001',
      name: 'Site Clearing',
      location: 'Section 1',
      wbsCode: '1.0',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20',
      plannedQuantity: 1000,
      unit: 'm2'
    });
    act1Id = a1.id;

    // Act 2: 2026-08-10 to 2026-08-30 (20 days)
    const a2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-002',
      name: 'Foundation Piling',
      location: 'Section 2',
      wbsCode: '2.0',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-30',
      plannedQuantity: 50,
      unit: 'piles'
    });
    act2Id = a2.id;

    // 4. Create observations for Act 1:
    // Obs 1 at 2026-08-10: 50%
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1Id,
      actualPercent: 50,
      actualQuantity: 500,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-10'
    });

    // Obs 2 at 2026-08-20: 100%
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1Id,
      actualPercent: 100,
      actualQuantity: 1000,
      actualStart: '2026-08-01',
      actualFinish: '2026-08-19',
      status: 'completed',
      asOfDate: '2026-08-20'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('GET /api/projects/:projectId/progress-snapshot - should return 200 with valid snapshot schema', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/progress-snapshot?asOfDate=2026-08-10`)
      .expect(200);

    // Validate response schema
    const parseResult = projectProgressSnapshotSchema.safeParse(res.body);
    expect(parseResult.success).toBe(true);

    expect(res.body.projectId).toBe(testProjectId);
    expect(res.body.asOfDate).toBe('2026-08-10');
    expect(res.body.activities).toHaveLength(2);

    // Act 1 check as of 2026-08-10:
    // planned: 2026-08-01 to 2026-08-20 -> elapsed 9 days / 19 days ~ 47.37% or 9/19... Wait: 2026-08-10 - 2026-08-01 = 9 days. Duration = 19 days. 9/19*100 = 47.37%
    // actual: 50% -> ahead
    const act1 = res.body.activities.find((a: any) => a.activityId === act1Id);
    expect(act1).toBeDefined();
    expect(act1.actualProgress).toBe(50);
    expect(act1.status).toBe('in_progress');
    expect(act1.varianceState).toBe('ahead');
    expect(act1.overdue).toBe(false);

    // Act 2 check as of 2026-08-10:
    // start is 2026-08-10 (elapsed 0 days), planned = 0%, actual = 0% -> not_started, on_plan
    const act2 = res.body.activities.find((a: any) => a.activityId === act2Id);
    expect(act2).toBeDefined();
    expect(act2.actualProgress).toBe(0);
    expect(act2.status).toBe('not_started');
    expect(act2.varianceState).toBe('on_plan');
    expect(act2.overdue).toBe(false);

    // Summary counts
    expect(res.body.summary.totalActivities).toBe(2);
    expect(res.body.summary.notStarted).toBe(1);
    expect(res.body.summary.inProgress).toBe(1);
    expect(res.body.summary.completed).toBe(0);
    expect(res.body.summary.ahead).toBe(1);
    expect(res.body.summary.onPlan).toBe(1);
    expect(res.body.summary.behind).toBe(0);
    expect(res.body.summary.overdue).toBe(0);
  });

  it('GET /api/projects/:projectId/progress-snapshot - should return 200 with default date when asOfDate is omitted', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/progress-snapshot`)
      .expect(200);

    expect(res.body.projectId).toBe(testProjectId);
    expect(res.body.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.activities).toHaveLength(2);
  });

  it('GET /api/projects/:projectId/progress-snapshot - should return 404 for unknown project', async () => {
    const res = await request(app)
      .get('/api/projects/unknown-proj-999/progress-snapshot')
      .expect(404);

    expect(res.body.error).toContain('not found');
  });

  it('GET /api/projects/:projectId/progress-snapshot - should return 400 for invalid date query param', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/progress-snapshot?asOfDate=not-a-date`)
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });

  it('GET /api/projects/:projectId/progress-snapshot - should return 400 for impossible calendar date', async () => {
    const res = await request(app)
      .get(`/api/projects/${testProjectId}/progress-snapshot?asOfDate=2026-02-30`)
      .expect(400);

    expect(res.body.statusCode).toBe(400);
  });
});
