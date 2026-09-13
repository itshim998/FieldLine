import crypto from 'node:crypto';
import { Database as DatabaseType } from 'better-sqlite3';
import { getDatabase } from '../database/db.js';
import { ConflictError, DatabaseError } from '../errors/index.js';
import { env } from '../config/env.js';
import type {
  CreateNotificationOutboxInput,
  NotificationChannel,
  NotificationOutboxItem,
  NotificationOutboxStatus,
  NotificationType
} from '../services/anomaly/notification-outbox.types.js';
import type { AnomalyAlertMessage } from '../services/anomaly/anomaly-message.types.js';

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
  next_attempt_at: string | null;
  locked_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToNotificationOutbox(row: NotificationOutboxDbRow): NotificationOutboxItem {
  return {
    id: row.id,
    projectId: row.project_id,
    activityMatchId: row.activity_match_id,
    notificationType: row.notification_type as NotificationType,
    channel: row.channel as NotificationChannel,
    status: row.status as NotificationOutboxStatus,
    payloadJson: row.payload_json,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lastAttemptAt: row.last_attempt_at,
    deliveredAt: row.delivered_at,
    providerMessageId: row.provider_message_id,
    lastErrorCode: row.last_error_code,
    lastErrorSummary: row.last_error_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

import { MaybePromise } from '../database/provider.js';

export interface NotificationOutboxRepository {
  create(input: CreateNotificationOutboxInput): MaybePromise<NotificationOutboxItem>;
  getById(id: string): MaybePromise<NotificationOutboxItem | null>;
  getByActivityMatchId(activityMatchId: string, channel?: NotificationChannel): MaybePromise<NotificationOutboxItem | null>;
  findByIdempotencyKey(key: string): MaybePromise<NotificationOutboxItem | null>;
  claimNextEligible(nowIso?: string): MaybePromise<NotificationOutboxItem | null>;
  claimById(id: string, nowIso?: string): MaybePromise<NotificationOutboxItem | null>;
  saveMessageSnapshot(id: string, message: AnomalyAlertMessage): MaybePromise<NotificationOutboxItem | null>;
  markDelivered(id: string, providerMessageId?: string): MaybePromise<NotificationOutboxItem | null>;
  scheduleRetry(id: string, errorCode: string, errorSummary: string, nextAttemptAt: string): MaybePromise<NotificationOutboxItem | null>;
  markFailed(id: string, errorCode: string, errorSummary: string): MaybePromise<NotificationOutboxItem | null>;
  requeueStaleProcessing(leaseTimeoutMs?: number, nowIso?: string): MaybePromise<number>;
  listByProject(projectId: string, options?: { status?: NotificationOutboxStatus; limit?: number }): MaybePromise<NotificationOutboxItem[]>;
  count(projectId?: string, status?: NotificationOutboxStatus): MaybePromise<number>;
  runInTransaction?<T>(fn: () => MaybePromise<T>): MaybePromise<T>;
}

export class SqliteNotificationOutboxRepository implements NotificationOutboxRepository {
  private getDb: () => DatabaseType;

  constructor(dbProvider?: () => DatabaseType) {
    this.getDb = dbProvider || getDatabase;
  }

  create(input: CreateNotificationOutboxInput): NotificationOutboxItem {
    const db = this.getDb();
    const id = input.id || crypto.randomUUID();
    const notificationType = input.notificationType || 'anomaly_alert';
    const channel = input.channel || 'email';
    const idempotencyKey =
      input.idempotencyKey || `fieldline-anomaly-alert:${input.activityMatchId}`;
    const maxAttempts = input.maxAttempts ?? env.NOTIFICATION_MAX_ATTEMPTS ?? 5;
    const payloadJson = JSON.stringify(input.payload);

    const insertStmt = db.prepare(`
      INSERT INTO notification_outbox (
        id, project_id, activity_match_id, notification_type, channel,
        status, payload_json, idempotency_key, attempt_count, max_attempts
      ) VALUES (
        ?, ?, ?, ?, ?, 'pending', ?, ?, 0, ?
      )
    `);

    try {
      insertStmt.run(
        id,
        input.projectId,
        input.activityMatchId,
        notificationType,
        channel,
        payloadJson,
        idempotencyKey,
        maxAttempts
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          throw new ConflictError(`Notification with ID '${id}' already exists`);
        }
        if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new ConflictError(
            `A notification for activity match '${input.activityMatchId}' (${channel}) or idempotency key '${idempotencyKey}' already exists`
          );
        }
      }
      throw new DatabaseError(
        `Failed to create notification outbox row: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const created = this.getById(id);
    if (!created) {
      throw new DatabaseError('Failed to retrieve newly created notification outbox row');
    }
    return created;
  }

  getById(id: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT * FROM notification_outbox WHERE id = ?')
      .get(id) as NotificationOutboxDbRow | undefined;
    return row ? mapRowToNotificationOutbox(row) : null;
  }

  getByActivityMatchId(
    activityMatchId: string,
    channel: NotificationChannel = 'email'
  ): NotificationOutboxItem | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT * FROM notification_outbox WHERE activity_match_id = ? AND channel = ?')
      .get(activityMatchId, channel) as NotificationOutboxDbRow | undefined;
    return row ? mapRowToNotificationOutbox(row) : null;
  }

  findByIdempotencyKey(key: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const row = db
      .prepare('SELECT * FROM notification_outbox WHERE idempotency_key = ?')
      .get(key) as NotificationOutboxDbRow | undefined;
    return row ? mapRowToNotificationOutbox(row) : null;
  }

  claimNextEligible(nowIso?: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const effectiveNow = nowIso || new Date().toISOString();

    return db.transaction(() => {
      const row = db
        .prepare(`
          SELECT * FROM notification_outbox
          WHERE (status = 'pending' OR (status = 'retry_wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)))
          ORDER BY created_at ASC, rowid ASC
          LIMIT 1
        `)
        .get(effectiveNow) as NotificationOutboxDbRow | undefined;

      if (!row) {
        return null;
      }

      const updateStmt = db.prepare(`
        UPDATE notification_outbox
        SET status = 'processing',
            locked_at = ?,
            last_attempt_at = ?,
            attempt_count = attempt_count + 1,
            updated_at = ?
        WHERE id = ? AND status IN ('pending', 'retry_wait')
      `);

      const res = updateStmt.run(effectiveNow, effectiveNow, effectiveNow, row.id);
      if (res.changes === 0) {
        return null;
      }

      const updatedRow = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(row.id) as NotificationOutboxDbRow;
      return mapRowToNotificationOutbox(updatedRow);
    })();
  }

  claimById(id: string, nowIso?: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const effectiveNow = nowIso || new Date().toISOString();

    return db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE notification_outbox
        SET status = 'processing',
            locked_at = ?,
            last_attempt_at = ?,
            attempt_count = attempt_count + 1,
            updated_at = ?
        WHERE id = ? AND status IN ('pending', 'retry_wait')
      `);

      const res = updateStmt.run(effectiveNow, effectiveNow, effectiveNow, id);
      if (res.changes === 0) {
        return null;
      }

      const updatedRow = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow;
      return mapRowToNotificationOutbox(updatedRow);
    })();
  }

  saveMessageSnapshot(id: string, message: AnomalyAlertMessage): NotificationOutboxItem | null {
    const db = this.getDb();
    const existing = this.getById(id);
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

    db.prepare(`
      UPDATE notification_outbox
      SET payload_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newPayloadJson, now, id);

    return this.getById(id);
  }

  markDelivered(id: string, providerMessageId?: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const now = new Date().toISOString();

    return db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow | undefined;
      if (!existing) return null;

      db.prepare(`
        UPDATE notification_outbox
        SET status = 'delivered',
            delivered_at = ?,
            locked_at = NULL,
            provider_message_id = ?,
            updated_at = ?
        WHERE id = ?
      `).run(now, providerMessageId || null, now, id);

      // Record audit event in project_events
      db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (?, ?, 'notification_delivery_succeeded', 'notification_outbox', ?, ?, ?, ?)
      `).run(
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
      );

      const updatedRow = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow;
      return mapRowToNotificationOutbox(updatedRow);
    })();
  }

  scheduleRetry(
    id: string,
    errorCode: string,
    errorSummary: string,
    nextAttemptAt: string
  ): NotificationOutboxItem | null {
    const db = this.getDb();
    const now = new Date().toISOString();

    return db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow | undefined;
      if (!existing) return null;

      db.prepare(`
        UPDATE notification_outbox
        SET status = 'retry_wait',
            locked_at = NULL,
            last_error_code = ?,
            last_error_summary = ?,
            next_attempt_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(errorCode, errorSummary, nextAttemptAt, now, id);

      // Record audit event in project_events
      db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (?, ?, 'notification_retry_scheduled', 'notification_outbox', ?, ?, ?, ?)
      `).run(
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
      );

      const updatedRow = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow;
      return mapRowToNotificationOutbox(updatedRow);
    })();
  }

  markFailed(id: string, errorCode: string, errorSummary: string): NotificationOutboxItem | null {
    const db = this.getDb();
    const now = new Date().toISOString();

    return db.transaction(() => {
      const existing = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow | undefined;
      if (!existing) return null;

      db.prepare(`
        UPDATE notification_outbox
        SET status = 'failed',
            locked_at = NULL,
            last_error_code = ?,
            last_error_summary = ?,
            updated_at = ?
        WHERE id = ?
      `).run(errorCode, errorSummary, now, id);

      // Record audit event in project_events
      db.prepare(`
        INSERT INTO project_events (
          id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
        ) VALUES (?, ?, 'notification_delivery_failed', 'notification_outbox', ?, ?, ?, ?)
      `).run(
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
      );

      const updatedRow = db
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(id) as NotificationOutboxDbRow;
      return mapRowToNotificationOutbox(updatedRow);
    })();
  }

  requeueStaleProcessing(leaseTimeoutMs: number = 5 * 60 * 1000, nowIso?: string): number {
    const db = this.getDb();
    const effectiveNow = nowIso || new Date().toISOString();
    const cutoffTime = new Date(new Date(effectiveNow).getTime() - leaseTimeoutMs).toISOString();

    return db.transaction(() => {
      // 1. Fetch all rows in processing that have timed out
      const staleRows = db
        .prepare(`
          SELECT * FROM notification_outbox
          WHERE status = 'processing'
            AND (locked_at IS NULL OR locked_at < ?)
        `)
        .all(cutoffTime) as NotificationOutboxDbRow[];

      let recovered = 0;

      for (const row of staleRows) {
        if (row.attempt_count >= row.max_attempts) {
          // Exceeded max attempts -> permanent failure
          db.prepare(`
            UPDATE notification_outbox
            SET status = 'failed',
                locked_at = NULL,
                last_error_code = 'LEASE_EXPIRED_MAX_ATTEMPTS',
                last_error_summary = 'Processing lease expired and maximum attempts reached',
                updated_at = ?
            WHERE id = ?
          `).run(effectiveNow, row.id);

          db.prepare(`
            INSERT INTO project_events (
              id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
            ) VALUES (?, ?, 'notification_delivery_failed', 'notification_outbox', ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            row.project_id,
            row.id,
            `Notification ${row.id.slice(0, 8)} failed due to expired lease and max attempts`,
            JSON.stringify({
              notificationId: row.id,
              attemptCount: row.attempt_count
            }),
            effectiveNow
          );
        } else {
          // Return to retry_wait state
          db.prepare(`
            UPDATE notification_outbox
            SET status = 'retry_wait',
                locked_at = NULL,
                next_attempt_at = ?,
                updated_at = ?
            WHERE id = ?
          `).run(effectiveNow, effectiveNow, row.id);

          db.prepare(`
            INSERT INTO project_events (
              id, project_id, event_type, entity_type, entity_id, summary, payload_json, created_at
            ) VALUES (?, ?, 'notification_retry_scheduled', 'notification_outbox', ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            row.project_id,
            row.id,
            `Stale notification lease recovered; returned to retry queue`,
            JSON.stringify({
              notificationId: row.id,
              attemptCount: row.attempt_count
            }),
            effectiveNow
          );
        }
        recovered++;
      }

      return recovered;
    })();
  }

  listByProject(
    projectId: string,
    options?: { status?: NotificationOutboxStatus; limit?: number }
  ): NotificationOutboxItem[] {
    const db = this.getDb();
    let query = 'SELECT * FROM notification_outbox WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (options?.status) {
      query += ' AND status = ?';
      params.push(options.status);
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = db.prepare(query).all(...params) as NotificationOutboxDbRow[];
    return rows.map(mapRowToNotificationOutbox);
  }

  count(projectId?: string, status?: NotificationOutboxStatus): number {
    const db = this.getDb();
    let query = 'SELECT COUNT(*) as c FROM notification_outbox WHERE 1=1';
    const params: string[] = [];

    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    const row = db.prepare(query).get(...params) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  runInTransaction<T>(fn: () => T): T {
    const db = this.getDb();
    return db.transaction(fn)();
  }
}

export const sqliteNotificationOutboxRepository: NotificationOutboxRepository =
  new SqliteNotificationOutboxRepository();

import { PostgresNotificationOutboxRepository } from './postgres/postgres-notification-outbox.repository.js';

let _postgresNotificationOutboxRepoInstance: PostgresNotificationOutboxRepository | null = null;
export function getPostgresNotificationOutboxRepository(): PostgresNotificationOutboxRepository {
  if (!_postgresNotificationOutboxRepoInstance) {
    _postgresNotificationOutboxRepoInstance = new PostgresNotificationOutboxRepository();
  }
  return _postgresNotificationOutboxRepoInstance;
}

export const notificationOutboxRepository: NotificationOutboxRepository = new Proxy(Object.create(sqliteNotificationOutboxRepository) as NotificationOutboxRepository, {
  get(target, prop, receiver) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) {
      return Reflect.get(target, prop, receiver);
    }
    const activeRepo: any = env.DATABASE_PROVIDER === 'postgres' ? getPostgresNotificationOutboxRepository() : sqliteNotificationOutboxRepository;
    const val = Reflect.get(activeRepo, prop, receiver);
    if (typeof val === 'function') {
      return val.bind(activeRepo);
    }
    return val;
  }
});
