import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations, getAppliedMigrations, MIGRATIONS } from '../src/database/migrator.js';
import { CORE_TABLES } from '../src/database/schema.js';

describe('Database Migration Engine', () => {
  let db: DatabaseType;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  it('should run all pending migrations on a fresh in-memory database', () => {
    const result = runMigrations(db);

    expect(result.applied).toHaveLength(MIGRATIONS.length);
    expect(result.applied).toContain('0001_baseline_system_metadata');
    expect(result.applied).toContain('0002_core_domain_schema');
    expect(result.applied).toContain('0003_upgrade_metadata_for_pass2');
    expect(result.applied).toContain('0004_upgrade_cross_project_integrity');
    expect(result.alreadyApplied).toHaveLength(0);

    const appliedFromDb = getAppliedMigrations(db);
    expect(appliedFromDb).toEqual(MIGRATIONS.map((m) => m.name));
  });

  it('should be completely idempotent when run multiple times', () => {
    const firstRun = runMigrations(db);
    expect(firstRun.applied.length).toBeGreaterThan(0);

    const secondRun = runMigrations(db);
    expect(secondRun.applied).toHaveLength(0);
    expect(secondRun.alreadyApplied).toEqual(MIGRATIONS.map((m) => m.name));

    const thirdRun = runMigrations(db);
    expect(thirdRun.applied).toHaveLength(0);
    expect(thirdRun.alreadyApplied).toEqual(MIGRATIONS.map((m) => m.name));
  });

  it('should correctly upgrade an existing database with recorded 0001 and 0002 migrations by applying 0003 and 0004', () => {
    // 1. Simulate an existing Pass 1 database where 0001 and 0002 are already tracked
    db.exec(`
      CREATE TABLE system_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO system_metadata (key, value) VALUES 
        ('schema_version', '0.1.0'),
        ('app_name', 'FieldLine'),
        ('sih_ps_id', 'SIH26122'),
        ('pass', 'Pass 1: Application Architecture'),
        ('custom_eval_key', 'custom_eval_value');

      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO schema_migrations (name) VALUES 
        ('0001_baseline_system_metadata'),
        ('0002_core_domain_schema');
    `);

    // Verify initial state
    const preVersion = db.prepare("SELECT value FROM system_metadata WHERE key = 'schema_version'").get() as { value: string };
    expect(preVersion.value).toBe('0.1.0');

    // 2. Run the migration engine
    const result = runMigrations(db);

    // 3. Verify that 0003 through 0011 were applied
    expect(result.applied).toEqual([
      '0003_upgrade_metadata_for_pass2',
      '0004_upgrade_cross_project_integrity',
      '0005_processing_jobs',
      '0006_evidence_content_hash',
      '0007_match_review_tiers',
      '0008_project_accounts',
      '0009_operational_blockers',
      '0010_ml_advisory_fields',
      '0011_notification_outbox'
    ]);
    expect(result.alreadyApplied).toContain('0001_baseline_system_metadata');
    expect(result.alreadyApplied).toContain('0002_core_domain_schema');

    // 4. Verify system_metadata upgraded values
    const rows = db.prepare('SELECT key, value FROM system_metadata').all() as Array<{ key: string; value: string }>;
    const metadata = rows.reduce((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {} as Record<string, string>);

    expect(metadata.schema_version).toBe('0.2.0');
    expect(metadata.pass).toBe('Pass 2: SQLite and Persistence Foundation');
    expect(metadata.app_name).toBe('FieldLine');
    expect(metadata.sih_ps_id).toBe('SIH26122');
    expect(metadata.custom_eval_key).toBe('custom_eval_value');

    // 5. Verify running migrations again does not re-apply 0003 or 0004
    const secondRun = runMigrations(db);
    expect(secondRun.applied).toHaveLength(0);
    expect(secondRun.alreadyApplied).toContain('0003_upgrade_metadata_for_pass2');
    expect(secondRun.alreadyApplied).toContain('0004_upgrade_cross_project_integrity');
  });

  it('should upgrade a real existing database with data from 0001+0002+0003, applying 0004 and preserving all data and delete semantics', () => {
    // 1. Create baseline tables with Pass 1/2 initial structure
    db.exec(`
      CREATE TABLE system_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO schema_migrations (name) VALUES 
        ('0001_baseline_system_metadata'),
        ('0002_core_domain_schema'),
        ('0003_upgrade_metadata_for_pass2');

      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        start_date TEXT,
        target_end_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        version TEXT DEFAULT '1.0',
        source_type TEXT NOT NULL,
        source_filename TEXT,
        is_baseline INTEGER DEFAULT 1,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        schedule_id TEXT NOT NULL REFERENCES schedules(id),
        external_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        wbs_code TEXT,
        location TEXT,
        planned_start TEXT NOT NULL,
        planned_finish TEXT NOT NULL,
        planned_quantity REAL,
        unit TEXT,
        baseline_progress REAL DEFAULT 0.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE progress_updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        report_date TEXT NOT NULL,
        reporter_name TEXT,
        reporter_role TEXT,
        source_type TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        status TEXT DEFAULT 'received',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE evidence (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        progress_update_id TEXT REFERENCES progress_updates(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size_bytes INTEGER,
        mime_type TEXT,
        metadata_json TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE activity_matches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        progress_update_id TEXT NOT NULL REFERENCES progress_updates(id),
        evidence_id TEXT REFERENCES evidence(id) ON DELETE SET NULL,
        activity_id TEXT NOT NULL REFERENCES activities(id),
        confidence_score REAL NOT NULL,
        match_method TEXT NOT NULL,
        matched_text TEXT,
        rationale TEXT,
        status TEXT DEFAULT 'suggested',
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE activity_progress (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        activity_id TEXT NOT NULL REFERENCES activities(id),
        progress_update_id TEXT REFERENCES progress_updates(id) ON DELETE SET NULL,
        actual_percent REAL NOT NULL,
        actual_quantity REAL,
        actual_start TEXT,
        actual_finish TEXT,
        status TEXT DEFAULT 'in_progress',
        as_of_date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE project_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Insert representative existing data across all entities
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p1', 'Metro Line 1', 'ML-01')").run();
    db.prepare("INSERT INTO projects (id, name, code) VALUES ('p2', 'Metro Line 2', 'ML-02')").run();
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s1', 'p1', 'Master Schedule', 'csv')").run();
    db.prepare("INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish, planned_quantity) VALUES ('a1', 'p1', 's1', 'ACT-1', 'Excavation', '2026-01-01', '2026-01-10', 100)").run();
    db.prepare("INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text) VALUES ('u1', 'p1', '2026-01-05', 'manual', 'Excavated 50%')").run();
    db.prepare("INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_type) VALUES ('e1', 'p1', 'u1', 'photo.jpg', '/uploads/photo.jpg', 'image')").run();
    db.prepare("INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_type) VALUES ('e_standalone', 'p1', NULL, 'spec.pdf', '/uploads/spec.pdf', 'pdf')").run();
    db.prepare("INSERT INTO activity_matches (id, project_id, progress_update_id, evidence_id, activity_id, confidence_score, match_method) VALUES ('m1', 'p1', 'u1', 'e1', 'a1', 0.9, 'exact_id')").run();
    db.prepare("INSERT INTO activity_progress (id, project_id, activity_id, progress_update_id, actual_percent, as_of_date) VALUES ('prog1', 'p1', 'a1', 'u1', 50.0, '2026-01-05')").run();

    // 3. Run migration engine to apply 0004
    const result = runMigrations(db);

    // 4. Verify 0004 through 0011 were applied
    expect(result.applied).toEqual([
      '0004_upgrade_cross_project_integrity',
      '0005_processing_jobs',
      '0006_evidence_content_hash',
      '0007_match_review_tiers',
      '0008_project_accounts',
      '0009_operational_blockers',
      '0010_ml_advisory_fields',
      '0011_notification_outbox'
    ]);

    // 5. Verify all existing valid data is preserved
    const project = db.prepare('SELECT name FROM projects WHERE id = ?').get('p1') as { name: string };
    expect(project.name).toBe('Metro Line 1');
    const activity = db.prepare('SELECT name, planned_quantity FROM activities WHERE id = ?').get('a1') as { name: string; planned_quantity: number };
    expect(activity.name).toBe('Excavation');
    expect(activity.planned_quantity).toBe(100);
    const evidence = db.prepare('SELECT file_name FROM evidence WHERE id = ?').get('e1') as { file_name: string };
    expect(evidence.file_name).toBe('photo.jpg');

    // 6. Verify cross-project relationships are now rejected
    expect(() => {
      // Activity declares project_id = 'p2' but schedule_id = 's1' (which belongs to 'p1')
      db.prepare("INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish) VALUES ('a_invalid', 'p2', 's1', 'ACT-X', 'Invalid Cross Task', '2026-01-01', '2026-01-10')").run();
    }).toThrow(/FOREIGN KEY constraint failed/);

    expect(() => {
      // Evidence in p2 referencing update u1 from p1
      db.prepare("INSERT INTO evidence (id, project_id, progress_update_id, file_name, file_path, file_type) VALUES ('e_invalid', 'p2', 'u1', 'cross.jpg', '/uploads/cross.jpg', 'image')").run();
    }).toThrow(/FOREIGN KEY constraint failed/);

    // 7. Verify valid same-project relationships still work
    db.prepare("INSERT INTO schedules (id, project_id, name, source_type) VALUES ('s2', 'p2', 'Line 2 Sched', 'csv')").run();
    db.prepare("INSERT INTO activities (id, project_id, schedule_id, external_id, name, planned_start, planned_finish) VALUES ('a2', 'p2', 's2', 'ACT-2', 'Line 2 Task', '2026-02-01', '2026-02-10')").run();
    expect(db.prepare('SELECT name FROM activities WHERE id = ?').get('a2')).toEqual({ name: 'Line 2 Task' });

    // 8. Verify deleting progress update u1 sets progress_update_id to NULL on evidence while preserving the evidence row
    db.prepare('DELETE FROM progress_updates WHERE id = ?').run('u1');

    const e1Row = db.prepare('SELECT id, project_id, progress_update_id FROM evidence WHERE id = ?').get('e1') as { id: string; project_id: string; progress_update_id: string | null };
    expect(e1Row).toBeDefined();
    expect(e1Row.id).toBe('e1');
    expect(e1Row.project_id).toBe('p1');
    expect(e1Row.progress_update_id).toBeNull();

    // Verify standalone evidence remains intact
    const eStandalone = db.prepare('SELECT id, progress_update_id FROM evidence WHERE id = ?').get('e_standalone') as { id: string; progress_update_id: string | null };
    expect(eStandalone).toBeDefined();
    expect(eStandalone.id).toBe('e_standalone');
    expect(eStandalone.progress_update_id).toBeNull();

    // Verify nullable progress_update_id on activity_progress was set to NULL
    const prog1Row = db.prepare('SELECT id, progress_update_id FROM activity_progress WHERE id = ?').get('prog1') as { id: string; progress_update_id: string | null };
    expect(prog1Row).toBeDefined();
    expect(prog1Row.progress_update_id).toBeNull();

    // 9. Verify running migrations again does not reapply anything
    const rerun = runMigrations(db);
    expect(rerun.applied).toHaveLength(0);
    expect(rerun.alreadyApplied).toContain('0004_upgrade_cross_project_integrity');
  });

  it('should create all required core domain and metadata tables', () => {
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    for (const expectedTable of CORE_TABLES) {
      expect(tableNames).toContain(expectedTable);
    }
  });

  it('should preserve system metadata from Pass 0 / Pass 1', () => {
    runMigrations(db);

    const rows = db.prepare('SELECT key, value FROM system_metadata').all() as Array<{ key: string; value: string }>;
    const metadata = rows.reduce((acc, r) => {
      acc[r.key] = r.value;
      return acc;
    }, {} as Record<string, string>);

    expect(metadata.app_name).toBe('FieldLine');
    expect(metadata.sih_ps_id).toBe('SIH26122');
    expect(metadata.schema_version).toBe('0.2.0');
  });

  it('should create indexes for domain entities', () => {
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_schedules_project_id');
    expect(indexNames).toContain('idx_activities_project_id');
    expect(indexNames).toContain('idx_activities_schedule_id');
    expect(indexNames).toContain('idx_activities_external_id');
    expect(indexNames).toContain('idx_activities_schedule_external');
    expect(indexNames).toContain('idx_progress_updates_project_date');
    expect(indexNames).toContain('idx_evidence_project_id');
    expect(indexNames).toContain('idx_evidence_update_id');
    expect(indexNames).toContain('idx_activity_matches_project_id');
    expect(indexNames).toContain('idx_activity_matches_update_id');
    expect(indexNames).toContain('idx_activity_matches_activity_id');
    expect(indexNames).toContain('idx_activity_progress_project_activity');
    expect(indexNames).toContain('idx_activity_progress_activity_id');
    expect(indexNames).toContain('idx_project_events_project_created');
    expect(indexNames).toContain('idx_project_events_event_type');
  });
});
