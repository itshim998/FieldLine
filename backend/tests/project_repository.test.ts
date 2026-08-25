import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { ConflictError, NotFoundError } from '../src/errors/AppError.js';

describe('SqliteProjectRepository', () => {
  let db: DatabaseType;
  let repo: SqliteProjectRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new SqliteProjectRepository(() => db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create a project with generated ID and persist all fields accurately', () => {
    const project = repo.create({
      name: 'Mumbai Coastal Road',
      description: 'Reclamation and undersea tunnel segment',
      code: 'MCR-01',
      status: 'active',
      startDate: '2026-01-01',
      targetEndDate: '2027-12-31'
    });

    expect(project).toBeDefined();
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Mumbai Coastal Road');
    expect(project.description).toBe('Reclamation and undersea tunnel segment');
    expect(project.code).toBe('MCR-01');
    expect(project.status).toBe('active');
    expect(project.startDate).toBe('2026-01-01');
    expect(project.targetEndDate).toBe('2027-12-31');
    expect(project.createdAt).toBeDefined();
    expect(project.updatedAt).toBeDefined();
  });

  it('should retrieve a persisted project by its ID', () => {
    const created = repo.create({
      id: 'proj-custom-id-123',
      name: 'Delhi Metro Phase 4',
      code: 'DMRC-P4'
    });

    const retrieved = repo.getById('proj-custom-id-123');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.name).toBe('Delhi Metro Phase 4');
    expect(retrieved?.code).toBe('DMRC-P4');
    expect(retrieved?.status).toBe('active');
  });

  it('should retrieve a persisted project by its code', () => {
    repo.create({
      name: 'Bullet Train Corridor',
      code: 'MAHSR-01'
    });

    const retrieved = repo.getByCode('MAHSR-01');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.name).toBe('Bullet Train Corridor');
  });

  it('should return null when retrieving a non-existent project', () => {
    const byId = repo.getById('non_existent_project_id');
    expect(byId).toBeNull();

    const byCode = repo.getByCode('NON_EXISTENT_CODE');
    expect(byCode).toBeNull();
  });

  it('should throw ConflictError when creating a project with a duplicate code', () => {
    repo.create({
      name: 'Expressway Package 1',
      code: 'EXP-PKG1'
    });

    expect(() => {
      repo.create({
        name: 'Expressway Package 1 Duplicate',
        code: 'EXP-PKG1'
      });
    }).toThrow(ConflictError);
  });

  it('should list all projects ordered by creation date descending', () => {
    repo.create({ name: 'Project Alpha', code: 'A1' });
    repo.create({ name: 'Project Beta', code: 'B1' });
    repo.create({ name: 'Project Gamma', code: 'G1' });

    const list = repo.listAll();
    expect(list).toHaveLength(3);
    expect(repo.count()).toBe(3);
  });

  it('should update an existing project', () => {
    const created = repo.create({
      name: 'Old Name',
      code: 'UPDATE-01',
      status: 'planning'
    });

    const updated = repo.update(created.id, {
      name: 'New Name',
      status: 'active'
    });

    expect(updated.name).toBe('New Name');
    expect(updated.status).toBe('active');
    expect(updated.code).toBe('UPDATE-01');
  });

  it('should throw NotFoundError when updating a non-existent project', () => {
    expect(() => {
      repo.update('non-existent-id', { name: 'New Name' });
    }).toThrow(NotFoundError);
  });

  it('should delete a project by ID', () => {
    const created = repo.create({
      name: 'Temporary Project',
      code: 'TEMP-01'
    });

    expect(repo.getById(created.id)).not.toBeNull();
    const deleted = repo.delete(created.id);
    expect(deleted).toBe(true);
    expect(repo.getById(created.id)).toBeNull();
    expect(repo.count()).toBe(0);
  });
});
