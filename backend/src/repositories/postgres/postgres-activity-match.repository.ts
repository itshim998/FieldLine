import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import {
  ActivityMatch,
  CreateActivityMatchInput,
  MatchConfidenceTier,
  MatchMethod,
  MatchReviewState,
  MatchStatus
} from '../../models/domain.types.js';
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError
} from '../../errors/AppError.js';
import type {
  ActivityMatchRepository,
  PersistMatchesAndEventsAtomicInput,
  ResolveMatchAtomicInput,
  RejectMatchAtomicInput,
  ConfirmMatchAtomicInput,
  UpdateMatchReviewInput
} from '../activity-match.repository.js';

export interface UpdateActivityMatchInput {
  confidenceScore?: number;
  matchMethod?: MatchMethod;
  matchedText?: string | null;
  rationale?: string | null;
  status?: MatchStatus;
  confidenceTier?: MatchConfidenceTier | null;
  reviewState?: MatchReviewState | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
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
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRowToActivityMatch(row: ActivityMatchDbRow): ActivityMatch {
  let anomalyReasons: string[] | null = null;
  if (row.anomaly_reasons_json) {
    try {
      const parsed = JSON.parse(row.anomaly_reasons_json);
      if (Array.isArray(parsed)) anomalyReasons = parsed;
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
    confidenceScore: Number(row.confidence_score),
    matchMethod: row.match_method as ActivityMatch['matchMethod'],
    matchedText: row.matched_text,
    rationale: row.rationale,
    status: row.status as ActivityMatch['status'],
    confidenceTier: (row.confidence_tier as ActivityMatch['confidenceTier']) || null,
    reviewState: (row.review_state as ActivityMatch['reviewState']) || null,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    mlConfidence: row.ml_confidence !== null ? Number(row.ml_confidence) : null,
    anomalyScore: row.anomaly_score !== null ? Number(row.anomaly_score) : null,
    anomalySeverity: (row.anomaly_severity as ActivityMatch['anomalySeverity']) || null,
    anomalyReasonsJson: row.anomaly_reasons_json || null,
    anomalyReasons,
    createdAt: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString()
  };
}

export class PostgresActivityMatchRepository implements ActivityMatchRepository {
  private getPool: () => Pool;

  constructor(poolProvider?: () => Pool) {
    this.getPool = poolProvider || getPostgresPool;
  }

  async runInTransaction<T>(fn: (client?: PoolClient) => Promise<T>): Promise<T> {
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async create(input: CreateActivityMatchInput, client?: PoolClient): Promise<ActivityMatch> {
    const pool = client || this.getPool();
    const id = input.id || crypto.randomUUID();
    const status = input.status || 'suggested';
    const confidenceTier = input.confidenceTier ?? null;
    const reviewState = input.reviewState ?? null;
    const reviewedBy = input.reviewedBy ?? null;
    const reviewedAt = input.reviewedAt ?? null;
    const mlConfidence = input.mlConfidence ?? null;
    const anomalyScore = input.anomalyScore ?? null;
    const anomalySeverity = input.anomalySeverity ?? null;
    const anomalyReasonsJson = input.anomalyReasonsJson ?? null;

    const sql = `
      INSERT INTO activity_matches (
        id, project_id, progress_update_id, evidence_id, activity_id,
        confidence_score, match_method, matched_text, rationale, status,
        confidence_tier, review_state, reviewed_by, reviewed_at,
        ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
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
        reviewedBy,
        reviewedAt,
        mlConfidence,
        anomalyScore,
        anomalySeverity,
        anomalyReasonsJson
      ]);
      return mapRowToActivityMatch(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        throw new ConflictError(`Activity match with ID '${id}' already exists`);
      }
      throw new DatabaseError(`Failed to create activity match: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getById(id: string): Promise<ActivityMatch | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM activity_matches WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToActivityMatch(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity match by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByIdAndProjectId(id: string, projectId: string, client?: PoolClient): Promise<ActivityMatch | null> {
    try {
      const pool = client || this.getPool();
      const res = await pool.query('SELECT * FROM activity_matches WHERE id = $1 AND project_id = $2', [id, projectId]);
      return res.rows.length > 0 ? mapRowToActivityMatch(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch activity match: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProjectId(projectId: string): Promise<ActivityMatch[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_matches WHERE project_id = $1 ORDER BY created_at DESC',
        [projectId]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity matches: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByProgressUpdateId(progressUpdateId: string, projectId: string): Promise<ActivityMatch[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2 ORDER BY confidence_score DESC',
        [progressUpdateId, projectId]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list activity matches for update: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listConfirmedByActivityId(activityId: string, projectId: string): Promise<ActivityMatch[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        "SELECT * FROM activity_matches WHERE activity_id = $1 AND project_id = $2 AND status = 'confirmed' ORDER BY created_at ASC",
        [activityId, projectId]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list confirmed matches for activity: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listByReviewState(projectId: string, reviewState: MatchReviewState): Promise<ActivityMatch[]> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM activity_matches WHERE project_id = $1 AND review_state = $2 ORDER BY created_at ASC',
        [projectId, reviewState]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list matches by review state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async listAwaitingReview(projectId: string): Promise<ActivityMatch[]> {
    return this.listByReviewState(projectId, 'awaiting_review');
  }

  async countAwaitingReview(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        "SELECT COUNT(*) as count FROM activity_matches WHERE project_id = $1 AND review_state = 'awaiting_review'",
        [projectId]
      );
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count awaiting review matches: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async countByProjectId(projectId: string): Promise<number> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT COUNT(*) as count FROM activity_matches WHERE project_id = $1', [projectId]);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count matches: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async update(id: string, input: UpdateActivityMatchInput): Promise<ActivityMatch> {
    const pool = this.getPool();
    const existing = await this.getById(id);
    if (!existing) {
      throw new NotFoundError(`Activity match with ID '${id}' not found`);
    }

    const confidenceScore = input.confidenceScore ?? existing.confidenceScore;
    const matchMethod = input.matchMethod ?? existing.matchMethod;
    const matchedText = input.matchedText !== undefined ? input.matchedText : existing.matchedText;
    const rationale = input.rationale !== undefined ? input.rationale : existing.rationale;
    const status = input.status ?? existing.status;
    const confidenceTier = input.confidenceTier !== undefined ? input.confidenceTier : existing.confidenceTier;
    const reviewState = input.reviewState !== undefined ? input.reviewState : existing.reviewState;
    const reviewedBy = input.reviewedBy !== undefined ? input.reviewedBy : existing.reviewedBy;
    const reviewedAt = input.reviewedAt !== undefined ? input.reviewedAt : existing.reviewedAt;

    const sql = `
      UPDATE activity_matches
      SET
        confidence_score = $1, match_method = $2, matched_text = $3,
        rationale = $4, status = $5, confidence_tier = $6,
        review_state = $7, reviewed_by = $8, reviewed_at = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        confidenceScore,
        matchMethod,
        matchedText,
        rationale,
        status,
        confidenceTier,
        reviewState,
        reviewedBy,
        reviewedAt,
        id
      ]);
      return mapRowToActivityMatch(res.rows[0]);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to update activity match: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async resolveMatchAtomically(input: ResolveMatchAtomicInput): Promise<ActivityMatch> {
    const pool = this.getPool();
    const client = await pool.connect();
    const eventId = crypto.randomUUID();

    try {
      await client.query('BEGIN');

      const matchRes = await client.query(
        'SELECT * FROM activity_matches WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [input.id, input.projectId]
      );

      if (matchRes.rows.length === 0) {
        throw new NotFoundError(`Activity match with ID '${input.id}' not found for project '${input.projectId}'`);
      }

      const existing = matchRes.rows[0];
      if (existing.status === 'confirmed') {
        throw new ValidationError(`Cannot resolve or retarget match '${input.id}'. Confirmed match history is immutable.`);
      }
      if (existing.status === 'rejected') {
        throw new ValidationError(`Cannot resolve match '${input.id}'. Rejected match history is immutable.`);
      }

      const updateRes = await client.query(
        `
        UPDATE activity_matches
        SET
          activity_id = $1,
          status = 'confirmed',
          review_state = 'resolved',
          match_method = 'manual',
          reviewed_by = $2,
          reviewed_at = $3,
          rationale = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $5 AND project_id = $6 AND status = 'suggested'
        RETURNING *
      `,
        [input.targetActivityId, input.reviewer, input.nowIso, input.rationale, input.id, input.projectId]
      );

      if ((updateRes.rowCount ?? 0) === 0) {
        throw new ValidationError(`Failed to resolve match '${input.id}': State may have changed concurrently.`);
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

      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
      `,
        [
          eventId,
          input.projectId,
          'match_resolved',
          'activity_matches',
          input.id,
          `Activity match manually resolved to '${input.targetActivityName}' (${input.targetActivityExternalId}) by reviewer '${input.reviewer}'`,
          payload,
          input.nowIso
        ]
      );

      await client.query('COMMIT');
      return mapRowToActivityMatch(updateRes.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      throw new DatabaseError(`Failed to resolve activity match atomically: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async rejectMatchAtomically(input: RejectMatchAtomicInput): Promise<ActivityMatch> {
    const pool = this.getPool();
    const client = await pool.connect();
    const eventId = crypto.randomUUID();

    try {
      await client.query('BEGIN');

      const matchRes = await client.query(
        'SELECT * FROM activity_matches WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [input.id, input.projectId]
      );

      if (matchRes.rows.length === 0) {
        throw new NotFoundError(`Activity match with ID '${input.id}' not found for project '${input.projectId}'`);
      }

      const existing = matchRes.rows[0];
      if (existing.status === 'confirmed') {
        throw new ValidationError(`Cannot reject match '${input.id}'. Confirmed match history is immutable.`);
      }
      if (existing.status === 'rejected') {
        throw new ValidationError(`Cannot reject match '${input.id}'. Match is already rejected.`);
      }

      const updateRes = await client.query(
        `
        UPDATE activity_matches
        SET
          status = 'rejected',
          review_state = 'resolved',
          reviewed_by = $1,
          reviewed_at = $2,
          rationale = $3,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND project_id = $5 AND status = 'suggested'
        RETURNING *
      `,
        [input.reviewer, input.nowIso, input.rationale, input.id, input.projectId]
      );

      if ((updateRes.rowCount ?? 0) === 0) {
        throw new ValidationError(`Failed to reject match '${input.id}': State may have changed concurrently.`);
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

      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
      `,
        [
          eventId,
          input.projectId,
          'match_rejected',
          'activity_matches',
          input.id,
          `Activity match rejected by reviewer '${input.reviewer}' for activity '${existing.activity_id}'`,
          payload,
          input.nowIso
        ]
      );

      await client.query('COMMIT');
      return mapRowToActivityMatch(updateRes.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      throw new DatabaseError(`Failed to reject activity match atomically: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async persistMatchesAndEventsAtomically(
    input: PersistMatchesAndEventsAtomicInput,
    client?: PoolClient
  ): Promise<ActivityMatch[]> {
    const pool = this.getPool();
    const conn = client || (await pool.connect());
    const shouldRelease = !client;

    try {
      if (shouldRelease) {
        await conn.query('BEGIN');
      }

      // 1. Clean up only suggested or system-confirmed matches for this update
      await conn.query(
        `DELETE FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2 AND (status = 'suggested' OR reviewed_by = 'system')`,
        [input.progressUpdateId, input.projectId]
      );

      // Check existing confirmed activities to prevent duplicate confirmed decisions
      const existingConfirmed = await conn.query(
        `SELECT activity_id FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2 AND status = 'confirmed'`,
        [input.progressUpdateId, input.projectId]
      );
      const existingConfirmedActivityIds = new Set(existingConfirmed.rows.map((r: { activity_id: string }) => r.activity_id));

      const insertedMatches: ActivityMatch[] = [];

      const insertMatchSql = `
        INSERT INTO activity_matches (
          id, project_id, progress_update_id, evidence_id, activity_id,
          confidence_score, match_method, matched_text, rationale, status,
          confidence_tier, review_state, reviewed_by, reviewed_at,
          ml_confidence, anomaly_score, anomaly_severity, anomaly_reasons_json
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING *
      `;

      for (const m of input.matches) {
        if (m.status === 'confirmed' && existingConfirmedActivityIds.has(m.activityId)) {
          continue;
        }

        const id = m.id || crypto.randomUUID();
        const res = await conn.query(insertMatchSql, [
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
        ]);
        insertedMatches.push(mapRowToActivityMatch(res.rows[0]));
      }

      // Insert audit events
      const insertEventSql = `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
      `;

      for (const evt of input.events) {
        const eventId = evt.id || crypto.randomUUID();
        await conn.query(insertEventSql, [
          eventId,
          evt.projectId,
          evt.eventType,
          evt.entityType ?? null,
          evt.entityId ?? null,
          evt.summary,
          evt.payloadJson ?? null,
          new Date().toISOString()
        ]);
      }

      // Insert notification outbox records atomically if provided
      if (input.notifications && input.notifications.length > 0) {
        const insertNotifSql = `
          INSERT INTO notification_outbox (
            id, project_id, activity_match_id, notification_type, channel,
            status, payload_json, idempotency_key, attempt_count, max_attempts
          ) VALUES (
            $1, $2, $3, $4, $5, 'pending', $6, $7, 0, $8
          )
          ON CONFLICT (idempotency_key) DO NOTHING
        `;

        for (const notif of input.notifications) {
          const notifId = notif.id || crypto.randomUUID();
          const channel = notif.channel || 'email';
          const notifType = notif.notificationType || 'anomaly_alert';
          const maxAttempts = notif.maxAttempts || 5;
          const idempotencyKey = notif.idempotencyKey || `fieldline-anomaly-alert:${notif.activityMatchId}`;

          const payloadJson =
            (notif as any).payloadJson ||
            (typeof (notif as any).payload === 'string'
              ? (notif as any).payload
              : (notif as any).payload
                ? JSON.stringify((notif as any).payload)
                : JSON.stringify({}));

          await conn.query(insertNotifSql, [
            notifId,
            notif.projectId,
            notif.activityMatchId,
            notifType,
            channel,
            payloadJson,
            idempotencyKey,
            maxAttempts
          ]);
        }
      }

      if (shouldRelease) {
        await conn.query('COMMIT');
      }

      return insertedMatches;
    } catch (err) {
      if (shouldRelease) {
        try {
          await conn.query('ROLLBACK');
        } catch {}
      }
      throw new DatabaseError(`Failed to atomically persist matches, events and notifications: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (shouldRelease) {
        conn.release();
      }
    }
  }

  async delete(id: string, projectId?: string): Promise<boolean> {
    try {
      const pool = this.getPool();
      let res;
      if (projectId) {
        res = await pool.query('DELETE FROM activity_matches WHERE id = $1 AND project_id = $2', [id, projectId]);
      } else {
        res = await pool.query('DELETE FROM activity_matches WHERE id = $1', [id]);
      }
      return (res.rowCount ?? 0) > 0;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to delete activity match: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async createMany(inputs: CreateActivityMatchInput[]): Promise<ActivityMatch[]> {
    if (!inputs || inputs.length === 0) return [];
    const pool = this.getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results: ActivityMatch[] = [];
      for (const input of inputs) {
        const item = await this.create(input, client);
        results.push(item);
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listByProgressUpdateIds(progressUpdateIds: string[], projectId: string): Promise<ActivityMatch[]> {
    if (!progressUpdateIds || progressUpdateIds.length === 0) return [];
    const pool = this.getPool();
    try {
      const res = await pool.query(
        `SELECT * FROM activity_matches WHERE project_id = $1 AND progress_update_id = ANY($2::text[]) ORDER BY created_at ASC`,
        [projectId, progressUpdateIds]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity matches by progress update IDs: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async listByActivityId(activityId: string, projectId: string): Promise<ActivityMatch[]> {
    const pool = this.getPool();
    try {
      const res = await pool.query(
        `SELECT * FROM activity_matches WHERE activity_id = $1 AND project_id = $2 ORDER BY created_at DESC`,
        [activityId, projectId]
      );
      return res.rows.map(mapRowToActivityMatch);
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to list activity matches for activity: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async confirmMatchAtomically(input: ConfirmMatchAtomicInput): Promise<ActivityMatch> {
    const pool = this.getPool();
    const client = await pool.connect();
    const eventId = crypto.randomUUID();

    try {
      await client.query('BEGIN');

      const matchRes = await client.query(
        'SELECT * FROM activity_matches WHERE id = $1 AND project_id = $2 FOR UPDATE',
        [input.id, input.projectId]
      );

      if (matchRes.rows.length === 0) {
        throw new NotFoundError(
          `Activity match with ID '${input.id}' not found for project '${input.projectId}'`
        );
      }

      const existing = matchRes.rows[0];
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

      const updateRes = await client.query(
        `
        UPDATE activity_matches
        SET
          status = 'confirmed',
          review_state = 'resolved',
          reviewed_by = $1,
          reviewed_at = $2,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND project_id = $4 AND status = 'suggested'
        RETURNING *
      `,
        [input.reviewer, input.nowIso, input.id, input.projectId]
      );

      if ((updateRes.rowCount ?? 0) === 0) {
        throw new ValidationError(
          `Failed to confirm match '${input.id}': State may have changed concurrently.`
        );
      }

      const payload = JSON.stringify({
        matchId: input.id,
        progressUpdateId: existing.progress_update_id,
        activityId: existing.activity_id,
        confidenceScore: Number(existing.confidence_score),
        confidenceTier: existing.confidence_tier,
        reviewSource: 'human',
        reviewer: input.reviewer
      });

      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        )
      `,
        [
          eventId,
          input.projectId,
          'match_confirmed',
          'activity_matches',
          input.id,
          `Activity match confirmed by reviewer '${input.reviewer}' for activity '${existing.activity_id}'`,
          payload,
          input.nowIso
        ]
      );

      await client.query('COMMIT');
      return mapRowToActivityMatch(updateRes.rows[0]);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      if (err instanceof NotFoundError || err instanceof ValidationError) {
        throw err;
      }
      throw new DatabaseError(
        `Failed to confirm activity match atomically: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      client.release();
    }
  }

  async updateMatchReview(input: UpdateMatchReviewInput): Promise<ActivityMatch | null> {
    const pool = this.getPool();
    const existing = await this.getByIdAndProjectId(input.id, input.projectId);
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

    const sql = `
      UPDATE activity_matches
      SET
        activity_id = $1,
        status = $2,
        match_method = $3,
        rationale = $4,
        review_state = $5,
        reviewed_by = $6,
        reviewed_at = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 AND project_id = $9 AND status = 'suggested'
      RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        updatedActivityId,
        input.status,
        updatedMatchMethod,
        updatedRationale,
        updatedReviewState,
        input.reviewedBy ?? null,
        input.reviewedAt ?? null,
        input.id,
        input.projectId
      ]);

      if (res.rowCount === 0) {
        throw new ValidationError(
          `Failed to update match '${input.id}': State may have changed concurrently.`
        );
      }

      return mapRowToActivityMatch(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof ValidationError) {
        throw err;
      }
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23503') {
        throw new DatabaseError(
          `Failed to update activity match review due to foreign key constraint: ${err.message}`
        );
      }
      throw new DatabaseError(
        `Failed to update activity match review: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async deleteByProgressUpdateId(progressUpdateId: string, projectId?: string): Promise<number> {
    const pool = this.getPool();
    try {
      let res;
      if (projectId) {
        res = await pool.query(
          'DELETE FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2',
          [progressUpdateId, projectId]
        );
      } else {
        res = await pool.query(
          'DELETE FROM activity_matches WHERE progress_update_id = $1',
          [progressUpdateId]
        );
      }
      return res.rowCount ?? 0;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to delete activity matches for progress update: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async deleteSuggestedByProgressUpdateId(progressUpdateId: string, projectId: string): Promise<number> {
    const pool = this.getPool();
    try {
      const res = await pool.query(
        `DELETE FROM activity_matches WHERE progress_update_id = $1 AND project_id = $2 AND status = 'suggested'`,
        [progressUpdateId, projectId]
      );
      return res.rowCount ?? 0;
    } catch (err: unknown) {
      throw new DatabaseError(
        `Failed to delete suggested activity matches for progress report: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export const postgresActivityMatchRepository = new PostgresActivityMatchRepository();
