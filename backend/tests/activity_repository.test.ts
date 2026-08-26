import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { ConflictError, DatabaseError } from '../src/errors/AppError.js';

describe('SqliteActivityRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let testProjectId: string;
  let testScheduleId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);

    const proj = projectRepo.create({
      name: 'Port Terminal Project',
      code: 'PORT-01'
    });
    testProjectId = proj.id;

    const sched = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = sched.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create an activity record with all attributes', () => {
    const activity = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-001',
      name: 'Breakwater Dredging',
      description: 'Dredging approach channel',
      wbsCode: '1.1.1',
      location: 'South Jetty',
      plannedStart: '2026-05-01',
      plannedFinish: '2026-06-30',
      plannedQuantity: 45000,
      unit: 'm3'
    });

    expect(activity.id).toBeDefined();
    expect(activity.projectId).toBe(testProjectId);
    expect(activity.scheduleId).toBe(testScheduleId);
    expect(activity.externalId).toBe('ACT-001');
    expect(activity.name).toBe('Breakwater Dredging');
    expect(activity.plannedQuantity).toBe(45000);
    expect(activity.unit).toBe('m3');
    expect(activity.baselineProgress).toBe(0.0);
  });

  it('should batch create activities with createMany', () => {
    const inputs = [
      {
        projectId: testProjectId,
        scheduleId: testScheduleId,
        externalId: 'ACT-10',
        name: 'Pier 1 Construction',
        plannedStart: '2026-01-01',
        plannedFinish: '2026-02-01'
      },
      {
        projectId: testProjectId,
        scheduleId: testScheduleId,
        externalId: 'ACT-20',
        name: 'Pier 2 Construction',
        plannedStart: '2026-02-02',
        plannedFinish: '2026-03-01'
      }
    ];

    const created = activityRepo.createMany(inputs);
    expect(created).toHaveLength(2);
    expect(activityRepo.countByScheduleId(testScheduleId)).toBe(2);
    expect(activityRepo.countByProjectId(testProjectId)).toBe(2);
  });

  it('should throw ConflictError on duplicate externalId within the same schedule', () => {
    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'DUP-01',
      name: 'Original Task',
      plannedStart: '2026-01-01',
      plannedFinish: '2026-01-15'
    });

    expect(() => {
      activityRepo.create({
        projectId: testProjectId,
        scheduleId: testScheduleId,
        externalId: 'DUP-01',
        name: 'Duplicate Task',
        plannedStart: '2026-01-16',
        plannedFinish: '2026-01-30'
      });
    }).toThrow(ConflictError);
  });

  it('should list activities ordered by planned_start', () => {
    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'LATER',
      name: 'Later Task',
      plannedStart: '2026-10-01',
      plannedFinish: '2026-10-15'
    });
    activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'EARLIER',
      name: 'Earlier Task',
      plannedStart: '2026-01-01',
      plannedFinish: '2026-01-15'
    });

    const list = activityRepo.listByScheduleId(testScheduleId);
    expect(list).toHaveLength(2);
    expect(list[0].externalId).toBe('EARLIER');
    expect(list[1].externalId).toBe('LATER');
  });

  it('should reject activity with invalid schedule reference', () => {
    expect(() => {
      activityRepo.create({
        projectId: testProjectId,
        scheduleId: 'non-existent-sched',
        externalId: 'INVALID',
        name: 'Invalid Task',
        plannedStart: '2026-01-01',
        plannedFinish: '2026-01-15'
      });
    }).toThrow(DatabaseError);
  });
});
