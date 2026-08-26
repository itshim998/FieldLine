import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { DefaultScheduleImportService } from '../src/services/schedule-import.service.js';
import { NotFoundError, ConflictError } from '../src/errors/AppError.js';

const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');

describe('ScheduleImportService', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let service: DefaultScheduleImportService;
  let testProjectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);

    service = new DefaultScheduleImportService(
      projectRepo,
      scheduleRepo,
      activityRepo
    );

    const proj = projectRepo.create({
      name: 'High-Speed Rail Corridor',
      code: 'HSR-01'
    });
    testProjectId = proj.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should successfully import a valid CSV schedule file', async () => {
    // Copy fixture to a temp file to test cleanup
    const srcPath = path.join(fixturesDir, 'valid_schedule.csv');
    const tempPath = path.join(fixturesDir, 'temp_test_valid.csv');
    fs.copyFileSync(srcPath, tempPath);

    const result = await service.importSchedule(testProjectId, {
      path: tempPath,
      originalname: 'master_baseline.csv',
      mimetype: 'text/csv'
    });

    expect(result).toBeDefined();
    expect(result.schedule.id).toBeDefined();
    expect(result.schedule.projectId).toBe(testProjectId);
    expect(result.schedule.sourceType).toBe('csv');
    expect(result.schedule.sourceFilename).toBe('master_baseline.csv');
    expect(result.activitiesImported).toBe(5);
    expect(result.rowCount).toBe(5);

    // Verify persisted records in database
    const schedules = scheduleRepo.listByProjectId(testProjectId);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].id).toBe(result.schedule.id);

    const activities = activityRepo.listByScheduleId(result.schedule.id);
    expect(activities).toHaveLength(5);
    expect(activities[0].externalId).toBe('ACT-101');
    expect(activities[0].projectId).toBe(testProjectId);
    expect(activities[0].scheduleId).toBe(result.schedule.id);

    // Verify temp file was cleaned up
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should successfully import a valid XLSX schedule file', async () => {
    const srcPath = path.join(fixturesDir, 'valid_schedule.xlsx');
    const tempPath = path.join(fixturesDir, 'temp_test_valid.xlsx');
    fs.copyFileSync(srcPath, tempPath);

    const result = await service.importSchedule(testProjectId, {
      path: tempPath,
      originalname: 'substation_schedule.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    expect(result.activitiesImported).toBe(3);
    expect(result.sourceType).toBe('xlsx');

    const activities = service.listScheduleActivities(testProjectId, result.schedule.id);
    expect(activities).toHaveLength(3);
    expect(activities[0].externalId).toBe('XL-001');
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should reject file with duplicate activity IDs and leave zero database artifacts', async () => {
    const srcPath = path.join(fixturesDir, 'duplicate_activities.csv');
    const tempPath = path.join(fixturesDir, 'temp_test_dup.csv');
    fs.copyFileSync(srcPath, tempPath);

    await expect(
      service.importSchedule(testProjectId, {
        path: tempPath,
        originalname: 'duplicate_activities.csv'
      })
    ).rejects.toThrow(ConflictError);

    // Verify atomic rollback: no schedules or activities created
    expect(scheduleRepo.listByProjectId(testProjectId)).toHaveLength(0);
    expect(activityRepo.countByProjectId(testProjectId)).toBe(0);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should reject import for non-existent project', async () => {
    const srcPath = path.join(fixturesDir, 'valid_schedule.csv');
    const tempPath = path.join(fixturesDir, 'temp_test_bad_proj.csv');
    fs.copyFileSync(srcPath, tempPath);

    await expect(
      service.importSchedule('non-existent-proj-id', {
        path: tempPath,
        originalname: 'valid_schedule.csv'
      })
    ).rejects.toThrow(NotFoundError);

    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should support querying schedules and schedule activities', async () => {
    const srcPath = path.join(fixturesDir, 'valid_schedule.csv');
    const tempPath = path.join(fixturesDir, 'temp_test_query.csv');
    fs.copyFileSync(srcPath, tempPath);

    const imported = await service.importSchedule(testProjectId, {
      path: tempPath,
      originalname: 'query_test.csv'
    });

    const schedules = service.listSchedules(testProjectId);
    expect(schedules).toHaveLength(1);

    const schedule = service.getSchedule(testProjectId, imported.schedule.id);
    expect(schedule.id).toBe(imported.schedule.id);

    const activities = service.listScheduleActivities(testProjectId, imported.schedule.id);
    expect(activities).toHaveLength(5);
  });
});
