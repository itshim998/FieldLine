import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { ProgressUpdate, CreateProgressUpdateInput } from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';

export interface ProgressUpdateRepository {
  create(input: CreateProgressUpdateInput): ProgressUpdate;
  getById(id: string): ProgressUpdate | null;
  getByIdAndProjectId(id: string, projectId: string): ProgressUpdate | null;
  listByProjectId(projectId: string): ProgressUpdate[];
  countByProjectId(projectId: string): number;
  delete(id: string): boolean;
  deleteByIdAndProjectId(id: string, projectId: string): boolean;
}

interface ProgressUpdateDbRow {
  id: string;
  project_id: string;
  report_date: string;
  reporter_name: string | null;
  reporter_role: string | null;
  source_type: string;
  raw_text: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRowToProgressUpdate(row: ProgressUpdateDbRow): ProgressUpdate {
  return {
    id: row.id,
    projectId: row.project_id,
    reportDate: row.report_date,
    reporterName: row.reporter_name,
    reporterRole: row.reporter_role,
    sourceType: row.source_type as ProgressUpdate['sourceType'],
    rawText: row.raw_text,
    status: row.status as ProgressUpdate['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteProgressUpdateRepository implements ProgressUpdateRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateProgressUpdateInput): ProgressUpdate {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const sourceType = input.sourceType || 'manual';
    const status = input.status || 'received';

    const insertUpdateStmt = db.prepare(`
      INSERT INTO progress_updates (
        id, project_id, report_date, reporter_name, reporter_role, source_type, raw_text, status
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
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
      try {
        insertUpdateStmt.run(
          id,
          input.projectId,
          input.reportDate,
          input.reporterName ?? null,
          input.reporterRole ?? null,
          sourceType,
          input.rawText,
          status
        );
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err) {
          const code = (err as { code: string }).code;
          if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            throw new NotFoundError(`Project with ID '${input.projectId}' not found`);
          }
          if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new ConflictError(`Progress update with ID '${id}' already exists`);
          }
        }
        throw new DatabaseError(`Failed to create progress update: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Record project event for audit within the atomic transaction
      try {
        const eventId = crypto.randomUUID();
        insertEventStmt.run(
          eventId,
          input.projectId,
          'progress_reported',
          'progress_updates',
          id,
          'Manual progress report received',
          JSON.stringify({
            updateId: id,
            reportDate: input.reportDate,
            reporterName: input.reporterName ?? null,
            reporterRole: input.reporterRole ?? null,
            sourceType
          })
        );
      } catch {
        // Event recording failure should not break transaction unless strict audit is mandated
      }
    });

    runTransaction();

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created progress update');
    }
    return created;
  }

  getById(id: string): ProgressUpdate | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM progress_updates WHERE id = ?');
      const row = stmt.get(id) as ProgressUpdateDbRow | undefined;
      return row ? mapRowToProgressUpdate(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch progress update by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByIdAndProjectId(id: string, projectId: string): ProgressUpdate | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM progress_updates WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as ProgressUpdateDbRow | undefined;
      return row ? mapRowToProgressUpdate(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch progress update for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProjectId(projectId: string): ProgressUpdate[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM progress_updates 
        WHERE project_id = ? 
        ORDER BY report_date DESC, created_at DESC, id DESC
      `);
      const rows = stmt.all(projectId) as ProgressUpdateDbRow[];
      return rows.map(mapRowToProgressUpdate);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list progress updates for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  countByProjectId(projectId: string): number {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT COUNT(*) as count FROM progress_updates WHERE project_id = ?');
      const row = stmt.get(projectId) as { count: number } | undefined;
      return row ? row.count : 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count progress updates: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  delete(id: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM progress_updates WHERE id = ?');
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete progress update: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  deleteByIdAndProjectId(id: string, projectId: string): boolean {
    try {
      const db = this.getDb();
      const stmt = db.prepare('DELETE FROM progress_updates WHERE id = ? AND project_id = ?');
      const result = stmt.run(id, projectId);
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete progress update for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const progressUpdateRepository: ProgressUpdateRepository = new SqliteProgressUpdateRepository();
