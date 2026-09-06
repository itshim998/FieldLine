import { Database as DatabaseType } from 'better-sqlite3';
import * as migration0001 from './migrations/0001_baseline_system_metadata.js';
import * as migration0002 from './migrations/0002_core_domain_schema.js';
import * as migration0003 from './migrations/0003_upgrade_metadata_for_pass2.js';
import * as migration0004 from './migrations/0004_upgrade_cross_project_integrity.js';
import * as migration0005 from './migrations/0005_processing_jobs.js';
import * as migration0006 from './migrations/0006_evidence_content_hash.js';
import * as migration0007 from './migrations/0007_match_review_tiers.js';
import * as migration0008 from './migrations/0008_project_accounts.js';

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
  { name: migration0003.name, up: migration0003.up },
  { name: migration0004.name, up: migration0004.up },
  { name: migration0005.name, up: migration0005.up },
  { name: migration0006.name, up: migration0006.up },
  { name: migration0007.name, up: migration0007.up },
  { name: migration0008.name, up: migration0008.up }
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
 * Each migration is applied within an atomic transaction with foreign keys safely toggled.
 */
export function runMigrations(db: DatabaseType): MigrationResult {
  initMigrationTable(db);
  const appliedSet = new Set(getAppliedMigrations(db));
  const newlyApplied: string[] = [];
  const alreadyApplied: string[] = [];

  const recordMigrationStmt = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  const fkEnabled = db.pragma('foreign_keys', { simple: true }) === 1;

  for (const migration of MIGRATIONS) {
    if (appliedSet.has(migration.name)) {
      alreadyApplied.push(migration.name);
      continue;
    }

    // Disable foreign keys outside transaction for table rebuild compatibility
    db.pragma('foreign_keys = OFF');

    const applyMigrationTx = db.transaction(() => {
      migration.up(db);
      recordMigrationStmt.run(migration.name);
    });

    applyMigrationTx();

    if (fkEnabled) {
      db.pragma('foreign_keys = ON');
    }

    newlyApplied.push(migration.name);
  }

  if (fkEnabled) {
    db.pragma('foreign_keys = ON');
  }

  return {
    applied: newlyApplied,
    alreadyApplied
  };
}
