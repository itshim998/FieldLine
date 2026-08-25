import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { runInTransaction } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';

describe('Database Transaction Management', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    projectRepo = new SqliteProjectRepository(() => db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should commit all operations atomically when a transaction completes successfully', () => {
    const result = runInTransaction(() => {
      const project = projectRepo.create({
        id: 'tx-proj-1',
        name: 'Atomic Port Project',
        code: 'TX-PORT-01'
      });

      db.prepare(`
        INSERT INTO schedules (id, project_id, name, source_type)
        VALUES ('tx-sched-1', 'tx-proj-1', 'Initial Schedule', 'csv')
      `).run();

      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
        VALUES ('tx-act-1', 'tx-proj-1', 'tx-sched-1', 'ACT-01', 'Breakwater', '2026-04-01', '2026-05-01')
      `).run();

      return project;
    }, () => db);

    expect(result.id).toBe('tx-proj-1');
    expect(projectRepo.getById('tx-proj-1')).not.toBeNull();
    expect(db.prepare('SELECT COUNT(*) as c FROM schedules WHERE id = ?').get('tx-sched-1')).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM activities WHERE id = ?').get('tx-act-1')).toEqual({ c: 1 });
  });

  it('should completely roll back all intermediate writes when an error is thrown inside transaction', () => {
    expect(() => {
      runInTransaction(() => {
        // Step 1: create project (this write occurs inside transaction)
        projectRepo.create({
          id: 'tx-rollback-proj',
          name: 'Rollback Project',
          code: 'TX-RB-01'
        });

        // Step 2: insert schedule
        db.prepare(`
          INSERT INTO schedules (id, project_id, name, source_type)
          VALUES ('tx-sched-rb', 'tx-rollback-proj', 'Rollback Schedule', 'csv')
        `).run();

        // Step 3: simulate unexpected failure
        throw new Error('Simulated failure during multi-entity operation');
      }, () => db);
    }).toThrow('Simulated failure during multi-entity operation');

    // Verify neither project nor schedule was persisted (zero partial state)
    expect(projectRepo.getById('tx-rollback-proj')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) as c FROM schedules WHERE id = ?').get('tx-sched-rb')).toEqual({ c: 0 });
    expect(projectRepo.count()).toBe(0);
  });
});
