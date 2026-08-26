import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { DatabaseError } from '../src/errors/AppError.js';

describe('SqliteScheduleRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let testProjectId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);

    const proj = projectRepo.create({
      name: 'Test Infrastructure Project',
      code: 'TEST-01'
    });
    testProjectId = proj.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create a schedule record with defaults', () => {
    const schedule = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Master Schedule',
      sourceType: 'csv',
      sourceFilename: 'master_schedule.csv'
    });

    expect(schedule).toBeDefined();
    expect(schedule.id).toBeDefined();
    expect(schedule.projectId).toBe(testProjectId);
    expect(schedule.name).toBe('Baseline Master Schedule');
    expect(schedule.version).toBe('1.0');
    expect(schedule.sourceType).toBe('csv');
    expect(schedule.sourceFilename).toBe('master_schedule.csv');
    expect(schedule.isBaseline).toBe(true);
    expect(schedule.importedAt).toBeDefined();
  });

  it('should retrieve a schedule by ID and project ID', () => {
    const created = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Revision 1 Schedule',
      sourceType: 'xlsx',
      sourceFilename: 'rev1.xlsx',
      isBaseline: false
    });

    const retrieved = scheduleRepo.getById(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.isBaseline).toBe(false);

    const byProj = scheduleRepo.getByIdAndProjectId(created.id, testProjectId);
    expect(byProj).not.toBeNull();
    expect(byProj?.name).toBe('Revision 1 Schedule');

    const wrongProj = scheduleRepo.getByIdAndProjectId(created.id, 'wrong-project-id');
    expect(wrongProj).toBeNull();
  });

  it('should list schedules by project ID', () => {
    scheduleRepo.create({
      projectId: testProjectId,
      name: 'Schedule A',
      sourceType: 'csv'
    });
    scheduleRepo.create({
      projectId: testProjectId,
      name: 'Schedule B',
      sourceType: 'xlsx'
    });

    const list = scheduleRepo.listByProjectId(testProjectId);
    expect(list).toHaveLength(2);
    expect(scheduleRepo.countByProjectId(testProjectId)).toBe(2);
  });

  it('should fail when creating schedule with non-existent projectId due to FK', () => {
    expect(() => {
      scheduleRepo.create({
        projectId: 'non-existent-proj-id',
        name: 'Invalid Schedule',
        sourceType: 'csv'
      });
    }).toThrow(DatabaseError);
  });

  it('should delete a schedule by ID', () => {
    const created = scheduleRepo.create({
      projectId: testProjectId,
      name: 'To Delete',
      sourceType: 'csv'
    });

    expect(scheduleRepo.delete(created.id)).toBe(true);
    expect(scheduleRepo.getById(created.id)).toBeNull();
  });
});
