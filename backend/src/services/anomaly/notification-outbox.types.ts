import type { AnomalyAlertMessage, GenerateAnomalyMessageInput } from './anomaly-message.types.js';

export type NotificationOutboxStatus =
  | 'pending'
  | 'processing'
  | 'retry_wait'
  | 'delivered'
  | 'failed';

export type NotificationType = 'anomaly_alert';

export type NotificationChannel = 'email';

/**
 * Immutable factual payload stored in notification_outbox.payload_json.
 * Preserves the exact server-owned anomaly inputs, and once generated, the
 * exact Phase 2 AnomalyAlertMessage snapshot reused across all delivery attempts.
 */
export interface NotificationOutboxPayload {
  messageInput: GenerateAnomalyMessageInput;
  message?: AnomalyAlertMessage | null;
}

/**
 * Authoritative domain model representing a row in the notification_outbox table.
 */
export interface NotificationOutboxItem {
  id: string;
  projectId: string;
  activityMatchId: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  status: NotificationOutboxStatus;
  payloadJson: string;
  idempotencyKey: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt?: string | null;
  lockedAt?: string | null;
  lastAttemptAt?: string | null;
  deliveredAt?: string | null;
  providerMessageId?: string | null;
  lastErrorCode?: string | null;
  lastErrorSummary?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input for creating a durable notification outbox entry.
 */
export interface CreateNotificationOutboxInput {
  id?: string;
  projectId: string;
  activityMatchId: string;
  notificationType?: NotificationType;
  channel?: NotificationChannel;
  payload: NotificationOutboxPayload;
  idempotencyKey?: string;
  maxAttempts?: number;
}
