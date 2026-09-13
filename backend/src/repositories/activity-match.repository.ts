import { Database as DatabaseType } from 'better-sqlite3';
import crypto from 'node:crypto';
import { getDatabase } from '../database/db.js';
import {
  ActivityMatch,
  CreateActivityMatchInput,
  CreateProjectEventInput,
  MatchMethod,
  MatchStatus,
  MatchConfidenceTier,
  MatchReviewState
} from '../models/domain.types.js';
import { ConflictError, DatabaseError, NotFoundError, ValidationError } from '../errors/AppError.js';
import type { CreateNotificationOutboxInput } from '../services/anomaly/notification-outbox.types.js';

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

export interface ConfirmMatchAtomicInput {
  id: string;
  projectId: string;
  reviewer: string;
  nowIso: string;
}

export interface RejectMatchAtomicInput {
  id: string;
  projectId: string;
  reviewer: string;
  rationale?: string | null;
  nowIso: string;
  reason?: string | null;
}

export interface ResolveMatchAtomicInput {
  id: string;
  projectId: string;
  targetActivityId: string;
  targetActivityName: string;
  targetActivityExternalId: string;
  originalActivityId: string;
  originalRationale?: string | null;
  reviewer: string;
  rationale: string;
  nowIso: string;
  reason?: string | null;
}

export interface PersistMatchesAndEventsAtomicInput {
  projectId: string;
  progressUpdateId: string;
  matches: CreateActivityMatchInput[];
  events: CreateProjectEventInput[];
  notifications?: CreateNotificationOutboxInput[];
}

