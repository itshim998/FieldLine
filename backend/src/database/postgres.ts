import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runPostgresMigrations, PostgresMigrationResult } from './postgres-migrator.js';

const { Pool } = pg;

let postgresPoolInstance: pg.Pool | null = null;

export interface PostgresInitOptions {
  connectionString?: string;
  ssl?: boolean;
  sslRejectUnauthorized?: boolean;
  sslCa?: string;
  pool?: pg.Pool;
  autoMigrate?: boolean;
  skipMigrations?: boolean;
  maxConnections?: number;
}

export const CRITICAL_POSTGRES_TABLES = [
  'projects',
  'schedules',
  'activities',
  'progress_updates',
  'evidence',
  'activity_matches',
  'activity_progress',
  'project_events',
  'processing_jobs',
  'project_accounts',
  'operational_blockers',
  'notification_outbox',
  'system_metadata'
] as const;

export type CriticalPostgresTable = (typeof CRITICAL_POSTGRES_TABLES)[number];

export interface PostgresSchemaReadiness {
  ready: boolean;
  existingTables: string[];
  missingTables: string[];
}

/**
 * Initializes the shared PostgreSQL connection pool.
 * Does NOT run migrations unless autoMigrate is explicitly enabled (DATABASE_AUTO_MIGRATE=true).
 * Supabase GitHub Integration is the authoritative schema-migration deployment authority in production.
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

    const isSsl = options.ssl ?? env.DATABASE_SSL;
    const rejectUnauthorized = options.sslRejectUnauthorized ?? env.DATABASE_SSL_REJECT_UNAUTHORIZED;
    let sslConfig: pg.ConnectionConfig['ssl'] = undefined;
    if (isSsl) {
      sslConfig = {
        rejectUnauthorized,
        ca: options.sslCa ?? env.DATABASE_SSL_CA ?? undefined
      };
    }

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

  const shouldAutoMigrate =
    options.autoMigrate ??
    (options.skipMigrations !== undefined ? !options.skipMigrations : env.DATABASE_AUTO_MIGRATE);

  if (shouldAutoMigrate) {
    try {
      logger.info('DATABASE_AUTO_MIGRATE is enabled. Running PostgreSQL schema migrations...');
      await runPostgresMigrations(postgresPoolInstance);
    } catch (migErr) {
      logger.error('Failed to apply PostgreSQL migrations during initialization:', migErr);
      throw migErr;
    }
  }

  return postgresPoolInstance;
}

/**
 * Checks PostgreSQL schema readiness by verifying that all required domain and operational
 * tables exist in the public/current database schema.
 */
export async function checkPostgresSchemaReadiness(
  pool?: pg.Pool,
  requiredTables: readonly string[] = CRITICAL_POSTGRES_TABLES
): Promise<PostgresSchemaReadiness> {
  const p = pool || getPostgresPool();
  const query = `
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() OR table_schema = 'public';
  `;
  const res = await p.query(query);
  const existingSet = new Set(
    (res.rows || []).map((r: { table_name: string }) => r.table_name.toLowerCase())
  );
  const missingTables = requiredTables.filter((t) => !existingSet.has(t.toLowerCase()));

  return {
    ready: missingTables.length === 0,
    existingTables: Array.from(existingSet),
    missingTables
  };
}

/**
 * Asserts that the PostgreSQL database schema has all critical tables applied.
 * Throws a safe diagnostic error without credentials or SQL secrets if any table is missing.
 */
export async function assertPostgresSchemaReady(
  pool?: pg.Pool,
  requiredTables: readonly string[] = CRITICAL_POSTGRES_TABLES
): Promise<void> {
  const check = await checkPostgresSchemaReadiness(pool, requiredTables);
  if (!check.ready) {
    throw new Error(
      `FieldLine database schema is not ready. Missing table(s): ${check.missingTables.join(', ')}. Apply pending Supabase migrations before starting the backend.`
    );
  }
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
