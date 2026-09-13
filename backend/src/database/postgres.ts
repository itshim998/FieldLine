import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runPostgresMigrations, PostgresMigrationResult } from './postgres-migrator.js';

const { Pool } = pg;

let postgresPoolInstance: pg.Pool | null = null;

export interface PostgresInitOptions {
  connectionString?: string;
  ssl?: boolean;
  pool?: pg.Pool;
  skipMigrations?: boolean;
  maxConnections?: number;
}

/**
 * Initializes the shared PostgreSQL connection pool and runs pending migrations.
 * Connects directly or via Supabase session pooler on port 5432 or 6543.
 */
export async function initPostgres(options: PostgresInitOptions = {}): Promise<pg.Pool> {
  if (postgresPoolInstance) {
    return postgresPoolInstance;
  }

  if (options.pool) {
    postgresPoolInstance = options.pool;
  } else {
    const connectionString = options.connectionString || env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to initialize PostgreSQL connection pool');
    }

    const sslConfig =
      options.ssl ?? env.DATABASE_SSL
        ? { rejectUnauthorized: false }
        : undefined;

    postgresPoolInstance = new Pool({
      connectionString,
      ssl: sslConfig,
      max: options.maxConnections || env.DATABASE_POOL_MAX || 5,
      min: env.DATABASE_POOL_MIN || 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    postgresPoolInstance.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client in pool:', err);
    });
  }

  if (!options.skipMigrations) {
    try {
      await runPostgresMigrations(postgresPoolInstance);
    } catch (migErr) {
      logger.error('Failed to apply PostgreSQL migrations during initialization:', migErr);
      throw migErr;
    }
  }

  return postgresPoolInstance;
}

/**
 * Returns the active shared PostgreSQL pool instance.
 */
export function getPostgresPool(): pg.Pool {
  if (!postgresPoolInstance) {
    throw new Error('PostgreSQL pool has not been initialized. Call initPostgres() first.');
  }
  return postgresPoolInstance;
}

/**
 * Executes a function inside an atomic PostgreSQL transaction with connection pinning.
 * Ensures the entire transaction (BEGIN, queries, COMMIT/ROLLBACK) executes on the exact same PoolClient.
 */
export async function runInPostgresTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  poolProvider?: () => pg.Pool
): Promise<T> {
  const pool = poolProvider ? poolProvider() : getPostgresPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Failed to rollback PostgreSQL transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Checks PostgreSQL connectivity by executing a lightweight SELECT 1 query.
 */
export async function isPostgresHealthy(pool?: pg.Pool): Promise<boolean> {
  try {
    const p = pool || postgresPoolInstance;
    if (!p) return false;
    const res = await p.query('SELECT 1 as healthy');
    return res?.rows?.[0]?.healthy === 1 || res?.rows?.[0]?.healthy === '1';
  } catch {
    return false;
  }
}

/**
 * Gracefully closes the PostgreSQL connection pool.
 */
export async function closePostgres(): Promise<void> {
  if (postgresPoolInstance) {
    try {
      await postgresPoolInstance.end();
    } catch (err) {
      logger.warn('Error closing PostgreSQL pool:', err);
    } finally {
      postgresPoolInstance = null;
    }
  }
}

/**
 * Sets a custom pool instance (used for testing and in-memory mock adapters).
 */
export function setPostgresPoolInstance(pool: pg.Pool | null): void {
  postgresPoolInstance = pool;
}
