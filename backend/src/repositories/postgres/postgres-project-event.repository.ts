import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import { ProjectEvent, CreateProjectEventInput } from '../../models/domain.types.js';
import { DatabaseError, NotFoundError } from '../../errors/AppError.js';
import type { ProjectEventRepository, ProjectEventFilterOptions } from '../project-event.repository.js';

interface ProjectEventDbRow {
  id: string;
  project_id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  payload_json: string | null;
  created_at: string | Date;
}

function mapRowToProjectEvent(row: ProjectEventDbRow): ProjectEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    payloadJson: row.payload_json,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString()
  };
}

function getNextDayString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class PostgresProjectEventRepository implements ProjectEventRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateProjectEventInput & { createdAt?: string }): Promise<ProjectEvent> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();

    try {
      if (input.createdAt) {
        const sql = `
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8
          ) RETURNING *
        `;
        const res = await pool.query(sql, [
          id,
          input.projectId,
          input.eventType,
          input.entityType ?? null,
          input.entityId ?? null,
          input.summary,
          input.payloadJson ?? null,
          input.createdAt
        ]);
        return mapRowToProjectEvent(res.rows[0]);
      } else {
        const sql = `
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7
          ) RETURNING *
        `;
        const res = await pool.query(sql, [
          id,
          input.projectId,
          input.eventType,
          input.entityType ?? null,
          input.entityId ?? null,
          input.summary,
          input.payloadJson ?? null
        ]);
        return mapRowToProjectEvent(res.rows[0]);
      }
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to create project event: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getById(id: string, projectId?: string): Promise<ProjectEvent | null> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query('SELECT * FROM project_events WHERE id = $1 AND project_id = $2', [id, projectId]);
      } else {
        res = await pool.query('SELECT * FROM project_events WHERE id = $1', [id]);
      }
      return res.rows.length > 0 ? mapRowToProjectEvent(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project event by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string, limit: number = 100): Promise<ProjectEvent[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM project_events WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
        [projectId, limit]
      );
      return res.rows.map(mapRowToProjectEvent);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list project events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listRecentByProject(projectId: string, options?: ProjectEventFilterOptions): Promise<ProjectEvent[]> {
    try {
      const pool = this.getPool();
      const params: unknown[] = [projectId];
      let sql = 'SELECT * FROM project_events WHERE project_id = $1';
      let paramIdx = 2;

      if (options?.sinceDate) {
        sql += ` AND created_at >= $${paramIdx++}`;
        params.push(options.sinceDate);
      }

      if (options?.asOfDate) {
        const nextDay = getNextDayString(options.asOfDate);
        sql += ` AND created_at < $${paramIdx++}`;
        params.push(nextDay);
      }

      sql += ' ORDER BY created_at DESC, id DESC';
      const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
      sql += ` LIMIT $${paramIdx++}`;
      params.push(limit);

      const res = await pool.query(sql, params);
      return res.rows.map(mapRowToProjectEvent);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list recent project events: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresProjectEventRepository = new PostgresProjectEventRepository();
