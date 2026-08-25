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

  it('should correctly upgrade an existing database with recorded 0001 and 0002 migrations by applying 0003', () => {
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

    // 3. Verify that only 0003 was newly applied
    expect(result.applied).toEqual(['0003_upgrade_metadata_for_pass2']);
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

    // 5. Verify running migrations again does not re-apply 0003
    const secondRun = runMigrations(db);
    expect(secondRun.applied).toHaveLength(0);
    expect(secondRun.alreadyApplied).toContain('0003_upgrade_metadata_for_pass2');
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
