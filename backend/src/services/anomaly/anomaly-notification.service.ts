import { logger } from '../../config/logger.js';
import { AnomalyPrediction } from '../../ml/types.js';
import {
  AnomalyAlertMessage,
  AnomalyMessageGeneratorService,
  AdaptAnomalyEvaluationOptions,
  isEligibleForAnomalyAlert,
  toAnomalyMessageInput
} from './anomaly-message.types.js';
import { defaultAnomalyMessageGeneratorService } from './anomaly-message-generator.service.js';
import { EmailDeliveryResult, EmailDeliveryService } from './email/email-delivery.types.js';
import { resendEmailDeliveryService } from './email/resend-email-delivery.service.js';
import {
  NotificationOutboxRepository,
  notificationOutboxRepository as defaultOutboxRepo
} from '../../repositories/notification-outbox.repository.js';
import {
  NotificationWorker,
  notificationWorker as defaultWorker
} from './notification.worker.js';
import type {
  NotificationOutboxItem,
  NotificationOutboxPayload
} from './notification-outbox.types.js';

export interface NotifyAnomalyAlertInput {
  prediction: AnomalyPrediction | null | undefined;
  context: AdaptAnomalyEvaluationOptions;
}

export interface NotifyAnomalyAlertResult {
  message: AnomalyAlertMessage | null;
  delivery: EmailDeliveryResult | null;
  outboxItem?: NotificationOutboxItem | null;
}

export interface AnomalyNotificationServiceDependencies {
  messageGeneratorService?: AnomalyMessageGeneratorService;
  emailDeliveryService?: EmailDeliveryService;
  outboxRepo?: NotificationOutboxRepository;
  notificationWorker?: NotificationWorker;
}

export interface AnomalyNotificationService {
  /**
   * Evaluates eligibility, ensures durable outbox persistence, and executes delivery.
   * Invariant: Never throws an unhandled error that interrupts the caller.
   */
  notifyAnomalyAlert(input: NotifyAnomalyAlertInput): Promise<NotifyAnomalyAlertResult>;

  /**
   * Directly dispatches an existing AnomalyAlertMessage to the delivery channel.
   */
  dispatchAlertMessage(message: AnomalyAlertMessage): Promise<EmailDeliveryResult>;

  /**
   * Records notification intent into the outbox idempotently without delivering immediately.
   */
  recordNotificationIntent(input: NotifyAnomalyAlertInput): NotificationOutboxItem | null;
}

/**
 * Phase 4 AnomalyNotificationService:
 * Coordinates durable outbox persistence, deterministic idempotency, single message generation,
 * and reliable retry scheduling.
 */
export class DefaultAnomalyNotificationService implements AnomalyNotificationService {
  private messageGeneratorService: AnomalyMessageGeneratorService;
  private emailDeliveryService: EmailDeliveryService;
  private outboxRepo: NotificationOutboxRepository;
  private notificationWorker: NotificationWorker;

  constructor(dependencies?: AnomalyNotificationServiceDependencies) {
    this.messageGeneratorService =
      dependencies?.messageGeneratorService || defaultAnomalyMessageGeneratorService;
    this.emailDeliveryService =
      dependencies?.emailDeliveryService || resendEmailDeliveryService;
    this.outboxRepo = dependencies?.outboxRepo || defaultOutboxRepo;
    this.notificationWorker =
      dependencies?.notificationWorker ||
      new NotificationWorker({
        outboxRepo: this.outboxRepo,
        messageGenerator: this.messageGeneratorService,
        emailDeliveryService: this.emailDeliveryService
      });
  }

  recordNotificationIntent(input: NotifyAnomalyAlertInput): NotificationOutboxItem | null {
    const { prediction, context } = input;
    if (!isEligibleForAnomalyAlert(prediction)) {
      return null;
    }

    // Critical Invariant: Must have authoritative activityMatchId AND authoritative projectId.
    // Never fabricate synthetic IDs, never use projectName as projectId.
    if (!context.activityMatchId || !context.projectId) {
      logger.warn(
        `AnomalyNotificationService: recordNotificationIntent skipped due to missing authoritative relational identity (projectId='${context.projectId}', activityMatchId='${context.activityMatchId}')`
      );
      return null;
    }

    const messageInput = toAnomalyMessageInput(prediction, context);
    if (!messageInput) {
      return null;
    }

    const existing = this.outboxRepo.getByActivityMatchId(context.activityMatchId, 'email');
    if (existing) {
      return existing;
    }

    try {
      return this.outboxRepo.create({
        projectId: context.projectId,
        activityMatchId: context.activityMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: {
          messageInput,
          message: null
        },
        idempotencyKey: `fieldline-anomaly-alert:${context.activityMatchId}`
      });
    } catch (err) {
      logger.warn(`AnomalyNotificationService: Intent creation notice: ${err}`);
      return this.outboxRepo.getByActivityMatchId(context.activityMatchId, 'email');
    }
  }

