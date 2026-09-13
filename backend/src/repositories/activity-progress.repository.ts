import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  ActivityProgress,
  CreateActivityProgressInput,
  CreateProjectEventInput
} from '../models/domain.types.js';
import { ConflictError, DatabaseError } from '../errors/AppError.js';

export interface ActivityProgressRepository {
  create(input: CreateActivityProgressInput): ActivityProgress;
  createWithEvent(
    progressInput: CreateActivityProgressInput,
    eventInput: CreateProjectEventInput
  ): ActivityProgress;
  getById(id: string): ActivityProgress | null;
  getByIdAndProjectId(id: string, projectId: string): ActivityProgress | null;
  listByActivityId(activityId: string, projectId?: string): ActivityProgress[];
  listByProgressUpdateId(progressUpdateId: string, projectId?: string): ActivityProgress[];
  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): ActivityProgress[];
  listByProjectId(projectId: string): ActivityProgress[];
  getLatestByActivityId(activityId: string, projectId?: string): ActivityProgress | null;
  getLatestByActivityIdAsOfDate(
    activityId: string,
    projectId: string,
    asOfDate: string
  ): ActivityProgress | null;
  findExistingObservation(
    projectId: string,
    activityId: string,
    progressUpdateId: string | null,
    asOfDate: string,
    actualPercent: number,
    actualQuantity: number | null,
    status: string
  ): ActivityProgress | null;
  delete(id: string, projectId?: string): boolean;
}

interface ActivityProgressDbRow {
  id: string;
  project_id: string;
  activity_id: string;
  progress_update_id: string | null;
  actual_percent: number;
  actual_quantity: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  status: string;
  as_of_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToActivityProgress(row: ActivityProgressDbRow): ActivityProgress {
  return {
    id: row.id,
    projectId: row.project_id,
    activityId: row.activity_id,
    progressUpdateId: row.progress_update_id,
    actualPercent: row.actual_percent,
    actualQuantity: row.actual_quantity,
    actualStart: row.actual_start,
    actualFinish: row.actual_finish,
    status: row.status as ActivityProgress['status'],
    asOfDate: row.as_of_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteActivityProgressRepository implements ActivityProgressRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateActivityProgressInput): ActivityProgress {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'in_progress';

    const stmt = db.prepare(`
      INSERT INTO activity_progress (
        id, project_id, activity_id, progress_update_id,
        actual_percent, actual_quantity, actual_start, actual_finish,
        status, as_of_date, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.activityId,
        input.progressUpdateId ?? null,
        input.actualPercent,
        input.actualQuantity ?? null,
        input.actualStart ?? null,
        input.actualFinish ?? null,
        status,
        input.asOfDate,
        input.notes ?? null
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(`Activity progress with ID '${id}' already exists`);
        }
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to create activity progress due to constraint violation: ${err.message}`
          );
        }
      }
      throw new DatabaseError(
        `Failed to create activity progress: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created activity progress');
    }
    return created;
  }

  createWithEvent(
    progressInput: CreateActivityProgressInput,
    eventInput: CreateProjectEventInput
  ): ActivityProgress {
    const db = this.getDb();
    const progressId = progressInput.id || crypto.randomUUID();
    const status = progressInput.status || 'in_progress';
    const eventId = eventInput.id || crypto.randomUUID();

    const insertProgressStmt = db.prepare(`
      INSERT INTO activity_progress (
        id, project_id, activity_id, progress_update_id,
        actual_percent, actual_quantity, actual_start, actual_finish,
        status, as_of_date, notes
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTransaction = db.transaction(() => {
      insertProgressStmt.run(
        progressId,
        progressInput.projectId,
        progressInput.activityId,
        progressInput.progressUpdateId ?? null,
        progressInput.actualPercent,
        progressInput.actualQuantity ?? null,
        progressInput.actualStart ?? null,
        progressInput.actualFinish ?? null,
        status,
        progressInput.asOfDate,
        progressInput.notes ?? null
      );

      insertEventStmt.run(
        eventId,
        eventInput.projectId,
        eventInput.eventType,
        eventInput.entityType ?? 'activity_progress',
        eventInput.entityId ?? progressId,
        eventInput.summary,
        eventInput.payloadJson ?? null
      );
    });

    try {
      runTransaction();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(`Activity progress or event conflict: ${err.message}`);
        }
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to persist activity progress and event due to constraint violation: ${err.message}`
          );
        }
      }
      throw new DatabaseError(
        `Failed to persist activity progress and event atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const created = this.getById(progressId);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created activity progress');
    }
    return created;
  }

