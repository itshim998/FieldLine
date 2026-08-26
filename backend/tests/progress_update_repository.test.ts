import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { ConflictError, NotFoundError } from '../src/errors/AppError.js';

describe('SqliteProgressUpdateRepository', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let testProjectId: string;
  let testProject2Id: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);

    const p1 = projectRepo.create({
      name: 'Bullet Train Corridor',
      code: 'BTC-01',
      status: 'active'
    });
    testProjectId = p1.id;

    const p2 = projectRepo.create({
      name: 'Expressway Package 4',
      code: 'EXP-04',
      status: 'active'
    });
    testProject2Id = p2.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create a manual progress update and persist all fields accurately', () => {
    const rawText = 'Foundation work at Block B is 60% complete. Concrete pouring started today.';
    const update = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Rajesh Sharma',
      reporterRole: 'Site Engineer',
      sourceType: 'manual',
      rawText,
      status: 'received'
    });

    expect(update).toBeDefined();
    expect(update.id).toBeDefined();
    expect(update.projectId).toBe(testProjectId);
    expect(update.reportDate).toBe('2026-08-26');
    expect(update.reporterName).toBe('Rajesh Sharma');
    expect(update.reporterRole).toBe('Site Engineer');
    expect(update.sourceType).toBe('manual');
    expect(update.rawText).toBe(rawText);
    expect(update.status).toBe('received');
    expect(update.createdAt).toBeDefined();
    expect(update.updatedAt).toBeDefined();
  });

  it('should retrieve a progress update by its ID', () => {
    const created = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-25',
      reporterName: 'Amit Verma',
      sourceType: 'manual',
      rawText: 'Excavation completed for Pier P12.'
    });

    const retrieved = updateRepo.getById(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.projectId).toBe(testProjectId);
    expect(retrieved?.rawText).toBe('Excavation completed for Pier P12.');
    expect(retrieved?.reporterName).toBe('Amit Verma');
    expect(retrieved?.reporterRole).toBeNull();
  });

  it('should retrieve a progress update by ID and project ID (project scoping)', () => {
    const update1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Supervisor 1',
      sourceType: 'manual',
      rawText: 'Update for Project 1'
    });

    // Valid query with matching projectId
    const match = updateRepo.getByIdAndProjectId(update1.id, testProjectId);
    expect(match).not.toBeNull();
    expect(match?.id).toBe(update1.id);

    // Cross-project query should return null
    const mismatch = updateRepo.getByIdAndProjectId(update1.id, testProject2Id);
    expect(mismatch).toBeNull();
  });

  it('should list progress updates by project ID in newest-first order (report_date DESC, created_at DESC)', async () => {
    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-20',
      sourceType: 'manual',
      rawText: 'Day 1 report'
    });

    const u2 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-25',
      sourceType: 'manual',
      rawText: 'Day 2 report'
    });

    const u3 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-25',
      sourceType: 'manual',
      rawText: 'Day 2 evening report'
    });

    const uOther = updateRepo.create({
      projectId: testProject2Id,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Other project report'
    });

    const project1Updates = updateRepo.listByProjectId(testProjectId);
    expect(project1Updates).toHaveLength(3);
    // Newest report date first
    expect(project1Updates[0].reportDate).toBe('2026-08-25');
    expect(project1Updates[1].reportDate).toBe('2026-08-25');
    expect(project1Updates[2].reportDate).toBe('2026-08-20');
    // Ensure cross project is not included
    expect(project1Updates.some(u => u.id === uOther.id)).toBe(false);
  });

  it('should count progress updates accurately per project', () => {
    expect(updateRepo.countByProjectId(testProjectId)).toBe(0);

    updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Report A'
    });
    updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Report B'
    });

    expect(updateRepo.countByProjectId(testProjectId)).toBe(2);
    expect(updateRepo.countByProjectId(testProject2Id)).toBe(0);
  });

  it('should atomically record a progress_reported event in project_events', () => {
    const update = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      reporterName: 'Vikram Singh',
      reporterRole: 'QA Manager',
      sourceType: 'manual',
      rawText: 'Steel reinforcement tested and certified.'
    });

    const eventRow = db.prepare('SELECT * FROM project_events WHERE entity_id = ?').get(update.id) as {
      event_type: string;
      project_id: string;
      entity_type: string;
      summary: string;
      payload_json: string;
    } | undefined;

    expect(eventRow).toBeDefined();
    expect(eventRow?.event_type).toBe('progress_reported');
    expect(eventRow?.project_id).toBe(testProjectId);
    expect(eventRow?.entity_type).toBe('progress_updates');
    expect(eventRow?.summary).toBe('Manual progress report received');
    const payload = JSON.parse(eventRow!.payload_json);
    expect(payload.reportDate).toBe('2026-08-26');
    expect(payload.reporterName).toBe('Vikram Singh');
  });

  it('should enforce foreign key constraint and throw NotFoundError when project does not exist', () => {
    expect(() => {
      updateRepo.create({
        projectId: 'non-existent-project-id',
        reportDate: '2026-08-26',
        sourceType: 'manual',
        rawText: 'Orphan report'
      });
    }).toThrow(NotFoundError);
  });

  it('should cascade delete progress updates when project is deleted', () => {
    const update = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'Report to be cascade deleted'
    });

    expect(updateRepo.getById(update.id)).not.toBeNull();

    // Delete project
    projectRepo.delete(testProjectId);

    // Verify progress update is removed by cascade
    expect(updateRepo.getById(update.id)).toBeNull();
    expect(updateRepo.countByProjectId(testProjectId)).toBe(0);
  });

  it('should support delete and deleteByIdAndProjectId methods', () => {
    const u1 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-26',
      sourceType: 'manual',
      rawText: 'To delete'
    });

    const deletedMismatch = updateRepo.deleteByIdAndProjectId(u1.id, testProject2Id);
    expect(deletedMismatch).toBe(false);
    expect(updateRepo.getById(u1.id)).not.toBeNull();

    const deleted = updateRepo.deleteByIdAndProjectId(u1.id, testProjectId);
    expect(deleted).toBe(true);
    expect(updateRepo.getById(u1.id)).toBeNull();
  });
});
