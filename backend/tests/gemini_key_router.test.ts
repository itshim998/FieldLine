import { describe, it, expect, vi } from 'vitest';
import { GeminiKeyRouter } from '../src/ai/providers/gemini-key-router.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { extractGeminiApiKeys } from '../src/config/env.js';

describe('GeminiKeyRouter (Pass 1)', () => {
  const sample20Keys = Array.from(
    { length: 20 },
    (_, i) => `AIzaSyMockGeminiKey_${String(i + 1).padStart(2, '0')}_test`
  );

  // 1. Extraction of sparse and 20-slot keys
  describe('Key Extraction & Initialization', () => {
    it('should initialize with 20 configured keys starting at Key 01 (index 0)', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });
      expect(router.keyCount).toBe(20);
      expect(router.getCurrentIndex()).toBe(0);
      expect(router.getCurrentSlot()).toBe('01');
      expect(router.getCurrentEpoch()).toBe(0);
      expect(router.getKeyHealthEpoch(0)).toBe(0);
      expect(router.getKeyTokenUsage(0)).toBe(0);
      expect(router.tokenLimitPerKey).toBe(55000);

      const snapshots = router.getKeyHealthSnapshots();
      expect(snapshots).toHaveLength(20);
      expect(snapshots[0].slot).toBe('01');
      expect(snapshots[19].slot).toBe('20');
      // Ensure raw API keys are never exposed in public health snapshots
      expect((snapshots[0] as any).apiKey).toBeUndefined();
      expect(snapshots[0].isAvailable).toBe(true);
      expect(snapshots[0].estimatedSessionTokens).toBe(0);
    });

    it('should throw AIProviderError when initialized with empty keys array', () => {
      expect(() => new GeminiKeyRouter({ apiKeys: [] })).toThrow(AIProviderError);
      expect(() => new GeminiKeyRouter({ apiKeys: [] })).toThrow(/At least one Gemini API key is required/);
    });

    it('should extract sparse keys and preserve sequential slot numbering in router', () => {
      const envSource = {
        GEMINI_API_KEY_02: 'AIzaSyKeyTwo',
        GEMINI_API_KEY_08: 'AIzaSyKeyEight',
        GEMINI_API_KEY_15: 'AIzaSyKeyFifteen'
      };

      const { keys } = extractGeminiApiKeys(envSource);
      expect(keys).toEqual(['AIzaSyKeyTwo', 'AIzaSyKeyEight', 'AIzaSyKeyFifteen']);

      const router = new GeminiKeyRouter({ apiKeys: keys });
      expect(router.keyCount).toBe(3);
      expect(router.getCurrentSlot()).toBe('01');
      expect(router.acquireLiveSessionKey().apiKey).toBe('AIzaSyKeyTwo');
    });

    it('should support fallback single GEMINI_API_KEY extraction', () => {
      const envSource = {
        GEMINI_API_KEY: 'AIzaSySingleFallback'
      };

      const { keys } = extractGeminiApiKeys(envSource);
      expect(keys).toEqual(['AIzaSySingleFallback']);

      const router = new GeminiKeyRouter({ apiKeys: keys });
      expect(router.keyCount).toBe(1);
      expect(router.getCurrentSlot()).toBe('01');
      expect(router.acquireLiveSessionKey().apiKey).toBe('AIzaSySingleFallback');
    });
  });

  // 2. Sticky key acquisition and round-robin progression
  describe('Sticky Key Acquisition & Round-Robin Progression', () => {
    it('should enforce sticky key acquisition when the active key is healthy', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      const session1 = router.acquireLiveSessionKey();
      const session2 = router.acquireLiveSessionKey();
      const session3 = router.acquireLiveSessionKey();

      expect(session1.slot).toBe('01');
      expect(session2.slot).toBe('01');
      expect(session3.slot).toBe('01');
      expect(router.getCurrentSlot()).toBe('01');
      expect(router.getCurrentEpoch()).toBe(0);
    });

    it('should advance to the next healthy key in round-robin order when current key is in cooldown', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys, baseCooldownMs: 5000 });

      // Trigger cooldown on Key 01 (e.g. 429 error)
      const err = new Error('RESOURCE_EXHAUSTED: Rate limit exceeded');
      (err as any).status = 429;
      router.recordFailure(0, err);

      expect(router.isKeyHealthy(0)).toBe(false);

      // Next acquisition should advance to Key 02
      const active = router.acquireLiveSessionKey();
      expect(active.slot).toBe('02');
      expect(active.index).toBe(1);
      expect(active.apiKey).toBe(sample20Keys[1]);
      expect(router.getCurrentSlot()).toBe('02');
    });

    it('should wrap around from the last key to the first healthy key', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys.slice(0, 3) });

      // Rotate from 01 -> 02 -> 03
      router.rotateToNextKey(0, 'test_rotation');
      expect(router.getCurrentSlot()).toBe('02');

      router.rotateToNextKey(1, 'test_rotation');
      expect(router.getCurrentSlot()).toBe('03');

      // Wraps around to 01
      router.rotateToNextKey(2, 'test_rotation');
      expect(router.getCurrentSlot()).toBe('01');
    });

    it('should throw when all keys are permanently invalid (401/403)', () => {
      const smallKeys = sample20Keys.slice(0, 2);
      const router = new GeminiKeyRouter({ apiKeys: smallKeys });

      // Invalidate both keys
      router.recordFailure(0, { slot: '01', index: 0, status: 401, message: 'Invalid API Key', isFailoverEligible: true });
      router.recordFailure(1, { slot: '02', index: 1, status: 403, message: 'Permission Denied', isFailoverEligible: true });

      expect(() => router.acquireLiveSessionKey()).toThrow(AIProviderError);
      expect(() => router.acquireLiveSessionKey()).toThrow(/All configured Gemini API keys are permanently invalid/);
    });

    it('should fallback gracefully to best available key when all healthy keys are in cooldown', () => {
      const smallKeys = sample20Keys.slice(0, 2);
      const router = new GeminiKeyRouter({ apiKeys: smallKeys, baseCooldownMs: 10000 });

      // Put both keys in cooldown
      router.recordFailure(0, { slot: '01', index: 0, status: 429, message: 'Rate limited', isFailoverEligible: true });
      router.recordFailure(1, { slot: '02', index: 1, status: 429, message: 'Rate limited', isFailoverEligible: true });

      // Should not throw, should fallback to a non-permanently-invalid key
      const active = router.acquireLiveSessionKey();
      expect(['01', '02']).toContain(active.slot);
    });
  });

  // 3. Cooldown on 429 errors and permanent invalidation on 401/403
  describe('Error Classification, Cooldown & Invalidation', () => {
    it('should set exponential cooldown on 429 RESOURCE_EXHAUSTED', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys, baseCooldownMs: 1000, maxCooldownMs: 30000 });

      const attemptErr = router.recordFailure(0, new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
      expect(attemptErr.status).toBe(429);
      expect(attemptErr.isFailoverEligible).toBe(true);

      const snapshots = router.getKeyHealthSnapshots();
      expect(snapshots[0].failureCount).toBe(1);
      expect(snapshots[0].lastErrorStatus).toBe(429);
      expect(snapshots[0].cooldownUntil).not.toBeNull();
      expect(snapshots[0].isPermanentlyInvalid).toBe(false);
      expect(snapshots[0].isAvailable).toBe(false);

      // Second failure on same key increases cooldown exponentially
      router.recordFailure(0, new Error('RESOURCE_EXHAUSTED'));
      const snapshots2 = router.getKeyHealthSnapshots();
      expect(snapshots2[0].failureCount).toBe(2);
    });

    it('should respect retry-after header or retryAfterMs property on 429 errors', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });
      const errorWithRetry = {
        status: 429,
        retryAfterMs: 12000,
        message: 'Rate limit exceeded'
      };

      router.recordFailure(0, errorWithRetry);
      const snapshot = router.getKeyHealthSnapshots()[0];
      expect(snapshot.cooldownUntil).not.toBeNull();
      const cooldownRemaining = snapshot.cooldownUntil!.getTime() - Date.now();
      expect(cooldownRemaining).toBeGreaterThan(11000);
      expect(cooldownRemaining).toBeLessThanOrEqual(13000);
    });

    it('should permanently invalidate keys on 401 or 403', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      router.recordFailure(0, new Error('API_KEY_INVALID: API key not valid. Please pass a valid API key.'));
      const snapshot = router.getKeyHealthSnapshots()[0];

      expect(snapshot.isPermanentlyInvalid).toBe(true);
      expect(snapshot.isAvailable).toBe(false);

      // Even if a subsequent recordSuccess arrives (e.g. out of order), permanent invalidation is preserved
      router.recordSuccess(0);
      expect(router.getKeyHealthSnapshots()[0].isPermanentlyInvalid).toBe(true);

      // acquireLiveSessionKey skips permanently invalid key
      const active = router.acquireLiveSessionKey();
      expect(active.slot).toBe('02');
    });

    it('should reset failure count and clear cooldown on recordSuccess', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      router.recordFailure(0, new Error('RESOURCE_EXHAUSTED'));
      expect(router.getKeyHealthSnapshots()[0].failureCount).toBe(1);
      expect(router.getKeyHealthSnapshots()[0].cooldownUntil).not.toBeNull();

      router.recordSuccess(0);
      const snapshot = router.getKeyHealthSnapshots()[0];
      expect(snapshot.failureCount).toBe(0);
      expect(snapshot.successCount).toBe(1);
      expect(snapshot.cooldownUntil).toBeNull();
      expect(snapshot.isAvailable).toBe(true);
    });
  });

  // 4. Proactive key rotation when token budget reaches safety threshold
  describe('Token Budget Tracking & Proactive Rotation', () => {
    it('should track cumulative session tokens and flag when safety threshold is reached', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys, tokenLimitPerKey: 55000 });

      // Add 20,000 tokens
      const res1 = router.recordTokenUsage(0, 20000);
      expect(res1.totalTokens).toBe(20000);
      expect(res1.limitExceeded).toBe(false);
      expect(router.getKeyTokenUsage(0)).toBe(20000);
      expect(router.isKeyHealthy(0)).toBe(true);

      // Add 34,000 tokens (total 54,000, still below 55K)
      const res2 = router.recordTokenUsage(0, 34000);
      expect(res2.totalTokens).toBe(54000);
      expect(res2.limitExceeded).toBe(false);
      expect(router.isKeyHealthy(0)).toBe(true);

      // Add 1,500 tokens (total 55,500 >= 55K threshold)
      const res3 = router.recordTokenUsage(0, 1500);
      expect(res3.totalTokens).toBe(55500);
      expect(res3.limitExceeded).toBe(true);
      expect(router.isKeyHealthy(0)).toBe(false);
    });

    it('should proactively acquire the next healthy key when current key reaches token threshold', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys, tokenLimitPerKey: 55000 });

      // Slot 01 is currently active
      expect(router.acquireLiveSessionKey().slot).toBe('01');

      // Simulate token consumption reaching 55,000 tokens on Key 01
      router.recordTokenUsage(0, 55000);

      // Next acquisition should proactively advance to Key 02
      const active = router.acquireLiveSessionKey();
      expect(active.slot).toBe('02');
      expect(active.index).toBe(1);
      expect(active.apiKey).toBe(sample20Keys[1]);
      expect(router.getCurrentSlot()).toBe('02');
    });

    it('should atomically transition cursor and epoch on rotateToNextKey', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      expect(router.getCurrentSlot()).toBe('01');
      expect(router.getCurrentEpoch()).toBe(0);

      const rotated = router.rotateToNextKey(0, 'token_limit_reached');
      expect(rotated.slot).toBe('02');
      expect(rotated.index).toBe(1);
      expect(rotated.routingEpoch).toBe(1);
      expect(router.getCurrentSlot()).toBe('02');
      expect(router.getCurrentEpoch()).toBe(1);
    });

    it('should allow token usage reset for recycled keys', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys, tokenLimitPerKey: 55000 });

      router.recordTokenUsage(0, 60000);
      expect(router.isKeyHealthy(0)).toBe(false);

      router.resetTokenUsage(0);
      expect(router.getKeyTokenUsage(0)).toBe(0);
      expect(router.isKeyHealthy(0)).toBe(true);
    });
  });

  // 5. Concurrency and stale epoch protection
  describe('Concurrency & Stale Epoch Protection', () => {
    it('should ignore stale rotateToNextKey calls from an outdated key slot', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      // Advance router from 01 to 02
      router.rotateToNextKey(0, 'legitimate_rotation_1');
      expect(router.getCurrentSlot()).toBe('02');
      expect(router.getCurrentEpoch()).toBe(1);

      // An old async worker tries to rotate from slot 0 (index 0) - this is stale!
      const result = router.rotateToNextKey(0, 'stale_rotation_attempt');
      // Router should NOT rotate to slot 03; it should remain at slot 02 with unchanged epoch
      expect(result.slot).toBe('02');
      expect(router.getCurrentSlot()).toBe('02');
      expect(router.getCurrentEpoch()).toBe(1);
    });

    it('should reject stale recordSuccess with outdated routingEpoch', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      const staleRoutingEpoch = 999;
      // Record success with mismatching routing epoch
      router.recordSuccess(1, staleRoutingEpoch);

      // Active cursor should remain at 01
      expect(router.getCurrentSlot()).toBe('01');
    });

    it('should reject stale recordFailure with outdated healthEpoch', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      // Key 01 has healthEpoch = 0
      // Simulate state transition bumping healthEpoch
      router.recordSuccess(0);
      expect(router.getKeyHealthEpoch(0)).toBe(1);

      // A delayed failure from the previous epoch (attemptHealthEpoch: 0) arrives
      router.recordFailure(
        0,
        { slot: '01', index: 0, status: 429, message: 'Delayed 429', isFailoverEligible: true },
        router.getCurrentEpoch(),
        0 // Stale health epoch
      );

      // Failure count should NOT be mutated because healthEpoch was stale
      expect(router.getKeyHealthSnapshots()[0].failureCount).toBe(0);
    });

    it('should handle rapid concurrent failovers safely without corrupted epochs', async () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      // Simulate 5 simultaneous requests experiencing 429 errors
      const failoverPromises = Array.from({ length: 5 }, (_, i) => {
        const curIdx = router.getCurrentIndex();
        return Promise.resolve().then(() => {
          router.recordFailure(curIdx, new Error('RESOURCE_EXHAUSTED'));
        });
      });

      await Promise.all(failoverPromises);

      // Active slot must have advanced and routing epoch must be positive and consistent
      expect(router.getCurrentEpoch()).toBeGreaterThan(0);
      expect(router.getCurrentIndex()).toBeGreaterThanOrEqual(1);
      expect(router.getCurrentSlot()).not.toBe('01');
    });
  });

  // 6. Error sanitization and executeRequest pipeline
  describe('Sanitization & executeRequest Pipeline', () => {
    it('should sanitize Gemini API keys from error messages', () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });
      const sensitiveKey = sample20Keys[0];

      const rawError = `Request failed: key=${sensitiveKey} with AIzaSyMockGeminiKey_01_test`;
      const sanitized = router.sanitizeMessage(rawError);

      expect(sanitized).not.toContain(sensitiveKey);
      expect(sanitized).toContain('[REDACTED_KEY_SLOT_01]');
    });

    it('should execute operation with sticky key and succeed', async () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });
      const executedSlots: string[] = [];

      const op = vi.fn(async (_key: string, slot: string) => {
        executedSlots.push(slot);
        return `Success from ${slot}`;
      });

      const res1 = await router.executeRequest(op);
      const res2 = await router.executeRequest(op);

      expect(res1).toBe('Success from 01');
      expect(res2).toBe('Success from 01');
      expect(executedSlots).toEqual(['01', '01']);
      expect(router.getCurrentSlot()).toBe('01');
    });

    it('should failover to next key when executeRequest encounters 429', async () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });
      const attemptedSlots: string[] = [];

      const op = vi.fn(async (_key: string, slot: string) => {
        attemptedSlots.push(slot);
        if (slot === '01') {
          const err = new Error('RESOURCE_EXHAUSTED: Rate limit reached');
          (err as any).status = 429;
          throw err;
        }
        return `Success from ${slot}`;
      });

      const result = await router.executeRequest(op);
      expect(result).toBe('Success from 02');
      expect(attemptedSlots).toEqual(['01', '02']);
      expect(router.getCurrentSlot()).toBe('02');
    });

    it('should immediately throw non-failover client error (400) without key rotation', async () => {
      const router = new GeminiKeyRouter({ apiKeys: sample20Keys });

      const op = vi.fn(async () => {
        const err = new Error('INVALID_ARGUMENT: Bad request prompt');
        (err as any).status = 400;
        throw err;
      });

      await expect(router.executeRequest(op)).rejects.toThrow(AIProviderError);
      // Active key should NOT rotate on 400
      expect(router.getCurrentSlot()).toBe('01');
    });
  });
});