  getById(id: string): ActivityProgress | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activity_progress WHERE id = ?');
      const row = stmt.get(id) as ActivityProgressDbRow | undefined;
      return row ? mapRowToActivityProgress(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to fetch activity progress by ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  getByIdAndProjectId(id: string, projectId: string): ActivityProgress | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activity_progress WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as ActivityProgressDbRow | undefined;
      return row ? mapRowToActivityProgress(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to fetch activity progress for project: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByActivityId(activityId: string, projectId?: string): ActivityProgress[] {
    try {
      const db = this.getDb();
      let stmt;
      let rows: ActivityProgressDbRow[];

      if (projectId) {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE activity_id = ? AND project_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC
        `);
        rows = stmt.all(activityId, projectId) as ActivityProgressDbRow[];
      } else {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE activity_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC
        `);
        rows = stmt.all(activityId) as ActivityProgressDbRow[];
      }

      return rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity progress by activity ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProgressUpdateId(progressUpdateId: string, projectId?: string): ActivityProgress[] {
    try {
      const db = this.getDb();
      let stmt;
      let rows: ActivityProgressDbRow[];

      if (projectId) {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE progress_update_id = ? AND project_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC
        `);
        rows = stmt.all(progressUpdateId, projectId) as ActivityProgressDbRow[];
      } else {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE progress_update_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC
        `);
        rows = stmt.all(progressUpdateId) as ActivityProgressDbRow[];
      }

      return rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity progress by progress update ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): ActivityProgress[] {
    if (progressUpdateIds.length === 0) {
      return [];
    }

    try {
      const db = this.getDb();
      const placeholders = progressUpdateIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM activity_progress 
        WHERE project_id = ? AND progress_update_id IN (${placeholders}) 
        ORDER BY progress_update_id ASC, as_of_date DESC, created_at DESC, id DESC
      `);
      const rows = stmt.all(projectId, ...progressUpdateIds) as ActivityProgressDbRow[];
      return rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity progress for progress update batch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProjectId(projectId: string): ActivityProgress[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM activity_progress 
        WHERE project_id = ? 
        ORDER BY as_of_date DESC, created_at DESC, id DESC
      `);
      const rows = stmt.all(projectId) as ActivityProgressDbRow[];
      return rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity progress for project: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  getLatestByActivityId(activityId: string, projectId?: string): ActivityProgress | null {
    try {
      const db = this.getDb();
      let stmt;
      let row: ActivityProgressDbRow | undefined;

      if (projectId) {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE activity_id = ? AND project_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC 
          LIMIT 1
        `);
        row = stmt.get(activityId, projectId) as ActivityProgressDbRow | undefined;
      } else {
        stmt = db.prepare(`
          SELECT * FROM activity_progress 
          WHERE activity_id = ? 
          ORDER BY as_of_date DESC, created_at DESC, id DESC 
          LIMIT 1
        `);
        row = stmt.get(activityId) as ActivityProgressDbRow | undefined;
      }

      return row ? mapRowToActivityProgress(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to fetch latest activity progress: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  getLatestByActivityIdAsOfDate(
    activityId: string,
    projectId: string,
    asOfDate: string
  ): ActivityProgress | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM activity_progress 
        WHERE activity_id = ? AND project_id = ? AND as_of_date <= ?
        ORDER BY as_of_date DESC, created_at DESC, id DESC 
        LIMIT 1
      `);
      const row = stmt.get(activityId, projectId, asOfDate) as ActivityProgressDbRow | undefined;
      return row ? mapRowToActivityProgress(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to fetch latest activity progress as of date: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  findExistingObservation(
    projectId: string,
    activityId: string,
    progressUpdateId: string | null,
    asOfDate: string,
    actualPercent: number,
    actualQuantity: number | null,
    status: string
  ): ActivityProgress | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM activity_progress 
        WHERE project_id = ? 
          AND activity_id = ? 
          AND (progress_update_id = ? OR (progress_update_id IS NULL AND ? IS NULL))
          AND as_of_date = ?
          AND actual_percent = ?
          AND (actual_quantity = ? OR (actual_quantity IS NULL AND ? IS NULL))
          AND status = ?
        ORDER BY created_at DESC
        LIMIT 1
      `);

      const row = stmt.get(
        projectId,
        activityId,
        progressUpdateId,
        progressUpdateId,
        asOfDate,
        actualPercent,
        actualQuantity,
        actualQuantity,
        status
      ) as ActivityProgressDbRow | undefined;

      return row ? mapRowToActivityProgress(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to check existing activity progress observation: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  delete(id: string, projectId?: string): boolean {
    try {
      const db = this.getDb();
      let result;
      if (projectId) {
        const stmt = db.prepare('DELETE FROM activity_progress WHERE id = ? AND project_id = ?');
        result = stmt.run(id, projectId);
      } else {
        const stmt = db.prepare('DELETE FROM activity_progress WHERE id = ?');
        result = stmt.run(id);
      }
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to delete activity progress: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export const sqliteActivityProgressRepository: ActivityProgressRepository =
  new SqliteActivityProgressRepository();

import { PostgresActivityProgressRepository } from './postgres/postgres-activity-progress.repository.js';
import { env } from '../config/env.js';

let _postgresActivityProgressRepoInstance: PostgresActivityProgressRepository | null = null;
export function getPostgresActivityProgressRepository(): PostgresActivityProgressRepository {
  if (!_postgresActivityProgressRepoInstance) {
    _postgresActivityProgressRepoInstance = new PostgresActivityProgressRepository();
  }
  return _postgresActivityProgressRepoInstance;
}

export const activityProgressRepository: ActivityProgressRepository = new Proxy(Object.create(sqliteActivityProgressRepository) as ActivityProgressRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresActivityProgressRepository() : sqliteActivityProgressRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
