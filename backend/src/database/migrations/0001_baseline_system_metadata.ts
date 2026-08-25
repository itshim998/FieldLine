import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0001_baseline_system_metadata';

export function up(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO system_metadata (key, value) VALUES 
      ('schema_version', '0.2.0'),
      ('app_name', 'FieldLine'),
      ('sih_ps_id', 'SIH26122'),
      ('pass', 'Pass 2: SQLite and Persistence Foundation')
    ON CONFLICT(key) DO UPDATE SET 
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP;
  `);
}
