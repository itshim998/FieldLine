import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { runMigrations, MigrationResult } from './migrator.js';

let dbInstance: DatabaseType | null = null;

export interface DatabaseOptions {
  dbPath?: string;
  verbose?: boolean;
  skipMigrations?: boolean;
}

/**
 * Initializes and returns the SQLite database instance.
 * Enables WAL mode, foreign keys, and executes migrations deterministically.
 */
export function initDatabase(options: DatabaseOptions = {}): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  const targetPath = options.dbPath || env.DATABASE_PATH;

  // Handle filesystem directory creation
  if (targetPath !== ':memory:') {
    const dbDir = path.dirname(path.resolve(process.cwd(), targetPath));
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new Database(targetPath, {
    verbose: options.verbose ? console.log : undefined
  });

  // Enable foreign key enforcement
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for file-based database for concurrent reads/writes
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  // Run pending schema migrations unless explicitly skipped
  if (!options.skipMigrations) {
    runMigrations(db);
  }

  dbInstance = db;
  return dbInstance;
}

/**
 * Returns the current database instance, initializing it if necessary.
 */
export function getDatabase(): DatabaseType {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

/**
 * Checks if the database is open and responds to queries.
 */
export function isDatabaseHealthy(): boolean {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT 1 as healthy').get() as { healthy: number } | undefined;
    return row?.healthy === 1;
  } catch {
    return false;
  }
}

/**
 * Executes a function inside an atomic SQLite transaction.
 * Automatically commits on success and rolls back on thrown errors.
 */
export function runInTransaction<T>(fn: () => T, dbProvider?: () => DatabaseType): T {
  const db = dbProvider ? dbProvider() : getDatabase();
  const tx = db.transaction(fn);
  return tx();
}

/**
 * Closes the database connection.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } finally {
      dbInstance = null;
    }
  }
}
