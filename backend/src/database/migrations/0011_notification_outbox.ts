import { Database as DatabaseType } from 'better-sqlite3';

export const name = '0011_notification_outbox';

function tableExists(db: DatabaseType, tableName: string): boolean {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return row !== undefined;
}

/**
 * Migration 0011: Creates the dedicated notification_outbox table.
 *
 * Provides durable state, atomic persistence, logical idempotency, safe lease claiming,
 * bounded retry backoff, and delivery traceability for FieldLine anomaly notifications.
 *
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * 1. Durable Intent: notification_outbox records the server's intent to notify.
 * 2. Logical Idempotency: (project_id, activity_match_id, notification_type, channel) is unique.
 * 3. Atomic Outbox Persistence: created in the exact same SQLite transaction as the anomaly match.
 * 4. Offline & Secret Safety: no API secrets or auth tokens are stored in payload or errors.
 */
export function up(db: DatabaseType): void {
  if (!tableExists(db, 'notification_outbox')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_outbox (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        activity_match_id TEXT NOT NULL REFERENCES activity_matches(id) ON DELETE CASCADE,
        notification_type TEXT NOT NULL CHECK (notification_type IN ('anomaly_alert')),
        channel TEXT NOT NULL CHECK (channel IN ('email')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'retry_wait', 'delivered', 'failed')),
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at TEXT,
        locked_at TEXT,
        last_attempt_at TEXT,
        delivered_at TEXT,
        provider_message_id TEXT,
        last_error_code TEXT,
        last_error_summary TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (project_id, activity_match_id, notification_type, channel)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_idempotency
        ON notification_outbox(idempotency_key);

      CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_next_attempt
        ON notification_outbox(status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_notification_outbox_project_created
        ON notification_outbox(project_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_notification_outbox_activity_match
        ON notification_outbox(activity_match_id);
    `);
  }
}
