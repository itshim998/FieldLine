import { Database as DatabaseType } from 'better-sqlite3';
import * as migration0001 from './migrations/0001_baseline_system_metadata.js';
import * as migration0002 from './migrations/0002_core_domain_schema.js';
import * as migration0003 from './migrations/0003_upgrade_metadata_for_pass2.js';

export interface Migration {
  name: string;
  up: (db: DatabaseType) => void;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export const MIGRATIONS: Migration[] = [
  { name: migration0001.name, up: migration0001.up },
  { name: migration0002.name, up: migration0002.up },
  { name: migration0003.name, up: migration0003.up }
];

/**
 * Initializes the schema_migrations tracking table if it does not already exist.
 */
export function initMigrationTable(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Returns the list of migration names that have already been applied to the database.
 */
export function getAppliedMigrations(db: DatabaseType): string[] {
  initMigrationTable(db);
  const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY id ASC').all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Runs all pending migrations deterministically in lexical/registration order.
 * Each migration is applied within an atomic transaction.
 */
export function runMigrations(db: DatabaseType): MigrationResult {
  initMigrationTable(db);
  const appliedSet = new Set(getAppliedMigrations(db));
  const newlyApplied: string[] = [];
  const alreadyApplied: string[] = [];

  const recordMigrationStmt = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) {
      alreadyApplied.push(migration.name);
      continue;
    }

    const applyMigrationTx = db.transaction(() => {
      migration.up(db);
      recordMigrationStmt.run(migration.name);
    });

    applyMigrationTx();
    newlyApplied.push(migration.name);
  }

  return {
    applied: newlyApplied,
    alreadyApplied
  };
}
