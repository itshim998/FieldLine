import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import {
  DefaultProgressSnapshotService,
  ProgressSnapshotService
} from '../src/services/snapshot/progress-snapshot.service.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('ProgressSnapshotService (Planned vs Actual Integration)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let snapshotService: ProgressSnapshotService;

  let projectAId: string;
  let projectBId: string;
  let scheduleAId: string;
  let scheduleBId: string;
  let act1Id: string;
  let act2Id: string;
  let act3Id: string;
  let actBId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);

    snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo: progressRepo
    });

    // Project A
    const pA = projectRepo.create({
      name: 'Metro Line Corridor A',
      code: 'MLA-01',
      status: 'active'
    });
    projectAId = pA.id;

    // Project B (for isolation testing)
    const pB = projectRepo.create({
      name: 'Highway Project B',
      code: 'HPB-02',
      status: 'active'
    });
    projectBId = pB.id;

    // Schedule A
    const sA = scheduleRepo.create({
      projectId: projectAId,
      name: 'Master Baseline A',
      sourceType: 'csv'
    });
    scheduleAId = sA.id;

    // Schedule B
    const sB = scheduleRepo.create({
      projectId: projectBId,
      name: 'Master Baseline B',
      sourceType: 'csv'
    });
    scheduleBId = sB.id;

    // Activity 1 (Project A): 2026-08-01 to 2026-08-31
    const a1 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A01',
      name: 'Tunnel Boring 1',
      wbsCode: '1.1',
      location: 'Section North',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31',
      plannedQuantity: 1000,
      unit: 'm'
    });
    act1Id = a1.id;

    // Activity 2 (Project A): 2026-08-01 to 2026-08-15 (Completed early)
    const a2 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A02',
      name: 'Piling Work',
      wbsCode: '1.2',
      location: 'Pier 4',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 50,
      unit: 'piles'
    });
    act2Id = a2.id;

    // Activity 3 (Project A): 2026-09-01 to 2026-09-30 (Future task, no observations)
    const a3 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-A03',
      name: 'Track Laying',
      wbsCode: '2.1',
      location: 'Section North',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-30',
      plannedQuantity: 1000,
      unit: 'm'
    });
    act3Id = a3.id;

    // Activity B (Project B): Isolation verification
    const aB = activityRepo.create({
      projectId: projectBId,
      scheduleId: scheduleBId,
      externalId: 'ACT-B01',
      name: 'Bridge Pier',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20',
      plannedQuantity: 100,
      unit: 'm3'
    });
    actBId = aB.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should throw NotFoundError for non-existent project', () => {
    expect(() =>
      snapshotService.getProgressSnapshot('non-existent-proj-id', '2026-08-26')
    ).toThrow(NotFoundError);
  });

  it('should throw ValidationError for invalid date format', () => {
    expect(() =>
      snapshotService.getProgressSnapshot(projectAId, 'invalid-date')
    ).toThrow(ValidationError);

    expect(() =>
      snapshotService.getProgressSnapshot(projectAId, '2026-02-31')
    ).toThrow(ValidationError);
  });

  it('should default to current local date when asOfDate is omitted', () => {
    const snapshot = snapshotService.getProgressSnapshot(projectAId);
    expect(snapshot).toBeDefined();
    expect(snapshot.projectId).toBe(projectAId);
    expect(snapshot.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should select correct chronological observation as-of date and exclude future observations', () => {
    // Activity 1 observations:
    // Obs 1 at 2026-08-10: 30%
    progressRepo.create({
      projectId: projectAId,
      activityId: act1Id,
      actualPercent: 30,
      actualQuantity: 300,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-10',
      notes: 'Initial progress'
    });

    // Obs 2 at 2026-08-20: 60%
    progressRepo.create({
      projectId: projectAId,
      activityId: act1Id,
      actualPercent: 60,
      actualQuantity: 600,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-20',
      notes: 'Mid progress'
    });

    // Obs 3 at 2026-09-01: 90% (Future observation relative to August snapshots)
    progressRepo.create({
      projectId: projectAId,
      activityId: act1Id,
      actualPercent: 90,
      actualQuantity: 900,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-09-01',
      notes: 'September progress'
    });

    // Snapshot at 2026-08-15: Must pick Obs 1 (30%), NOT Obs 2 (60%) or Obs 3 (90%)
    const snapAug15 = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');
    const act1Aug15 = snapAug15.activities.find(a => a.activityId === act1Id)!;
    expect(act1Aug15.actualProgress).toBe(30);
    expect(act1Aug15.actualStart).toBe('2026-08-01');
    expect(act1Aug15.status).toBe('in_progress');

    // Snapshot at 2026-08-25: Must pick Obs 2 (60%), MUST NOT pick future Obs 3 (90%)
    const snapAug25 = snapshotService.getProgressSnapshot(projectAId, '2026-08-25');
    const act1Aug25 = snapAug25.activities.find(a => a.activityId === act1Id)!;
    expect(act1Aug25.actualProgress).toBe(60);
    expect(act1Aug25.status).toBe('in_progress');

    // Snapshot at 2026-09-05: Can now pick Obs 3 (90%)
    const snapSep05 = snapshotService.getProgressSnapshot(projectAId, '2026-09-05');
    const act1Sep05 = snapSep05.activities.find(a => a.activityId === act1Id)!;
    expect(act1Sep05.actualProgress).toBe(90);
  });

  it('should default activities without observations to not_started and 0% actual', () => {
    const snapshot = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');
    const act3 = snapshot.activities.find(a => a.activityId === act3Id)!;

    expect(act3.actualProgress).toBe(0);
    expect(act3.actualStart).toBeNull();
    expect(act3.actualFinish).toBeNull();
    expect(act3.status).toBe('not_started');
    expect(act3.plannedProgress).toBe(0); // starts 2026-09-01
    expect(act3.progressVariance).toBe(0);
    expect(act3.varianceState).toBe('on_plan');
    expect(act3.overdue).toBe(false);
  });

  it('should preserve historical actualStart and actualFinish dates without recomputing them', () => {
    // Record completion of Activity 2
    progressRepo.create({
      projectId: projectAId,
      activityId: act2Id,
      actualPercent: 100,
      actualQuantity: 50,
      actualStart: '2026-08-02',
      actualFinish: '2026-08-12',
      status: 'completed',
      asOfDate: '2026-08-12',
      notes: 'Completed ahead of schedule'
    });

    const snapshot = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');
    const act2 = snapshot.activities.find(a => a.activityId === act2Id)!;

    expect(act2.actualStart).toBe('2026-08-02');
    expect(act2.actualFinish).toBe('2026-08-12');
    expect(act2.actualProgress).toBe(100);
    expect(act2.status).toBe('completed');
    expect(act2.overdue).toBe(false);
  });

  it('should strictly isolate projects and never leak activities or progress across projects', () => {
    // Add observation for Project B activity
    progressRepo.create({
      projectId: projectBId,
      activityId: actBId,
      actualPercent: 100,
      actualQuantity: 100,
      status: 'completed',
      asOfDate: '2026-08-15'
    });

    const snapA = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');
    expect(snapA.activities.some(a => a.activityId === actBId)).toBe(false);
    expect(snapA.activities.every(a => a.activityId !== actBId)).toBe(true);

    const snapB = snapshotService.getProgressSnapshot(projectBId, '2026-08-15');
    expect(snapB.activities).toHaveLength(1);
    expect(snapB.activities[0].activityId).toBe(actBId);
    expect(snapB.activities[0].actualProgress).toBe(100);
  });

  it('should be deterministic across multiple calls with same state', () => {
    const snap1 = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');
    const snap2 = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');

    expect(snap1.projectId).toBe(snap2.projectId);
    expect(snap1.asOfDate).toBe(snap2.asOfDate);
    expect(snap1.activities).toEqual(snap2.activities);
    expect(snap1.summary).toEqual(snap2.summary);
  });

  it('should expose canonical aggregate progress metrics on snapshot and summary', () => {
    progressRepo.create({
      projectId: projectAId,
      activityId: act1Id,
      actualPercent: 30,
      status: 'in_progress',
      asOfDate: '2026-08-15'
    });
    progressRepo.create({
      projectId: projectAId,
      activityId: act2Id,
      actualPercent: 100,
      status: 'completed',
      asOfDate: '2026-08-15'
    });

    // Project A on 2026-08-15:
    // Act 1 (planned 46.67%, actual 30%)
    // Act 2 (planned 100%, actual 100%)
    // Act 3 (planned 0%, actual 0%)
    // Total Planned: (46.67 + 100 + 0) / 3 = 48.89%
    // Total Actual: (30 + 100 + 0) / 3 = 43.33%
    // Variance: 43.33 - 48.89 = -5.56 pts ('behind')
    const snapshot = snapshotService.getProgressSnapshot(projectAId, '2026-08-15');

    expect(snapshot.summary.overallActualProgress).toBe(43.33);
    expect(snapshot.summary.overallPlannedProgress).toBe(48.89);
    expect(snapshot.summary.progressVariance).toBe(-5.56);
    expect(snapshot.summary.varianceState).toBe('behind');

    expect(snapshot.overallActualProgress).toBe(43.33);
    expect(snapshot.overallPlannedProgress).toBe(48.89);
    expect(snapshot.progressVariance).toBe(-5.56);
    expect(snapshot.varianceState).toBe('behind');
  });
});
