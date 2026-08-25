import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0003_upgrade_metadata_for_pass2';

export function up(db: DatabaseType): void {
  db.exec(`
    INSERT INTO system_metadata (key, value, updated_at) 
    VALUES ('schema_version', '0.2.0', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = '0.2.0', updated_at = CURRENT_TIMESTAMP;

    INSERT INTO system_metadata (key, value, updated_at)
    VALUES ('pass', 'Pass 2: SQLite and Persistence Foundation', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = 'Pass 2: SQLite and Persistence Foundation', updated_at = CURRENT_TIMESTAMP;
  `);
}
