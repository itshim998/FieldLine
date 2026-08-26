import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { DefaultScheduleImportService } from '../src/services/schedule-import.service.js';
import { NotFoundError, ScheduleValidationError } from '../src/errors/AppError.js';

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
    ).rejects.toThrow(ScheduleValidationError);

    // Verify atomic rollback: no schedules or activities created
    expect(scheduleRepo.listByProjectId(testProjectId)).toHaveLength(0);
    expect(activityRepo.countByProjectId(testProjectId)).toBe(0);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should reject file with invalid date ordering (start > finish) and leave zero database artifacts', async () => {
    const tempPath = path.join(fixturesDir, 'temp_test_bad_dates.csv');
    const badContent = [
      'Activity ID,Activity Name,Start Date,Finish Date,Quantity,Unit',
      'ACT-ERR-01,Earthwork Prep,2026-06-15,2026-06-01,100,m3'
    ].join('\n');
    fs.writeFileSync(tempPath, badContent, 'utf-8');

    try {
      await service.importSchedule(testProjectId, {
        path: tempPath,
        originalname: 'bad_dates.csv',
        mimetype: 'text/csv'
      });
      expect.unreachable('Should have thrown ScheduleValidationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ScheduleValidationError);
      expect(err.statusCode).toBe(422);
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0].code).toBe('START_AFTER_FINISH');
    }

    // Verify persistence safety: no database artifacts left behind
    expect(scheduleRepo.listByProjectId(testProjectId)).toHaveLength(0);
    expect(activityRepo.countByProjectId(testProjectId)).toBe(0);
    expect(fs.existsSync(tempPath)).toBe(false);
  });

  it('should aggregate multiple validation errors across rows and reject cleanly', async () => {
    const tempPath = path.join(fixturesDir, 'temp_test_multi_err.csv');
    const multiErrContent = [
      'Activity ID,Activity Name,Start Date,Finish Date,Quantity,Progress',
      'ACT-001,Site Clearing,2026-04-01,2026-04-10,100,0',
      'ACT-001,Grading,2026-05-15,2026-05-01,-50,150'
    ].join('\n');
    fs.writeFileSync(tempPath, multiErrContent, 'utf-8');

    try {
      await service.importSchedule(testProjectId, {
        path: tempPath,
        originalname: 'multi_err.csv',
        mimetype: 'text/csv'
      });
      expect.unreachable('Should have thrown ScheduleValidationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ScheduleValidationError);
      expect(err.statusCode).toBe(422);
      expect(err.issues.length).toBeGreaterThanOrEqual(4);
      const codes = err.issues.map((i: any) => i.code);
      expect(codes).toContain('DUPLICATE_ACTIVITY_ID'); // row 3 duplicate ACT-001
      expect(codes).toContain('START_AFTER_FINISH'); // row 3 start > finish
      expect(codes).toContain('INVALID_QUANTITY'); // row 3 quantity -50
      expect(codes).toContain('INVALID_PERCENTAGE'); // row 3 progress 150
    }

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

  it('should normalize activities during import before persisting to SQLite', async () => {
    const unnormalizedCsvPath = path.join(fixturesDir, 'temp_unnorm.csv');
    const content = [
      'Activity ID,Activity Name,Description,WBS,Location,Start,Finish,Quantity,Unit',
      '  ACT-NORM-01  ,"  Site   Clearing  ",,  1.1  ,"  Sector 1  ",2026/04/01,15-Apr-2026,"1,250",sqm'
    ].join('\n');
    fs.writeFileSync(unnormalizedCsvPath, content, 'utf-8');

    const result = await service.importSchedule(testProjectId, {
      path: unnormalizedCsvPath,
      originalname: 'unnormalized.csv',
      mimetype: 'text/csv'
    });

    const activities = activityRepo.listByScheduleId(result.schedule.id);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      externalId: 'ACT-NORM-01',
      name: 'Site Clearing',
      description: null,
      wbsCode: '1.1',
      location: 'Sector 1',
      plannedStart: '2026-04-01',
      plannedFinish: '2026-04-15',
      plannedQuantity: 1250,
      unit: 'm2',
      baselineProgress: 0.0
    });
  });
});

