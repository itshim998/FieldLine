import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { Project, CreateProjectInput, UpdateProjectInput } from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';
import { MaybePromise } from '../database/provider.js';

export interface ProjectRepository {
  create(input: CreateProjectInput): MaybePromise<Project>;
  getById(id: string): MaybePromise<Project | null>;
  getByCode(code: string): MaybePromise<Project | null>;
  listAll(): MaybePromise<Project[]>;
  update(id: string, input: UpdateProjectInput): MaybePromise<Project>;
  delete(id: string): MaybePromise<boolean>;
  count(): MaybePromise<number>;
}

interface ProjectDbRow {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteProjectRepository implements ProjectRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateProjectInput): Project {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'active';

    const stmt = db.prepare(`
      INSERT INTO projects (
        id, name, description, code, status, start_date, target_end_date
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.name,
        input.description ?? null,
        input.code,
        status,
        input.startDate ?? null,
        input.targetEndDate ?? null
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Project with code '${input.code}' already exists`);
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new ConflictError(`Project with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create project: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created project');
    }
    return created;
  }

  getById(id: string): Project | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
      const row = stmt.get(id) as ProjectDbRow | undefined;
      return row ? mapRowToProject(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByCode(code: string): Project | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM projects WHERE code = ?');
      const row = stmt.get(code) as ProjectDbRow | undefined;
      return row ? mapRowToProject(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch project by code: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listAll(): Project[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
      const rows = stmt.all() as ProjectDbRow[];
      return rows.map(mapRowToProject);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list projects: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  update(id: string, input: UpdateProjectInput): Project {
    const existing = this.getById(id);
    if (!existing) {
      throw new NotFoundError(`Project with ID '${id}' not found`);
    }

    const db = this.getDb();
    const name = input.name ?? existing.name;
    const description = input.description !== undefined ? input.description : existing.description;
    const code = input.code ?? existing.code;
    const status = input.status ?? existing.status;
    const startDate = input.startDate !== undefined ? input.startDate : existing.startDate;
    const targetEndDate = input.targetEndDate !== undefined ? input.targetEndDate : existing.targetEndDate;

    const stmt = db.prepare(`
      UPDATE projects
      SET name = ?, description = ?, code = ?, status = ?, start_date = ?, target_end_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    try {
      stmt.run(name, description, code, status, startDate, targetEndDate, id);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ConflictError(`Project with code '${code}' already exists`);
      }
      throw new DatabaseError(`Failed to update project: ${err instanceof Error ? err.message : String(err)}`);
    }

    const updated = this.getById(id);
    if (!updated) {
      throw new DatabaseError('Failed to fetch updated project');
    }
    return updated;
  }

  delete(id: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  count(): number {
    try {
      const db = this.getDb();
      const row = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
      return row.count;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count projects: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const sqliteProjectRepository: ProjectRepository = new SqliteProjectRepository();

import { PostgresProjectRepository } from './postgres/postgres-project.repository.js';
import { env } from '../config/env.js';

let _postgresProjectRepoInstance: PostgresProjectRepository | null = null;
export function getPostgresProjectRepository(): PostgresProjectRepository {
  if (!_postgresProjectRepoInstance) {
    _postgresProjectRepoInstance = new PostgresProjectRepository();
  }
  return _postgresProjectRepoInstance;
}

export const projectRepository: ProjectRepository = new Proxy(Object.create(sqliteProjectRepository) as ProjectRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresProjectRepository() : sqliteProjectRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
