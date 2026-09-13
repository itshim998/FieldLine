import { logger } from '../../config/logger.js';
import {
  NotificationOutboxRepository,
  notificationOutboxRepository as defaultOutboxRepo
} from '../../repositories/notification-outbox.repository.js';
import {
  defaultAnomalyMessageGeneratorService
} from './anomaly-message-generator.service.js';
import type {
  AnomalyAlertMessage,
  AnomalyMessageGeneratorService
} from './anomaly-message.types.js';
import {
  EmailDeliveryService
} from './email/email-delivery.types.js';
import { resendEmailDeliveryService } from './email/resend-email-delivery.service.js';
import type {
  NotificationOutboxItem,
  NotificationOutboxPayload
} from './notification-outbox.types.js';
import {
  calculateNextAttemptAt,
  isRetryableDeliveryError
} from './retry-policy.js';

export interface NotificationWorkerDependencies {
  outboxRepo?: NotificationOutboxRepository;
  messageGenerator?: AnomalyMessageGeneratorService;
  emailDeliveryService?: EmailDeliveryService;
  backoffDelaysMs?: number[];
}

export class NotificationWorker {
  private outboxRepo: NotificationOutboxRepository;
  private messageGenerator: AnomalyMessageGeneratorService;
  private emailDeliveryService: EmailDeliveryService;
  private backoffDelaysMs?: number[];

  constructor(dependencies?: NotificationWorkerDependencies) {
    this.outboxRepo = dependencies?.outboxRepo || defaultOutboxRepo;
    this.messageGenerator =
      dependencies?.messageGenerator || defaultAnomalyMessageGeneratorService;
    this.emailDeliveryService =
      dependencies?.emailDeliveryService || resendEmailDeliveryService;
    this.backoffDelaysMs = dependencies?.backoffDelaysMs;
  }

  /**
   * Processes a single claimed outbox item through message snapshotting,
   * delivery adapter dispatch, and state transition.
   *
   * Invariants:
   * 1. Groq message generation occurs at most ONCE per notification.
   * 2. Retries reuse the exact immutable message snapshot.
   * 3. Retries use the exact deterministic Resend idempotency key.
   * 4. Anomaly detection truth is never mutated or deleted on failure.
   */
  async processNotification(item: NotificationOutboxItem): Promise<boolean> {
    try {
      let payload: NotificationOutboxPayload;
      try {
        payload = JSON.parse(item.payloadJson) as NotificationOutboxPayload;
      } catch (parseErr) {
        logger.error(`NotificationWorker: Malformed payload in notification ${item.id}`, parseErr);
        this.outboxRepo.markFailed(
          item.id,
          'MALFORMED_PAYLOAD',
          `Cannot parse payload JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
        );
        return false;
      }

      // Step 1: Ensure immutable message snapshot exists (Groq called ONCE only)
      let alertMessage: AnomalyAlertMessage | null | undefined = payload.message;
      if (!alertMessage) {
        logger.debug(
          `NotificationWorker: Generating Phase 2 AnomalyAlertMessage snapshot for notification ${item.id}`
        );
        alertMessage = await this.messageGenerator.generateAnomalyMessage(payload.messageInput);

        if (!alertMessage) {
          await (this.outboxRepo.markFailed(
            item.id,
            'MESSAGE_GENERATION_FAILED',
            'Failed to generate anomaly alert message'
          ) as any);
          return false;
        }

        // Snapshot so all subsequent retries reuse this exact payload
        await (this.outboxRepo.saveMessageSnapshot(item.id, alertMessage) as any);
        payload.message = alertMessage;
      } else {
        logger.debug(
          `NotificationWorker: Reusing existing message snapshot for notification ${item.id} (attempt ${item.attemptCount})`
        );
      }

      // Step 2: Deliver via configured delivery adapter (e.g. Resend HTTPS)
      const deliveryResult = await this.emailDeliveryService.sendAnomalyAlert(alertMessage);

      // Step 3: Handle result
      if (deliveryResult.sent) {
        logger.info(
          `NotificationWorker: Notification ${item.id} delivered successfully. Provider message ID: ${deliveryResult.providerMessageId || 'acknowledged'}`
        );
        await (this.outboxRepo.markDelivered(item.id, deliveryResult.providerMessageId) as any);
        return true;
      }

      // Step 4: Handle failure — classify retryable vs permanent
      const errorCode = deliveryResult.errorCode || 'DELIVERY_FAILED';
      const errorSummary = deliveryResult.errorSummary || 'Outbound email delivery failed';
      const isRetryable = isRetryableDeliveryError(errorCode);

      if (isRetryable && item.attemptCount < item.maxAttempts) {
        const nextAttemptAt = calculateNextAttemptAt(item.attemptCount, this.backoffDelaysMs);
        logger.warn(
          `NotificationWorker: Temporary delivery failure for notification ${item.id} (${errorCode}). Retrying at ${nextAttemptAt}. Attempt ${item.attemptCount}/${item.maxAttempts}.`
        );
        await (this.outboxRepo.scheduleRetry(item.id, errorCode, errorSummary, nextAttemptAt) as any);
        return false;
      }

      // Permanent failure or max attempts reached
      const finalCode = item.attemptCount >= item.maxAttempts ? 'MAX_ATTEMPTS_EXCEEDED' : errorCode;
      const finalSummary =
        item.attemptCount >= item.maxAttempts
          ? `Delivery failed after ${item.attemptCount} attempts. Last error: ${errorSummary}`
          : errorSummary;

      logger.error(
        `NotificationWorker: Permanent delivery failure for notification ${item.id} (${finalCode}): ${finalSummary}`
      );
      await (this.outboxRepo.markFailed(item.id, finalCode, finalSummary) as any);
      return false;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`NotificationWorker: Unexpected exception processing notification ${item.id}: ${errMsg}`, err);

      const isRetryable = isRetryableDeliveryError('UNEXPECTED_ERROR');
      if (isRetryable && item.attemptCount < item.maxAttempts) {
        const nextAttemptAt = calculateNextAttemptAt(item.attemptCount, this.backoffDelaysMs);
        this.outboxRepo.scheduleRetry(item.id, 'UNEXPECTED_ERROR', errMsg, nextAttemptAt);
      } else {
        this.outboxRepo.markFailed(item.id, 'UNEXPECTED_ERROR', errMsg);
      }
      return false;
    }
  }

  /**
   * Claims and processes the next eligible pending/retry_wait notification.
   * Returns true if a notification was claimed and processed, false if none found.
   */
  async processNextNotification(): Promise<boolean> {
    const claimed = this.outboxRepo.claimNextEligible();
    if (!claimed) {
      return false;
    }

    await this.processNotification(claimed);
    return true;
  }

  /**
   * Iterates through pending eligible notifications up to maxBatch.
   */
  async processPendingNotifications(maxBatch: number = 50): Promise<number> {
    let count = 0;
    while (count < maxBatch) {
      const processed = await this.processNextNotification();
      if (!processed) break;
      count++;
    }
    return count;
  }

  /**
   * Recovers stale in-progress leases from process crashes or timeouts.
   */
  requeueStaleNotifications(leaseTimeoutMs?: number): number {
    return this.outboxRepo.requeueStaleProcessing(leaseTimeoutMs);
  }
}

export const notificationWorker = new NotificationWorker();
