import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import { Project, CreateProjectInput, UpdateProjectInput } from '../../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../../errors/AppError.js';
import type { ProjectRepository } from '../project.repository.js';

interface ProjectDbRow {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToProject(row: ProjectDbRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    status: row.status as Project['status'],
    startDate: row.start_date,
    targetEndDate: row.target_end_date,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export class PostgresProjectRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async create(input: CreateProjectInput): Promise<Project> {
    const pool = this.getPool();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'active';

    const sql = `
      INSERT INTO projects (
        id, name, description, code, status, start_date, target_end_date
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        id,
        input.name,
        input.description ?? null,
        input.code,
        status,
        input.startDate ?? null,
        input.targetEndDate ?? null
      ]);
      return mapRowToProject(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        const detail = (err as { detail?: string }).detail || '';
        if (detail.includes('code') || String(err).includes('code')) {
          throw new ConflictError(`Project with code '${input.code}' already exists`);
        }
        throw new ConflictError(`Project with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getById(id: string): Promise<Project | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToProject(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByCode(code: string): Promise<Project | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM projects WHERE code = $1', [code]);
      return res.rows.length > 0 ? mapRowToProject(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project by code: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listAll(): Promise<Project[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
      return res.rows.map(mapRowToProject);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list projects: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundError(`Project with ID '${id}' not found`);
    }

    const pool = this.getPool();
    const name = input.name ?? existing.name;
    const description = input.description !== undefined ? input.description : existing.description;
    const code = input.code ?? existing.code;
    const status = input.status ?? existing.status;
    const startDate = input.startDate !== undefined ? input.startDate : existing.startDate;
    const targetEndDate = input.targetEndDate !== undefined ? input.targetEndDate : existing.targetEndDate;

    const sql = `
      UPDATE projects
      SET name = $1, description = $2, code = $3, status = $4, start_date = $5, target_end_date = $6, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;

    try {
      const res = await pool.query(sql, [name, description, code, status, startDate, targetEndDate, id]);
      return mapRowToProject(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Project with code '${code}' already exists`);
      }
      throw new DatabaseError(`Failed to update project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async count(): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM projects');
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count projects: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresProjectRepository = new PostgresProjectRepository();
