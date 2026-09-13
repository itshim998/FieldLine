import { Database as DatabaseType } from 'better-sqlite3';
import { getDatabase } from '../database/db.js';

export interface SystemRepository {
  isHealthy(): boolean;
  getAllMetadata(): Record<string, string>;
  getMetadata(key: string): string | null;
  setMetadata(key: string, value: string): void;
}

export class SqliteSystemRepository implements SystemRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  isHealthy(): boolean {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT 1 as healthy').get() as { healthy: number } | undefined;
      return row?.healthy === 1;
    } catch {
      return false;
    }
  }

  getAllMetadata(): Record<string, string> {
    try {
      const db = this.getDb();
      const rows = db.prepare('SELECT key, value FROM system_metadata').all() as Array<{ key: string; value: string }>;
      return rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
      }, {} as Record<string, string>);
    } catch {
      return {};
    }
  }

  getMetadata(key: string): string | null {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT value FROM system_metadata WHERE key = ?').get(key) as { value: string } | undefined;
      return row ? row.value : null;
    } catch {
      return null;
    }
  }

  setMetadata(key: string, value: string): void {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO system_metadata (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, value);
  }
}

export const sqliteSystemRepository: SystemRepository = new SqliteSystemRepository();

import { PostgresSystemRepository } from './postgres/postgres-system.repository.js';
import { env } from '../config/env.js';

let _postgresSystemRepoInstance: PostgresSystemRepository | null = null;
export function getPostgresSystemRepository(): PostgresSystemRepository {
  if (!_postgresSystemRepoInstance) {
    _postgresSystemRepoInstance = new PostgresSystemRepository();
  }
  return _postgresSystemRepoInstance;
}

export const systemRepository: SystemRepository = new Proxy(Object.create(sqliteSystemRepository) as SystemRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresSystemRepository() : sqliteSystemRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
