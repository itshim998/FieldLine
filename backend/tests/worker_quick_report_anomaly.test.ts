import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';

describe('Unified Anomaly Detection Across Worker Quick-Report Paths', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;

  let testProjectId: string;
  let testScheduleId: string;
  let actFoundationId: string;
  let actPipingId: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);

    app = createApp();

    const proj = projectRepo.create({
      code: 'REFINERY-U4',
      name: 'Refinery Unit 4 Expansion',
      description: 'Golden Demo Test Project'
    });
    testProjectId = proj.id;

    const sched = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Master Baseline Schedule',
      sourceType: 'manual',
      isBaseline: true
    });
    testScheduleId = sched.id;

    // Activity 1: Foundation (quantity 100 m3)
    const act1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-FOUND-01',
      name: 'Foundation Footing Concrete Pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      plannedQuantity: 100,
      unit: 'm3',
      location: 'Area B',
      baselineProgress: 0
    });
    actFoundationId = act1.id;

    // Activity 2: Piping
    const act2 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-PIPE-02',
      name: 'Cooling Water Underground Piping',
      plannedStart: '2026-08-05',
      plannedFinish: '2026-08-25',
      plannedQuantity: 500,
      unit: 'm',
      location: 'Area B',
      baselineProgress: 0
    });
    actPipingId = act2.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('1. Scenario A — Normal direct report receives anomaly evaluation and remains normal', async () => {
    // Seed prior observation: 45% on 2026-08-14
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 45,
      asOfDate: '2026-08-14',
      status: 'in_progress'
    });

    // Direct quick-report: worker selects ACT-FOUND-01, reports 50% on 2026-08-16
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-16',
        activityId: actFoundationId,
        progressPercent: 50,
        reporterName: 'Carlos Ramos',
        reporterRole: 'Civil Lead',
        notes: 'Steady concrete footing progress in Area B'
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.derivedPercent).toBe(50);

    // Verify match record has anomaly advisory metadata
    const matches = activityMatchRepo.listByProgressUpdateId(res.body.progressUpdate.id, testProjectId);
    expect(matches).toHaveLength(1);
    const match = matches[0];

    expect(match.matchMethod).toBe('exact_id');
    expect(match.confidenceScore).toBe(1.0);
    expect(match.status).toBe('confirmed');

    // Anomaly fields
    expect(match.anomalyScore).toBeDefined();
    expect(match.anomalyScore).not.toBeNull();
    expect(match.anomalyScore).toBeLessThan(0.5);
    expect(match.anomalySeverity).toBe('normal');

    // Canonical progress committed
    const latest = activityProgressRepo.getLatestByActivityId(actFoundationId);
    expect(latest?.actualPercent).toBe(50);
  });

  it('2. Scenario B — Anomalous direct report receives anomaly evaluation with high severity and diagnostic reasons', async () => {
    // Seed prior observation: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Direct quick-report: worker selects ACT-FOUND-01, reports 95% on 2026-08-16 (+85% in 1 day!)
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-16',
        activityId: actFoundationId,
        progressPercent: 95,
        reporterName: 'Carlos Ramos',
        reporterRole: 'Civil Lead',
        notes: 'Footing concrete pour completed rapidly'
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('confirmed');

    // Verify match record has elevated anomaly severity
    const matches = activityMatchRepo.listByProgressUpdateId(res.body.progressUpdate.id, testProjectId);
    expect(matches).toHaveLength(1);
    const match = matches[0];

    expect(match.anomalyScore).toBeDefined();
    expect(match.anomalyScore).toBeGreaterThanOrEqual(0.75);
    expect(match.anomalySeverity).toBe('high');
    expect(match.anomalyReasons).toBeDefined();
    expect(match.anomalyReasons!.length).toBeGreaterThan(0);
    expect(match.anomalyReasons!.join(' ')).toMatch(/velocity|increment|outside/i);
  });

  it('3. Scenario C — Exact match confidence and anomaly severity remain orthogonal', async () => {
    // Prior observation: 15% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 15,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Direct report with 98%
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-16',
        activityId: actFoundationId,
        progressPercent: 98,
        reporterName: 'Carlos Ramos'
      });

    expect(res.status).toBe(201);

    const matches = activityMatchRepo.listByProgressUpdateId(res.body.progressUpdate.id, testProjectId);
    const match = matches[0];

    // Orthogonality: match confidence is 1.0 (exact_id), but anomaly severity is independently high!
    expect(match.confidenceScore).toBe(1.0);
    expect(match.matchMethod).toBe('exact_id');
    expect(match.confidenceTier).toBe('high');
    expect(match.status).toBe('confirmed');
    expect(match.anomalySeverity).toBe('high');
    expect(match.anomalyScore).toBeGreaterThanOrEqual(0.75);
  });

  it('4. Scenario D — First observation preserves cold-start semantics', async () => {
    // No prior observations for actPipingId
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-10',
        activityId: actPipingId,
        progressPercent: 40,
        reporterName: 'Elena Rostova'
      });

    expect(res.status).toBe(201);

    const matches = activityMatchRepo.listByProgressUpdateId(res.body.progressUpdate.id, testProjectId);
    const match = matches[0];

    // Safe cold start: score 0.0, normal severity
    expect(match.anomalyScore).toBe(0.0);
    expect(match.anomalySeverity).toBe('normal');
  });

  it('5. Quantity-derived direct report evaluates statistical anomaly correctly', async () => {
    // Prior observation: 10 m3 (10%) on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      actualQuantity: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Worker reports 90 m3 out of 100 m3 on 2026-08-16 (jump from 10% to 90%)
    const res = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-16',
        activityId: actFoundationId,
        actualQuantity: 90,
        quantityUnit: 'm3',
        reporterName: 'Carlos Ramos'
      });

    expect(res.status).toBe(201);
    expect(res.body.derivedPercent).toBe(90);

    const matches = activityMatchRepo.listByProgressUpdateId(res.body.progressUpdate.id, testProjectId);
    const match = matches[0];

    // Quantity-derived 90% jump should be flagged as anomalous
    expect(match.anomalySeverity).toBe('high');
    expect(match.anomalyScore).toBeGreaterThanOrEqual(0.75);
  });

  it('6. Activity detail endpoint reflects flaggedForVerification when direct report was anomalous', async () => {
    // Prior observation: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Anomalous direct report: 95% on 2026-08-16
    await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-16',
        activityId: actFoundationId,
        progressPercent: 95,
        reporterName: 'Carlos Ramos'
      });

    // Query Activity Detail endpoint (admin role can see full advisory match metadata)
    const detailRes = await request(app)
      .get(`/api/projects/${testProjectId}/activities/${actFoundationId}`)
      .set(adminAuthHeader(testProjectId));

    expect(detailRes.status).toBe(200);
    // Detail view surfaces flaggedForVerification: true!
    expect(detailRes.body.current.flaggedForVerification).toBe(true);
    expect(detailRes.body.matches[0].anomalySeverity).toBe('high');
  });

  it('7. Scenario F — Canonical baseline isolation: current report does not become its own baseline', async () => {
    // 0 prior observations
    // Submitting 25% on day 1
    const res1 = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-10',
        activityId: actFoundationId,
        progressPercent: 25,
        reporterName: 'Carlos Ramos'
      });

    expect(res1.status).toBe(201);
    const match1 = activityMatchRepo.listByProgressUpdateId(res1.body.progressUpdate.id, testProjectId)[0];
    // First report was cold start
    expect(match1.anomalyScore).toBe(0.0);
    expect(match1.anomalySeverity).toBe('normal');

    // Submitting 95% on day 2 (evaluated against 25% baseline from day 1, NOT against itself)
    const res2 = await request(app)
      .post(`/api/projects/${testProjectId}/worker/quick-report`)
      .set(workerAuthHeader(testProjectId))
      .send({
        reportDate: '2026-08-11',
        activityId: actFoundationId,
        progressPercent: 95,
        reporterName: 'Carlos Ramos'
      });

    expect(res2.status).toBe(201);
    const match2 = activityMatchRepo.listByProgressUpdateId(res2.body.progressUpdate.id, testProjectId)[0];
    // Evaluated against prior 25% -> delta +70% in 1 day -> high anomaly!
    expect(match2.anomalySeverity).toBe('high');
    expect(match2.anomalyScore).toBeGreaterThanOrEqual(0.75);
  });
});
