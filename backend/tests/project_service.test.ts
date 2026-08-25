import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { DefaultProjectService } from '../src/services/project.service.js';
import { NotFoundError, ConflictError } from '../src/errors/AppError.js';

describe('ProjectService', () => {
  let db: DatabaseType;
  let repo: SqliteProjectRepository;
  let service: DefaultProjectService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new SqliteProjectRepository(() => db);
    service = new DefaultProjectService(repo);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should create a project with normalized fields and defaults', () => {
    const project = service.createProject({
      name: '  Bangalore Metro Phase 3  ',
      code: '  bmrc-p3  ',
      description: '  Pink Line Extension  ',
      startDate: '2026-03-01',
      targetEndDate: '2028-12-31'
    });

    expect(project).toBeDefined();
    expect(project.id).toBeDefined();
    expect(project.name).toBe('Bangalore Metro Phase 3');
    expect(project.code).toBe('BMRC-P3');
    expect(project.description).toBe('Pink Line Extension');
    expect(project.status).toBe('active');
    expect(project.startDate).toBe('2026-03-01');
    expect(project.targetEndDate).toBe('2028-12-31');
  });

  it('should list all projects', () => {
    service.createProject({ name: 'Project A', code: 'PROJ-A' });
    service.createProject({ name: 'Project B', code: 'PROJ-B' });

    const list = service.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.code)).toContain('PROJ-A');
    expect(list.map((p) => p.code)).toContain('PROJ-B');
  });

  it('should get a project by ID', () => {
    const created = service.createProject({
      name: 'Dedicated Freight Corridor',
      code: 'DFC-W01'
    });

    const fetched = service.getProject(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Dedicated Freight Corridor');
  });

  it('should throw NotFoundError when getting non-existent project by ID', () => {
    expect(() => {
      service.getProject('non-existent-uuid');
    }).toThrow(NotFoundError);
  });

  it('should get a project by code', () => {
    service.createProject({
      name: 'Chenab Bridge Project',
      code: 'CBP-01'
    });

    const fetched = service.getProjectByCode('cbp-01');
    expect(fetched.name).toBe('Chenab Bridge Project');
    expect(fetched.code).toBe('CBP-01');
  });

  it('should throw NotFoundError when getting non-existent project by code', () => {
    expect(() => {
      service.getProjectByCode('UNKNOWN-CODE');
    }).toThrow(NotFoundError);
  });

  it('should update an existing project', () => {
    const created = service.createProject({
      name: 'Initial Name',
      code: 'INIT-01',
      status: 'planning'
    });

    const updated = service.updateProject(created.id, {
      name: 'Updated Name',
      status: 'active',
      description: 'Updated Description'
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.status).toBe('active');
    expect(updated.description).toBe('Updated Description');
  });

  it('should throw NotFoundError when updating non-existent project', () => {
    expect(() => {
      service.updateProject('non-existent-id', { name: 'New Name' });
    }).toThrow(NotFoundError);
  });

  it('should throw ConflictError when updating project code to an existing code', () => {
    service.createProject({ name: 'Project 1', code: 'CODE-01' });
    const p2 = service.createProject({ name: 'Project 2', code: 'CODE-02' });

    expect(() => {
      service.updateProject(p2.id, { code: 'CODE-01' });
    }).toThrow(ConflictError);
  });

  it('should delete an existing project', () => {
    const created = service.createProject({
      name: 'To be deleted',
      code: 'DEL-01'
    });

    const result = service.deleteProject(created.id);
    expect(result).toBe(true);
    expect(() => service.getProject(created.id)).toThrow(NotFoundError);
  });

  it('should throw NotFoundError when deleting non-existent project', () => {
    expect(() => {
      service.deleteProject('non-existent-id');
    }).toThrow(NotFoundError);
  });
});
