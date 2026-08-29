import { AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface KeyHealthState {
  index: number;
  slot: string;
  apiKey: string;
  failureCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorStatus: number | null;
  cooldownUntil: Date | null;
  isPermanentlyInvalid: boolean;
}

export interface GroqKeyRouterOptions {
  apiKeys: string[];
  defaultModel?: string;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
}

export interface ProviderAttemptError {
  slot: string;
  index: number;
  status?: number;
  message: string;
  isFailoverEligible: boolean;
  retryAfterMs?: number;
}

export class GroqKeyRouter {
  private readonly keys: KeyHealthState[];
  private currentKeyIndex: number = 0;
  private readonly defaultModel: string;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;

  constructor(options: GroqKeyRouterOptions) {
    if (!options.apiKeys || options.apiKeys.length === 0) {
      throw new AIProviderError(
        'GroqKeyRouter initialization failed: At least one Groq API key is required'
      );
    }

    this.defaultModel = options.defaultModel || 'openai/gpt-oss-20b';
    this.baseCooldownMs = options.baseCooldownMs ?? 2000;
    this.maxCooldownMs = options.maxCooldownMs ?? 60000;

    this.keys = options.apiKeys.map((key, idx) => {
      const slotNumber = idx + 1;
      const slot = String(slotNumber).padStart(2, '0');
      return {
        index: idx,
        slot,
        apiKey: key,
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastErrorStatus: null,
        cooldownUntil: null,
        isPermanentlyInvalid: false
      };
    });
  }

  /**
   * Total number of configured keys.
   */
  get keyCount(): number {
    return this.keys.length;
  }

  /**
   * Current active key index (0-based).
   */
  getCurrentIndex(): number {
    return this.currentKeyIndex;
  }

  /**
   * Current active key slot string (e.g. '01').
   */
  getCurrentSlot(): string {
    return this.keys[this.currentKeyIndex].slot;
  }

  /**
   * Returns a snapshot of health states for all keys without exposing API keys.
   */
  getKeyHealthSnapshots(): Omit<KeyHealthState, 'apiKey'>[] {
    const now = Date.now();
    return this.keys.map((k) => ({
      index: k.index,
      slot: k.slot,
      failureCount: k.failureCount,
      successCount: k.successCount,
      lastFailureAt: k.lastFailureAt,
      lastSuccessAt: k.lastSuccessAt,
      lastErrorStatus: k.lastErrorStatus,
      cooldownUntil: k.cooldownUntil,
      isPermanentlyInvalid: k.isPermanentlyInvalid,
      isAvailable: !k.isPermanentlyInvalid && (!k.cooldownUntil || k.cooldownUntil.getTime() <= now)
    }));
  }

  /**
   * Determines the initial candidate key for a new request.
   * If the current sticky key is in active cooldown or invalid, advances to the next available key.
   */
  private getInitialCandidateIndex(): number {
    const now = Date.now();
    const count = this.keys.length;

    for (let offset = 0; offset < count; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % count;
      const keyState = this.keys[candidateIdx];

      if (!keyState.isPermanentlyInvalid) {
        if (!keyState.cooldownUntil || keyState.cooldownUntil.getTime() <= now) {
          return candidateIdx;
        }
      }
    }

    // If all keys are in cooldown/invalid, fallback to currentKeyIndex rather than throwing early
    return this.currentKeyIndex;
  }

  /**
   * Records a successful request execution for a key.
   * Enforces sticky selection: currentKeyIndex stays on this key.
   */
  recordSuccess(keyIndex: number): void {
    const keyState = this.keys[keyIndex];
    if (keyState) {
      keyState.successCount++;
      keyState.failureCount = 0;
      keyState.lastSuccessAt = new Date();
      keyState.cooldownUntil = null;
      keyState.lastErrorStatus = null;
      // Sticky invariant: successful key establishes active key for subsequent requests
      this.currentKeyIndex = keyIndex;
    }
  }

  /**
   * Records a failure for a key and applies health/cooldown adjustments.
   * Advances currentKeyIndex if it is currently pointing to the failed key.
   */
  recordFailure(keyIndex: number, attemptError: ProviderAttemptError): void {
    const keyState = this.keys[keyIndex];
    if (!keyState) return;

    keyState.failureCount++;
    keyState.lastFailureAt = new Date();
    keyState.lastErrorStatus = attemptError.status ?? null;

    if (attemptError.status === 401 || attemptError.status === 403) {
      keyState.isPermanentlyInvalid = true;
      logger.warn(`GroqKeyRouter: Key slot [${keyState.slot}] marked permanently invalid (Auth failure ${attemptError.status})`);
    } else {
      // Calculate cooldown
      let cooldownMs = attemptError.retryAfterMs;
      if (!cooldownMs || cooldownMs <= 0) {
        cooldownMs = Math.min(
          this.maxCooldownMs,
          this.baseCooldownMs * Math.pow(2, Math.min(keyState.failureCount - 1, 5))
        );
      }
      keyState.cooldownUntil = new Date(Date.now() + cooldownMs);
      logger.warn(
        `GroqKeyRouter: Key slot [${keyState.slot}] cooling down for ${cooldownMs}ms (Status: ${attemptError.status ?? 'Network/Timeout'}, Failures: ${keyState.failureCount})`
      );
    }

    // If currentKeyIndex is currently pointing at the failed key, advance it
    if (this.currentKeyIndex === keyIndex) {
      this.currentKeyIndex = (keyIndex + 1) % this.keys.length;
    }
  }

  /**
   * Executes an operation with sticky sequential failover across configured keys.
   * Ensures every key is attempted at most once per request.
   */
  async executeRequest<T>(
    operation: (apiKey: string, slot: string, keyIndex: number) => Promise<T>,
    contextDescription: string = 'Groq AI Request'
  ): Promise<T> {
    const totalKeys = this.keys.length;
    const startIndex = this.getInitialCandidateIndex();
    const attempts: ProviderAttemptError[] = [];

    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const targetIndex = (startIndex + attempt) % totalKeys;
      const targetKey = this.keys[targetIndex];

      logger.debug(
        `GroqKeyRouter: ${contextDescription} [Attempt ${attempt + 1}/${totalKeys}] using Key Slot [${targetKey.slot}]`
      );

      try {
        const result = await operation(targetKey.apiKey, targetKey.slot, targetIndex);
        this.recordSuccess(targetIndex);
        return result;
      } catch (err: unknown) {
        const classified = this.classifyError(err, targetKey.slot, targetIndex);
        attempts.push(classified);

        if (!classified.isFailoverEligible) {
          // Non-failover error (e.g. 400 Bad Request from malformed schema/prompt): throw immediately
          // Do not penalize key health or advance currentKeyIndex
          logger.error(
            `GroqKeyRouter: Non-failover error encountered on slot [${targetKey.slot}]: ${classified.message}`
          );
          throw new AIProviderError(
            `Groq AI request failed (non-failover): ${classified.message}`,
            { slot: targetKey.slot, status: classified.status }
          );
        }

        this.recordFailure(targetIndex, classified);

        const nextSlot = this.keys[(targetIndex + 1) % totalKeys].slot;
        logger.warn(
          `GroqKeyRouter: Failover from slot [${targetKey.slot}] to slot [${nextSlot}] after error: ${classified.message}`
        );
      }
    }

    // Exhausted all configured keys
    const summary = attempts
      .map((a) => `Slot ${a.slot}: ${a.status ? `HTTP ${a.status}` : a.message}`)
      .join(' | ');

    logger.error(`GroqKeyRouter: All ${totalKeys} configured Groq API keys exhausted without success. ${summary}`);

    throw new AIProviderError(
      `Groq AI provider exhausted all ${totalKeys} configured API key(s) without success. Attempts: ${summary}`,
      {
        totalAttempts: attempts.length,
        attempts: attempts.map((a) => ({ slot: a.slot, status: a.status, message: a.message }))
      }
    );
  }

  /**
   * Classifies an error to determine whether it qualifies for key failover.
   */
  classifyError(err: unknown, slot: string, index: number): ProviderAttemptError {
    let message = err instanceof Error ? err.message : String(err);
    let status: number | undefined;
    let retryAfterMs: number | undefined;

    // Check if error has status / statusCode / response properties
    if (err && typeof err === 'object') {
      const errObj = err as Record<string, any>;
      if (typeof errObj.status === 'number') {
        status = errObj.status;
      } else if (typeof errObj.statusCode === 'number') {
        status = errObj.statusCode;
      } else if (errObj.response && typeof errObj.response.status === 'number') {
        status = errObj.response.status;
      }

      // Check for retry-after in headers or properties
      if (errObj.retryAfterMs && typeof errObj.retryAfterMs === 'number') {
        retryAfterMs = errObj.retryAfterMs;
      } else if (errObj.headers && typeof errObj.headers.get === 'function') {
        const retryHeader = errObj.headers.get('retry-after');
        if (retryHeader) {
          const parsedSec = Number(retryHeader);
          if (!isNaN(parsedSec)) {
            retryAfterMs = parsedSec * 1000;
          }
        }
      }
    }

    // Also check status from message text if available (e.g. "HTTP 429", "status code 401")
    if (!status) {
      const match = message.match(/\b(400|401|403|404|422|429|500|502|503|504)\b/);
      if (match) {
        status = Number(match[1]);
      }
    }

    // Sanitize message to strip all configured keys
    message = this.sanitizeMessage(message);

    // Classification:
    // Failover-eligible:
    // 429 Too Many Requests
    // 401 / 403 Authentication / Key revoked
    // 5xx Server Errors (500, 502, 503, 504)
    // Network / timeout errors (fetch failed, ECONNREFUSED, ETIMEDOUT, AbortError, etc.)
    const isNetworkOrTimeout =
      /timeout|abort|econnrefused|econnreset|enotfound|fetch failed|network|socket/i.test(message);

    let isFailoverEligible = false;
    if (status) {
      if (status === 429 || status === 401 || status === 403 || (status >= 500 && status < 600)) {
        isFailoverEligible = true;
      } else {
        // 400, 404, 422, etc. are client/request errors
        isFailoverEligible = false;
      }
    } else {
      // If no explicit status, treat network/timeout/connection issues as failover-eligible
      isFailoverEligible = isNetworkOrTimeout || message.includes('AI provider');
    }

    return {
      slot,
      index,
      status,
      message,
      isFailoverEligible,
      retryAfterMs
    };
  }

  /**
   * Sanitizes strings by removing all configured API keys and bearer headers.
   */
  sanitizeMessage(raw: string): string {
    if (!raw) return 'Unknown Groq error';
    let sanitized = raw;

    for (const k of this.keys) {
      if (k.apiKey && k.apiKey.length > 5) {
        sanitized = sanitized.split(k.apiKey).join(`[REDACTED_KEY_SLOT_${k.slot}]`);
      }
    }

    // Strip generic Bearer tokens and gsk_ prefixed keys
    sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/gsk_[a-zA-Z0-9]{20,}/gi, 'gsk_[REDACTED]');
    sanitized = sanitized.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');

    return sanitized;
  }
}
