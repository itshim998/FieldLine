import { describe, it, expect, beforeEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import {
  DefaultProgressSnapshotService,
  ProgressSnapshotService
} from '../src/services/snapshot/progress-snapshot.service.js';
import {
  DefaultRiskClassificationService,
  RiskClassificationService
} from '../src/services/risk/risk-classification.service.js';
import { NotFoundError, ValidationError } from '../src/errors/AppError.js';

describe('RiskClassificationService (Integration)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let snapshotService: ProgressSnapshotService;
  let riskService: RiskClassificationService;

  let projectAId: string;
  let projectBId: string;
  let scheduleAId: string;
  let act1Id: string;
  let act2Id: string;
  let act3Id: string;
  let act4Id: string;
  let act5Id: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);

    snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo: progressRepo
    });

    riskService = new DefaultRiskClassificationService({
      snapshotService
    });

    // Project A
    const pA = projectRepo.create({
      name: 'Metro Line Corridor A',
      code: 'MLA-01',
      status: 'active'
    });
    projectAId = pA.id;

    // Project B (for isolation)
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

    // Act 1: COMPLETED (Finished)
    const a1 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-01',
      name: 'Site Clearing',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });
    act1Id = a1.id;
    progressRepo.create({
      projectId: projectAId,
      activityId: act1Id,
      actualPercent: 100,
      status: 'completed',
      asOfDate: '2026-08-08'
    });

    // Act 2: DELAYED (Planned finish was 2026-08-10, progress is only 40% as of 2026-08-15)
    const a2 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-02',
      name: 'Excavation',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });
    act2Id = a2.id;
    progressRepo.create({
      projectId: projectAId,
      activityId: act2Id,
      actualPercent: 40,
      status: 'in_progress',
      asOfDate: '2026-08-08'
    });

    // Act 3: AT_RISK (Planned 2026-08-01 to 2026-08-31; as of 2026-08-15 planned is 46.67%, actual is 20% -> variance -26.67%)
    const a3 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-03',
      name: 'Piling Work',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31'
    });
    act3Id = a3.id;
    progressRepo.create({
      projectId: projectAId,
      activityId: act3Id,
      actualPercent: 20,
      status: 'in_progress',
      asOfDate: '2026-08-12'
    });

    // Act 4: AHEAD (Planned 2026-08-01 to 2026-08-31; as of 2026-08-15 planned is 46.67%, actual is 70% -> variance +23.33%)
    const a4 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-04',
      name: 'Rebar Placement',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-31'
    });
    act4Id = a4.id;
    progressRepo.create({
      projectId: projectAId,
      activityId: act4Id,
      actualPercent: 70,
      status: 'in_progress',
      asOfDate: '2026-08-12'
    });

    // Act 5: ON_TRACK (Not started yet, planned 2026-08-20 to 2026-08-30; as of 2026-08-15 planned is 0%, actual 0%)
    const a5 = activityRepo.create({
      projectId: projectAId,
      scheduleId: scheduleAId,
      externalId: 'ACT-05',
      name: 'Concrete Pouring',
      plannedStart: '2026-08-20',
      plannedFinish: '2026-08-30'
    });
    act5Id = a5.id;
  });

  it('should return complete and correct risk classifications and summary for project', () => {
    const result = riskService.getProjectRiskStatus(projectAId, '2026-08-15');

    expect(result.projectId).toBe(projectAId);
    expect(result.asOfDate).toBe('2026-08-15');
    expect(result.activities).toHaveLength(5);

    const act1 = result.activities.find(a => a.activityId === act1Id);
    expect(act1?.classification).toBe('COMPLETED');
    expect(act1?.reasons[0].code).toBe('completed');

    const act2 = result.activities.find(a => a.activityId === act2Id);
    expect(act2?.classification).toBe('DELAYED');
    expect(act2?.reasons[0].code).toBe('overdue');

    const act3 = result.activities.find(a => a.activityId === act3Id);
    expect(act3?.classification).toBe('AT_RISK');
    expect(act3?.reasons[0].code).toBe('strong_negative_variance');

    const act4 = result.activities.find(a => a.activityId === act4Id);
    expect(act4?.classification).toBe('AHEAD');
    expect(act4?.reasons[0].code).toBe('positive_variance');

    const act5 = result.activities.find(a => a.activityId === act5Id);
    expect(act5?.classification).toBe('ON_TRACK');
    expect(act5?.reasons[0].code).toBe('within_plan');

    expect(result.summary).toEqual({
      totalActivities: 5,
      completed: 1,
      delayed: 1,
      atRisk: 1,
      ahead: 1,
      onTrack: 1,
      overdueCount: 1
    });
  });

  it('should enforce strict project isolation', () => {
    // Add schedule and activity to Project B
    const sB = scheduleRepo.create({
      projectId: projectBId,
      name: 'Baseline B',
      sourceType: 'csv'
    });
    activityRepo.create({
      projectId: projectBId,
      scheduleId: sB.id,
      externalId: 'ACT-B01',
      name: 'Project B Task',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10'
    });

    const resA = riskService.getProjectRiskStatus(projectAId, '2026-08-15');
    const resB = riskService.getProjectRiskStatus(projectBId, '2026-08-15');

    expect(resA.activities).toHaveLength(5);
    expect(resB.activities).toHaveLength(1);
    expect(resA.activities.some(a => a.externalId === 'ACT-B01')).toBe(false);
  });

  it('should throw NotFoundError if project does not exist', () => {
    expect(() => riskService.getProjectRiskStatus('non-existent-id', '2026-08-15')).toThrow(
      NotFoundError
    );
  });

  it('should throw ValidationError if asOfDate format is invalid', () => {
    expect(() => riskService.getProjectRiskStatus(projectAId, '2026/08/15')).toThrow(
      ValidationError
    );
    expect(() => riskService.getProjectRiskStatus(projectAId, 'invalid-date')).toThrow(
      ValidationError
    );
  });

  it('should perform chronological time-travel without future observation contamination', () => {
    // As of 2026-08-05 (before act1 completion was reported on 2026-08-08):
    const earlyResult = riskService.getProjectRiskStatus(projectAId, '2026-08-05');
    const act1Early = earlyResult.activities.find(a => a.activityId === act1Id);

    // On 2026-08-05, Act 1 has no observation yet (0% actual vs ~44.4% planned) -> variance -44.4% -> AT_RISK
    expect(act1Early?.classification).toBe('AT_RISK');

    // On 2026-08-15, Act 1 has 100% completed observation from 2026-08-08 -> COMPLETED
    const laterResult = riskService.getProjectRiskStatus(projectAId, '2026-08-15');
    const act1Later = laterResult.activities.find(a => a.activityId === act1Id);
    expect(act1Later?.classification).toBe('COMPLETED');
  });
});
