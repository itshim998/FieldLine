import type { Pool, PoolClient } from 'pg';
import crypto from 'node:crypto';
import { getPostgresPool } from '../../database/postgres.js';
import { ConflictError, DatabaseError } from '../../errors/index.js';
import { env } from '../../config/env.js';
import type {
  CreateNotificationOutboxInput,
  NotificationChannel,
  NotificationOutboxItem,
  NotificationOutboxStatus,
  NotificationType
} from '../../services/anomaly/notification-outbox.types.js';
import type { AnomalyAlertMessage } from '../../services/anomaly/anomaly-message.types.js';
import type { NotificationOutboxRepository } from '../notification-outbox.repository.js';

interface NotificationOutboxDbRow {
  id: string;
  project_id: string;
  activity_match_id: string;
  notification_type: string;
  channel: string;
  status: string;
  payload_json: string;
  idempotency_key: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | Date | null;
  locked_at: string | Date | null;
  last_attempt_at: string | Date | null;
  delivered_at: string | Date | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toNullableIsoString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function toIsoString(val: string | Date | null | undefined, fallback?: string): string {
  if (!val) return fallback || new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function mapRowToNotificationOutbox(row: NotificationOutboxDbRow): NotificationOutboxItem {
  return {
    id: row.id,
    projectId: row.project_id,
    activityMatchId: row.activity_match_id,
    notificationType: row.notification_type as NotificationType,
    channel: row.channel as NotificationChannel,
    status: row.status as NotificationOutboxStatus,
    payloadJson: typeof row.payload_json === 'string' ? row.payload_json : JSON.stringify(row.payload_json),
    idempotencyKey: row.idempotency_key,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: toNullableIsoString(row.next_attempt_at),
    lockedAt: toNullableIsoString(row.locked_at),
    lastAttemptAt: toNullableIsoString(row.last_attempt_at),
    deliveredAt: toNullableIsoString(row.delivered_at),
    providerMessageId: row.provider_message_id,
    lastErrorCode: row.last_error_code,
    lastErrorSummary: row.last_error_summary,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

export class PostgresNotificationOutboxRepository implements NotificationOutboxRepository {
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

  async create(input: CreateNotificationOutboxInput, client?: PoolClient): Promise<NotificationOutboxItem> {
    const pool = client || this.getPool();
    const id = input.id || crypto.randomUUID();
    const notificationType = input.notificationType || 'anomaly_alert';
    const channel = input.channel || 'email';
    const idempotencyKey =
      input.idempotencyKey || `fieldline-anomaly-alert:${input.activityMatchId}`;
    const maxAttempts = input.maxAttempts ?? env.NOTIFICATION_MAX_ATTEMPTS ?? 5;
    const payloadJson =
      typeof input.payload === 'string'
        ? input.payload
        : input.payload
          ? JSON.stringify(input.payload)
          : JSON.stringify({});

    const sql = `
      INSERT INTO notification_outbox (
        id, project_id, activity_match_id, notification_type, channel,
        status, payload_json, idempotency_key, attempt_count, max_attempts
      ) VALUES (
        $1, $2, $3, $4, $5, 'pending', $6, $7, 0, $8
      ) RETURNING *
    `;

    try {
      const res = await pool.query(sql, [
        id,
        input.projectId,
        input.activityMatchId,
        notificationType,
        channel,
        payloadJson,
        idempotencyKey,
        maxAttempts
      ]);
      return mapRowToNotificationOutbox(res.rows[0]);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === '23505') {
          throw new ConflictError(
            `A notification for activity match '${input.activityMatchId}' (${channel}) or idempotency key '${idempotencyKey}' already exists`
          );
        }
      }
      throw new DatabaseError(
        `Failed to create notification outbox row: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async getById(id: string): Promise<NotificationOutboxItem | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT * FROM notification_outbox WHERE id = $1', [id]);
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch notification by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async getByActivityMatchId(
    activityMatchId: string,
    channel: NotificationChannel = 'email'
  ): Promise<NotificationOutboxItem | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM notification_outbox WHERE activity_match_id = $1 AND channel = $2',
        [activityMatchId, channel]
      );
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch notification by match ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async findByIdempotencyKey(key: string): Promise<NotificationOutboxItem | null> {
    try {
      const pool = this.getPool();
      const res = await pool.query(
        'SELECT * FROM notification_outbox WHERE idempotency_key = $1',
        [key]
      );
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to fetch notification by idempotency key: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async claimNextEligible(nowIso?: string): Promise<NotificationOutboxItem | null> {
    const pool = this.getPool();
    const effectiveNow = nowIso || new Date().toISOString();

    const sql = `
      UPDATE notification_outbox
      SET status = 'processing',
          locked_at = $1,
          last_attempt_at = $1,
          attempt_count = attempt_count + 1,
          updated_at = $1
      WHERE id = (
        SELECT id FROM notification_outbox
        WHERE (status = 'pending' OR (status = 'retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at <= $1)))
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    try {
      const res = await pool.query(sql, [effectiveNow]);
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to claim next eligible notification: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async claimById(id: string, nowIso?: string): Promise<NotificationOutboxItem | null> {
    const pool = this.getPool();
    const effectiveNow = nowIso || new Date().toISOString();

    const sql = `
      UPDATE notification_outbox
      SET status = 'processing',
          locked_at = $1,
          last_attempt_at = $1,
          attempt_count = attempt_count + 1,
          updated_at = $1
      WHERE id = (
        SELECT id FROM notification_outbox
        WHERE id = $2 AND status IN ('pending', 'retry_wait')
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `;

    try {
      const res = await pool.query(sql, [effectiveNow, id]);
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to claim notification by ID: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async saveMessageSnapshot(id: string, message: AnomalyAlertMessage): Promise<NotificationOutboxItem | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(existing.payloadJson);
    } catch {
      payload = {};
    }

    payload.message = message;
    const newPayloadJson = JSON.stringify(payload);
    const now = new Date().toISOString();

    try {
      const pool = this.getPool();
      const res = await pool.query(
        `
        UPDATE notification_outbox
        SET payload_json = $1, updated_at = $2
        WHERE id = $3
        RETURNING *
      `,
        [newPayloadJson, now, id]
      );
      return res.rows.length > 0 ? mapRowToNotificationOutbox(res.rows[0]) : null;
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to save message snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async markDelivered(id: string, providerMessageId?: string): Promise<NotificationOutboxItem | null> {
    const pool = this.getPool();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      const existingRes = await client.query('SELECT * FROM notification_outbox WHERE id = $1 FOR UPDATE', [id]);
      if (existingRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const existing = existingRes.rows[0];

      const updateRes = await client.query(
        `
        UPDATE notification_outbox
        SET status = 'delivered',
            delivered_at = $1,
            locked_at = NULL,
            provider_message_id = $2,
            updated_at = $1
        WHERE id = $3
        RETURNING *
      `,
        [now, providerMessageId || null, id]
      );

      // Record audit event in project_events
      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES ($1, $2, 'notification_delivery_succeeded', 'notification_outbox', $3, $4, $5, $6)
      `,
        [
          crypto.randomUUID(),
          existing.project_id,
          id,
          `Anomaly alert email delivered successfully (${existing.channel})`,
          JSON.stringify({
            notificationId: id,
            activityMatchId: existing.activity_match_id,
            providerMessageId: providerMessageId || null,
            attemptCount: existing.attempt_count
          }),
          now
        ]
      );

      await client.query('COMMIT');
      return mapRowToNotificationOutbox(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError(`Failed to mark notification delivered: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async scheduleRetry(
    id: string,
    errorCode: string,
    errorSummary: string,
    nextAttemptAt: string
  ): Promise<NotificationOutboxItem | null> {
    const pool = this.getPool();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      const existingRes = await client.query('SELECT * FROM notification_outbox WHERE id = $1 FOR UPDATE', [id]);
      if (existingRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const existing = existingRes.rows[0];

      const updateRes = await client.query(
        `
        UPDATE notification_outbox
        SET status = 'retry_wait',
            locked_at = NULL,
            last_error_code = $1,
            last_error_summary = $2,
            next_attempt_at = $3,
            updated_at = $4
        WHERE id = $5
        RETURNING *
      `,
        [errorCode, errorSummary, nextAttemptAt, now, id]
      );

      // Record audit event in project_events
      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES ($1, $2, 'notification_retry_scheduled', 'notification_outbox', $3, $4, $5, $6)
      `,
        [
          crypto.randomUUID(),
          existing.project_id,
          id,
          `Anomaly notification retry scheduled for ${nextAttemptAt}: ${errorCode}`,
          JSON.stringify({
            notificationId: id,
            activityMatchId: existing.activity_match_id,
            attemptCount: existing.attempt_count,
            nextAttemptAt,
            errorCode,
            errorSummary
          }),
          now
        ]
      );

      await client.query('COMMIT');
      return mapRowToNotificationOutbox(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError(`Failed to schedule notification retry: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async markFailed(id: string, errorCode: string, errorSummary: string): Promise<NotificationOutboxItem | null> {
    const pool = this.getPool();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      const existingRes = await client.query('SELECT * FROM notification_outbox WHERE id = $1 FOR UPDATE', [id]);
      if (existingRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const existing = existingRes.rows[0];

      const updateRes = await client.query(
        `
        UPDATE notification_outbox
        SET status = 'failed',
            locked_at = NULL,
            last_error_code = $1,
            last_error_summary = $2,
            updated_at = $3
        WHERE id = $4
        RETURNING *
      `,
        [errorCode, errorSummary, now, id]
      );

      await client.query(
        `
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES ($1, $2, 'notification_delivery_failed', 'notification_outbox', $3, $4, $5, $6)
      `,
        [
          crypto.randomUUID(),
          existing.project_id,
          id,
          `Anomaly notification delivery permanently failed: ${errorCode}`,
          JSON.stringify({
            notificationId: id,
            activityMatchId: existing.activity_match_id,
            attemptCount: existing.attempt_count,
            errorCode,
            errorSummary
          }),
          now
        ]
      );

      await client.query('COMMIT');
      return mapRowToNotificationOutbox(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError(`Failed to mark notification failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async requeueStaleProcessing(leaseTimeoutMs: number = 5 * 60 * 1000, nowIso?: string): Promise<number> {
    const pool = this.getPool();
    const client = await pool.connect();
    const effectiveNow = nowIso || new Date().toISOString();
    const cutoffTime = new Date(new Date(effectiveNow).getTime() - leaseTimeoutMs).toISOString();

    try {
      await client.query('BEGIN');

      const staleRes = await client.query(
        `
        SELECT * FROM notification_outbox
        WHERE status = 'processing'
          AND (locked_at IS NULL OR locked_at < $1)
        FOR UPDATE
      `,
        [cutoffTime]
      );

      let recovered = 0;

      for (const row of staleRes.rows) {
        if (Number(row.attempt_count) >= Number(row.max_attempts)) {
          await client.query(
            `
            UPDATE notification_outbox
            SET status = 'failed',
                locked_at = NULL,
                last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
                last_error_summary = 'Processing lease expired and maximum attempts reached',
                updated_at = $1
            WHERE id = $2
          `,
            [effectiveNow, row.id]
          );

          await client.query(
            `
            INSERT INTO project_events (
              id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
            ) VALUES ($1, $2, 'notification_delivery_failed', 'notification_outbox', $3, $4, $5, $6)
          `,
            [
              crypto.randomUUID(),
              row.project_id,
              row.id,
              `Notification ${row.id.slice(0, 8)} failed due to expired lease and max attempts`,
              JSON.stringify({
                notificationId: row.id,
                attemptCount: row.attempt_count
              }),
              effectiveNow
            ]
          );
        } else {
          await client.query(
            `
            UPDATE notification_outbox
            SET status = 'retry_wait',
                locked_at = NULL,
                last_error_code = 'LEASE_EXPIRED_REQUEUED',
                last_error_summary = 'Processing lease expired; reset to retry_wait for recovery',
                next_attempt_at = $1,
                updated_at = $1
            WHERE id = $2
          `,
            [effectiveNow, row.id]
          );

          await client.query(
            `
            INSERT INTO project_events (
              id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
            ) VALUES ($1, $2, 'notification_lease_recovered', 'notification_outbox', $3, $4, $5, $6)
          `,
            [
              crypto.randomUUID(),
              row.project_id,
              row.id,
              `Notification ${row.id.slice(0, 8)} recovered from stale processing lease`,
              JSON.stringify({
                notificationId: row.id,
                previousLockedAt: row.locked_at,
                recoveredAt: effectiveNow,
                attemptCount: row.attempt_count
              }),
              effectiveNow
            ]
          );
        }
        recovered++;
      }

      await client.query('COMMIT');
      return recovered;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new DatabaseError(`Failed to requeue stale processing notifications: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }

  async listByProject(
    projectId: string,
    options?: { status?: NotificationOutboxStatus; limit?: number }
  ): Promise<NotificationOutboxItem[]> {
    try {
      const pool = this.getPool();
      let sql = 'SELECT * FROM notification_outbox WHERE project_id = $1';
      const params: unknown[] = [projectId];
      let pIdx = 2;

      if (options?.status) {
        sql += ` AND status = $${pIdx++}`;
        params.push(options.status);
      }

      sql += ' ORDER BY created_at DESC';
      if (options?.limit) {
        sql += ` LIMIT $${pIdx++}`;
        params.push(options.limit);
      }

      const res = await pool.query(sql, params);
      return res.rows.map(mapRowToNotificationOutbox);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to list notifications: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async count(projectId?: string, status?: NotificationOutboxStatus): Promise<number> {
    try {
      const pool = this.getPool();
      let sql = 'SELECT COUNT(*) as count FROM notification_outbox WHERE 1=1';
      const params: unknown[] = [];
      let pIdx = 1;

      if (projectId) {
        sql += ` AND project_id = $${pIdx++}`;
        params.push(projectId);
      }
      if (status) {
        sql += ` AND status = $${pIdx++}`;
        params.push(status);
      }

      const res = await pool.query(sql, params);
      return parseInt(res.rows[0].count, 10);
    } catch (err: unknown) {
      throw new DatabaseError(`Failed to count notifications: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const postgresNotificationOutboxRepository = new PostgresNotificationOutboxRepository();
