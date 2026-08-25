import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';

describe('Database Integrity Constraints', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should enforce unique project code constraint', () => {
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Project Alpha', 'ALPHA-01')").run();

    expect(() => {
      db.prepare("INSERT INTO projects (id, name, code) VALUES ('p2', 'Project Beta', 'ALPHA-01')").run();
    }).toThrow(/UNIQUE constraint failed: projects\.code/);
  });

  it('should enforce unique (schedule_id, external_id) constraint on activities', () => {
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Project Alpha', 'ALPHA-01')").run();
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Sched 1', 'csv')").run();

    db.prepare(`
      INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
      VALUES ('a1', 'p1', 's1', 'ACT-100', 'Task 1', '2026-01-01', '2026-01-10')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
        VALUES ('a2', 'p1', 's1', 'ACT-100', 'Duplicate Task 1', '2026-01-05', '2026-01-15')
      `).run();
    }).toThrow(/UNIQUE constraint failed: activities\.schedule_id, activities\.external_id/);
  });

  it('should enforce baseline_progress range check constraint (0.0 to 100.0)', () => {
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Project Alpha', 'ALPHA-01')").run();
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Sched 1', 'csv')").run();

    // Valid: 0, 50, 100
    db.prepare(`
      INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, baseline_progress)
      VALUES ('a1', 'p1', 's1', 'ACT-1', 'Valid Task', '2026-01-01', '2026-01-10', 50.0)
    `).run();

    // Invalid: > 100.0
    expect(() => {
      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, baseline_progress)
        VALUES ('a2', 'p1', 's1', 'ACT-2', 'Invalid Task', '2026-01-01', '2026-01-10', 105.0)
      `).run();
    }).toThrow(/CHECK constraint failed/);

    // Invalid: < 0.0
    expect(() => {
      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, baseline_progress)
        VALUES ('a3', 'p1', 's1', 'ACT-3', 'Invalid Task', '2026-01-01', '2026-01-10', -5.0)
      `).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('should enforce planned_quantity non-negative check constraint', () => {
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Project Alpha', 'ALPHA-01')").run();
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Sched 1', 'csv')").run();

    // Invalid negative quantity
    expect(() => {
      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, planned_quantity)
        VALUES ('a_neg', 'p1', 's1', 'ACT-NEG', 'Negative Quantity Task', '2026-01-01', '2026-01-10', -100)
      `).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('should enforce confidence_score range check constraint (0.0 to 1.0) on activity_matches', () => {
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Project Alpha', 'ALPHA-01')").run();
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Sched 1', 'csv')").run();
    db.prepare(`
      INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
      VALUES ('a1', 'p1', 's1', 'ACT-1', 'Task 1', '2026-01-01', '2026-01-10')
    `).run();
    db.prepare(`
      INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text)
      VALUES ('u1', 'p1', '2026-01-02', 'manual', 'Daily log')
    `).run();

    // Invalid confidence: 1.5
    expect(() => {
      db.prepare(`
        INSERT INTO activity_matches (id, project_id, progress_update_id, activity_id, confidence_score, match_method)
        VALUES ('m1', 'p1', 'u1', 'a1', 1.5, 'exact_id')
      `).run();
    }).toThrow(/CHECK constraint failed/);
  });

  it('should enforce NOT NULL constraints on critical columns', () => {
    // Project name is NOT NULL
    expect(() => {
      db.prepare("INSERT INTO projects (id, name, code) VALUES ('p_null', NULL, 'NULL-01')").run();
    }).toThrow(/NOT NULL constraint failed/);

    // Project code is NOT NULL
    expect(() => {
      db.prepare("INSERT INTO projects (id, name, code) VALUES ('p_null2', 'Name', NULL)").run();
    }).toThrow(/NOT NULL constraint failed/);
  });
});
