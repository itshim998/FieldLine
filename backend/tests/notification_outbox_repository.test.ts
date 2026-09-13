import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase, runInTransaction } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteNotificationOutboxRepository } from '../src/repositories/notification-outbox.repository.js';
import { ConflictError, DatabaseError } from '../src/errors/index.js';
import type { GenerateAnomalyMessageInput } from '../src/services/anomaly/anomaly-message.types.js';

describe('Phase 4 — NotificationOutboxRepository & Persistence Invariants', () => {
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let outboxRepo: SqliteNotificationOutboxRepository;

  let testProjectId: string;
  let testScheduleId: string;
  let testActivityId: string;
  let testProgressUpdateId: string;
  let testMatchId: string;

  const sampleMessageInput: GenerateAnomalyMessageInput = {
    projectName: 'Outbox Test Project',
    activityExternalId: 'ACT-001',
    activityName: 'Structural Steel Erection',
    activityLocation: 'Zone 1',
    reportDate: '2026-08-16',
    reporterName: 'Worker A',
    previousPercent: 10,
    reportedPercent: 85,
    anomalyScore: 0.88,
    anomalySeverity: 'high',
    anomalyReasons: ['Large jump in single shift'],
    activityMatchId: 'sample_match_id'
  };

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    outboxRepo = new SqliteNotificationOutboxRepository(() => db);

    const proj = projectRepo.create({
      code: 'OUTBOX-P4',
      name: 'Outbox Test Project'
    });
    testProjectId = proj.id;

    const sched = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Master Schedule',
      sourceType: 'manual',
      isBaseline: true
    });
    testScheduleId = sched.id;

    const act = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-001',
      name: 'Structural Steel Erection',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      baselineProgress: 0
    });
    testActivityId = act.id;

    const pu = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-16',
      rawText: 'Steel erection progress 85%',
      sourceType: 'manual',
      status: 'received'
    });
    testProgressUpdateId = pu.id;

    const match = activityMatchRepo.create({
      projectId: testProjectId,
      progressUpdateId: testProgressUpdateId,
      activityId: testActivityId,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed',
      anomalyScore: 0.88,
      anomalySeverity: 'high'
    });
    testMatchId = match.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Outbox Creation & Logical Idempotency', () => {
    it('1. Creates a valid pending outbox row with defaults', () => {
      const item = outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      expect(item.id).toBeDefined();
      expect(item.status).toBe('pending');
      expect(item.attemptCount).toBe(0);
      expect(item.maxAttempts).toBe(5);
      expect(item.idempotencyKey).toBe(`fieldline-anomaly-alert:${testMatchId}`);

      const fetched = outboxRepo.getById(item.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.activityMatchId).toBe(testMatchId);
    });

    it('2. Enforces logical idempotency: prevents duplicate notification row for same (project, match, type, channel)', () => {
      outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      expect(() => {
        outboxRepo.create({
          projectId: testProjectId,
          activityMatchId: testMatchId,
          notificationType: 'anomaly_alert',
          channel: 'email',
          payload: {
            messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
            message: null
          }
        });
      }).toThrow(ConflictError);
    });

    it('3. Enforces uniqueness on idempotency_key', () => {
      outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        idempotencyKey: 'custom-unique-key-123',
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      // Different match ID, but same idempotency key
      const secondMatch = activityMatchRepo.create({
        projectId: testProjectId,
        progressUpdateId: testProgressUpdateId,
        activityId: testActivityId,
        confidenceScore: 0.9,
        matchMethod: 'exact_id',
        status: 'suggested'
      });

      expect(() => {
        outboxRepo.create({
          projectId: testProjectId,
          activityMatchId: secondMatch.id,
          idempotencyKey: 'custom-unique-key-123',
          payload: {
            messageInput: { ...sampleMessageInput, activityMatchId: secondMatch.id },
            message: null
          }
        });
      }).toThrow(ConflictError);
    });
  });

  describe('Atomicity & Transaction Rollback Invariants', () => {
    it('4. Atomicity Rollback: When outbox insertion fails, the anomaly match rolls back', () => {
      const preMatches = activityMatchRepo.listByProjectId(testProjectId);
      const preOutboxCount = outboxRepo.count(testProjectId);

      expect(() => {
        runInTransaction(() => {
          activityMatchRepo.create({
            id: 'failed_match_tx',
            projectId: testProjectId,
            progressUpdateId: testProgressUpdateId,
            activityId: testActivityId,
            confidenceScore: 1.0,
            matchMethod: 'exact_id',
            status: 'confirmed'
          });

          // Deliberately trigger foreign key error by passing invalid project ID
          outboxRepo.create({
            projectId: 'non_existent_project_id',
            activityMatchId: 'failed_match_tx',
            payload: {
              messageInput: { ...sampleMessageInput, activityMatchId: 'failed_match_tx' },
              message: null
            }
          });
        });
      }).toThrow();

      // Verify that 'failed_match_tx' was rolled back completely
      const postMatches = activityMatchRepo.listByProjectId(testProjectId);
      expect(postMatches.length).toBe(preMatches.length);
      expect(activityMatchRepo.getById('failed_match_tx')).toBeNull();
      expect(outboxRepo.count(testProjectId)).toBe(preOutboxCount);
    });

    it('5. Atomicity in persistMatchesAndEventsAtomically: persists matches and notifications together', () => {
      const matchId1 = 'batch_match_1';
      const matchId2 = 'batch_match_2';

      const update2 = progressUpdateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-17',
        rawText: 'Batch update',
        sourceType: 'manual',
        status: 'received'
      });

      activityMatchRepo.persistMatchesAndEventsAtomically({
        projectId: testProjectId,
        progressUpdateId: update2.id,
        matches: [
          {
            id: matchId1,
            projectId: testProjectId,
            progressUpdateId: update2.id,
            activityId: testActivityId,
            confidenceScore: 1.0,
            matchMethod: 'exact_id',
            status: 'confirmed',
            anomalySeverity: 'high'
          },
          {
            id: matchId2,
            projectId: testProjectId,
            progressUpdateId: update2.id,
            activityId: testActivityId,
            confidenceScore: 0.8,
            matchMethod: 'exact_id',
            status: 'suggested',
            anomalySeverity: 'normal'
          }
        ],
        events: [
          {
            projectId: testProjectId,
            eventType: 'match_auto_confirmed',
            summary: 'Auto confirmed 1'
          }
        ],
        notifications: [
          {
            projectId: testProjectId,
            activityMatchId: matchId1,
            payload: {
              messageInput: { ...sampleMessageInput, activityMatchId: matchId1 },
              message: null
            }
          }
        ]
      });

      const outbox1 = outboxRepo.getByActivityMatchId(matchId1);
      expect(outbox1).not.toBeNull();
      expect(outbox1?.status).toBe('pending');

      const outbox2 = outboxRepo.getByActivityMatchId(matchId2);
      expect(outbox2).toBeNull(); // Normal severity -> no outbox row
    });
  });

  describe('Safe Claiming & Concurrency Invariants', () => {
    it('6. Atomically claims next eligible row and updates attempt count', () => {
      const created = outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      const claimed = outboxRepo.claimNextEligible();
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe('processing');
      expect(claimed?.attemptCount).toBe(1);
      expect(claimed?.lockedAt).toBeDefined();

      // Second claim attempt immediately finds nothing (row is locked in processing)
      const secondClaim = outboxRepo.claimNextEligible();
      expect(secondClaim).toBeNull();
    });

    it('7. Concurrency Safety: Two claim requests cannot claim the same notification simultaneously', () => {
      outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      const worker1Claim = outboxRepo.claimNextEligible();
      const worker2Claim = outboxRepo.claimNextEligible();

      expect(worker1Claim).not.toBeNull();
      expect(worker2Claim).toBeNull();
    });

    it('8. Does not claim retry_wait rows before next_attempt_at', () => {
      const item = outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      // Claim and schedule retry in the future (+10 minutes)
      outboxRepo.claimNextEligible();
      const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      outboxRepo.scheduleRetry(item.id, 'RATE_LIMIT', 'HTTP 429', futureTime);

      // Current time cannot claim it
      const currentClaim = outboxRepo.claimNextEligible();
      expect(currentClaim).toBeNull();

      // Future time beyond next_attempt_at can claim it
      const afterFutureTime = new Date(Date.now() + 11 * 60 * 1000).toISOString();
      const futureClaim = outboxRepo.claimNextEligible(afterFutureTime);
      expect(futureClaim).not.toBeNull();
      expect(futureClaim?.id).toBe(item.id);
      expect(futureClaim?.attemptCount).toBe(2);
    });
  });

  describe('Stale Lease Recovery', () => {
    it('9. Recovers stale processing row whose lease timed out back to retry_wait', () => {
      const item = outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      // Claim at an old time (10 minutes ago)
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      outboxRepo.claimNextEligible(oldTime);

      // Requeue with 5 minute lease timeout
      const recovered = outboxRepo.requeueStaleProcessing(5 * 60 * 1000);
      expect(recovered).toBe(1);

      const refreshed = outboxRepo.getById(item.id);
      expect(refreshed?.status).toBe('retry_wait');
      expect(refreshed?.lockedAt).toBeNull();
    });

    it('10. Permanently fails stale rows when max_attempts has been reached', () => {
      const item = outboxRepo.create({
        projectId: testProjectId,
        activityMatchId: testMatchId,
        maxAttempts: 2,
        payload: {
          messageInput: { ...sampleMessageInput, activityMatchId: testMatchId },
          message: null
        }
      });

      // Claim 1 at T-30m
      const t0 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      outboxRepo.claimNextEligible(t0); // attempt 1

      // Recover at T-20m (leaseTimeout = 5m, so cutoff is T-25m; t0 < cutoff)
      const t1 = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const rec1 = outboxRepo.requeueStaleProcessing(5 * 60 * 1000, t1);
      expect(rec1).toBe(1);

      // Claim 2 at T-15m
      const t2 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      outboxRepo.claimNextEligible(t2); // attempt 2 (max reached)

      // Recover now (cutoff is T-5m; t2 < cutoff)
      const recovered = outboxRepo.requeueStaleProcessing(5 * 60 * 1000);
      expect(recovered).toBe(1);

      const refreshed = outboxRepo.getById(item.id);
      expect(refreshed?.status).toBe('failed');
      expect(refreshed?.lastErrorCode).toBe('LEASE_EXPIRED_MAX_ATTEMPTS');
    });
  });
});
