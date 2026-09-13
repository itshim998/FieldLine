import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  OperationalBlocker,
  CreateBlockerInput,
  BlockerCategory,
  BlockerStatus
} from '../models/domain.types.js';
import { DatabaseError, NotFoundError } from '../errors/AppError.js';

import { MaybePromise } from '../database/provider.js';

export interface OperationalBlockerRepository {
  create(input: CreateBlockerInput): MaybePromise<OperationalBlocker>;
  findById(id: string): MaybePromise<OperationalBlocker | null>;
  listByProjectId(
    projectId: string,
    options?: { status?: BlockerStatus; activityId?: string }
  ): MaybePromise<OperationalBlocker[]>;
  listActiveByProject(projectId: string): MaybePromise<OperationalBlocker[]>;
  listByActivity(projectId: string, activityId: string): MaybePromise<OperationalBlocker[]>;
  resolve(id: string, projectId: string, resolvedAt?: string): MaybePromise<OperationalBlocker | null>;
  countByRootCause(projectId: string): MaybePromise<Record<BlockerCategory, number>>;
  delete(id: string, projectId: string): MaybePromise<boolean>;
}

interface BlockerDbRow {
  id: string;
  project_id: string;
  activity_id: string | null;
  category: string;
  description: string;
  status: string;
  reporter_name: string;
  reporter_role: string | null;
  created_at: string;
  resolved_at: string | null;
}

function mapRowToBlocker(row: BlockerDbRow): OperationalBlocker {
  return {
    id: row.id,
    projectId: row.project_id,
    activityId: row.activity_id,
    category: row.category as BlockerCategory,
    description: row.description,
    status: row.status as BlockerStatus,
    reporterName: row.reporter_name,
    reporterRole: row.reporter_role,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

const ALL_BLOCKER_CATEGORIES: BlockerCategory[] = [
  'equipment',
  'material',
  'access',
  'inspection',
  'weather',
  'safety',
  'coordination'
];

export class SqliteOperationalBlockerRepository implements OperationalBlockerRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateBlockerInput): OperationalBlocker {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'active';

    const stmt = db.prepare(`
      INSERT INTO operational_blockers (
        id, project_id, activity_id, category, description, status,
        reporter_name, reporter_role
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.activityId || null,
        input.category,
        input.description,
        status,
        input.reporterName,
        input.reporterRole || null
      );
    } catch (err: any) {
      throw new DatabaseError(`Failed to create operational blocker: ${err.message}`, err);
    }

    const created = this.findById(id);
    if (!created) {
      throw new DatabaseError(`Operational blocker '${id}' was not found after insertion`);
    }
    return created;
  }

  findById(id: string): OperationalBlocker | null {
    const db = this.getDb();
    const stmt = db.prepare('SELECT * FROM operational_blockers WHERE id = ?');
    const row = stmt.get(id) as BlockerDbRow | undefined;
    return row ? mapRowToBlocker(row) : null;
  }

  listByProjectId(
    projectId: string,
    options?: { status?: BlockerStatus; activityId?: string }
  ): OperationalBlocker[] {
    const db = this.getDb();
    let query = 'SELECT * FROM operational_blockers WHERE project_id = ?';
    const params: unknown[] = [projectId];

    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    if (options?.activityId) {
      query += ' AND activity_id = ?';
      params.push(options.activityId);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as BlockerDbRow[];
    return rows.map(mapRowToBlocker);
  }

  listActiveByProject(projectId: string): OperationalBlocker[] {
    return this.listByProjectId(projectId, { status: 'active' });
  }

  listByActivity(projectId: string, activityId: string): OperationalBlocker[] {
    return this.listByProjectId(projectId, { activityId });
  }

  resolve(id: string, projectId: string, resolvedAt?: string): OperationalBlocker | null {
    const db = this.getDb();
    const resolvedTimestamp = resolvedAt || new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE operational_blockers
      SET status = 'resolved', resolved_at = ?
      WHERE id = ? AND project_id = ?
    `);

    const result = stmt.run(resolvedTimestamp, id, projectId);
    if (result.changes === 0) {
      return null;
    }

    return this.findById(id);
  }

  countByRootCause(projectId: string): Record<BlockerCategory, number> {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM operational_blockers
      WHERE project_id = ? AND status = 'active'
      GROUP BY category
    `);

    const rows = stmt.all(projectId) as Array<{ category: string; count: number }>;
    const counts: Record<BlockerCategory, number> = {
      equipment: 0,
      material: 0,
      access: 0,
      inspection: 0,
      weather: 0,
      safety: 0,
      coordination: 0
    };

    for (const row of rows) {
      if (row.category in counts) {
        counts[row.category as BlockerCategory] = Number(row.count);
      }
    }

    return counts;
  }

  delete(id: string, projectId: string): boolean {
    const db = this.getDb();
    const stmt = db.prepare('DELETE FROM operational_blockers WHERE id = ? AND project_id = ?');
    const result = stmt.run(id, projectId);
    return result.changes > 0;
  }
}

export const sqliteOperationalBlockerRepository: OperationalBlockerRepository =
  new SqliteOperationalBlockerRepository();

import { PostgresOperationalBlockerRepository } from './postgres/postgres-operational-blocker.repository.js';
import { env } from '../config/env.js';

let _postgresOperationalBlockerRepoInstance: PostgresOperationalBlockerRepository | null = null;
export function getPostgresOperationalBlockerRepository(): PostgresOperationalBlockerRepository {
  if (!_postgresOperationalBlockerRepoInstance) {
    _postgresOperationalBlockerRepoInstance = new PostgresOperationalBlockerRepository();
  }
  return _postgresOperationalBlockerRepoInstance;
}

export const operationalBlockerRepository: OperationalBlockerRepository = new Proxy(Object.create(sqliteOperationalBlockerRepository) as OperationalBlockerRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresOperationalBlockerRepository() : sqliteOperationalBlockerRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
