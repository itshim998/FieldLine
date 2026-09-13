import { describe, it, expect, vi } from 'vitest';
import {
  ResendEmailDeliveryService,
  sanitizeEmailSecrets
} from '../src/services/anomaly/email/resend-email-delivery.service.js';
import type { AnomalyAlertMessage } from '../src/services/anomaly/anomaly-message.types.js';

describe('Phase 3 — ResendEmailDeliveryService HTTP Contract & Resilience', () => {
  const sampleMessage: AnomalyAlertMessage = {
    title: '[FieldLine Alert] HIGH: Underground Piping (ACT-PIPE-01) Progress Deviation',
    summary: 'A reported progress of 80% for Underground Piping shows HIGH statistical deviation.',
    details: 'Project: Unit 4\nActivity: Underground Piping (ACT-PIPE-01)\nReported Progress: 80%\nPrevious Progress: 20%',
    recommendedAction: 'Verify progress on site before approving.',
    fullMessage: 'Full message...',
    activityMatchId: 'match-resend-test-001',
    projectName: 'Unit 4 Expansion',
    activityExternalId: 'ACT-PIPE-01',
    activityName: 'Underground Piping',
    activityLocation: 'Area B',
    reportDate: '2026-09-13',
    reporterName: 'Carlos R',
    previousPercent: 20,
    reportedPercent: 80,
    severity: 'high',
    anomalyScore: 0.92,
    anomalyReasons: ['Daily increment is outside learned baseline distribution.'],
    generatedBy: 'groq',
    generatedAt: '2026-09-13T12:00:00.000Z'
  };

  it('1. Verifies the outgoing HTTPS request contract to Resend API', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend_email_id_12345' })
      };
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_live_secret_key_1234567890abcdef',
      from: 'FieldLine Alerts <alerts@fieldline.app>',
      recipients: ['admin@fieldline.app', 'lead@fieldline.app'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(true);
    expect(result.provider).toBe('resend');
    expect(result.providerMessageId).toBe('resend_email_id_12345');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify endpoint
    expect(capturedUrl).toBe('https://api.resend.com/emails');

    // Verify method & headers
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer re_live_secret_key_1234567890abcdef');
    expect(headers['Idempotency-Key']).toBe('fieldline-anomaly-alert:match-resend-test-001');

    // Verify JSON payload
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.from).toBe('FieldLine Alerts <alerts@fieldline.app>');
    expect(body.to).toEqual(['admin@fieldline.app', 'lead@fieldline.app']);
    expect(body.subject).toContain('[FieldLine Alert] HIGH: Underground Piping');
    expect(body.html).toContain('HIGH SEVERITY');
    expect(body.html).toContain('Underground Piping');
    expect(body.text).toContain('FIELDLINE OPERATIONAL ANOMALY ALERT — HIGH');
  });

  it('2. Disabled mode (EMAIL_ENABLED=false) results in zero HTTP calls and safe result', async () => {
    const mockFetch = vi.fn();

    const service = new ResendEmailDeliveryService({
      enabled: false,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.provider).toBe('resend');
    expect(result.errorCode).toBe('EMAIL_DISABLED');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('3. Missing configuration is handled gracefully without throwing', async () => {
    const mockFetch = vi.fn();

    // Enabled but missing API key
    const serviceNoKey = new ResendEmailDeliveryService({
      enabled: true,
      apiKey: '',
      recipients: ['admin@fieldline.app'],
      fetchFn: mockFetch as any
    });

    const resultNoKey = await serviceNoKey.sendAnomalyAlert(sampleMessage);
    expect(resultNoKey.sent).toBe(false);
    expect(resultNoKey.errorCode).toBe('MISSING_CONFIGURATION');
    expect(mockFetch).not.toHaveBeenCalled();

    // Enabled but empty recipients
    const serviceNoRecipients = new ResendEmailDeliveryService({
      enabled: true,
      apiKey: 're_valid_key_1234567890',
      recipients: [],
      fetchFn: mockFetch as any
    });

    const resultNoRecipients = await serviceNoRecipients.sendAnomalyAlert(sampleMessage);
    expect(resultNoRecipients.sent).toBe(false);
    expect(resultNoRecipients.errorCode).toBe('MISSING_CONFIGURATION');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('4. Handles HTTP 400 Bad Request validation error safely', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        statusCode: 400,
        name: 'validation_error',
        message: 'The recipient address is invalid.'
      })
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_test_key_1234567890',
      recipients: ['invalid-address'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
    expect(result.errorSummary).toContain('HTTP 400');
    expect(result.errorSummary).toContain('invalid');
  });

  it('5. Handles HTTP 401/403 Authentication/Authorization errors', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        statusCode: 401,
        message: 'Invalid API key provided.'
      })
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_invalid_key_1234567890',
      recipients: ['admin@fieldline.app'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('AUTH_ERROR');
    expect(result.errorSummary).toContain('HTTP 401');
  });

  it('6. Handles HTTP 429 Rate Limiting', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        statusCode: 429,
        message: 'Too many requests. You have reached the rate limit.'
      })
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_test_key_1234567890',
      recipients: ['admin@fieldline.app'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('RATE_LIMIT');
  });

  it('7. Handles HTTP 500/503 Server Failure without crashing', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        statusCode: 503,
        message: 'Service Unavailable. Upstream mail cluster degraded.'
      })
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_test_key_1234567890',
      recipients: ['admin@fieldline.app'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('SERVER_ERROR');
    expect(result.errorSummary).toContain('HTTP 503');
  });

  it('8. Handles connection timeout via AbortController', async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      // Simulate slow response that triggers abort
      const signal: AbortSignal = init.signal;
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted.');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    });

    const service = new ResendEmailDeliveryService({
      apiKey: 're_test_key_1234567890',
      recipients: ['admin@fieldline.app'],
      enabled: true,
      timeoutMs: 50, // 50ms fast timeout
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('TIMEOUT');
    expect(result.errorSummary).toContain('timed out after 50ms');
  });

  it('9. Handles network failures (e.g. DNS or connection refused)', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

    const service = new ResendEmailDeliveryService({
      apiKey: 're_test_key_1234567890',
      recipients: ['admin@fieldline.app'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const result = await service.sendAnomalyAlert(sampleMessage);

    expect(result.sent).toBe(false);
    expect(result.errorCode).toBe('NETWORK_ERROR');
    expect(result.errorSummary).toContain('fetch failed');
  });

  it('10. Never leaks secrets in error summaries or logs (Secret Redaction Regression)', () => {
    const secretKey = 're_super_secret_live_token_abcdef123456';
    const rawError = `Request with Bearer ${secretKey} failed against key=${secretKey} with token re_1234567890abcdef123456`;

    const sanitized = sanitizeEmailSecrets(rawError, secretKey);

    expect(sanitized).not.toContain(secretKey);
    expect(sanitized).not.toContain('re_1234567890abcdef123456');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).toContain('key=[REDACTED]');
    expect(sanitized).toContain('re_[REDACTED]');
  });
});
