import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { Activity, CreateActivityInput } from '../models/domain.types.js';
import { ConflictError, DatabaseError } from '../errors/AppError.js';

export interface ActivityRepository {
  create(input: CreateActivityInput): Activity;
  createMany(inputs: CreateActivityInput[]): Activity[];
  getById(id: string): Activity | null;
  getByIdAndProjectId(id: string, projectId: string): Activity | null;
  listByScheduleId(scheduleId: string): Activity[];
  listByProjectId(projectId: string): Activity[];
  countByScheduleId(scheduleId: string): number;
  countByProjectId(projectId: string): number;
}

interface ActivityDbRow {
  id: string;
  project_id: string;
  schedule_id: string;
  external_id: string;
  name: string;
  description: string | null;
  wbs_code: string | null;
  location: string | null;
  planned_start: string;
  planned_finish: string;
  planned_quantity: number | null;
  unit: string | null;
  baseline_progress: number;
  created_at: string;
  updated_at: string;
}

function mapRowToActivity(row: ActivityDbRow): Activity {
  return {
    id: row.id,
    projectId: row.project_id,
    scheduleId: row.schedule_id,
    externalId: row.external_id,
    name: row.name,
    description: row.description,
    wbsCode: row.wbs_code,
    location: row.location,
    plannedStart: row.planned_start,
    plannedFinish: row.planned_finish,
    plannedQuantity: row.planned_quantity,
    unit: row.unit,
    baselineProgress: row.baseline_progress,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteActivityRepository implements ActivityRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateActivityInput): Activity {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const baselineProgress = input.baselineProgress ?? 0.0;

    const stmt = db.prepare(`
      INSERT INTO activities (
        id, project_id, schedule_id, external_id, name, description,
        wbs_code, location, planned_start, planned_finish, planned_quantity,
        unit, baseline_progress
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.scheduleId,
        input.externalId,
        input.name,
        input.description ?? null,
        input.wbsCode ?? null,
        input.location ?? null,
        input.plannedStart,
        input.plannedFinish,
        input.plannedQuantity ?? null,
        input.unit ?? null,
        baselineProgress
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(
          `Activity with external ID '${input.externalId}' already exists in this schedule`
        );
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Activity with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create activity: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created activity');
    }
    return created;
  }

  createMany(inputs: CreateActivityInput[]): Activity[] {
    if (inputs.length === 0) {
      return [];
    }

    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO activities (
        id, project_id, schedule_id, external_id, name, description,
        wbs_code, location, planned_start, planned_finish, planned_quantity,
        unit, baseline_progress
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertedIds: string[] = [];

    for (const input of inputs) {
      const id = input.id || crypto.randomUUID();
      const baselineProgress = input.baselineProgress ?? 0.0;

      try {
        stmt.run(
          id,
          input.projectId,
          input.scheduleId,
          input.externalId,
          input.name,
          input.description ?? null,
          input.wbsCode ?? null,
          input.location ?? null,
          input.plannedStart,
          input.plannedFinish,
          input.plannedQuantity ?? null,
          input.unit ?? null,
          baselineProgress
        );
        insertedIds.push(id);
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(
            `Activity with external ID '${input.externalId}' already exists in this schedule`
          );
        }
        throw new DatabaseError(`Failed to insert activity batch: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Retrieve inserted rows
    const placeholders = insertedIds.map(() => '?').join(',');
    const selectStmt = db.prepare(`SELECT * FROM activities WHERE id IN (${placeholders}) ORDER BY planned_start ASC, external_id ASC`);
    const rows = selectStmt.all(...insertedIds) as ActivityDbRow[];
    return rows.map(mapRowToActivity);
  }

  getById(id: string): Activity | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activities WHERE id = ?');
      const row = stmt.get(id) as ActivityDbRow | undefined;
      return row ? mapRowToActivity(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByIdAndProjectId(id: string, projectId: string): Activity | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activities WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as ActivityDbRow | undefined;
      return row ? mapRowToActivity(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity by ID and Project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByScheduleId(scheduleId: string): Activity[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activities WHERE schedule_id = ? ORDER BY planned_start ASC, external_id ASC');
      const rows = stmt.all(scheduleId) as ActivityDbRow[];
      return rows.map(mapRowToActivity);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activities by schedule ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProjectId(projectId: string): Activity[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY planned_start ASC, external_id ASC');
      const rows = stmt.all(projectId) as ActivityDbRow[];
      return rows.map(mapRowToActivity);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activities by project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  countByScheduleId(scheduleId: string): number {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM activities WHERE schedule_id = ?').get(scheduleId) as { count: number };
      return row.count;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count activities by schedule ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  countByProjectId(projectId: string): number {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM activities WHERE project_id = ?').get(projectId) as { count: number };
      return row.count;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count activities by project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const sqliteActivityRepository: ActivityRepository = new SqliteActivityRepository();

import { PostgresActivityRepository } from './postgres/postgres-activity.repository.js';
import { env } from '../config/env.js';

let _postgresActivityRepoInstance: PostgresActivityRepository | null = null;
export function getPostgresActivityRepository(): PostgresActivityRepository {
  if (!_postgresActivityRepoInstance) {
    _postgresActivityRepoInstance = new PostgresActivityRepository();
  }
  return _postgresActivityRepoInstance;
}

export const activityRepository: ActivityRepository = new Proxy(Object.create(sqliteActivityRepository) as ActivityRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresActivityRepository() : sqliteActivityRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
