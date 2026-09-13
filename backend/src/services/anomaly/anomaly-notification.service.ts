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

export interface NotifyAnomalyAlertInput {
  prediction: AnomalyPrediction | null | undefined;
  context: AdaptAnomalyEvaluationOptions;
}

export interface NotifyAnomalyAlertResult {
  message: AnomalyAlertMessage | null;
  delivery: EmailDeliveryResult | null;
}

export interface AnomalyNotificationServiceDependencies {
  messageGeneratorService?: AnomalyMessageGeneratorService;
  emailDeliveryService?: EmailDeliveryService;
}

export interface AnomalyNotificationService {
  /**
   * Evaluates eligibility, generates structured alert prose, and dispatches email delivery.
   * Invariant: Never throws an error that interrupts the caller.
   */
  notifyAnomalyAlert(input: NotifyAnomalyAlertInput): Promise<NotifyAnomalyAlertResult>;

  /**
   * Directly dispatches an existing AnomalyAlertMessage to the delivery channel.
   */
  dispatchAlertMessage(message: AnomalyAlertMessage): Promise<EmailDeliveryResult>;
}

/**
 * Orchestrates Phase 2 message generation and Phase 3 email delivery
 * downstream of successful anomaly evaluation and persistence.
 */
export class DefaultAnomalyNotificationService implements AnomalyNotificationService {
  private messageGeneratorService: AnomalyMessageGeneratorService;
  private emailDeliveryService: EmailDeliveryService;

  constructor(dependencies?: AnomalyNotificationServiceDependencies) {
    this.messageGeneratorService =
      dependencies?.messageGeneratorService || defaultAnomalyMessageGeneratorService;
    this.emailDeliveryService =
      dependencies?.emailDeliveryService || resendEmailDeliveryService;
  }

  async notifyAnomalyAlert(input: NotifyAnomalyAlertInput): Promise<NotifyAnomalyAlertResult> {
    const { prediction, context } = input;

    // 1. Strict Anomaly Invariant: normal and cold-start observations are not alerted
    if (!isEligibleForAnomalyAlert(prediction)) {
      return { message: null, delivery: null };
    }

    // 2. Adapt verified server facts to message generation input
    const messageInput = toAnomalyMessageInput(prediction, context);
    if (!messageInput) {
      return { message: null, delivery: null };
    }

    try {
      // 3. Phase 2: Generate natural language alert message (Groq with deterministic fallback)
      const alertMessage = await this.messageGeneratorService.generateAnomalyMessage(messageInput);

      // 4. Phase 3: Deliver via configured email delivery service
      const deliveryResult = await this.dispatchAlertMessage(alertMessage);

      return {
        message: alertMessage,
        delivery: deliveryResult
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
        }
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
