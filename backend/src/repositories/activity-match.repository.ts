import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import { ActivityMatch, CreateActivityMatchInput, MatchMethod, MatchStatus, MatchConfidenceTier, MatchReviewState } from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError } from '../errors/AppError.js';

export interface UpdateMatchReviewInput {
  id: string;
  projectId: string;
  status: MatchStatus;
  reviewState?: MatchReviewState | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  activityId?: string;
  matchMethod?: MatchMethod;
  rationale?: string | null;
}

export interface ActivityMatchRepository {
  create(input: CreateActivityMatchInput): ActivityMatch;
  createMany(inputs: CreateActivityMatchInput[]): ActivityMatch[];
  getById(id: string): ActivityMatch | null;
  getByIdAndProjectId(id: string, projectId: string): ActivityMatch | null;
  listByProgressUpdateId(progressUpdateId: string, projectId?: string): ActivityMatch[];
  listByProjectId(projectId: string): ActivityMatch[];
  updateMatchReview(input: UpdateMatchReviewInput): ActivityMatch | null;
  delete(id: string, projectId?: string): boolean;
  deleteByProgressUpdateId(progressUpdateId: string, projectId?: string): number;
  deleteSuggestedByProgressUpdateId(progressUpdateId: string, projectId: string): number;
}

