import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  OperationalBlocker,
  CreateBlockerInput,
  BlockerCategory,
  BlockerStatus
} from '../../models/domain.types.js';
import { DatabaseError, NotFoundError } from '../../errors/AppError.js';
import type { OperationalBlockerRepository } from '../operational-blocker.repository.js';

interface BlockerDbRow {
  id: string;
  project_id: string;
  activity_id: string | null;
  category: string;
  description: string;
  status: string;
  reporter_name: string;
  reporter_role: string | null;
  created_at: string | Date;
  resolved_at: string | Date | null;
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
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? (typeof row.resolved_at === 'string' ? row.resolved_at : row.resolved_at.toISOString()) : null
  };
}

export class PostgresOperationalBlockerRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateBlockerInput): Promise<OperationalBlocker> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'active';

    const sql = `
      INSERT INTO operational_blockers (
        id, project_id, activity_id, category, description, status,
        reporter_name, reporter_role
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8
      ) RETURNING *
    `;

    const category = input.category || (input as any).rootCauseCategory;
    const reporterName = input.reporterName || (input as any).reportedBy;
    const reporterRole = input.reporterRole || (input as any).reporterRole || null;

    try {
      const res = await pool.query(sql, [
        id,
        input.projectId,
        input.activityId || null,
        category,
        input.description,
        status,
        reporterName,
        reporterRole
      ]);
      return mapRowToBlocker(res.rows[0]);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to create operational blocker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async findById(id: string): Promise<OperationalBlocker | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM operational_blockers WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToBlocker(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch operational blocker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(
    projectId: string,
    options?: { status?: BlockerStatus; activityId?: string }
  ): Promise<OperationalBlocker[]> {
    try {
      const pool = this.getPool();
      let query = 'SELECT * FROM operational_blockers WHERE project_id = $1';
      const params: unknown[] = [projectId];
      let paramIdx = 2;

      if (options?.status) {
        query += ` AND status = $${paramIdx++}`;
        params.push(options.status);
      }

      if (options?.activityId) {
        query += ` AND activity_id = $${paramIdx++}`;
        params.push(options.activityId);
      }

      query += ' ORDER BY created_at DESC';
      const res = await pool.query(query, params);
      return res.rows.map(mapRowToBlocker);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list operational blockers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listActiveByProject(projectId: string): Promise<OperationalBlocker[]> {
    return this.listByProjectId(projectId, { status: 'active' });
  }

  async listByActivity(projectId: string, activityId: string): Promise<OperationalBlocker[]> {
    return this.listByProjectId(projectId, { activityId });
  }

  async resolve(id: string, projectId: string, resolvedAt?: string): Promise<OperationalBlocker | null> {
    try {
      const pool = this.getPool();
      const resolvedTimestamp = resolvedAt || new Date().toISOString();
      const res = await pool.query(
        `
        UPDATE operational_blockers
        SET status = 'resolved', resolved_at = $1
        WHERE id = $2 AND project_id = $3
        RETURNING *
      `,
        [resolvedTimestamp, id, projectId]
      );

      return res.rows.length > 0 ? mapRowToBlocker(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to resolve operational blocker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByRootCause(projectId: string): Promise<Record<BlockerCategory, number>> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        `
        SELECT category, COUNT(*) as count
        FROM operational_blockers
        WHERE project_id = $1 AND status = 'active'
        GROUP BY category
      `,
        [projectId]
      );

      const counts: Record<BlockerCategory, number> = {
        equipment: 0,
        material: 0,
        access: 0,
        inspection: 0,
        weather: 0,
        safety: 0,
        coordination: 0
      };

      for (const row of res.rows) {
        if (row.category in counts) {
          counts[row.category as BlockerCategory] = Number(row.count);
        }
      }

      return counts;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count root causes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string, projectId: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM operational_blockers WHERE id = $1 AND project_id = $2', [id, projectId]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete operational blocker: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresOperationalBlockerRepository = new PostgresOperationalBlockerRepository();
