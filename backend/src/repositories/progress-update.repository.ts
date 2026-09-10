import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  ProgressUpdate,
  CreateProgressUpdateInput,
  CreateActivityMatchInput,
  ActivityMatch
} from '../models/domain.types.js';
import { AppError, ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';

export interface DocumentProcessingTxInput {
  progressUpdate: CreateProgressUpdateInput;
  evidenceId: string;
  suggestedMatches: Array<Omit<CreateActivityMatchInput, 'progressUpdateId'> & { progressUpdateId?: string }>;
}

export interface DocumentProcessingTxResult {
  progressUpdate: ProgressUpdate;
  matches: ActivityMatch[];
}

export interface ProgressUpdateRepository {
  create(input: CreateProgressUpdateInput): ProgressUpdate;
  commitDocumentIngestionTransaction(input: DocumentProcessingTxInput): DocumentProcessingTxResult;
  getById(id: string): ProgressUpdate | null;
  getByIdAndProjectId(id: string, projectId: string): ProgressUpdate | null;
  listByIds(ids: string[], projectId: string): ProgressUpdate[];
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

    const nowIso = new Date().toISOString();
    const insertUpdateStmt = db.prepare(`
      INSERT INTO progress_updates (
        id, project_id, report_date, reporter_name, reporter_role, source_type, raw_text, status, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      insertUpdateStmt.run(
        id,
        input.projectId,
        input.reportDate,
        input.reporterName ?? null,
        input.reporterRole ?? null,
        sourceType,
        input.rawText,
        status,
        nowIso,
        nowIso
      );

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
    });

    try {
      runTransaction();
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
      if (err instanceof AppError) {
        throw err;
      }
      throw new DatabaseError(`Failed to create progress update: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created progress update');
    }
    return created;
  }

  commitDocumentIngestionTransaction(input: DocumentProcessingTxInput): DocumentProcessingTxResult {
    const db = this.getDb();
    const puId = input.progressUpdate.id || crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const sourceType = input.progressUpdate.sourceType || 'manual';
    const status = input.progressUpdate.status || 'received';

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

    const attachEvidenceStmt = db.prepare(`
      UPDATE evidence
      SET progress_update_id = ?
      WHERE id = ? AND project_id = ?
    `);

    const deleteSuggestionsStmt = db.prepare(`
      DELETE FROM activity_matches
      WHERE progress_update_id = ? AND project_id = ? AND status = 'suggested'
    `);

    const insertMatchStmt = db.prepare(`
      INSERT INTO activity_matches (
        id, project_id, progress_update_id, evidence_id, activity_id,
        confidence_score, match_method, matched_text, rationale, status,
        confidence_tier, review_state, reviewed_by, reviewed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTx = db.transaction(() => {
      // 1. Insert progress update
      insertUpdateStmt.run(
        puId,
        input.progressUpdate.projectId,
        input.progressUpdate.reportDate,
        input.progressUpdate.reporterName ?? null,
        input.progressUpdate.reporterRole ?? null,
        sourceType,
        input.progressUpdate.rawText,
        status
      );

      // 2. Insert event
      insertEventStmt.run(
        eventId,
        input.progressUpdate.projectId,
        'progress_reported',
        'progress_updates',
        puId,
        `Document ingestion report created for evidence '${input.evidenceId}'`,
        JSON.stringify({
          updateId: puId,
          reportDate: input.progressUpdate.reportDate,
          sourceType,
          evidenceId: input.evidenceId
        })
      );

      // 3. Attach evidence
      const attachRes = attachEvidenceStmt.run(
        puId,
        input.evidenceId,
        input.progressUpdate.projectId
      );
      if (attachRes.changes === 0) {
        throw new DatabaseError(`Evidence '${input.evidenceId}' could not be linked to report '${puId}'`);
      }

      // 4. Delete existing suggestions and insert suggested matches
      deleteSuggestionsStmt.run(puId, input.progressUpdate.projectId);
      const insertedMatchIds: string[] = [];
      for (const m of input.suggestedMatches) {
        const mId = m.id || crypto.randomUUID();
        insertMatchStmt.run(
          mId,
          input.progressUpdate.projectId,
          puId,
          input.evidenceId,
          m.activityId,
          m.confidenceScore,
          m.matchMethod,
          m.matchedText ?? null,
          m.rationale ?? null,
          m.status || 'suggested',
          m.confidenceTier ?? null,
          m.reviewState ?? null,
          m.reviewedBy ?? null,
          m.reviewedAt ?? null
        );
        insertedMatchIds.push(mId);
      }

      return insertedMatchIds;
    });

    let insertedMatchIds: string[] = [];
    try {
      insertedMatchIds = runTx();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new DatabaseError(`Failed to commit document processing transaction: ${err instanceof Error ? err.message : String(err)}`);
    }

    const createdProgressUpdate = this.getById(puId);
    if (!createdProgressUpdate) {
      throw new DatabaseError('Failed to retrieve created progress update after transaction');
    }

    let persistedMatches: ActivityMatch[] = [];
    if (insertedMatchIds.length > 0) {
      const placeholders = insertedMatchIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM activity_matches WHERE id IN (${placeholders}) ORDER BY confidence_score DESC`).all(...insertedMatchIds) as any[];
      persistedMatches = rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        progressUpdateId: r.progress_update_id,
        evidenceId: r.evidence_id,
        activityId: r.activity_id,
        confidenceScore: r.confidence_score,
        matchMethod: r.match_method,
        matchedText: r.matched_text,
        rationale: r.rationale,
        status: r.status,
        confidenceTier: r.confidence_tier || null,
        reviewState: r.review_state || null,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    }

    return {
      progressUpdate: createdProgressUpdate,
      matches: persistedMatches
    };
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

  listByIds(ids: string[], projectId: string): ProgressUpdate[] {
    if (ids.length === 0) {
      return [];
    }

    try {
      const db = this.getDb();
      const placeholders = ids.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM progress_updates
        WHERE project_id = ? AND id IN (${placeholders})
        ORDER BY created_at DESC, rowid DESC
      `);
      const rows = stmt.all(projectId, ...ids) as ProgressUpdateDbRow[];
      return rows.map(mapRowToProgressUpdate);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list progress updates for ID batch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProjectId(projectId: string): ProgressUpdate[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM progress_updates 
        WHERE project_id = ? 
        ORDER BY created_at DESC, rowid DESC
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
