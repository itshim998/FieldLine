import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { ProjectEvent, CreateProjectEventInput } from '../models/domain.types.js';
import { DatabaseError, NotFoundError } from '../errors/AppError.js';

export interface ProjectEventFilterOptions {
  asOfDate?: string;
  sinceDate?: string;
  limit?: number;
}

export interface ProjectEventRepository {
  create(input: CreateProjectEventInput & { createdAt?: string }): ProjectEvent;
  getById(id: string, projectId?: string): ProjectEvent | null;
  listByProjectId(projectId: string, limit?: number): ProjectEvent[];
  listRecentByProject(projectId: string, options?: ProjectEventFilterOptions): ProjectEvent[];
}

interface ProjectEventDbRow {
  id: string;
  project_id: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  payload_json: string | null;
  created_at: string;
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
    createdAt: row.created_at
  };
}

/**
 * Calculates the next calendar day in YYYY-MM-DD format using UTC semantics.
 */
function getNextDayString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class SqliteProjectEventRepository implements ProjectEventRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateProjectEventInput & { createdAt?: string }): ProjectEvent {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();

    try {
      if (input.createdAt) {
        const stmt = db.prepare(`
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?
          )
        `);
        stmt.run(
          id,
          input.projectId,
          input.eventType,
          input.entityType ?? null,
          input.entityId ?? null,
          input.summary,
          input.payloadJson ?? null,
          input.createdAt
        );
      } else {
        const stmt = db.prepare(`
          INSERT INTO project_events (
            id, project_id, event_type, entity_type, entity_id, summary, payload_json
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
          )
        `);
        stmt.run(
          id,
          input.projectId,
          input.eventType,
          input.entityType ?? null,
          input.entityId ?? null,
          input.summary,
          input.payloadJson ?? null
        );
      }
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to create project event: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const created = this.getById(id, input.projectId);
    if (!created) {
      throw new NotFoundError(`Project event '${id}' could not be retrieved after insert`);
    }
    return created;
  }

  getById(id: string, projectId?: string): ProjectEvent | null {
    try {
      const db = this.getDb();
      let stmt;
      let row: ProjectEventDbRow | undefined;

      if (projectId) {
        stmt = db.prepare(`
          SELECT * FROM project_events WHERE id = ? AND project_id = ?
        `);
        row = stmt.get(id, projectId) as ProjectEventDbRow | undefined;
      } else {
        stmt = db.prepare(`
          SELECT * FROM project_events WHERE id = ?
        `);
        row = stmt.get(id) as ProjectEventDbRow | undefined;
      }

      return row ? mapRowToProjectEvent(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to fetch project event by ID: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProjectId(projectId: string, limit: number = 100): ProjectEvent[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM project_events
        WHERE project_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `);
      const rows = stmt.all(projectId, limit) as ProjectEventDbRow[];
      return rows.map(mapRowToProjectEvent);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list project events for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listRecentByProject(
    projectId: string,
    options?: ProjectEventFilterOptions
  ): ProjectEvent[] {
    try {
      const db = this.getDb();
      const params: unknown[] = [projectId];
      let sql = `SELECT * FROM project_events WHERE project_id = ?`;

      if (options?.sinceDate) {
        // Events on or after sinceDate (e.g. '2026-08-13')
        sql += ` AND created_at >= ?`;
        params.push(options.sinceDate);
      }

      if (options?.asOfDate) {
        // Events on or before the end of asOfDate (i.e. strictly before next day 00:00:00)
        const nextDay = getNextDayString(options.asOfDate);
        sql += ` AND created_at < ?`;
        params.push(nextDay);
      }

      sql += ` ORDER BY created_at DESC, id DESC`;

      const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));
      sql += ` LIMIT ?`;
      params.push(limit);

      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as ProjectEventDbRow[];
      return rows.map(mapRowToProjectEvent);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list recent project events for project '${projectId}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export const projectEventRepository: ProjectEventRepository = new SqliteProjectEventRepository();