interface ActivityMatchDbRow {
  id: string;
  project_id: string;
  progress_update_id: string;
  evidence_id: string | null;
  activity_id: string;
  confidence_score: number;
  match_method: string;
  matched_text: string | null;
  rationale: string | null;
  status: string;
  confidence_tier: string | null;
  review_state: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToActivityMatch(row: ActivityMatchDbRow): ActivityMatch {
  return {
    id: row.id,
    projectId: row.project_id,
    progressUpdateId: row.progress_update_id,
    evidenceId: row.evidence_id,
    activityId: row.activity_id,
    confidenceScore: row.confidence_score,
    matchMethod: row.match_method as ActivityMatch['matchMethod'],
    matchedText: row.matched_text,
    rationale: row.rationale,
    status: row.status as ActivityMatch['status'],
    confidenceTier: (row.confidence_tier as ActivityMatch['confidenceTier']) || null,
    reviewState: (row.review_state as ActivityMatch['reviewState']) || null,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteActivityMatchRepository implements ActivityMatchRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateActivityMatchInput): ActivityMatch {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'suggested';
    const confidenceTier = input.confidenceTier ?? null;
    const reviewState = input.reviewState ?? null;

    const stmt = db.prepare(`
      INSERT INTO activity_matches (
        id, project_id, progress_update_id, evidence_id, activity_id,
        confidence_score, match_method, matched_text, rationale, status,
        confidence_tier, review_state, reviewed_by, reviewed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    try {
      stmt.run(
        id,
        input.projectId,
        input.progressUpdateId,
        input.evidenceId ?? null,
        input.activityId,
        input.confidenceScore,
        input.matchMethod,
        input.matchedText ?? null,
        input.rationale ?? null,
        status,
        confidenceTier,
        reviewState,
        input.reviewedBy ?? null,
        input.reviewedAt ?? null
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to create activity match due to foreign key or cross-project constraint: ${err.message}`
          );
        }
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(`Activity match with ID '${id}' already exists`);
        }
      }
      throw new DatabaseError(`Failed to create activity match: ${err instanceof Error ? err.message : String(err)}`);
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created activity match');
    }
    return created;
  }

  createMany(inputs: CreateActivityMatchInput[]): ActivityMatch[] {
    if (inputs.length === 0) {
      return [];
    }

    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO activity_matches (
        id, project_id, progress_update_id, evidence_id, activity_id,
        confidence_score, match_method, matched_text, rationale, status,
        confidence_tier, review_state, reviewed_by, reviewed_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertedIds: string[] = [];

    const runTransaction = db.transaction(() => {
      for (const input of inputs) {
        const id = input.id || crypto.randomUUID();
        const status = input.status || 'suggested';
        const confidenceTier = input.confidenceTier ?? null;
        const reviewState = input.reviewState ?? null;

        stmt.run(
          id,
          input.projectId,
          input.progressUpdateId,
          input.evidenceId ?? null,
          input.activityId,
          input.confidenceScore,
          input.matchMethod,
          input.matchedText ?? null,
          input.rationale ?? null,
          status,
          confidenceTier,
          reviewState,
          input.reviewedBy ?? null,
          input.reviewedAt ?? null
        );
        insertedIds.push(id);
      }
    });

    try {
      runTransaction();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to insert activity matches batch due to constraint violation: ${err.message}`
          );
        }
      }
      throw new DatabaseError(
        `Failed to insert activity matches batch: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const placeholders = insertedIds.map(() => '?').join(',');
    const selectStmt = db.prepare(`
      SELECT * FROM activity_matches 
      WHERE id IN (${placeholders}) 
      ORDER BY confidence_score DESC, created_at ASC
    `);
    const rows = selectStmt.all(...insertedIds) as ActivityMatchDbRow[];
    return rows.map(mapRowToActivityMatch);
  }

  updateMatchReview(input: UpdateMatchReviewInput): ActivityMatch | null {
    const db = this.getDb();
    const existing = this.getByIdAndProjectId(input.id, input.projectId);
    if (!existing) {
      return null;
    }

    const updatedActivityId = input.activityId ?? existing.activityId;
    const updatedMatchMethod = input.matchMethod ?? existing.matchMethod;
    const updatedRationale = input.rationale !== undefined ? input.rationale : existing.rationale;
    const updatedReviewState = input.reviewState !== undefined ? input.reviewState : existing.reviewState;

    const stmt = db.prepare(`
      UPDATE activity_matches
      SET
        activity_id = ?,
        status = ?,
        match_method = ?,
        rationale = ?,
        review_state = ?,
        reviewed_by = ?,
        reviewed_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ?
    `);

    try {
      stmt.run(
        updatedActivityId,
        input.status,
        updatedMatchMethod,
        updatedRationale,
        updatedReviewState,
        input.reviewedBy ?? null,
        input.reviewedAt ?? null,
        input.id,
        input.projectId
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to update activity match review due to foreign key or cross-project constraint: ${err.message}`
          );
        }
      }
      throw new DatabaseError(`Failed to update activity match review: ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.getByIdAndProjectId(input.id, input.projectId);
  }

  getById(id: string): ActivityMatch | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activity_matches WHERE id = ?');
      const row = stmt.get(id) as ActivityMatchDbRow | undefined;
      return row ? mapRowToActivityMatch(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity match by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  getByIdAndProjectId(id: string, projectId: string): ActivityMatch | null {
    try {
      const db = this.getDb();
      const stmt = db.prepare('SELECT * FROM activity_matches WHERE id = ? AND project_id = ?');
      const row = stmt.get(id, projectId) as ActivityMatchDbRow | undefined;
      return row ? mapRowToActivityMatch(row) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity match for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  listByProgressUpdateId(progressUpdateId: string, projectId?: string): ActivityMatch[] {
    try {
      const db = this.getDb();
      let stmt;
      let rows: ActivityMatchDbRow[];

      if (projectId) {
        stmt = db.prepare(`
          SELECT * FROM activity_matches 
          WHERE progress_update_id = ? AND project_id = ? 
          ORDER BY confidence_score DESC, created_at ASC
        `);
        rows = stmt.all(progressUpdateId, projectId) as ActivityMatchDbRow[];
      } else {
        stmt = db.prepare(`
          SELECT * FROM activity_matches 
          WHERE progress_update_id = ? 
          ORDER BY confidence_score DESC, created_at ASC
        `);
        rows = stmt.all(progressUpdateId) as ActivityMatchDbRow[];
      }

      return rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity matches by progress update: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByProjectId(projectId: string): ActivityMatch[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM activity_matches 
        WHERE project_id = ? 
        ORDER BY created_at DESC, confidence_score DESC
      `);
      const rows = stmt.all(projectId) as ActivityMatchDbRow[];
      return rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity matches for project: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  delete(id: string, projectId?: string): boolean {
    try {
      const db = this.getDb();
      let result;
      if (projectId) {
        const stmt = db.prepare('DELETE FROM activity_matches WHERE id = ? AND project_id = ?');
        result = stmt.run(id, projectId);
      } else {
        const stmt = db.prepare('DELETE FROM activity_matches WHERE id = ?');
        result = stmt.run(id);
      }
      return result.changes > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete activity match: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  deleteByProgressUpdateId(progressUpdateId: string, projectId?: string): number {
    try {
      const db = this.getDb();
      let result;
      if (projectId) {
        const stmt = db.prepare('DELETE FROM activity_matches WHERE progress_update_id = ? AND project_id = ?');
        result = stmt.run(progressUpdateId, projectId);
      } else {
        const stmt = db.prepare('DELETE FROM activity_matches WHERE progress_update_id = ?');
        result = stmt.run(progressUpdateId);
      }
      return result.changes;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to delete activity matches for progress update: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  deleteSuggestedByProgressUpdateId(progressUpdateId: string, projectId: string): number {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        DELETE FROM activity_matches 
        WHERE progress_update_id = ? 
          AND project_id = ? 
          AND status = 'suggested'
      `);
      const result = stmt.run(progressUpdateId, projectId);
      return result.changes;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to delete suggested activity matches for progress report: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export const activityMatchRepository: ActivityMatchRepository = new SqliteActivityMatchRepository();
