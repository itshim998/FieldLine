import { describe, it, expect, vi } from 'vitest';
import { GroqKeyRouter } from '../src/ai/providers/groq-key-router.js';
import { AIProviderError } from '../src/errors/AppError.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('GroqKeyRouter (Pass 26)', () => {
  const sample20Keys = Array.from({ length: 20 }, (_, i) => `gsk_mock_secret_key_${String(i + 1).padStart(2, '0')}`);

  it('should initialize with 20 configured keys starting at Key 01 (index 0)', () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.keyCount).toBe(20);
    expect(router.getCurrentIndex()).toBe(0);
    expect(router.getCurrentSlot()).toBe('01');
    expect(router.getCurrentEpoch()).toBe(0);
    expect(router.getKeyHealthEpoch(0)).toBe(0);

    const snapshots = router.getKeyHealthSnapshots();
    expect(snapshots).toHaveLength(20);
    expect(snapshots[0].slot).toBe('01');
    expect(snapshots[19].slot).toBe('20');
    // Ensure API keys are NOT exposed in public snapshots
    expect((snapshots[0] as any).apiKey).toBeUndefined();
    expect(snapshots[0].isAvailable).toBe(true);
  });

  it('should enforce sticky success across multiple requests (Sticky-success test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    const executedSlots: string[] = [];

    const op = vi.fn(async (_key: string, slot: string) => {
      executedSlots.push(slot);
      return `Success from ${slot}`;
    });

    const res1 = await router.executeRequest(op);
    const res2 = await router.executeRequest(op);
    const res3 = await router.executeRequest(op);

    expect(res1).toBe('Success from 01');
    expect(res2).toBe('Success from 01');
    expect(res3).toBe('Success from 01');
    expect(executedSlots).toEqual(['01', '01', '01']);
    expect(router.getCurrentSlot()).toBe('01');
  });

  it('should failover to next key on qualifying 429 failure (Failover test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    const attemptedSlots: string[] = [];

    const op = vi.fn(async (_key: string, slot: string) => {
      attemptedSlots.push(slot);
      if (slot === '01') {
        const err = new Error('Too Many Requests');
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

  it('should cascade through consecutive failures until a key succeeds (Consecutive failure test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    const attemptedSlots: string[] = [];

    const op = vi.fn(async (_key: string, slot: string) => {
      attemptedSlots.push(slot);
      if (slot === '01') {
        const err = new Error('Rate limit exceeded');
        (err as any).status = 429;
        throw err;
      }
      if (slot === '02') {
        const err = new Error('Internal Server Error');
        (err as any).status = 500;
        throw err;
      }
      return `Success from ${slot}`;
    });

    const result = await router.executeRequest(op);
    expect(result).toBe('Success from 03');
    expect(attemptedSlots).toEqual(['01', '02', '03']);
    expect(router.getCurrentSlot()).toBe('03');
  });

  it('should keep current key sticky after transitions (Persistent current-key test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    const attemptedHistory: string[] = [];

    const makeOp = (failSlots: string[]) => async (_key: string, slot: string) => {
      attemptedHistory.push(slot);
      if (failSlots.includes(slot)) {
        const err = new Error('Service Unavailable');
        (err as any).status = 503;
        throw err;
      }
      return `Result from ${slot}`;
    };

    // 1. Key 01 succeeds
    await router.executeRequest(makeOp([]));
    expect(router.getCurrentSlot()).toBe('01');

    // 2. Key 01 succeeds again
    await router.executeRequest(makeOp([]));
    expect(router.getCurrentSlot()).toBe('01');

    // 3. Key 01 fails -> failover to Key 02 which succeeds
    await router.executeRequest(makeOp(['01']));
    expect(router.getCurrentSlot()).toBe('02');

    // 4. Key 02 succeeds
    await router.executeRequest(makeOp([]));
    expect(router.getCurrentSlot()).toBe('02');

    // 5. Key 02 fails -> failover to Key 03 which succeeds
    await router.executeRequest(makeOp(['02']));
    expect(router.getCurrentSlot()).toBe('03');

    // Total history: 01, 01, 01 (fails) -> 02, 02, 02 (fails) -> 03
    expect(attemptedHistory).toEqual(['01', '01', '01', '02', '02', '02', '03']);
  });

  it('should wrap around from Key 20 to Key 01 (Wrap-around test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });

    // Manually advance to Key 20 (index 19)
    (router as any).currentKeyIndex = 19;
    expect(router.getCurrentSlot()).toBe('20');

    const attemptedSlots: string[] = [];
    const op = vi.fn(async (_key: string, slot: string) => {
      attemptedSlots.push(slot);
      if (slot === '20') {
        const err = new Error('HTTP 502 Bad Gateway');
        (err as any).status = 502;
        throw err;
      }
      return `Wrap around success from ${slot}`;
    });

    const result = await router.executeRequest(op);
    expect(result).toBe('Wrap around success from 01');
    expect(attemptedSlots).toEqual(['20', '01']);
    expect(router.getCurrentSlot()).toBe('01');
  });

  it('should attempt every key at most once and throw AIProviderError upon full exhaustion (Exhaustion test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });

    // Start at Key 14 (index 13)
    (router as any).currentKeyIndex = 13;
    expect(router.getCurrentSlot()).toBe('14');

    const attemptedSlots: string[] = [];
    const op = vi.fn(async (_key: string, slot: string) => {
      attemptedSlots.push(slot);
      const err = new Error('HTTP 429 Rate limited');
      (err as any).status = 429;
      throw err;
    });

    await expect(router.executeRequest(op)).rejects.toThrow(AIProviderError);

    // Verify exactly 20 keys attempted in ring order starting from 14
    expect(attemptedSlots).toEqual([
      '14', '15', '16', '17', '18', '19', '20',
      '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '10', '11', '12', '13'
    ]);
    expect(attemptedSlots).toHaveLength(20);
  });

  it('should mark key permanently invalid on 401/403 authentication failure (Invalid-key health test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });

    const op = vi.fn(async (_key: string, slot: string) => {
      if (slot === '01') {
        const err = new Error('Invalid API Key');
        (err as any).status = 401;
        throw err;
      }
      return `Valid response from ${slot}`;
    });

    const res = await router.executeRequest(op);
    expect(res).toBe('Valid response from 02');

    const snapshots = router.getKeyHealthSnapshots();
    expect(snapshots[0].isPermanentlyInvalid).toBe(true);
    expect(snapshots[0].isAvailable).toBe(false);

    // Next request should immediately start at eligible key rather than repeating dead Key 01
    const nextOp = vi.fn(async (_key: string, slot: string) => `Success ${slot}`);
    await router.executeRequest(nextOp);
    expect(nextOp).toHaveBeenCalledWith(expect.any(String), '02', 1);
  });

  it('should recover temporarily unhealthy key after cooldown expires (Recovery test)', async () => {
    const router = new GroqKeyRouter({
      apiKeys: sample20Keys,
      baseCooldownMs: 100 // 100ms for fast test
    });

    // Key 01 fails with 429
    const failOp = vi.fn(async (_key: string, slot: string) => {
      if (slot === '01') {
        const err = new Error('Rate limit');
        (err as any).status = 429;
        throw err;
      }
      return `Success from ${slot}`;
    });

    await router.executeRequest(failOp);
    expect(router.getCurrentSlot()).toBe('02');

    const snapDuringCooldown = router.getKeyHealthSnapshots();
    expect(snapDuringCooldown[0].cooldownUntil).not.toBeNull();

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 150));

    const snapAfterCooldown = router.getKeyHealthSnapshots();
    expect(snapAfterCooldown[0].isAvailable).toBe(true);
  });

  it('should maintain state invariants safely under concurrent async requests (Concurrency test)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });

    // Simulate 10 simultaneous requests
    const tasks = Array.from({ length: 10 }, (_, i) => {
      return router.executeRequest(async (_key, slot) => {
        // Small async delay to simulate I/O
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        return `Req-${i}-slot-${slot}`;
      });
    });

    const results = await Promise.all(tasks);
    expect(results).toHaveLength(10);
    // All should succeed on Key 01 since no errors were encountered
    results.forEach((r) => expect(r).toContain('slot-01'));
    expect(router.getCurrentSlot()).toBe('01');
  });

  it('should throw immediately on non-failover client error (HTTP 400 Bad Request) without rotating keys', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    const attemptedSlots: string[] = [];

    const op = vi.fn(async (_key: string, slot: string) => {
      attemptedSlots.push(slot);
      const err = new Error('Bad Request: Invalid prompt parameter');
      (err as any).status = 400;
      throw err;
    });

    await expect(router.executeRequest(op)).rejects.toThrow(AIProviderError);
    // Should NOT rotate through 20 keys for a client-side 400
    expect(attemptedSlots).toEqual(['01']);
    expect(router.getCurrentSlot()).toBe('01');
  });

  it('should sanitize API keys and bearer headers from error messages and logs (Security test)', async () => {
    const secretKey = 'gsk_super_secret_production_key_1234567890';
    const router = new GroqKeyRouter({
      apiKeys: [secretKey, 'gsk_second_key_0987654321']
    });

    const op = vi.fn(async () => {
      throw new Error(`Authentication failed with Bearer ${secretKey} and key=${secretKey}`);
    });

    try {
      await router.executeRequest(op);
      expect.unreachable('Should have thrown AIProviderError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(AIProviderError);
      expect(err.message).not.toContain(secretKey);
      expect(err.message).toContain('[REDACTED_KEY_SLOT_01]');
    }
  });

  // =========================================================================
  // Deterministic Routing Cursor Concurrency Invariant Tests (Tests A-E)
  // =========================================================================

  it('Test A: should prevent stale success from rolling back a newer active key', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const bBarrier = createDeferred<string>();

    // Request A starts on 01, fails on 01, advances to 02, and succeeds on 02
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429 Rate limited');
        (err as any).status = 429;
        throw err;
      }
      return `A-success-${slot}`;
    });

    // Request B starts on 01 (concurrently under epoch 0), but blocks until released
    const reqBPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        return await bBarrier.promise;
      }
      return `B-success-${slot}`;
    });

    // Wait for Request A to complete on 02
    const resA = await reqAPromise;
    expect(resA).toBe('A-success-02');
    expect(router.getCurrentSlot()).toBe('02');

    // Release stale Request B to complete on 01
    bBarrier.resolve('B-stale-success-01');
    const resB = await reqBPromise;
    expect(resB).toBe('B-stale-success-01');

    // INVARIANT: Active key MUST remain 02
    expect(router.getCurrentSlot()).toBe('02');
  });

  it('Test B: should prevent stale failure from rolling back or skipping the active key', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const bBarrier = createDeferred<void>();

    // Request A starts on 01, fails on 01, advances to 02, and succeeds on 02
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429');
        (err as any).status = 429;
        throw err;
      }
      return `A-success-${slot}`;
    });

    // Request B starts on 01 concurrently, blocks, then fails on 01 and retries
    const reqBPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        await bBarrier.promise;
        const err = new Error('429 stale');
        (err as any).status = 429;
        throw err;
      }
      return `B-success-${slot}`;
    });

    // A finishes and establishes 02 as active
    const resA = await reqAPromise;
    expect(resA).toBe('A-success-02');
    expect(router.getCurrentSlot()).toBe('02');

    // Release B's delayed failure on 01
    bBarrier.resolve();
    const resB = await reqBPromise;
    expect(resB).toBe('B-success-02');

    // INVARIANT: Active slot remains 02 (not skipped to 03 or reverted to 01)
    expect(router.getCurrentSlot()).toBe('02');
  });

  it('Test C: should handle successive active transitions without corruption from older completions', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const staleBarrier1 = createDeferred<string>();
    const staleBarrier2 = createDeferred<string>();

    // Stale request 1 started while 01 is active
    const staleReq1 = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        return await staleBarrier1.promise;
      }
      return `Stale1-${slot}`;
    });

    // Failover 01 -> 02 (Req A)
    await router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429');
        (err as any).status = 429;
        throw err;
      }
      return `A-${slot}`;
    });
    expect(router.getCurrentSlot()).toBe('02');

    // Stale request 2 started while 02 is active
    const staleReq2 = router.executeRequest(async (_key, slot) => {
      if (slot === '02') {
        return await staleBarrier2.promise;
      }
      return `Stale2-${slot}`;
    });

    // Failover 02 -> 03 (Req B)
    await router.executeRequest(async (_key, slot) => {
      if (slot === '02') {
        const err = new Error('500');
        (err as any).status = 500;
        throw err;
      }
      return `B-${slot}`;
    });
    expect(router.getCurrentSlot()).toBe('03');

    // Release older in-flight requests from epochs 0 and 1
    staleBarrier1.resolve('Stale1-Done');
    staleBarrier2.resolve('Stale2-Done');

    await Promise.all([staleReq1, staleReq2]);

    // INVARIANT: Final active key MUST remain 03
    expect(router.getCurrentSlot()).toBe('03');
  });

  it('Test D: should preserve wrap-around transitions when older requests complete late', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    // Advance router to slot 20
    (router as any).currentKeyIndex = 19;
    expect(router.getCurrentSlot()).toBe('20');

    const lateBarrier = createDeferred<string>();

    // Late request starts on 20
    const lateReq = router.executeRequest(async (_key, slot) => {
      if (slot === '20') {
        return await lateBarrier.promise;
      }
      return `Late-${slot}`;
    });

    // Request A on 20 fails -> wraps to 01 and succeeds
    const resA = await router.executeRequest(async (_key, slot) => {
      if (slot === '20') {
        const err = new Error('503');
        (err as any).status = 503;
        throw err;
      }
      return `A-success-${slot}`;
    });
    expect(resA).toBe('A-success-01');
    expect(router.getCurrentSlot()).toBe('01');

    // Now resolve late request on 20
    lateBarrier.resolve('Late-success-20');
    const resLate = await lateReq;
    expect(resLate).toBe('Late-success-20');

    // INVARIANT: Active key must remain 01 (not rolled back to 20)
    expect(router.getCurrentSlot()).toBe('01');
  });

  it('Test E: should maintain bounded single-pass execution across concurrent requests during widespread failure', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });

    // 5 concurrent requests where all keys return 429
    const tasks = Array.from({ length: 5 }, () => {
      const attemptedInThisReq: string[] = [];
      return router
        .executeRequest(async (_key, slot) => {
          attemptedInThisReq.push(slot);
          const err = new Error(`429 on ${slot}`);
          (err as any).status = 429;
          throw err;
        })
        .catch((err) => {
          expect(err).toBeInstanceOf(AIProviderError);
          // Each individual request must attempt exactly 20 distinct keys (no duplicates, no infinite loops)
          expect(attemptedInThisReq).toHaveLength(20);
          const unique = new Set(attemptedInThisReq);
          expect(unique.size).toBe(20);
          return 'failed_as_expected';
        });
    });

    const results = await Promise.all(tasks);
    expect(results).toEqual(Array(5).fill('failed_as_expected'));

    // Router currentIndex must be a valid slot index (0 to 19)
    expect(router.getCurrentIndex()).toBeGreaterThanOrEqual(0);
    expect(router.getCurrentIndex()).toBeLessThan(20);
  });

  // =========================================================================
  // Deterministic Per-Key Health Concurrency Invariant Tests (Section 13)
  // =========================================================================

  it('Health Concurrency Test 1: should prevent stale success from resurrecting a key placed in cooldown by a newer failure', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const slowReqBarrier = createDeferred<string>();

    // Request A starts on 01 (slow)
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        return await slowReqBarrier.promise;
      }
      return `A-success-${slot}`;
    });

    // Request B starts on 01, fails 429, advances to 02, and succeeds on 02
    const reqBPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429 Rate Limited');
        (err as any).status = 429;
        throw err;
      }
      return `B-success-${slot}`;
    });

    const resB = await reqBPromise;
    expect(resB).toBe('B-success-02');
    expect(router.getCurrentSlot()).toBe('02');

    // Key 01 is now in cooldown from Request B's 429
    const snapBeforeStaleSuccess = router.getKeyHealthSnapshots();
    expect(snapBeforeStaleSuccess[0].isAvailable).toBe(false);
    expect(snapBeforeStaleSuccess[0].cooldownUntil).not.toBeNull();
    expect(snapBeforeStaleSuccess[0].failureCount).toBe(1);

    // Now release slow Request A to succeed on 01
    slowReqBarrier.resolve('A-stale-success-01');
    const resA = await reqAPromise;
    expect(resA).toBe('A-stale-success-01');

    // INVARIANT: Key 01 must remain in cooldown! Stale success must NOT resurrect Key 01
    const snapAfterStaleSuccess = router.getKeyHealthSnapshots();
    expect(snapAfterStaleSuccess[0].isAvailable).toBe(false);
    expect(snapAfterStaleSuccess[0].cooldownUntil).not.toBeNull();
    expect(snapAfterStaleSuccess[0].failureCount).toBe(1);
    expect(router.getCurrentSlot()).toBe('02');
  });

  it('Health Concurrency Test 2: should prevent stale failure from poisoning a newly healthy key', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const slowReqBarrier = createDeferred<void>();

    // Request A starts on 01 (slow, will eventually fail)
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        await slowReqBarrier.promise;
        const err = new Error('429 Slow Request Failed');
        (err as any).status = 429;
        throw err;
      }
      return `A-fallback-${slot}`;
    });

    // Newer Request B succeeds on 01 and establishes healthy state
    const resB = await router.executeRequest(async () => 'B-immediate-success-01');
    expect(resB).toBe('B-immediate-success-01');

    const snapAfterB = router.getKeyHealthSnapshots();
    expect(snapAfterB[0].isAvailable).toBe(true);
    expect(snapAfterB[0].failureCount).toBe(0);
    expect(snapAfterB[0].cooldownUntil).toBeNull();

    // Now release slow Request A to fail on 01 (and complete on 02)
    slowReqBarrier.resolve();
    const resA = await reqAPromise;
    expect(resA).toBe('A-fallback-02');

    // INVARIANT: Key 01 must remain healthy! Stale failure must NOT poison Key 01
    const snapAfterA = router.getKeyHealthSnapshots();
    expect(snapAfterA[0].isAvailable).toBe(true);
    expect(snapAfterA[0].failureCount).toBe(0);
    expect(snapAfterA[0].cooldownUntil).toBeNull();
  });

  it('Health Concurrency Test 3: should prevent stale success from resurrecting a permanently invalid key (401)', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const slowReqBarrier = createDeferred<string>();

    // Request A starts on 01 (slow)
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        return await slowReqBarrier.promise;
      }
      return `A-success-${slot}`;
    });

    // Newer Request B encounters 401 (Invalid Key) on 01
    const reqBPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('401 Unauthorized API Key');
        (err as any).status = 401;
        throw err;
      }
      return `B-success-${slot}`;
    });

    const resB = await reqBPromise;
    expect(resB).toBe('B-success-02');
    expect(router.getCurrentSlot()).toBe('02');

    // Key 01 is now permanently invalid
    const snapAfterB = router.getKeyHealthSnapshots();
    expect(snapAfterB[0].isPermanentlyInvalid).toBe(true);
    expect(snapAfterB[0].isAvailable).toBe(false);

    // Now release slow Request A to succeed on 01
    slowReqBarrier.resolve('A-stale-success-01');
    const resA = await reqAPromise;
    expect(resA).toBe('A-stale-success-01');

    // INVARIANT: Key 01 must remain permanently invalid!
    const snapAfterA = router.getKeyHealthSnapshots();
    expect(snapAfterA[0].isPermanentlyInvalid).toBe(true);
    expect(snapAfterA[0].isAvailable).toBe(false);
    expect(router.getCurrentSlot()).toBe('02');
  });

  it('Health Concurrency Test 4: should prevent stale 429 from undoing a newer recovery', async () => {
    const router = new GroqKeyRouter({
      apiKeys: sample20Keys,
      baseCooldownMs: 50 // short cooldown
    });

    // 1. Initial 429 puts Key 01 in cooldown
    await router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429 Initial');
        (err as any).status = 429;
        throw err;
      }
      return `Init-${slot}`;
    });
    expect(router.getCurrentSlot()).toBe('02');

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 70));
    expect(router.getKeyHealthSnapshots()[0].isAvailable).toBe(true);

    const slowReqBarrier = createDeferred<void>();

    // Request A starts on 01 (slow, will return 429)
    (router as any).currentKeyIndex = 0;
    const reqAPromise = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        await slowReqBarrier.promise;
        const err = new Error('429 Stale Failure');
        (err as any).status = 429;
        throw err;
      }
      return `A-recovery-${slot}`;
    });

    // Newer Request B on Key 01 succeeds and clears cooldown
    (router as any).currentKeyIndex = 0;
    const resB = await router.executeRequest(async () => 'B-recovery-success-01');
    expect(resB).toBe('B-recovery-success-01');
    expect(router.getKeyHealthSnapshots()[0].cooldownUntil).toBeNull();
    expect(router.getKeyHealthSnapshots()[0].failureCount).toBe(0);

    // Release slow Request A's stale 429
    slowReqBarrier.resolve();
    await reqAPromise;

    // INVARIANT: Key 01 must remain healthy, stale 429 must not reintroduce cooldown!
    const snapAfterA = router.getKeyHealthSnapshots();
    expect(snapAfterA[0].isAvailable).toBe(true);
    expect(snapAfterA[0].cooldownUntil).toBeNull();
    expect(snapAfterA[0].failureCount).toBe(0);
  });

  it('Health Concurrency Test 5: should handle multiple concurrent old requests completing in arbitrary order without health or cursor rollback', async () => {
    const router = new GroqKeyRouter({ apiKeys: sample20Keys });
    expect(router.getCurrentSlot()).toBe('01');

    const barrier1 = createDeferred<string>();
    const barrier2 = createDeferred<void>();
    const barrier3 = createDeferred<string>();
    const newerAt02Barrier = createDeferred<void>();
    const releaseNewerAt02Barrier = createDeferred<void>();

    // 1. Old Req 1 on 01
    const req1 = router.executeRequest(async (_key, slot) => {
      if (slot === '01') return await barrier1.promise;
      return `Req1-${slot}`;
    });

    // 2. Old Req 2 on 01
    const req2 = router
      .executeRequest(async (_key, slot) => {
        if (slot === '01') {
          await barrier2.promise;
          const err = new Error('429 on 01');
          (err as any).status = 429;
          throw err;
        }
        const err = new Error('429 on fallback ' + slot);
        (err as any).status = 429;
        throw err;
      })
      .catch(() => 'Req2-Handled');

    // 3. Newer Failover: 01 fails -> advances to 02 -> signals barrier -> 02 fails -> advances to 03 -> 03 succeeds
    const newerReq = router.executeRequest(async (_key, slot) => {
      if (slot === '01') {
        const err = new Error('429 on 01');
        (err as any).status = 429;
        throw err;
      }
      if (slot === '02') {
        newerAt02Barrier.resolve();
        await releaseNewerAt02Barrier.promise;
        const err = new Error('500 on 02');
        (err as any).status = 500;
        throw err;
      }
      return `Newer-success-03`;
    });

    // Wait until newerReq has failed on 01 and transitioned active cursor to 02
    await newerAt02Barrier.promise;
    expect(router.getCurrentSlot()).toBe('02');

    // 4. Old Req 3 starts while 02 is active
    const req3 = router.executeRequest(async (_key, slot) => {
      if (slot === '02') return await barrier3.promise;
      return `Req3-${slot}`;
    });

    // Release newerReq on 02 to fail 500 and advance to 03
    releaseNewerAt02Barrier.resolve();
    const newerRes = await newerReq;
    expect(newerRes).toBe('Newer-success-03');
    expect(router.getCurrentSlot()).toBe('03');

    // 5. Resolve old requests in arbitrary mixed order: 2 (failure on 01), 1 (success on 01), 3 (success on 02)
    barrier2.resolve();
    barrier1.resolve('Req1-Success');
    barrier3.resolve('Req3-Success');

    await Promise.all([req1, req2, req3]);

    // INVARIANT: Active key remains 03, no stale completion rolls anything backward
    expect(router.getCurrentSlot()).toBe('03');

    // INVARIANT: Health state of 01 and 02 reflects newer failure states and was not resurrected by stale successes
    const snaps = router.getKeyHealthSnapshots();
    expect(snaps[0].cooldownUntil).not.toBeNull();
    expect(snaps[1].cooldownUntil).not.toBeNull();
  });
});
