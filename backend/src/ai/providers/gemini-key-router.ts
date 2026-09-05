import { AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface KeyHealthState {
  index: number;
  slot: string;
  apiKey: string;
  healthEpoch: number;
  failureCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorStatus: number | null;
  cooldownUntil: Date | null;
  isPermanentlyInvalid: boolean;
  estimatedSessionTokens: number;
}

export interface KeyHealthSnapshot extends Omit<KeyHealthState, 'apiKey'> {
  isAvailable: boolean;
}

export interface ActiveSessionKey {
  apiKey: string;
  slot: string;
  index: number;
  healthEpoch: number;
  routingEpoch: number;
  estimatedSessionTokens: number;
}

export interface GeminiKeyRouterOptions {
  apiKeys: string[];
  defaultModel?: string;
  baseCooldownMs?: number;
  maxCooldownMs?: number;
  tokenLimitPerKey?: number;
}

export interface ProviderAttemptError {
  slot: string;
  index: number;
  status?: number;
  message: string;
  isFailoverEligible: boolean;
  retryAfterMs?: number;
}

export class GeminiKeyRouter {
  private readonly keys: KeyHealthState[];
  private currentKeyIndex: number = 0;
  private routingEpoch: number = 0;
  private readonly defaultModel: string;
  private readonly baseCooldownMs: number;
  private readonly maxCooldownMs: number;
  public readonly tokenLimitPerKey: number;

  constructor(options: GeminiKeyRouterOptions) {
    if (!options.apiKeys || options.apiKeys.length === 0) {
      throw new AIProviderError(
        'GeminiKeyRouter initialization failed: At least one Gemini API key is required'
      );
    }

    this.defaultModel = options.defaultModel || 'gemini-3.1-flash-live-preview';
    this.baseCooldownMs = options.baseCooldownMs ?? 2000;
    this.maxCooldownMs = options.maxCooldownMs ?? 60000;
    this.tokenLimitPerKey = options.tokenLimitPerKey ?? 55000;

    this.keys = options.apiKeys.map((key, idx) => {
      const slotNumber = idx + 1;
      const slot = String(slotNumber).padStart(2, '0');
      return {
        index: idx,
        slot,
        apiKey: key,
        healthEpoch: 0,
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        lastSuccessAt: null,
        lastErrorStatus: null,
        cooldownUntil: null,
        isPermanentlyInvalid: false,
        estimatedSessionTokens: 0
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
   * Current routing epoch counter (increments on every active-cursor state transition).
   */
  getCurrentEpoch(): number {
    return this.routingEpoch;
  }

  /**
   * Current health epoch counter for a specific key slot.
   */
  getKeyHealthEpoch(keyIndex: number): number {
    return this.keys[keyIndex]?.healthEpoch ?? 0;
  }

  /**
   * Current estimated session tokens for a specific key slot.
   */
  getKeyTokenUsage(keyIndex: number): number {
    return this.keys[keyIndex]?.estimatedSessionTokens ?? 0;
  }

  /**
   * Returns a snapshot of health states for all keys without exposing API keys.
   */
  getKeyHealthSnapshots(): KeyHealthSnapshot[] {
    const now = Date.now();
    return this.keys.map((k) => ({
      index: k.index,
      slot: k.slot,
      healthEpoch: k.healthEpoch,
      failureCount: k.failureCount,
      successCount: k.successCount,
      lastFailureAt: k.lastFailureAt,
      lastSuccessAt: k.lastSuccessAt,
      lastErrorStatus: k.lastErrorStatus,
      cooldownUntil: k.cooldownUntil,
      isPermanentlyInvalid: k.isPermanentlyInvalid,
      estimatedSessionTokens: k.estimatedSessionTokens,
      isAvailable:
        !k.isPermanentlyInvalid &&
        (!k.cooldownUntil || k.cooldownUntil.getTime() <= now) &&
        k.estimatedSessionTokens < this.tokenLimitPerKey
    }));
  }

  /**
   * Checks whether a specific key slot is currently healthy and eligible for use.
   */
  isKeyHealthy(keyIndex: number): boolean {
    const key = this.keys[keyIndex];
    if (!key) return false;
    const now = Date.now();
    return (
      !key.isPermanentlyInvalid &&
      (!key.cooldownUntil || key.cooldownUntil.getTime() <= now) &&
      key.estimatedSessionTokens < this.tokenLimitPerKey
    );
  }

  /**
   * Acquires the current active sticky key for a live session.
   * If the current key is in cooldown, permanently invalid (401/403), or has exhausted
   * its proactive token limit, advances in round-robin order to the next healthy key.
   */
  acquireLiveSessionKey(): ActiveSessionKey {
    const total = this.keys.length;

    // Check if current sticky key is healthy
    const currentKey = this.keys[this.currentKeyIndex];
    if (this.isKeyHealthy(this.currentKeyIndex)) {
      return {
        apiKey: currentKey.apiKey,
        slot: currentKey.slot,
        index: currentKey.index,
        healthEpoch: currentKey.healthEpoch,
        routingEpoch: this.routingEpoch,
        estimatedSessionTokens: currentKey.estimatedSessionTokens
      };
    }

    // Current key is unhealthy; search for the next healthy candidate in round-robin order
    for (let offset = 1; offset < total; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % total;
      if (this.isKeyHealthy(candidateIdx)) {
        this.currentKeyIndex = candidateIdx;
        this.routingEpoch++;
        logger.info(
          `GeminiKeyRouter: Sticky key unhealthy. Advanced active cursor to healthy slot [${this.getCurrentSlot()}] (Epoch: ${this.routingEpoch})`
        );
        const candidateKey = this.keys[this.currentKeyIndex];
        return {
          apiKey: candidateKey.apiKey,
          slot: candidateKey.slot,
          index: candidateKey.index,
          healthEpoch: candidateKey.healthEpoch,
          routingEpoch: this.routingEpoch,
          estimatedSessionTokens: candidateKey.estimatedSessionTokens
        };
      }
    }

    // Check if all keys are permanently invalid
    const allPermanentlyInvalid = this.keys.every((k) => k.isPermanentlyInvalid);
    if (allPermanentlyInvalid) {
      throw new AIProviderError(
        'GeminiKeyRouter: All configured Gemini API keys are permanently invalid (401/403)'
      );
    }

    // Secondary fallback: find any non-permanently-invalid key (even if in cooldown or token limit reached)
    for (let offset = 1; offset < total; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % total;
      const candidate = this.keys[candidateIdx];
      if (!candidate.isPermanentlyInvalid) {
        this.currentKeyIndex = candidateIdx;
        this.routingEpoch++;
        logger.warn(
          `GeminiKeyRouter: No strictly healthy keys available. Falling back to slot [${candidate.slot}] (Epoch: ${this.routingEpoch})`
        );
        return {
          apiKey: candidate.apiKey,
          slot: candidate.slot,
          index: candidate.index,
          healthEpoch: candidate.healthEpoch,
          routingEpoch: this.routingEpoch,
          estimatedSessionTokens: candidate.estimatedSessionTokens
        };
      }
    }

    // Return current key if no alternative non-invalid key exists
    return {
      apiKey: currentKey.apiKey,
      slot: currentKey.slot,
      index: currentKey.index,
      healthEpoch: currentKey.healthEpoch,
      routingEpoch: this.routingEpoch,
      estimatedSessionTokens: currentKey.estimatedSessionTokens
    };
  }

  /**
   * Records cumulative token usage for a key slot against the safety threshold.
   * Returns whether the token limit has been reached.
   */
  recordTokenUsage(
    keyIndex: number,
    tokens: number
  ): { totalTokens: number; limitExceeded: boolean } {
    const keyState = this.keys[keyIndex];
    if (!keyState) {
      return { totalTokens: 0, limitExceeded: false };
    }

    keyState.estimatedSessionTokens += Math.max(0, tokens);
    const limitExceeded = keyState.estimatedSessionTokens >= this.tokenLimitPerKey;

    if (limitExceeded) {
      logger.warn(
        `GeminiKeyRouter: Key slot [${keyState.slot}] reached safety token threshold (${keyState.estimatedSessionTokens}/${this.tokenLimitPerKey} tokens). Proactive handover recommended.`
      );
    }

    return {
      totalTokens: keyState.estimatedSessionTokens,
      limitExceeded
    };
  }

  /**
   * Resets estimated session tokens for a key slot (e.g. on new quota window or manual reset).
   */
  resetTokenUsage(keyIndex?: number): void {
    if (typeof keyIndex === 'number') {
      if (this.keys[keyIndex]) {
        this.keys[keyIndex].estimatedSessionTokens = 0;
      }
    } else {
      for (const k of this.keys) {
        k.estimatedSessionTokens = 0;
      }
    }
  }

  /**
   * Atomically transitions the active sticky cursor to the next key slot and logs the epoch change.
   * Concurrency-safe: if currentKeyIndex does not match the active cursor, the rotation is
   * identified as stale and ignored, preventing duplicate transitions.
   */
  rotateToNextKey(currentKeyIndex: number, reason: string = 'manual_rotation'): ActiveSessionKey {
    // Concurrency protection: ignore stale rotations
    if (this.currentKeyIndex !== currentKeyIndex) {
      const active = this.keys[this.currentKeyIndex];
      logger.debug(
        `GeminiKeyRouter: Stale rotation ignored for slot [${this.keys[currentKeyIndex]?.slot ?? currentKeyIndex}] (active cursor is already at slot [${active.slot}], Epoch: ${this.routingEpoch}). Reason was: ${reason}`
      );
      return {
        apiKey: active.apiKey,
        slot: active.slot,
        index: active.index,
        healthEpoch: active.healthEpoch,
        routingEpoch: this.routingEpoch,
        estimatedSessionTokens: active.estimatedSessionTokens
      };
    }

    const total = this.keys.length;
    let nextIdx = (this.currentKeyIndex + 1) % total;

    // Search for the next healthy slot
    for (let offset = 1; offset < total; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % total;
      if (this.isKeyHealthy(candidateIdx)) {
        nextIdx = candidateIdx;
        break;
      }
    }

    // Fallback if no healthy slot: search for next non-permanently-invalid slot
    if (this.keys[nextIdx].isPermanentlyInvalid) {
      for (let offset = 1; offset < total; offset++) {
        const candidateIdx = (this.currentKeyIndex + offset) % total;
        if (!this.keys[candidateIdx].isPermanentlyInvalid) {
          nextIdx = candidateIdx;
          break;
        }
      }
    }

    const fromSlot = this.keys[this.currentKeyIndex].slot;
    this.currentKeyIndex = nextIdx;
    this.routingEpoch++;

    logger.info(
      `GeminiKeyRouter: Rotated active key from slot [${fromSlot}] to slot [${this.keys[nextIdx].slot}] (Epoch: ${this.routingEpoch}, Reason: ${reason})`
    );

    const newActive = this.keys[this.currentKeyIndex];
    return {
      apiKey: newActive.apiKey,
      slot: newActive.slot,
      index: newActive.index,
      healthEpoch: newActive.healthEpoch,
      routingEpoch: this.routingEpoch,
      estimatedSessionTokens: newActive.estimatedSessionTokens
    };
  }

  /**
   * Records a successful operation execution for a key.
   * Concurrency-safe: mutations apply only if epochs match.
   */
  recordSuccess(keyIndex: number, attemptRoutingEpoch?: number, attemptHealthEpoch?: number): void {
    const keyState = this.keys[keyIndex];
    if (!keyState) return;

    // 1. Authoritative Per-Key Health State Update
    if (!keyState.isPermanentlyInvalid) {
      if (attemptHealthEpoch === undefined || attemptHealthEpoch === keyState.healthEpoch) {
        keyState.successCount++;
        keyState.failureCount = 0;
        keyState.lastSuccessAt = new Date();
        keyState.cooldownUntil = null;
        keyState.lastErrorStatus = null;
        keyState.healthEpoch++;
      } else {
        logger.debug(
          `GeminiKeyRouter: Stale success on slot [${keyState.slot}] (attemptHealthEpoch: ${attemptHealthEpoch}, currentHealthEpoch: ${keyState.healthEpoch}). Ignoring health mutation to protect newer state.`
        );
      }
    } else {
      logger.debug(
        `GeminiKeyRouter: Success arrived for permanently invalid key slot [${keyState.slot}]. Preserving permanent invalidation.`
      );
    }

    // 2. Active Sticky Cursor Routing Update
    if (attemptRoutingEpoch === undefined || attemptRoutingEpoch === this.routingEpoch) {
      if (this.currentKeyIndex !== keyIndex) {
        this.currentKeyIndex = keyIndex;
        this.routingEpoch++;
        logger.debug(
          `GeminiKeyRouter: Active key transitioned to slot [${keyState.slot}] (Epoch: ${this.routingEpoch})`
        );
      }
    } else {
      logger.debug(
        `GeminiKeyRouter: Stale success on slot [${keyState.slot}] (attemptRoutingEpoch: ${attemptRoutingEpoch}, currentRoutingEpoch: ${this.routingEpoch}). Active cursor unchanged at slot [${this.getCurrentSlot()}].`
      );
    }
  }

  /**
   * Records a failure for a key and applies health/cooldown adjustments.
   * Classifies errors (429 RESOURCE_EXHAUSTED, 401/403 auth, network timeouts, 5xx).
   */
  recordFailure(
    keyIndex: number,
    error: unknown | ProviderAttemptError,
    attemptRoutingEpoch?: number,
    attemptHealthEpoch?: number
  ): ProviderAttemptError {
    const keyState = this.keys[keyIndex];
    if (!keyState) {
      return {
        slot: '00',
        index: keyIndex,
        message: 'Invalid key index',
        isFailoverEligible: false
      };
    }

    const attemptError: ProviderAttemptError =
      error && typeof error === 'object' && 'isFailoverEligible' in error
        ? (error as ProviderAttemptError)
        : this.classifyError(error, keyState.slot, keyIndex);

    // 1. Authoritative Per-Key Health State Update
    if (!keyState.isPermanentlyInvalid) {
      if (attemptHealthEpoch === undefined || attemptHealthEpoch === keyState.healthEpoch) {
        keyState.failureCount++;
        keyState.lastFailureAt = new Date();
        keyState.lastErrorStatus = attemptError.status ?? null;

        if (attemptError.status === 401 || attemptError.status === 403) {
          keyState.isPermanentlyInvalid = true;
          logger.warn(
            `GeminiKeyRouter: Key slot [${keyState.slot}] marked permanently invalid (Auth failure ${attemptError.status})`
          );
        } else {
          let cooldownMs = attemptError.retryAfterMs;
          if (!cooldownMs || cooldownMs <= 0) {
            cooldownMs = Math.min(
              this.maxCooldownMs,
              this.baseCooldownMs * Math.pow(2, Math.min(keyState.failureCount - 1, 5))
            );
          }
          keyState.cooldownUntil = new Date(Date.now() + cooldownMs);
          logger.warn(
            `GeminiKeyRouter: Key slot [${keyState.slot}] cooling down for ${cooldownMs}ms (Status: ${attemptError.status ?? 'Network/Timeout'}, Failures: ${keyState.failureCount})`
          );
        }
        keyState.healthEpoch++;
      } else {
        logger.debug(
          `GeminiKeyRouter: Stale failure on slot [${keyState.slot}] (attemptHealthEpoch: ${attemptHealthEpoch}, currentHealthEpoch: ${keyState.healthEpoch}). Ignoring health mutation to protect newer state.`
        );
      }
    }

    // 2. Active Sticky Cursor Routing Update
    if (attemptRoutingEpoch === undefined || attemptRoutingEpoch === this.routingEpoch) {
      if (this.currentKeyIndex === keyIndex) {
        this.currentKeyIndex = (keyIndex + 1) % this.keys.length;
        this.routingEpoch++;
        logger.warn(
          `GeminiKeyRouter: Failover advanced active cursor to slot [${this.getCurrentSlot()}] (Epoch: ${this.routingEpoch})`
        );
      }
    } else {
      logger.debug(
        `GeminiKeyRouter: Stale failure on slot [${keyState.slot}] (attemptRoutingEpoch: ${attemptRoutingEpoch}, currentRoutingEpoch: ${this.routingEpoch}). Active cursor unchanged at slot [${this.getCurrentSlot()}].`
      );
    }

    return attemptError;
  }

  /**
   * Executes a request with sticky sequential failover across configured keys.
   */
  async executeRequest<T>(
    operation: (apiKey: string, slot: string, keyIndex: number) => Promise<T>,
    contextDescription: string = 'Gemini AI Request'
  ): Promise<T> {
    const totalKeys = this.keys.length;
    const startIndex = this.getInitialCandidateIndex();
    const attempts: ProviderAttemptError[] = [];
    let currentRequestEpoch = this.routingEpoch;

    for (let attempt = 0; attempt < totalKeys; attempt++) {
      const targetIndex = (startIndex + attempt) % totalKeys;
      const targetKey = this.keys[targetIndex];
      const attemptRoutingEpoch = currentRequestEpoch;
      const attemptHealthEpoch = targetKey.healthEpoch;

      logger.debug(
        `GeminiKeyRouter: ${contextDescription} [Attempt ${attempt + 1}/${totalKeys}] using Key Slot [${targetKey.slot}] (RoutingEpoch: ${attemptRoutingEpoch}, HealthEpoch: ${attemptHealthEpoch})`
      );

      try {
        const result = await operation(targetKey.apiKey, targetKey.slot, targetIndex);
        this.recordSuccess(targetIndex, attemptRoutingEpoch, attemptHealthEpoch);
        return result;
      } catch (err: unknown) {
        const classified = this.classifyError(err, targetKey.slot, targetIndex);
        attempts.push(classified);

        if (!classified.isFailoverEligible) {
          logger.error(
            `GeminiKeyRouter: Non-failover error encountered on slot [${targetKey.slot}]: ${classified.message}`
          );
          throw new AIProviderError(
            `Gemini AI request failed (non-failover): ${classified.message}`,
            { slot: targetKey.slot, status: classified.status }
          );
        }

        const wasEpoch = this.routingEpoch;
        this.recordFailure(targetIndex, classified, attemptRoutingEpoch, attemptHealthEpoch);
        if (this.routingEpoch > wasEpoch) {
          currentRequestEpoch = this.routingEpoch;
        }

        const nextSlot = this.keys[(targetIndex + 1) % totalKeys].slot;
        logger.warn(
          `GeminiKeyRouter: Failover from slot [${targetKey.slot}] to slot [${nextSlot}] after error: ${classified.message}`
        );
      }
    }

    const summary = attempts
      .map((a) => `Slot ${a.slot}: ${a.status ? `HTTP ${a.status}` : a.message}`)
      .join(' | ');

    logger.error(
      `GeminiKeyRouter: All ${totalKeys} configured Gemini API keys exhausted without success. ${summary}`
    );

    throw new AIProviderError(
      `Gemini AI provider exhausted all ${totalKeys} configured API key(s) without success. Attempts: ${summary}`,
      {
        totalAttempts: attempts.length,
        attempts: attempts.map((a) => ({ slot: a.slot, status: a.status, message: a.message }))
      }
    );
  }

  /**
   * Determines the initial candidate key for a request.
   */
  private getInitialCandidateIndex(): number {
    const now = Date.now();
    const count = this.keys.length;

    for (let offset = 0; offset < count; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % count;
      const keyState = this.keys[candidateIdx];

      if (!keyState.isPermanentlyInvalid) {
        if (!keyState.cooldownUntil || keyState.cooldownUntil.getTime() <= now) {
          if (keyState.estimatedSessionTokens < this.tokenLimitPerKey) {
            return candidateIdx;
          }
        }
      }
    }

    // Fallback to any non-permanently-invalid key
    for (let offset = 0; offset < count; offset++) {
      const candidateIdx = (this.currentKeyIndex + offset) % count;
      if (!this.keys[candidateIdx].isPermanentlyInvalid) {
        return candidateIdx;
      }
    }

    return this.currentKeyIndex;
  }

  /**
   * Classifies an error to determine whether it qualifies for key failover.
   */
  classifyError(err: unknown, slot: string, index: number): ProviderAttemptError {
    let message = err instanceof Error ? err.message : String(err);
    let status: number | undefined;
    let retryAfterMs: number | undefined;

    if (err && typeof err === 'object') {
      const errObj = err as Record<string, any>;
      if (typeof errObj.status === 'number') {
        status = errObj.status;
      } else if (typeof errObj.statusCode === 'number') {
        status = errObj.statusCode;
      } else if (errObj.response && typeof errObj.response.status === 'number') {
        status = errObj.response.status;
      }

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

    // Check status or error type from message
    if (!status) {
      const match = message.match(/\b(400|401|403|404|422|429|500|502|503|504|1007|1008)\b/);
      if (match) {
        const code = Number(match[1]);
        if (code === 1008) {
          status = 403;
        } else if (code === 1007) {
          status = 400;
        } else {
          status = code;
        }
      } else if (/RESOURCE_EXHAUSTED|quota|rate limit/i.test(message)) {
        status = 429;
      } else if (/API_KEY_INVALID|UNAUTHENTICATED/i.test(message)) {
        status = 401;
      } else if (/PERMISSION_DENIED|denied access|has been denied/i.test(message)) {
        status = 403;
      } else if (/UNAVAILABLE/i.test(message)) {
        status = 503;
      }
    }

    message = this.sanitizeMessage(message);

    const isNetworkOrTimeout =
      /timeout|abort|econnrefused|econnreset|enotfound|fetch failed|network|socket|1006|1011/i.test(
        message
      );

    let isFailoverEligible = false;
    if (status) {
      if (
        status === 429 ||
        status === 401 ||
        status === 403 ||
        (status >= 500 && status < 600) ||
        message.includes('RESOURCE_EXHAUSTED')
      ) {
        isFailoverEligible = true;
      } else {
        isFailoverEligible = false;
      }
    } else {
      isFailoverEligible = isNetworkOrTimeout || message.includes('Gemini');
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
    if (!raw) return 'Unknown Gemini error';
    let sanitized = raw;

    for (const k of this.keys) {
      if (k.apiKey && k.apiKey.length > 5) {
        sanitized = sanitized.split(k.apiKey).join(`[REDACTED_KEY_SLOT_${k.slot}]`);
      }
    }

    sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
    sanitized = sanitized.replace(/AIzaSy[a-zA-Z0-9_\-]{33}/gi, 'AIzaSy[REDACTED]');
    sanitized = sanitized.replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]');

    return sanitized;
  }
}
