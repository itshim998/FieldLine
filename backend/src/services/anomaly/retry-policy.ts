/**
 * Retry classification and bounded backoff policy for FieldLine Anomaly Notifications.
 *
 * Distinguishes temporary provider / network failures (retryable) from deterministic
 * configuration or authorization errors (permanent), preventing infinite busy-loops.
 */

export const RETRYABLE_ERROR_CODES = new Set([
  'RATE_LIMIT', // HTTP 429
  'SERVER_ERROR', // HTTP 500, 502, 503, 504
  'TIMEOUT', // Request timeout
  'NETWORK_ERROR', // DNS, connection reset, socket hang up
  'TEMPORARY_PROVIDER_FAILURE'
]);

export const PERMANENT_ERROR_CODES = new Set([
  'VALIDATION_ERROR', // HTTP 400
  'AUTH_ERROR', // HTTP 401, 403
  'MISSING_CONFIGURATION', // Missing API key or recipients
  'INVALID_RECIPIENT', // Malformed recipient addresses
  'EMAIL_DISABLED', // Feature flag disabled
  'MAX_ATTEMPTS_EXCEEDED',
  'NOTIFICATION_ORCHESTRATION_ERROR',
  'LEASE_EXPIRED_MAX_ATTEMPTS'
]);

/**
 * Standard default backoff delays:
 * Attempt 1: 1 minute (60,000 ms)
 * Attempt 2: 5 minutes (300,000 ms)
 * Attempt 3: 15 minutes (900,000 ms)
 * Attempt 4+: 30 minutes (1,800,000 ms) - capped
 */
export const DEFAULT_BACKOFF_DELAYS_MS = [
  60 * 1000, // 1 min
  5 * 60 * 1000, // 5 min
  15 * 60 * 1000, // 15 min
  30 * 60 * 1000 // 30 min
];

export const MAX_BACKOFF_DELAY_MS = 30 * 60 * 1000; // 30 min cap

/**
 * Classifies an error code as retryable or permanent.
 */
export function isRetryableDeliveryError(errorCode?: string | null): boolean {
  if (!errorCode) return false;
  const upper = errorCode.toUpperCase();
  if (RETRYABLE_ERROR_CODES.has(upper)) return true;
  if (PERMANENT_ERROR_CODES.has(upper)) return false;

  // Fallback: If code contains common retryable tokens
  if (upper.includes('429') || upper.includes('503') || upper.includes('500') || upper.includes('TIMEOUT')) {
    return true;
  }
  return false;
}

/**
 * Calculates bounded increasing backoff delay in milliseconds.
 * Supports custom delay sequences for unit testing.
 */
export function calculateBackoffDelayMs(
  attemptCount: number,
  customDelaysMs?: number[]
): number {
  const delays = customDelaysMs && customDelaysMs.length > 0 ? customDelaysMs : DEFAULT_BACKOFF_DELAYS_MS;
  const maxCap = delays[delays.length - 1];

  if (attemptCount <= 0) {
    return delays[0];
  }

  const index = Math.min(attemptCount - 1, delays.length - 1);
  const delay = delays[index];
  return Math.min(delay, maxCap);
}

/**
 * Computes ISO-8601 timestamp for next delivery attempt.
 */
export function calculateNextAttemptAt(
  attemptCount: number,
  customDelaysMs?: number[],
  fromDate: Date = new Date()
): string {
  const delayMs = calculateBackoffDelayMs(attemptCount, customDelaysMs);
  return new Date(fromDate.getTime() + delayMs).toISOString();
}
