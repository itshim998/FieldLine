import type { Pool } from 'pg';
import { getPostgresPool } from '../../database/postgres.js';
import type { SystemRepository } from '../system.repository.js';

export class PostgresSystemRepository implements SystemRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT 1 as healthy');
      return res?.rows?.[0]?.healthy === 1 || res?.rows?.[0]?.healthy === '1';
    } catch {
      return false;
    }
  }

  async getAllMetadata(): Promise<Record<string, string>> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT key, value FROM system_metadata');
      return res.rows.reduce((acc: Record<string, string>, row: { key: string; value: string }) => {
        acc[row.key] = row.value;
        return acc;
      }, {});
    } catch {
      return {};
    }
  }

  async getMetadata(key: string): Promise<string | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT value FROM system_metadata WHERE key = $1', [key]);
      return res.rows.length > 0 ? res.rows[0].value : null;
    } catch {
      return null;
    }
  }

  async setMetadata(key: string, value: string): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `
      INSERT INTO system_metadata (key, value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `,
      [key, value]
    );
  }
}

export const postgresSystemRepository = new PostgresSystemRepository();