  async notifyAnomalyAlert(input: NotifyAnomalyAlertInput): Promise<NotifyAnomalyAlertResult> {
    const { prediction, context } = input;

    // 1. Strict Anomaly Invariant: normal and cold-start observations are never alerted
    if (!isEligibleForAnomalyAlert(prediction)) {
      return { message: null, delivery: null, outboxItem: null };
    }

    // 2. Strict Relational Identity Invariant:
    // If activityMatchId or projectId is missing/unavailable, NEVER fabricate a synthetic ID and NEVER create notification intent.
    if (!context.activityMatchId || !context.projectId) {
      logger.warn(
        `AnomalyNotificationService: Cannot create notification outbox without authoritative activityMatchId ('${context.activityMatchId}') and projectId ('${context.projectId}'). Notification skipped.`
      );
      return { message: null, delivery: null, outboxItem: null };
    }

    // 3. Adapt verified server facts to message generation input
    const messageInput = toAnomalyMessageInput(prediction, context);
    if (!messageInput) {
      return { message: null, delivery: null, outboxItem: null };
    }

    try {
      // 4. Ensure durable outbox row exists (idempotent lookup or creation)
      let outboxItem: NotificationOutboxItem | null =
        await (this.outboxRepo.getByActivityMatchId(context.activityMatchId, 'email') as any);

      if (!outboxItem) {
        const idempotencyKey = `fieldline-anomaly-alert:${context.activityMatchId}`;
        try {
          outboxItem = await (this.outboxRepo.create({
            projectId: context.projectId,
            activityMatchId: context.activityMatchId,
            notificationType: 'anomaly_alert',
            channel: 'email',
            payload: {
              messageInput,
              message: null
            },
            idempotencyKey
          }) as any);
        } catch {
          outboxItem = await (this.outboxRepo.findByIdempotencyKey(idempotencyKey) as any);
        }
      }

      if (!outboxItem) {
        throw new Error('Failed to obtain or persist outbox entry for anomaly notification');
      }

      // 5. Claim the item so attempt_count increments and lease is locked, then process through worker
      const claimedItem =
        (await (this.outboxRepo.claimById(outboxItem.id) as any)) ||
        (await (this.outboxRepo.getById(outboxItem.id) as any)) ||
        outboxItem;

      await this.notificationWorker.processNotification(claimedItem);

      // 6. Reload updated outbox row
      const updatedItem = (await (this.outboxRepo.getById(outboxItem.id) as any)) || outboxItem;
      let alertMsg: AnomalyAlertMessage | null = null;
      try {
        const parsed = JSON.parse(updatedItem.payloadJson) as NotificationOutboxPayload;
        alertMsg = parsed.message || null;
      } catch {
        alertMsg = null;
      }

      const isDelivered = updatedItem.status === 'delivered';
      const deliveryResult: EmailDeliveryResult = {
        sent: isDelivered,
        provider: 'resend',
        providerMessageId: updatedItem.providerMessageId || undefined,
        errorCode: updatedItem.lastErrorCode || undefined,
        errorSummary: updatedItem.lastErrorSummary || undefined
      };

      return {
        message: alertMsg,
        delivery: deliveryResult,
        outboxItem: updatedItem
      };
    } catch (err: any) {
      logger.error(
        `AnomalyNotificationService: Failed during notification workflow for activity '${context.activityExternalId}': ${err?.message || err}`,
        err
      );

      return {
        message: null,
        delivery: {
          sent: false,
          provider: 'resend',
          errorCode: 'NOTIFICATION_ORCHESTRATION_ERROR',
          errorSummary: String(err?.message || err)
        },
        outboxItem: null
      };
    }
  }

  async dispatchAlertMessage(message: AnomalyAlertMessage): Promise<EmailDeliveryResult> {
    try {
      return await this.emailDeliveryService.sendAnomalyAlert(message);
    } catch (err: any) {
      logger.error(
        `AnomalyNotificationService: Delivery adapter failed unexpectedly for activity '${message.activityExternalId}': ${err?.message || err}`,
        err
      );
      return {
        sent: false,
        provider: 'resend',
        errorCode: 'UNEXPECTED_DELIVERY_ERROR',
        errorSummary: String(err?.message || err)
      };
    }
  }
}

export const defaultAnomalyNotificationService: AnomalyNotificationService =
  new DefaultAnomalyNotificationService();
