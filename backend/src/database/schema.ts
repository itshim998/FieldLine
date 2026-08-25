/**
 * Base database schema initialization for Pass 0 & Pass 1.
 * In Pass 0 & 1, core system metadata is verified for deterministic SQLite initialization.
 * Full domain tables (projects, schedules, activities, progress, evidence) belong to Pass 2.
 */

export const INITIAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS system_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO system_metadata (key, value) VALUES 
    ('schema_version', '0.1.0'),
    ('app_name', 'FieldLine'),
    ('sih_ps_id', 'SIH26122'),
    ('pass', 'Pass 1: Application Architecture');
`;
