import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import { Activity, CreateActivityInput } from '../../models/domain.types.js';
import { ConflictError, DatabaseError } from '../../errors/AppError.js';
import type { ActivityRepository } from '../activity.repository.js';

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

export class PostgresActivityRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateActivityInput): Promise<Activity> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();
    const baselineProgress = input.baselineProgress ?? 0.0;

    const sql = `
      INSERT INTO activities (
        id, project_id, schedule_id, external_id, name, description,
        wbs_code, location, planned_start, planned_finish, planned_quantity,
        unit, baseline_progress
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
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
      ]);
      return mapRowToActivity(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        const detail = (err as { detail?: string }).detail || '';
        if (detail.includes('external_id') || String(err).includes('external_id')) {
          throw new ConflictError(
            `Activity with external ID '${input.externalId}' already exists in this schedule`
          );
        }
        throw new ConflictError(`Activity with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create activity: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createMany(inputs: CreateActivityInput[]): Promise<Activity[]> {
    if (inputs.length === 0) {
      return [];
    }

    const pool = this.getPool();
    const client = await pool.connect();
    const insertedActivities: Activity[] = [];

    try {
      await client.query('BEGIN');
      const sql = `
        INSERT INTO activities (
          id, project_id, schedule_id, external_id, name, description,
          wbs_code, location, planned_start, planned_finish, planned_quantity,
          unit, baseline_progress
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        ) RETURNING *
      `;

      for (const input of inputs) {
        const id = input.id || crypto.randomUUID();
        const baselineProgress = input.baselineProgress ?? 0.0;

        try {
          const res = await client.query(sql, [
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
          ]);
          insertedActivities.push(mapRowToActivity(res.rows[0]));
        } catch (err: unknown) {
          if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
            throw new ConflictError(
              `Activity with external ID '${input.externalId}' already exists in this schedule`
            );
          }
          throw new DatabaseError(`Failed to insert activity batch: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      await client.query('COMMIT');
      return insertedActivities;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Activity | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activities WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToActivity(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string): Promise<Activity | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activities WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToActivity(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity by ID and Project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByScheduleId(scheduleId: string): Promise<Activity[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activities WHERE schedule_id = $1 ORDER BY planned_start ASC, external_id ASC', [scheduleId]);
      return res.rows.map(mapRowToActivity);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activities by schedule ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<Activity[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activities WHERE project_id = $1 ORDER BY planned_start ASC, external_id ASC', [projectId]);
      return res.rows.map(mapRowToActivity);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activities by project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByScheduleId(scheduleId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM activities WHERE schedule_id = $1', [scheduleId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count activities by schedule ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByProjectId(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM activities WHERE project_id = $1', [projectId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count activities by project ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresActivityRepository = new PostgresActivityRepository();
