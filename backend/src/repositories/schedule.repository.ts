import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { Schedule, Activity, CreateScheduleInput, CreateActivityInput } from '../models/domain.types.js';
import { ConflictError, DatabaseError } from '../errors/AppError.js';

export interface ScheduleImportDataResult {
  schedule: Schedule;
  activities: Activity[];
}

export interface ScheduleRepository {
  create(input: CreateScheduleInput): Schedule;
  createWithActivities(
    scheduleInput: CreateScheduleInput,
    activityInputs: Omit<CreateActivityInput, 'scheduleId'>[]
  ): ScheduleImportDataResult;
  getById(id: string): Schedule | null;
  getByIdAndProjectId(id: string, projectId: string): Schedule | null;
  listByProjectId(projectId: string): Schedule[];
  countByProjectId(projectId: string): number;
  delete(id: string): boolean;
}

interface ScheduleDbRow {
  id: string;
  project_id: string;
  name: string;
  version: string;
  source_type: string;
  source_filename: string | null;
  is_baseline: number;
  imported_at: string;
  created_at: string;
  updated_at: string;
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

function mapRowToSchedule(row: ScheduleDbRow): Schedule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    version: row.version,
    sourceType: row.source_type as Schedule['sourceType'],
    sourceFilename: row.source_filename,
    isBaseline: row.is_baseline === 1,
    importedAt: row.imported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

export class SqliteScheduleRepository implements ScheduleRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateScheduleInput): Schedule {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const version = input.version || '1.0';
    const isBaseline = input.isBaseline !== undefined ? (input.isBaseline ? 1 : 0) : 1;

    const stmt = db.prepare(`
      INSERT INTO schedules (
        id, project_id, name, version, source_type, source_filename, is_baseline
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.name,
        version,
        input.sourceType,
        input.sourceFilename ?? null,
        isBaseline
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Schedule with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        throw new DatabaseError(`Failed to create schedule: project '${input.projectId}' does not exist`);
      }
      throw new DatabaseError(`Failed to create schedule: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created schedule');
    }
    return created;
  }

  createWithActivities(
    scheduleInput: CreateScheduleInput,
    activityInputs: Omit<CreateActivityInput, 'scheduleId'>[]
  ): ScheduleImportDataResult {
    const db = this.getDb();

    const transactionFn = db.transaction(() => {
      const schedule = this.create(scheduleInput);

      const insertActivityStmt = db.prepare(`
        INSERT INTO activities (
          id, project_id, schedule_id, external_id, name, description,
          wbs_code, location, planned_start, planned_finish, planned_quantity,
          unit, baseline_progress
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      const insertedIds: string[] = [];

      for (const act of activityInputs) {
        const actId = act.id || crypto.randomUUID();
        const baselineProgress = act.baselineProgress ?? 0.0;

        try {
          insertActivityStmt.run(
            actId,
            act.projectId,
            schedule.id,
            act.externalId,
            act.name,
            act.description ?? null,
            act.wbsCode ?? null,
            act.location ?? null,
            act.plannedStart,
            act.plannedFinish,
            act.plannedQuantity ?? null,
            act.unit ?? null,
            baselineProgress
          );
          insertedIds.push(actId);
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new ConflictError(
              `Activity with external ID '${act.externalId}' already exists in this schedule`
            );
          }
          throw new DatabaseError(
            `Failed to insert activity '${act.externalId}': ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Record project event for audit
      try {
        const eventId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
          )
        `).run(
          eventId,
          schedule.projectId,
          'schedule_imported',
          'schedules',
          schedule.id,
          `Imported schedule '${schedule.name}' with ${activityInputs.length} activities`,
          JSON.stringify({
            scheduleId: schedule.id,
            activityCount: activityInputs.length,
            sourceType: schedule.sourceType,
            sourceFilename: schedule.sourceFilename
          })
        );
      } catch {
        // Event recording failure should not break transaction
      }

      const selectStmt = db.prepare('SELECT * FROM activities WHERE schedule_id = ? ORDER BY planned_start ASC, external_id ASC');
      const activityRows = selectStmt.all(schedule.id) as ActivityDbRow[];
      const activities = activityRows.map(mapRowToActivity);

      return {
        schedule,
        activities
      };
    });

    return transactionFn();
  }

  getById(id: string): Schedule | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM schedules WHERE id = ?');
      const row = stmt.get(id) as ScheduleDbRow | undefined;
      return row ? mapRowToSchedule(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch schedule by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByIdAndProjectId(id: string, projectId: string): Schedule | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM schedules WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as ScheduleDbRow | undefined;
      return row ? mapRowToSchedule(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch schedule by project and ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProjectId(projectId: string): Schedule[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM schedules WHERE project_id = ? ORDER BY created_at DESC');
      const rows = stmt.all(projectId) as ScheduleDbRow[];
      return rows.map(mapRowToSchedule);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list schedules for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  countByProjectId(projectId: string): number {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM schedules WHERE project_id = ?').get(projectId) as { count: number };
      return row.count;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count schedules: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  delete(id: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM schedules WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete schedule: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const sqliteScheduleRepository: ScheduleRepository = new SqliteScheduleRepository();

import { PostgresScheduleRepository } from './postgres/postgres-schedule.repository.js';
import { env } from '../config/env.js';

let _postgresScheduleRepoInstance: PostgresScheduleRepository | null = null;
export function getPostgresScheduleRepository(): PostgresScheduleRepository {
  if (!_postgresScheduleRepoInstance) {
    _postgresScheduleRepoInstance = new PostgresScheduleRepository();
  }
  return _postgresScheduleRepoInstance;
}

export const scheduleRepository: ScheduleRepository = new Proxy(Object.create(sqliteScheduleRepository) as ScheduleRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresScheduleRepository() : sqliteScheduleRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
