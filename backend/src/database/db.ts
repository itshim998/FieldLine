import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';
import { INITIAL_SCHEMA_SQL } from './schema.js';

let dbInstance: DatabaseType | null = null;

export interface DatabaseOptions {
  dbPath?: string;
  verbose?: boolean;
}

/**
 * Initializes and returns the SQLite database instance.
 * Enables WAL mode, foreign keys, and executes base schema setup.
 */
export function initDatabase(options: DatabaseOptions = {}): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  const targetPath = options.dbPath || env.DATABASE_PATH;

  // Handle in-memory database vs filesystem database
  if (targetPath !== ':memory:') {
    const dbDir = path.dirname(path.resolve(process.cwd(), targetPath));
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new Database(targetPath, {
    verbose: options.verbose ? console.log : undefined
  });

  // Enable WAL mode for better concurrency and local performance
  if (targetPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');

  // Execute Pass 0 base schema
  db.exec(INITIAL_SCHEMA_SQL);

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
  } catch (error) {
    return false;
  }
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
