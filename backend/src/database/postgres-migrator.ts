import type { Pool, PoolClient } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../config/logger.js';

export interface PostgresMigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function initPostgresMigrationTable(client: PoolClient | Pool): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export async function getAppliedPostgresMigrations(client: PoolClient | Pool): Promise<string[]> {
  await initPostgresMigrationTable(client);
  const result = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC');
  return result.rows.map((r: { name: string }) => r.name);
}

let activeMigrationPromise: Promise<PostgresMigrationResult> | null = null;

/**
 * Runs PostgreSQL schema migrations from supabase/migrations/*.sql.
 * Used primarily for local/offline PostgreSQL development when DATABASE_AUTO_MIGRATE=true.
 * 
 * Concurrency Safety:
 * - Employs in-process in-flight promise deduplication to prevent concurrent callers from executing simultaneously.
 * - Re-checks schema_migrations inside each migration's transaction before applying.
 * - Note: This runner does not use PostgreSQL advisory locks; production Supabase relies on GitHub Deployment
 *   as the sole authoritative migration engine.
 */
export async function runPostgresMigrations(targetPool?: Pool): Promise<PostgresMigrationResult> {
  if (activeMigrationPromise) {
    return activeMigrationPromise;
  }

  activeMigrationPromise = (async () => {
    try {
      const pool = targetPool || (await import('./postgres.js')).getPostgresPool();
      await initPostgresMigrationTable(pool);
      const appliedList = await getAppliedPostgresMigrations(pool);
      const appliedSet = new Set(appliedList);
      const newlyApplied: string[] = [];
      const alreadyApplied: string[] = [];

      const migrationsDir = path.resolve(process.cwd(), 'supabase', 'migrations');
      if (!fs.existsSync(migrationsDir)) {
        return { applied: [], alreadyApplied: appliedList };
      }

      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const migrationName = path.basename(file, '.sql');
        if (appliedSet.has(migrationName)) {
          alreadyApplied.push(migrationName);
          continue;
        }

        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Re-check inside transaction for concurrent runners
          const checkRes = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migrationName]);
          if (checkRes.rows.length > 0) {
            await client.query('COMMIT');
            appliedSet.add(migrationName);
            alreadyApplied.push(migrationName);
            continue;
          }

          // In-memory pg-mem mock compatibility for test runners:
          // pg-mem's parser does not support PostgreSQL's "USING" clause in ALTER COLUMN TYPE
          const isMemPg = (client as any).constructor?.name === 'MemPg';
          const sqlToExecute = isMemPg
            ? sql.replace(/USING\s+NULLIF\(trim\([^)]+\),\s*''\)::TIMESTAMPTZ/gi, '')
                 .replace(/USING\s+[^,;]+/gi, '')
            : sql;

          await client.query(sqlToExecute);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migrationName]);
          await client.query('COMMIT');
          appliedSet.add(migrationName);
          newlyApplied.push(migrationName);
          logger.info(`PostgreSQL migration applied successfully: ${migrationName}`);
        } catch (err) {
          await client.query('ROLLBACK');
          logger.error(`PostgreSQL migration failed for ${migrationName}:`, err);
          throw err;
        } finally {
          client.release();
        }
      }

      return {
        applied: newlyApplied,
        alreadyApplied
      };
    } finally {
      activeMigrationPromise = null;
    }
  })();

  return activeMigrationPromise;
}