export interface ActivityMatchRepository {
  create(input: CreateActivityMatchInput): ActivityMatch;
  createMany(inputs: CreateActivityMatchInput[]): ActivityMatch[];
  getById(id: string): ActivityMatch | null;
  getByIdAndProjectId(id: string, projectId: string): ActivityMatch | null;
  listByProgressUpdateId(progressUpdateId: string, projectId?: string): ActivityMatch[];
  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): ActivityMatch[];
  listByActivityId(activityId: string, projectId: string): ActivityMatch[];
  listByProjectId(projectId: string): ActivityMatch[];
  updateMatchReview(input: UpdateMatchReviewInput): ActivityMatch | null;
  confirmMatchAtomically(input: ConfirmMatchAtomicInput): ActivityMatch;
  rejectMatchAtomically(input: RejectMatchAtomicInput): ActivityMatch;
  resolveMatchAtomically(input: ResolveMatchAtomicInput): ActivityMatch;
  persistMatchesAndEventsAtomically(input: PersistMatchesAndEventsAtomicInput): ActivityMatch[];
  delete(id: string, projectId?: string): boolean;
  deleteByProgressUpdateId(progressUpdateId: string, projectId?: string): number;
  deleteSuggestedByProgressUpdateId(progressUpdateId: string, projectId: string): number;
  runInTransaction?<T>(fn: () => T): T;
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
  ml_confidence: number | null;
  anomaly_score: number | null;
  anomaly_severity: string | null;
  anomaly_reasons_json: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToActivityMatch(row: ActivityMatchDbRow): ActivityMatch {
  let anomalyReasons: string[] | null = null;
  if (row.anomaly_reasons_json) {
    try {
      const parsed = JSON.parse(row.anomaly_reasons_json);
      if (Array.isArray(parsed)) {
        anomalyReasons = parsed;
      }
    } catch {
      anomalyReasons = null;
    }
  }

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
    mlConfidence: row.ml_confidence !== undefined && row.ml_confidence !== null ? row.ml_confidence : null,
    anomalyScore: row.anomaly_score !== undefined && row.anomaly_score !== null ? row.anomaly_score : null,
    anomalySeverity: (row.anomaly_severity as ActivityMatch['anomalySeverity']) || null,
    anomalyReasonsJson: row.anomaly_reasons_json || null,
    anomalyReasons,
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
        confidence_tier, review_state, reviewed_by, reviewed_at,
        ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        input.reviewedAt ?? null,
        input.mlConfidence ?? null,
        input.anomalyScore ?? null,
        input.anomalySeverity ?? null,
        input.anomalyReasonsJson ?? null
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
        confidence_tier, review_state, reviewed_by, reviewed_at,
        ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
          input.reviewedAt ?? null,
          input.mlConfidence ?? null,
          input.anomalyScore ?? null,
          input.anomalySeverity ?? null,
          input.anomalyReasonsJson ?? null
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

  /**
   * Atomically confirms a suggested match and records the match_confirmed project event.
   * Rollback occurs immediately if either the match update or event insertion fails.
   */
  confirmMatchAtomically(input: ConfirmMatchAtomicInput): ActivityMatch {
    const db = this.getDb();
    const eventId = crypto.randomUUID();

    const getMatchStmt = db.prepare(`
      SELECT * FROM activity_matches WHERE id = ? AND project_id = ?
    `);

    const updateMatchStmt = db.prepare(`
      UPDATE activity_matches
      SET
        status = 'confirmed',
        review_state = 'resolved',
        reviewed_by = ?,
        reviewed_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'suggested'
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTx = db.transaction(() => {
      const existing = getMatchStmt.get(input.id, input.projectId) as ActivityMatchDbRow | undefined;
      if (!existing) {
        throw new NotFoundError(
          `Activity match with ID '${input.id}' not found for project '${input.projectId}'`
        );
      }

      if (existing.status === 'confirmed') {
        throw new ValidationError(
          `Cannot confirm match '${input.id}'. Confirmed match history is immutable.`
        );
      }
      if (existing.status === 'rejected') {
        throw new ValidationError(
          `Cannot confirm match '${input.id}'. Rejected match history is immutable.`
        );
      }
      if (existing.review_state === 'unresolved') {
        throw new ValidationError(
          `Cannot confirm unresolved match '${input.id}' without selecting an activity. Use resolve to assign a specific activity.`
        );
      }

      const updateResult = updateMatchStmt.run(
        input.reviewer,
        input.nowIso,
        input.id,
        input.projectId
      );

      if (updateResult.changes === 0) {
        throw new ValidationError(
          `Failed to confirm match '${input.id}': State may have changed concurrently.`
        );
      }

      const payload = JSON.stringify({
        matchId: input.id,
        progressUpdateId: existing.progress_update_id,
        activityId: existing.activity_id,
        confidenceScore: existing.confidence_score,
        confidenceTier: existing.confidence_tier,
        reviewSource: 'human',
        reviewer: input.reviewer
      });

      insertEventStmt.run(
        eventId,
        input.projectId,
        'match_confirmed',
        'activity_matches',
        input.id,
        `Activity match confirmed by reviewer '${input.reviewer}' for activity '${existing.activity_id}'`,
        payload,
        input.nowIso
      );
    });

    try {
      runTx();
    } catch (err: unknown) {
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      throw new DatabaseError(
        `Failed to confirm activity match atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const updated = this.getByIdAndProjectId(input.id, input.projectId);
    if (!updated) {
      throw new DatabaseError(`Failed to retrieve confirmed activity match '${input.id}'`);
    }
    return updated;
  }

  /**
   * Atomically rejects a candidate match and records the match_rejected project event.
   * Rollback occurs immediately if either the match update or event insertion fails.
   */
  rejectMatchAtomically(input: RejectMatchAtomicInput): ActivityMatch {
    const db = this.getDb();
    const eventId = crypto.randomUUID();

    const getMatchStmt = db.prepare(`
      SELECT * FROM activity_matches WHERE id = ? AND project_id = ?
    `);

    const updateMatchStmt = db.prepare(`
      UPDATE activity_matches
      SET
        status = 'rejected',
        review_state = 'resolved',
        reviewed_by = ?,
        reviewed_at = ?,
        rationale = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'suggested'
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTx = db.transaction(() => {
      const existing = getMatchStmt.get(input.id, input.projectId) as ActivityMatchDbRow | undefined;
      if (!existing) {
        throw new NotFoundError(
          `Activity match with ID '${input.id}' not found for project '${input.projectId}'`
        );
      }

      if (existing.status === 'confirmed') {
        throw new ValidationError(
          `Cannot reject match '${input.id}'. Confirmed match history is immutable.`
        );
      }
      if (existing.status === 'rejected') {
        throw new ValidationError(
          `Cannot reject match '${input.id}'. Rejected match history is immutable.`
        );
      }

      const rationale = input.rationale !== undefined ? input.rationale : existing.rationale;

      const updateResult = updateMatchStmt.run(
        input.reviewer,
        input.nowIso,
        rationale,
        input.id,
        input.projectId
      );

      if (updateResult.changes === 0) {
        throw new ValidationError(
          `Failed to reject match '${input.id}': State may have changed concurrently.`
        );
      }

      const payload = JSON.stringify({
        matchId: input.id,
        progressUpdateId: existing.progress_update_id,
        activityId: existing.activity_id,
        confidenceScore: existing.confidence_score,
        confidenceTier: existing.confidence_tier,
        reviewSource: 'human',
        reviewer: input.reviewer,
        reason: input.reason ?? null
      });

      insertEventStmt.run(
        eventId,
        input.projectId,
        'match_rejected',
        'activity_matches',
        input.id,
        `Activity match rejected by reviewer '${input.reviewer}' for activity '${existing.activity_id}'`,
        payload,
        input.nowIso
      );
    });

    try {
      runTx();
    } catch (err: unknown) {
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      throw new DatabaseError(
        `Failed to reject activity match atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const updated = this.getByIdAndProjectId(input.id, input.projectId);
    if (!updated) {
      throw new DatabaseError(`Failed to retrieve rejected activity match '${input.id}'`);
    }
    return updated;
  }

  /**
   * Atomically resolves an unresolved or candidate match to a chosen activity and records match_resolved.
   * Rollback occurs immediately if either the match update or event insertion fails.
   */
  resolveMatchAtomically(input: ResolveMatchAtomicInput): ActivityMatch {
    const db = this.getDb();
    const eventId = crypto.randomUUID();

    const getMatchStmt = db.prepare(`
      SELECT * FROM activity_matches WHERE id = ? AND project_id = ?
    `);

    const updateMatchStmt = db.prepare(`
      UPDATE activity_matches
      SET
        activity_id = ?,
        status = 'confirmed',
        review_state = 'resolved',
        match_method = 'manual',
        reviewed_by = ?,
        reviewed_at = ?,
        rationale = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status = 'suggested'
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const runTx = db.transaction(() => {
      const existing = getMatchStmt.get(input.id, input.projectId) as ActivityMatchDbRow | undefined;
      if (!existing) {
        throw new NotFoundError(
          `Activity match with ID '${input.id}' not found for project '${input.projectId}'`
        );
      }

      if (existing.status === 'confirmed') {
        throw new ValidationError(
          `Cannot resolve or retarget match '${input.id}'. Confirmed match history is immutable.`
        );
      }
      if (existing.status === 'rejected') {
        throw new ValidationError(
          `Cannot resolve match '${input.id}'. Rejected match history is immutable.`
        );
      }

      const updateResult = updateMatchStmt.run(
        input.targetActivityId,
        input.reviewer,
        input.nowIso,
        input.rationale,
        input.id,
        input.projectId
      );

      if (updateResult.changes === 0) {
        throw new ValidationError(
          `Failed to resolve match '${input.id}': State may have changed concurrently.`
        );
      }

      const payload = JSON.stringify({
        matchId: input.id,
        progressUpdateId: existing.progress_update_id,
        activityId: input.targetActivityId,
        originalActivityId: input.originalActivityId,
        confidenceScore: existing.confidence_score,
        confidenceTier: existing.confidence_tier,
        matchMethod: 'manual',
        reviewSource: 'human',
        reviewer: input.reviewer,
        reason: input.reason ?? null
      });

      insertEventStmt.run(
        eventId,
        input.projectId,
        'match_resolved',
        'activity_matches',
        input.id,
        `Activity match manually resolved to '${input.targetActivityName}' (${input.targetActivityExternalId}) by reviewer '${input.reviewer}'`,
        payload,
        input.nowIso
      );
    });

    try {
      runTx();
    } catch (err: unknown) {
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to resolve activity match due to foreign key or cross-project constraint: ${err.message}`
          );
        }
      }
      throw new DatabaseError(
        `Failed to resolve activity match atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const updated = this.getByIdAndProjectId(input.id, input.projectId);
    if (!updated) {
      throw new DatabaseError(`Failed to retrieve resolved activity match '${input.id}'`);
    }
    return updated;
  }

  /**
   * Atomically cleans up old suggested matches, persists new candidate matches (with auto-confirm if applicable),
   * and creates all corresponding project audit events in a single transaction.
   */
  persistMatchesAndEventsAtomically(input: PersistMatchesAndEventsAtomicInput): ActivityMatch[] {
    const db = this.getDb();

    const deleteStmt = db.prepare(`
      DELETE FROM activity_matches
      WHERE progress_update_id = ? AND project_id = ? AND (status = 'suggested' OR reviewed_by = 'system')
    `);

    const insertMatchStmt = db.prepare(`
      INSERT INTO activity_matches (
        id, project_id, progress_update_id, evidence_id, activity_id,
        confidence_score, match_method, matched_text, rationale, status,
        confidence_tier, review_state, reviewed_by, reviewed_at,
        ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertEventStmt = db.prepare(`
      INSERT INTO project_events (
        id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const insertedIds: string[] = [];

    const runTx = db.transaction(() => {
      // 1. Clean up only suggested or system-confirmed matches for this update
      deleteStmt.run(input.progressUpdateId, input.projectId);

      // Check existing confirmed activities to prevent duplicate confirmed decisions
      const existingConfirmed = db.prepare(`
        SELECT activity_id FROM activity_matches
        WHERE progress_update_id = ? AND project_id = ? AND status = 'confirmed'
      `).all(input.progressUpdateId, input.projectId) as Array<{ activity_id: string }>;
      const existingConfirmedActivityIds = new Set(existingConfirmed.map((r) => r.activity_id));

      // 2. Insert new candidate matches
      for (const m of input.matches) {
        if (m.status === 'confirmed' && existingConfirmedActivityIds.has(m.activityId)) {
          // Do not duplicate already confirmed decisions for this activity
          continue;
        }

        const id = m.id || crypto.randomUUID();
        insertMatchStmt.run(
          id,
          m.projectId,
          m.progressUpdateId,
          m.evidenceId ?? null,
          m.activityId,
          m.confidenceScore,
          m.matchMethod,
          m.matchedText ?? null,
          m.rationale ?? null,
          m.status || 'suggested',
          m.confidenceTier ?? null,
          m.reviewState ?? null,
          m.reviewedBy ?? null,
          m.reviewedAt ?? null,
          m.mlConfidence ?? null,
          m.anomalyScore ?? null,
          m.anomalySeverity ?? null,
          m.anomalyReasonsJson ?? null
        );
        insertedIds.push(id);
      }

      // 3. Insert audit events for successfully inserted matches
      for (const evt of input.events) {
        const eventId = evt.id || crypto.randomUUID();
        insertEventStmt.run(
          eventId,
          evt.projectId,
          evt.eventType,
          evt.entityType ?? null,
          evt.entityId ?? null,
          evt.summary,
          evt.payloadJson ?? null,
          new Date().toISOString()
        );
      }

      // 4. Insert notification outbox records atomically if provided
      if (input.notifications && input.notifications.length > 0) {
        const insertNotifStmt = db.prepare(`
          INSERT INTO notification_outbox (
            id, project_id, activity_match_id, notification_type, channel,
            status, payload_json, idempotency_key, attempt_count, max_attempts
          ) VALUES (
            ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?
          )
        `);

        for (const notif of input.notifications) {
          const notifId = notif.id || crypto.randomUUID();
          const channel = notif.channel || 'email';
          const notifType = notif.notificationType || 'anomaly_alert';
          const idempotencyKey =
            notif.idempotencyKey || `fieldline-anomaly-alert:${notif.activityMatchId}`;
          const maxAttempts = notif.maxAttempts ?? 5;
          const payloadJson = JSON.stringify(notif.payload);

          insertNotifStmt.run(
            notifId,
            notif.projectId,
            notif.activityMatchId,
            notifType,
            channel,
            payloadJson,
            idempotencyKey,
            maxAttempts
          );
        }
      }
    });

    try {
      runTx();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_TRIGGER') {
          throw new DatabaseError(
            `Failed to persist matches and events atomically due to constraint violation: ${err.message}`
          );
        }
      }
      throw new DatabaseError(
        `Failed to persist matches and events atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (insertedIds.length === 0) {
      return [];
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

    if (existing.status === 'confirmed') {
      throw new ValidationError(
        `Cannot update match '${input.id}'. Confirmed match history is immutable.`
      );
    }
    if (existing.status === 'rejected') {
      throw new ValidationError(
        `Cannot update match '${input.id}'. Rejected match history is immutable.`
      );
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
      WHERE id = ? AND project_id = ? AND status = 'suggested'
    `);

    try {
      const result = stmt.run(
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
      if (result.changes === 0) {
        throw new ValidationError(
          `Failed to update match '${input.id}': State may have changed concurrently.`
        );
      }
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        throw err;
      }
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

  listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): ActivityMatch[] {
    if (progressUpdateIds.length === 0) {
      return [];
    }

    try {
      const db = this.getDb();
      const placeholders = progressUpdateIds.map(() => '?').join(',');
      const stmt = db.prepare(`
        SELECT * FROM activity_matches 
        WHERE project_id = ? AND progress_update_id IN (${placeholders}) 
        ORDER BY progress_update_id ASC, confidence_score DESC, id ASC
      `);
      const rows = stmt.all(projectId, ...progressUpdateIds) as ActivityMatchDbRow[];
      return rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity matches for progress update batch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  listByActivityId(activityId: string, projectId: string): ActivityMatch[] {
    try {
      const db = this.getDb();
      const stmt = db.prepare(`
        SELECT * FROM activity_matches
        WHERE activity_id = ? AND project_id = ?
        ORDER BY created_at DESC, confidence_score DESC, id ASC
      `);
      const rows = stmt.all(activityId, projectId) as ActivityMatchDbRow[];
      return rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity matches for activity '${activityId}': ${err instanceof Error ? err.message : String(err)}`
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

  runInTransaction<T>(fn: () => T): T {
    const db = this.getDb();
    return db.transaction(fn)();
  }
}

export const sqliteActivityMatchRepository: ActivityMatchRepository = new SqliteActivityMatchRepository();

import { PostgresActivityMatchRepository } from './postgres/postgres-activity-match.repository.js';
import { env } from '../config/env.js';

let _postgresActivityMatchRepoInstance: PostgresActivityMatchRepository | null = null;
export function getPostgresActivityMatchRepository(): PostgresActivityMatchRepository {
  if (!_postgresActivityMatchRepoInstance) {
    _postgresActivityMatchRepoInstance = new PostgresActivityMatchRepository();
  }
  return _postgresActivityMatchRepoInstance;
}

export const activityMatchRepository: ActivityMatchRepository = new Proxy(Object.create(sqliteActivityMatchRepository) as ActivityMatchRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresActivityMatchRepository() : sqliteActivityMatchRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
