import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { DefaultProgressAnomalyEvaluationService } from '../src/services/anomaly/progress-anomaly-evaluation.service.js';
import { AnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { Activity } from '../src/models/domain.types.js';

describe('ProgressAnomalyEvaluationService — Unified Anomaly Evaluation Seam', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let anomalyModelService: AnomalyModelService;
  let evaluator: DefaultProgressAnomalyEvaluationService;

  let testProjectId: string;
  let testScheduleId: string;
  let testActivity: Activity;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);
    anomalyModelService = new AnomalyModelService();

    evaluator = new DefaultProgressAnomalyEvaluationService({
      activityProgressRepo: progressRepo,
      activityRepo,
      anomalyModelService
    });

    const project = projectRepo.create({
      name: 'Refinery Expansion Unit 4',
      code: 'REF-U4',
      status: 'active'
    });
    testProjectId = project.id;

    const schedule = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Master Baseline Schedule',
      sourceType: 'manual'
    });
    testScheduleId = schedule.id;

    testActivity = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-FOUND-01',
      name: 'Crude Pump Foundation Piling',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      plannedQuantity: 100,
      unit: 'piles'
    });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('1. Returns null when reportedPercent is null, undefined, or non-finite', () => {
    expect(
      evaluator.evaluateProgressAnomaly({
        projectId: testProjectId,
        activityId: testActivity.id,
        reportedPercent: null,
        reportDate: '2026-08-15'
      })
    ).toBeNull();

    expect(
      evaluator.evaluateProgressAnomaly({
        projectId: testProjectId,
        activityId: testActivity.id,
        reportedPercent: undefined,
        reportDate: '2026-08-15'
      })
    ).toBeNull();

    expect(
      evaluator.evaluateProgressAnomaly({
        projectId: testProjectId,
        activityId: testActivity.id,
        reportedPercent: NaN,
        reportDate: '2026-08-15'
      })
    ).toBeNull();
  });

  it('2. Scenario D: First observation returns safe cold-start result (score 0.0, normal severity)', () => {
    // Zero prior observations in activity_progress
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 35,
      reportDate: '2026-08-10'
    });

    expect(result).not.toBeNull();
    expect(result?.anomalyScore).toBe(0.0);
    expect(result?.severity).toBe('normal');
    expect(result?.reviewRecommended).toBe(false);
    expect(result?.reasons).toEqual([]);
  });

  it('3. Scenario A: Normal steady progression produces normal severity', () => {
    // Prior observation: 45% on 2026-08-14 (day 13 of 29 = 44.8% planned)
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 45,
      asOfDate: '2026-08-14',
      status: 'in_progress'
    });

    // Worker reports 50% on 2026-08-16 (day 15 of 29 = 51.7% planned; delta +5% over 2 days -> normal velocity)
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 50,
      reportDate: '2026-08-16'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('normal');
    expect(result?.reviewRecommended).toBe(false);
    expect(result?.anomalyScore).toBeLessThan(0.5);
  });

  it('4. Scenario B: Extreme single-day progress jump produces high severity and diagnostic reasons', () => {
    // Prior observation: 10% on 2026-08-15
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Worker reports 95% on 2026-08-16 (jump of +85% in 1 day!)
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 95,
      reportDate: '2026-08-16'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('high');
    expect(result?.reviewRecommended).toBe(true);
    expect(result?.anomalyScore).toBeGreaterThanOrEqual(0.75);
    expect(result?.reasons.length).toBeGreaterThan(0);
    const reasonText = result?.reasons.join(' ');
    expect(reasonText).toMatch(/velocity|increment|outside/i);
  });

  it('5. Severe progress regression produces high severity and regression diagnostic reason', () => {
    // Prior observation: 75% on 2026-08-15
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 75,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Worker reports 20% on 2026-08-16 (massive -55% drop!)
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 20,
      reportDate: '2026-08-16'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('high');
    expect(result?.reviewRecommended).toBe(true);
    expect(result?.reasons.some((r) => r.includes('drop') || r.includes('atypical'))).toBe(true);
  });

  it('6. Minor negative survey reconciliation (-1% over 4 days) remains normal severity', () => {
    // Activity planned for 40 days (Aug 01 to Sep 10): Aug 15 is 35%, Aug 19 is 45%
    const surveyActivity = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-SURVEY-01',
      name: 'Site Survey Alignment',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-09-10',
      plannedQuantity: 100,
      unit: 'm'
    });

    // Prior observation: 45% on 2026-08-15
    progressRepo.create({
      projectId: testProjectId,
      activityId: surveyActivity.id,
      actualPercent: 45,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Worker reports 44% on 2026-08-19 (minor survey adjustment: -1% over 4 days)
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: surveyActivity.id,
      activity: surveyActivity,
      reportedPercent: 44,
      reportDate: '2026-08-19'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('normal');
    expect(result?.reviewRecommended).toBe(false);
  });

  it('7. Scenario F — Canonical Truth Protection: Anomaly evaluation performs zero database mutations', () => {
    const beforeCount = progressRepo.listByActivityId(testActivity.id).length;

    evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 90,
      reportDate: '2026-08-20'
    });

    const afterCount = progressRepo.listByActivityId(testActivity.id).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('8. As-of Date Isolation: Evaluates strictly against baseline as of reportDate (does not see future observations)', () => {
    // Aug 10: 31% (matches planned 31% on day 9 of 29)
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 31,
      asOfDate: '2026-08-10',
      status: 'in_progress'
    });

    // Aug 25 (Future observation relative to evaluation date): 83%
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 83,
      asOfDate: '2026-08-25',
      status: 'in_progress'
    });

    // Evaluate report on Aug 12 with 38% (matches planned 38% on day 11 of 29; +7% over 2 days from Aug 10 baseline)
    // If it mistakenly evaluated against the future Aug 25 observation (83%), it would see a -45% drop and flag as high anomaly!
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      activity: testActivity,
      reportedPercent: 38,
      reportDate: '2026-08-12'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('normal');
    expect(result?.reviewRecommended).toBe(false);
  });

  it('9. Resolves activity from activityRepo if activity entity is omitted', () => {
    progressRepo.create({
      projectId: testProjectId,
      activityId: testActivity.id,
      actualPercent: 30,
      asOfDate: '2026-08-10',
      status: 'in_progress'
    });

    // Pass only activityId
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: testActivity.id,
      reportedPercent: 35,
      reportDate: '2026-08-12'
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe('normal');
  });

  it('10. Graceful error boundary: Falls back to safe cold-start if activity is not found', () => {
    const result = evaluator.evaluateProgressAnomaly({
      projectId: testProjectId,
      activityId: 'NON_EXISTENT_ACTIVITY_ID',
      reportedPercent: 50,
      reportDate: '2026-08-12'
    });

    expect(result).not.toBeNull();
    expect(result?.anomalyScore).toBe(0.0);
    expect(result?.severity).toBe('normal');
  });
});
