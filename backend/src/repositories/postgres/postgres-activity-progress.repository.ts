import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  ActivityProgress,
  CreateActivityProgressInput,
  CreateProjectEventInput
} from '../../models/domain.types.js';
import { ConflictError, DatabaseError } from '../../errors/AppError.js';
import type { ActivityProgressRepository } from '../activity-progress.repository.js';

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
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToActivityProgress(row: ActivityProgressDbRow): ActivityProgress {
  return {
    id: row.id,
    projectId: row.project_id,
    activityId: row.activity_id,
    progressUpdateId: row.progress_update_id,
    actualPercent: Number(row.actual_percent),
    actualQuantity: row.actual_quantity !== null ? Number(row.actual_quantity) : null,
    actualStart: row.actual_start,
    actualFinish: row.actual_finish,
    status: row.status as ActivityProgress['status'],
    asOfDate: row.as_of_date,
    notes: row.notes,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export class PostgresActivityProgressRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateActivityProgressInput): Promise<ActivityProgress> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'in_progress';

    const sql = `
      INSERT INTO activity_progress (
        id, project_id, activity_id, progress_update_id,
        actual_percent, actual_quantity, actual_start, actual_finish,
        status, as_of_date, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
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
      ]);
      return mapRowToActivityProgress(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Activity progress with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create activity progress: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createWithEvent(
    progressInput: CreateActivityProgressInput,
    eventInput: CreateProjectEventInput
  ): Promise<ActivityProgress> {
    const pool = this.getPool();
    const client = await pool.connect();
    const progressId = progressInput.id || crypto.randomUUID();
    const status = progressInput.status || 'in_progress';
    const eventId = eventInput.id || crypto.randomUUID();

    try {
      await client.query('BEGIN');

      const insertProgressSql = `
        INSERT INTO activity_progress (
          id, project_id, activity_id, progress_update_id,
          actual_percent, actual_quantity, actual_start, actual_finish,
          status, as_of_date, notes
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        ) RETURNING *
      `;

      const pRes = await client.query(insertProgressSql, [
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
      ]);

      const insertEventSql = `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
      `;

      await client.query(insertEventSql, [
        eventId,
        eventInput.projectId,
        eventInput.eventType,
        eventInput.entityType ?? 'activity_progress',
        eventInput.entityId ?? progressId,
        eventInput.summary,
        eventInput.payloadJson ?? null
      ]);

      await client.query('COMMIT');
      return mapRowToActivityProgress(pRes.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Activity progress or event conflict: ${err.message}`);
      }
      throw new DatabaseError(`Failed to persist activity progress and event atomically: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<ActivityProgress | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activity_progress WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToActivityProgress(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity progress by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<ActivityProgress | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activity_progress WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToActivityProgress(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity progress for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByActivityId(activityId: string, projectId?: string): Promise<ActivityProgress[]> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE activity_id = $1 AND project_id = $2 ORDER BY as_of_date DESC, created_at DESC, id DESC',
          [activityId, projectId]
        );
      } else {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE activity_id = $1 ORDER BY as_of_date DESC, created_at DESC, id DESC',
          [activityId]
        );
      }
      return res.rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity progress by activity ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProgressUpdateId(progressUpdateId: string, projectId?: string): Promise<ActivityProgress[]> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE progress_update_id = $1 AND project_id = $2 ORDER BY as_of_date DESC, created_at DESC, id DESC',
          [progressUpdateId, projectId]
        );
      } else {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE progress_update_id = $1 ORDER BY as_of_date DESC, created_at DESC, id DESC',
          [progressUpdateId]
        );
      }
      return res.rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity progress by update ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): Promise<ActivityProgress[]> {
    if (progressUpdateIds.length === 0) return [];
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_progress WHERE project_id = $1 AND progress_update_id = ANY($2) ORDER BY progress_update_id ASC, as_of_date DESC, created_at DESC, id DESC',
        [projectId, progressUpdateIds]
      );
      return res.rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity progress for update batch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<ActivityProgress[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_progress WHERE project_id = $1 ORDER BY as_of_date DESC, created_at DESC, id DESC',
        [projectId]
      );
      return res.rows.map(mapRowToActivityProgress);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity progress for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getLatestByActivityId(activityId: string, projectId?: string): Promise<ActivityProgress | null> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE activity_id = $1 AND project_id = $2 ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1',
          [activityId, projectId]
        );
      } else {
        res = await pool.query(
          'SELECT * FROM activity_progress WHERE activity_id = $1 ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1',
          [activityId]
        );
      }
      return res.rows.length > 0 ? mapRowToActivityProgress(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch latest activity progress: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getLatestByActivityIdAsOfDate(
    activityId: string,
    projectId: string,
    asOfDate: string
  ): Promise<ActivityProgress | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_progress WHERE activity_id = $1 AND project_id = $2 AND as_of_date <= $3 ORDER BY as_of_date DESC, created_at DESC, id DESC LIMIT 1',
        [activityId, projectId, asOfDate]
      );
      return res.rows.length > 0 ? mapRowToActivityProgress(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch latest activity progress as of date: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async findExistingObservation(
    projectId: string,
    activityId: string,
    progressUpdateId: string | null,
    asOfDate: string,
    actualPercent: number,
    actualQuantity: number | null,
    status: string
  ): Promise<ActivityProgress | null> {
    try {
      const pool = this.getPool();
      const sql = `
        SELECT * FROM activity_progress
        WHERE project_id = $1
          AND activity_id = $2
          AND (progress_update_id = $3 OR (progress_update_id IS NULL AND $3 IS NULL))
          AND as_of_date = $4
          AND actual_percent = $5
          AND (actual_quantity = $6 OR (actual_quantity IS NULL AND $6 IS NULL))
          AND status = $7
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const res = await pool.query(sql, [
        projectId,
        activityId,
        progressUpdateId,
        asOfDate,
        actualPercent,
        actualQuantity,
        status
      ]);
      return res.rows.length > 0 ? mapRowToActivityProgress(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to check existing observation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string, projectId?: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query('DELETE FROM activity_progress WHERE id = $1 AND project_id = $2', [id, projectId]);
      } else {
        res = await pool.query('DELETE FROM activity_progress WHERE id = $1', [id]);
      }
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete activity progress: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresActivityProgressRepository = new PostgresActivityProgressRepository();
