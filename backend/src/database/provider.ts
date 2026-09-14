import { env } from '../config/env.js';
import { isDatabaseHealthy, closeDatabase, initDatabase } from './db.js';
import { isPostgresHealthy, closePostgres, initPostgres, runInPostgresTransaction } from './postgres.js';
import type pg from 'pg';

export type DatabaseEngine = 'sqlite' | 'postgres';
export type MaybePromise<T> = T | Promise<T>;

export interface DatabaseProviderInfo {
  type: DatabaseEngine;
  status: 'connected' | 'disconnected' | 'error';
  target: string;
}

/**
 * Returns the currently configured database provider type.
 */
export function getActiveDatabaseProvider(): DatabaseEngine {
  return env.DATABASE_PROVIDER;
}

export function isPostgresDatabase(): boolean {
  return env.DATABASE_PROVIDER === 'postgres';
}

export async function initActiveDatabase(): Promise<void> {
  if (isPostgresDatabase()) {
    await initPostgres({ autoMigrate: env.DATABASE_AUTO_MIGRATE });
  } else {
    initDatabase();
  }
}

/**
 * Verifies that the active database has its required schema ready.
 * For PostgreSQL, asserts that all critical tables are present.
 */
export async function assertActiveDatabaseReady(): Promise<void> {
  if (isPostgresDatabase()) {
    const { assertPostgresSchemaReady } = await import('./postgres.js');
    await assertPostgresSchemaReady();
  }
}

export async function runPostgresMigrations() {
  const { runPostgresMigrations: runner } = await import('./postgres-migrator.js');
  return runner();
}

/**
 * Checks connectivity to the currently configured database provider.
 */
export async function checkActiveDatabaseHealth(): Promise<boolean> {
  const provider = getActiveDatabaseProvider();
  if (provider === 'postgres') {
    return isPostgresHealthy();
  }
  return isDatabaseHealthy();
}

/**
 * Closes the active database connections gracefully.
 */
export async function closeActiveDatabase(): Promise<void> {
  const provider = getActiveDatabaseProvider();
  if (provider === 'postgres') {
    await closePostgres();
  } else {
    closeDatabase();
  }
}

/**
 * Executes a transaction using the active database provider.
 */
export async function runInActiveTransaction<T>(
  fn: (txHandle?: pg.PoolClient) => Promise<T> | T
): Promise<T> {
  const provider = getActiveDatabaseProvider();
  if (provider === 'postgres') {
    return runInPostgresTransaction(async (client) => {
      return await fn(client);
    });
  }
  // SQLite synchronous transaction
  const { runInTransaction } = await import('./db.js');
  return runInTransaction(() => fn() as T);
}
