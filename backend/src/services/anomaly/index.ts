export {
  DefaultProgressAnomalyEvaluationService,
  defaultProgressAnomalyEvaluationService
} from './progress-anomaly-evaluation.service.js';
export type { ProgressAnomalyEvaluationServiceDependencies } from './progress-anomaly-evaluation.service.js';

export type {
  EvaluateProgressAnomalyInput,
  ProgressAnomalyEvaluationService
} from './progress-anomaly-evaluation.types.js';

export {
  anomalyAlertPayloadSchema,
  isEligibleForAnomalyAlert,
  toAnomalyMessageInput
} from './anomaly-message.types.js';
export type {
  AnomalyAlertSeverity,
  GenerateAnomalyMessageInput,
  AdaptAnomalyEvaluationOptions,
  AnomalyAlertPayload,
  AnomalyAlertMessage,
  AnomalyMessageGeneratorService
} from './anomaly-message.types.js';

export {
  DefaultAnomalyMessageGeneratorService,
  defaultAnomalyMessageGeneratorService,
  buildAnomalyMessagePrompt,
  generateDeterministicFallbackMessage
} from './anomaly-message-generator.service.js';

export type {
  EmailDeliveryResult,
  EmailDeliveryService
} from './email/email-delivery.types.js';

export {
  escapeHtml,
  formatMultilineHtml,
  renderAnomalyAlertEmail
} from './email/email-renderer.js';
export type { RenderedAnomalyAlertEmail } from './email/email-renderer.js';

export {
  ResendEmailDeliveryService,
  resendEmailDeliveryService,
  sanitizeEmailSecrets
} from './email/resend-email-delivery.service.js';
export type { ResendEmailDeliveryServiceOptions } from './email/resend-email-delivery.service.js';

export {
  DefaultAnomalyNotificationService,
  defaultAnomalyNotificationService
} from './anomaly-notification.service.js';
export type {
  AnomalyNotificationService,
  NotifyAnomalyAlertInput,
  NotifyAnomalyAlertResult,
  AnomalyNotificationServiceDependencies
} from './anomaly-notification.service.js';

export type {
  NotificationOutboxStatus,
  NotificationType,
  NotificationChannel,
  NotificationOutboxPayload,
  NotificationOutboxItem,
  CreateNotificationOutboxInput
} from './notification-outbox.types.js';

export {
  isRetryableDeliveryError,
  calculateBackoffDelayMs,
  calculateNextAttemptAt,
  RETRYABLE_ERROR_CODES,
  PERMANENT_ERROR_CODES,
  DEFAULT_BACKOFF_DELAYS_MS,
  MAX_BACKOFF_DELAY_MS
} from './retry-policy.js';

export {
  NotificationWorker,
  notificationWorker
} from './notification.worker.js';
export type { NotificationWorkerDependencies } from './notification.worker.js';

export {
  NotificationWorkerRunner,
  notificationWorkerRunner
} from '../../jobs/notification-worker-runner.js';
export type { NotificationWorkerRunnerOptions } from '../../jobs/notification-worker-runner.js';

