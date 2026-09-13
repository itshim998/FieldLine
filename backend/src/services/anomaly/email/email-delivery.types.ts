import type { AnomalyAlertMessage } from '../anomaly-message.types.js';

/**
 * Structured, non-persisted result of an email delivery attempt.
 * Preserves clear separation between delivery status and domain anomaly truth.
 */
export interface EmailDeliveryResult {
  sent: boolean;
  provider: 'resend';
  providerMessageId?: string;
  errorCode?: string;
  errorSummary?: string;
}

/**
 * Service contract for outbound email delivery of FieldLine anomaly alerts.
 * Business and application services depend strictly on this abstraction,
 * keeping provider HTTP details fully encapsulated.
 */
export interface EmailDeliveryService {
  /**
   * Sends an anomaly alert email to configured recipients.
   * Invariant: Never throws unhandled errors that could roll back the caller's transaction.
   */
  sendAnomalyAlert(message: AnomalyAlertMessage): Promise<EmailDeliveryResult>;
}
