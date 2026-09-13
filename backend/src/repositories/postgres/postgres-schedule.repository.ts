import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import { Schedule, Activity, CreateScheduleInput, CreateActivityInput } from '../../models/domain.types.js';
import { ConflictError, DatabaseError } from '../../errors/AppError.js';
import type { ScheduleRepository, ScheduleImportDataResult } from '../schedule.repository.js';

interface ScheduleDbRow {
  id: string;
  project_id: string;
  name: string;
  version: string;
  source_type: string;
  source_filename: string | null;
  is_baseline: number;
  imported_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
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
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToSchedule(row: ScheduleDbRow): Schedule {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    version: row.version,
    sourceType: row.source_type as Schedule['sourceType'],
    sourceFilename: row.source_filename,
    isBaseline: Number(row.is_baseline) === 1,
    importedAt: typeof row.imported_at === 'string' ? row.imported_at : row.imported_at.toISOString(),
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
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
    plannedQuantity: row.planned_quantity !== null ? Number(row.planned_quantity) : null,
    unit: row.unit,
    baselineProgress: Number(row.baseline_progress),
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export class PostgresScheduleRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateScheduleInput, client?: PoolClient): Promise<Schedule> {
    const pool = client || this.getPool();
    const id = input.id || crypto.randomUUID();
    const version = input.version || '1.0';
    const isBaseline = input.isBaseline !== undefined ? (input.isBaseline ? 1 : 0) : 1;

    const sql = `
      INSERT INTO schedules (
        id, project_id, name, version, source_type, source_filename, is_baseline
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        id,
        input.projectId,
        input.name,
        version,
        input.sourceType,
        input.sourceFilename ?? null,
        isBaseline
      ]);
      return mapRowToSchedule(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Schedule with ID '${id}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
        throw new DatabaseError(`Failed to create schedule: project '${input.projectId}' does not exist`);
      }
      throw new DatabaseError(`Failed to create schedule: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createWithActivities(
    scheduleInput: CreateScheduleInput,
    activityInputs: Omit<CreateActivityInput, 'scheduleId'>[]
  ): Promise<ScheduleImportDataResult> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const schedule = await this.create(scheduleInput, client);

      const insertActivitySql = `
        INSERT INTO activities (
          id, project_id, schedule_id, external_id, name, description,
          wbs_code, location, planned_start, planned_finish, planned_quantity,
          unit, baseline_progress
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
      `;

      for (const act of activityInputs) {
        const actId = act.id || crypto.randomUUID();
        const baselineProgress = act.baselineProgress ?? 0.0;

        try {
          await client.query(insertActivitySql, [
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
          ]);
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
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
        await client.query(
          `
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          )
        `,
          [
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
          ]
        );
      } catch {
        // Non-fatal event record
      }

      const activityRows = await client.query(
        'SELECT * FROM activities WHERE schedule_id = $1 ORDER BY planned_start ASC, external_id ASC',
        [schedule.id]
      );
      const activities = activityRows.rows.map(mapRowToActivity);

      await client.query('COMMIT');
      return {
        schedule,
        activities
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Schedule | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM schedules WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToSchedule(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch schedule by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<Schedule | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM schedules WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToSchedule(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch schedule by project and ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<Schedule[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM schedules WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
      return res.rows.map(mapRowToSchedule);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list schedules for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByProjectId(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM schedules WHERE project_id = $1', [projectId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count schedules: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM schedules WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete schedule: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresScheduleRepository = new PostgresScheduleRepository();
