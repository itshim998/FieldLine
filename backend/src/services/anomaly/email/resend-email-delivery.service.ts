import { env, parseAnomalyAlertRecipients } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import type { AnomalyAlertMessage } from '../anomaly-message.types.js';
import type { EmailDeliveryResult, EmailDeliveryService } from './email-delivery.types.js';
import { renderAnomalyAlertEmail } from './email-renderer.js';

export interface ResendEmailDeliveryServiceOptions {
  apiKey?: string;
  from?: string;
  recipients?: string[] | string;
  enabled?: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/**
 * Sanitizes strings, error messages, and headers to prevent leaking sensitive credentials.
 * Masks Resend API keys (re_...) and authorization headers.
 */
export function sanitizeEmailSecrets(message: string, apiKey?: string): string {
  if (!message) return '';
  let sanitized = message;

  sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');
  sanitized = sanitized.replace(/re_[a-zA-Z0-9_]{15,}/gi, 're_[REDACTED]');

  if (apiKey && apiKey.trim().length > 0) {
    sanitized = sanitized.split(apiKey.trim()).join('[REDACTED_API_KEY]');
  }

  return sanitized;
}

/**
 * Production implementation of EmailDeliveryService utilizing the Resend HTTPS API.
 * Uses native Node 22 fetch() without external SDKs or SMTP dependencies.
 */
export class ResendEmailDeliveryService implements EmailDeliveryService {
  private apiKey?: string;
  private from: string;
  private recipients: string[];
  private enabled: boolean;
  private fetchFn: typeof fetch;
  private timeoutMs: number;
  private baseUrl: string;

  constructor(options?: ResendEmailDeliveryServiceOptions) {
    this.apiKey = options?.apiKey ?? env.RESEND_API_KEY;
    this.from = options?.from ?? env.EMAIL_FROM ?? 'FieldLine Alerts <onboarding@resend.dev>';

    if (options?.recipients !== undefined) {
      if (Array.isArray(options.recipients)) {
        this.recipients = options.recipients.map((r) => r.trim()).filter((r) => r.length > 0);
      } else {
        this.recipients = parseAnomalyAlertRecipients(options.recipients);
      }
    } else {
      this.recipients = parseAnomalyAlertRecipients(env.ANOMALY_ALERT_RECIPIENTS);
    }

    this.enabled = options?.enabled ?? env.EMAIL_ENABLED ?? false;
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.timeoutMs = options?.timeoutMs ?? 10000;
    this.baseUrl = options?.baseUrl ?? 'https://api.resend.com';
  }

  async sendAnomalyAlert(message: AnomalyAlertMessage): Promise<EmailDeliveryResult> {
    // 1. Safe offline / disabled check
    if (!this.enabled) {
      logger.debug(
        `ResendEmailDeliveryService: Email delivery disabled (EMAIL_ENABLED=false). Skipping send for activity '${message.activityExternalId}'.`
      );
      return {
        sent: false,
        provider: 'resend',
        errorCode: 'EMAIL_DISABLED',
        errorSummary: 'Email delivery is disabled via EMAIL_ENABLED=false'
      };
    }

    // 2. Configuration validation
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      const errSummary = 'Resend API key is not configured';
      logger.warn(`ResendEmailDeliveryService: ${errSummary}`);
      return {
        sent: false,
        provider: 'resend',
        errorCode: 'MISSING_CONFIGURATION',
        errorSummary: errSummary
      };
    }

    if (!this.recipients || this.recipients.length === 0) {
      const errSummary = 'No recipient email addresses configured in ANOMALY_ALERT_RECIPIENTS';
      logger.warn(`ResendEmailDeliveryService: ${errSummary}`);
      return {
        sent: false,
        provider: 'resend',
        errorCode: 'MISSING_CONFIGURATION',
        errorSummary: errSummary
      };
    }

    // 3. Render deterministic HTML and plaintext email
    const rendered = renderAnomalyAlertEmail(message);

    // 4. Formulate deterministic idempotency key explicitly identifying the anomaly-email event
    const idempotencyKey = message.activityMatchId
      ? `fieldline-anomaly-alert:${message.activityMatchId}`
      : `fieldline-anomaly-alert:${message.projectName.replace(/\s+/g, '_')}:${message.activityExternalId}:${message.reportDate}:${message.reportedPercent}`;

    if (this.from.includes('onboarding@resend.dev')) {
      logger.debug(
        'ResendEmailDeliveryService: Using onboarding@resend.dev sandbox sender. Note: Resend restricts sandbox sending to the account owner email address. Verified domain is required for arbitrary recipients.'
      );
    }

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/emails`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const payload = {
      from: this.from,
      to: this.recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text
    };

    try {
      logger.info(
        `ResendEmailDeliveryService: Initiating HTTPS alert delivery for '${message.activityExternalId}' (${message.severity.toUpperCase()}) to ${this.recipients.length} recipients.`
      );

      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      let responseBody: any = null;
      try {
        responseBody = await response.json();
      } catch {
        // Non-JSON or empty response
      }

      if (response.ok) {
        const messageId = responseBody?.id ? String(responseBody.id) : undefined;
        logger.info(
          `ResendEmailDeliveryService: Anomaly alert email successfully delivered for activity '${message.activityExternalId}'. Message ID: ${messageId || 'acknowledged'}`
        );
        return {
          sent: true,
          provider: 'resend',
          providerMessageId: messageId
        };
      }

      // Handle non-2xx HTTP responses
      const status = response.status;
      let errorCode = 'HTTP_ERROR';
      if (status === 400) errorCode = 'VALIDATION_ERROR';
      else if (status === 401 || status === 403) errorCode = 'AUTH_ERROR';
      else if (status === 429) errorCode = 'RATE_LIMIT';
      else if (status >= 500) errorCode = 'SERVER_ERROR';

      const rawMsg = responseBody?.message || responseBody?.name || `HTTP ${status} response`;
      const safeSummary = sanitizeEmailSecrets(`Resend email delivery failed: HTTP ${status} — ${rawMsg}`, this.apiKey);

      logger.warn(`ResendEmailDeliveryService: ${safeSummary}`);

      return {
        sent: false,
        provider: 'resend',
        errorCode,
        errorSummary: safeSummary
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error?.name === 'AbortError' || controller.signal.aborted) {
        const safeSummary = `Resend email delivery timed out after ${this.timeoutMs}ms`;
        logger.warn(`ResendEmailDeliveryService: ${safeSummary}`);
        return {
          sent: false,
          provider: 'resend',
          errorCode: 'TIMEOUT',
          errorSummary: safeSummary
        };
      }

      const rawErr = error?.message || String(error);
      const safeSummary = sanitizeEmailSecrets(`Resend network request failed: ${rawErr}`, this.apiKey);
      logger.warn(`ResendEmailDeliveryService: ${safeSummary}`);

      return {
        sent: false,
        provider: 'resend',
        errorCode: 'NETWORK_ERROR',
        errorSummary: safeSummary
      };
    }
  }
}

export const resendEmailDeliveryService: EmailDeliveryService = new ResendEmailDeliveryService();
