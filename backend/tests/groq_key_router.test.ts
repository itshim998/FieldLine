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

    const snapshots = router.getKeyHealthSnapshots();
    expect(snapshots).toHaveLength(20);
    expect(snapshots[0].slot).toBe('01');
    expect(snapshots[19].slot).toBe('20');
    // Ensure API keys are NOT exposed in public snapshots
    expect((snapshots[0] as any).apiKey).toBeUndefined();
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
  // Deterministic Concurrency Invariant Tests (Sections 7 & 8)
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

    // INVARIANT: Key 01 health gets success recorded, but active key MUST remain 02
    expect(router.getCurrentSlot()).toBe('02');
    const snapshots = router.getKeyHealthSnapshots();
    expect(snapshots[0].successCount).toBe(1);
    expect(snapshots[1].successCount).toBe(1);
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
});
