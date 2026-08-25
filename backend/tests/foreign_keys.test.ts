import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';

describe('Foreign Key Enforcement and Referential Integrity', () => {
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

  it('should verify PRAGMA foreign_keys is enabled', () => {
    const row = db.pragma('foreign_keys', { simple: true });
    expect(row).toBe(1);
  });

  it('should allow valid relational inserts across the domain dependency graph', () => {
    // 1. Insert Project
    db.prepare(`
      INSERT INTO projects (id, name, code, status) 
      VALUES ('p1', 'Metro Line 3', 'METRO-03', 'active')
    `).run();

    // 2. Insert Schedule
    db.prepare(`
      INSERT INTO schedules (id, project_id, name, version, source_type)
      VALUES ('s1', 'p1', 'Baseline Master Schedule', '1.0', 'csv')
    `).run();

    // 3. Insert Activity
    db.prepare(`
      INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, planned_quantity, unit)
      VALUES ('a1', 'p1', 's1', 'ACT-101', 'Piling Work Block A', '2026-03-01', '2026-03-15', 500, 'm3')
    `).run();

    // 4. Insert Progress Update
    db.prepare(`
      INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text)
      VALUES ('u1', 'p1', '2026-03-05', 'manual', 'Completed 200 m3 of piling at Block A')
    `).run();

    // 5. Insert Evidence
    db.prepare(`
      INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_type)
      VALUES ('e1', 'p1', 'u1', 'site_photo_01.jpg', '/uploads/evidence/site_photo_01.jpg', 'image')
    `).run();

    // 6. Insert Activity Match
    db.prepare(`
      INSERT INTO activity_matches (id, project_id, progress_update_id, evidence_id, activity_id, confidence_score, match_method)
      VALUES ('m1', 'p1', 'u1', 'e1', 'a1', 0.95, 'text_similarity')
    `).run();

    // 7. Insert Activity Progress
    db.prepare(`
      INSERT INTO activity_progress (id, project_id, activity_id, progress_update_id, actual_percent, actual_quantity, as_of_date)
      VALUES ('prog1', 'p1', 'a1', 'u1', 40.0, 200.0, '2026-03-05')
    `).run();

    // 8. Insert Project Event
    db.prepare(`
      INSERT INTO project_events (id, project_id, event_type, summary)
      VALUES ('ev1', 'p1', 'progress_reported', 'Progress reported for piling')
    `).run();

    // Query verification
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as { name: string };
    expect(project.name).toBe('Metro Line 3');

    const activity = db.prepare('SELECT name, planned_quantity FROM activities WHERE id = ?').get('a1') as { name: string; planned_quantity: number };
    expect(activity.name).toBe('Piling Work Block A');
    expect(activity.planned_quantity).toBe(500);
  });

  it('should reject schedule insert referencing a non-existent project', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO schedules (id, project_id, name, version, source_type)
        VALUES ('s_invalid', 'non_existent_project', 'Invalid Schedule', '1.0', 'csv')
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('should reject activity insert referencing a non-existent schedule', () => {
    db.prepare(`
      INSERT INTO projects (id, name, code) VALUES ('p1', 'Bridge Construction', 'BRG-01')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
        VALUES ('a_invalid', 'p1', 'non_existent_schedule', 'ACT-999', 'Ghost Task', '2026-01-01', '2026-01-10')
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('should reject activity match referencing a non-existent activity', () => {
    db.prepare(`INSERT INTO projects (id, name, code) VALUES ('p1', 'Highway 5', 'HW-05')`).run();
    db.prepare(`
      INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text)
      VALUES ('u1', 'p1', '2026-03-01', 'manual', 'Report text')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO activity_matches (id, project_id, progress_update_id, activity_id, confidence_score, match_method)
        VALUES ('m_invalid', 'p1', 'u1', 'non_existent_activity', 0.9, 'exact_id')
      `).run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('should cascade delete related schedules and activities when project is deleted', () => {
    db.prepare(`INSERT INTO projects (id, name, code) VALUES ('p1', 'Port Terminal', 'PORT-01')`).run();
    db.prepare(`INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Master', 'csv')`).run();
    db.prepare(`
      INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish)
      VALUES ('a1', 'p1', 's1', 'ACT-1', 'Quay Wall', '2026-01-01', '2026-02-01')
    `).run();

    expect(db.prepare('SELECT COUNT(*) as c FROM schedules WHERE project_id = ?').get('p1')).toEqual({ c: 1 });
    expect(db.prepare('SELECT COUNT(*) as c FROM activities WHERE project_id = ?').get('p1')).toEqual({ c: 1 });

    // Delete project
    db.prepare('DELETE FROM projects WHERE id = ?').run('p1');

    // Cascaded deletions
    expect(db.prepare('SELECT COUNT(*) as c FROM schedules WHERE project_id = ?').get('p1')).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) as c FROM activities WHERE project_id = ?').get('p1')).toEqual({ c: 0 });
  });

  it('should set progress_update_id to NULL in evidence when update is deleted', () => {
    db.prepare(`INSERT INTO projects (id, name, code) VALUES ('p1', 'Airport Pier', 'AIR-01')`).run();
    db.prepare(`
      INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text)
      VALUES ('u1', 'p1', '2026-03-01', 'manual', 'Inspection report')
    `).run();
    db.prepare(`
      INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_type)
      VALUES ('e1', 'p1', 'u1', 'report.pdf', '/uploads/evidence/report.pdf', 'pdf')
    `).run();

    // Delete update
    db.prepare('DELETE FROM progress_updates WHERE id = ?').run('u1');

    const evidenceRow = db.prepare('SELECT progress_update_id FROM evidence WHERE id = ?').get('e1') as { progress_update_id: string | null };
    expect(evidenceRow.progress_update_id).toBeNull();
  });
});
