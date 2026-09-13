import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import crypto from 'node:crypto';
import { initPostgres, closePostgres } from '../src/database/postgres.js';
import { runPostgresMigrations } from '../src/database/postgres-migrator.js';
import { PostgresProjectRepository } from '../src/repositories/postgres/postgres-project.repository.js';
import { PostgresScheduleRepository } from '../src/repositories/postgres/postgres-schedule.repository.js';
import { PostgresProgressUpdateRepository } from '../src/repositories/postgres/postgres-progress-update.repository.js';
import { PostgresActivityMatchRepository } from '../src/repositories/postgres/postgres-activity-match.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import { env } from '../src/config/env.js';

describe('PostgreSQL Behavioral Regression Scenarios (Phase 1–4 Certification)', () => {
  let memDb: ReturnType<typeof newDb>;
  let pool: pg.Pool;

  const projectRepo = new PostgresProjectRepository();
  const scheduleRepo = new PostgresScheduleRepository();
  const progressUpdateRepo = new PostgresProgressUpdateRepository();
  const matchRepo = new PostgresActivityMatchRepository();
  const outboxRepo = new PostgresNotificationOutboxRepository();

  const testProjectId = crypto.randomUUID();
  const testScheduleId = crypto.randomUUID();
  const testActivityId = crypto.randomUUID();
  let sharedPuId: string;
  let originalProvider: string;

  beforeAll(async () => {
    originalProvider = env.DATABASE_PROVIDER;
    (env as any).DATABASE_PROVIDER = 'postgres';

    memDb = newDb({ noAstCoverageCheck: true });
    const { Pool } = memDb.adapters.createPg();
    pool = new Pool();

    await initPostgres({ pool });
    await runPostgresMigrations(pool);

    // Setup base project and schedule
    await projectRepo.create({
      id: testProjectId,
      code: `SCENARIO-PG-${Date.now()}`,
      name: 'Behavioral Scenarios Test Project',
      startDate: '2026-09-01',
      targetEndDate: '2026-12-31'
    });

    await scheduleRepo.createWithActivities(
      {
        id: testScheduleId,
        projectId: testProjectId,
        name: 'Unit 4 Schedule',
        sourceType: 'csv'
      },
      [
        {
          id: testActivityId,
          projectId: testProjectId,
          externalId: 'ACT-CRUDE-01',
          name: 'Crude Distillation Unit Pump Foundation',
          plannedStart: '2026-09-01',
          plannedFinish: '2026-09-20',
          unit: 'm3',
          plannedQuantity: 100
        }
      ]
    );

    sharedPuId = crypto.randomUUID();
    await progressUpdateRepo.create({
      id: sharedPuId,
      projectId: testProjectId,
      sourceType: 'text',
      rawText: 'Baseline report for scenarios',
      status: 'processed',
      reportDate: '2026-09-01'
    });
  });

  afterAll(async () => {
    (env as any).DATABASE_PROVIDER = originalProvider;
    await closePostgres();
  });

  describe('Scenario A: Normal Worker Report (Clean / No Anomaly)', () => {
    it('persists normal progress match without creating an anomaly alert notification', async () => {
      const puId = crypto.randomUUID();
      const matchId = crypto.randomUUID();

      await progressUpdateRepo.create({
        id: puId,
        projectId: testProjectId,
        sourceType: 'text',
        rawText: 'Completed 5m3 normal excavation on crude pump foundation',
        status: 'processed',
        reportDate: '2026-09-05'
      });

      // Normal match: low anomaly score, severity normal
      const createdMatches = await matchRepo.persistMatchesAndEventsAtomically({
        projectId: testProjectId,
        progressUpdateId: puId,
        matches: [
          {
            id: matchId,
            projectId: testProjectId,
            progressUpdateId: puId,
            activityId: testActivityId,
            confidenceScore: 0.96,
            matchMethod: 'llm_assisted',
            status: 'suggested',
            reviewState: 'awaiting_review',
            anomalyScore: 0.05,
            anomalySeverity: 'normal',
            anomalyReasonsJson: null
          }
        ],
        events: [
          {
            projectId: testProjectId,
            eventType: 'progress_matched',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: 'Normal progress matched with planned baseline'
          }
        ]
        // Zero notifications attached
      });

      expect(createdMatches.length).toBe(1);
      const match = await matchRepo.getById(matchId);
      expect(match).not.toBeNull();
      expect(match?.anomalySeverity).toBe('normal');

      // Assert outbox is clean for this match
      const outboxEntries = await outboxRepo.listByProject(testProjectId);
      const matchingNotifs = outboxEntries.filter((o) => o.activityMatchId === matchId);
      expect(matchingNotifs.length).toBe(0);
    });
  });

  describe('Scenario B: High Anomaly Worker Report', () => {
    it('persists match, anomaly details, and notification outbox item with message snapshot', async () => {
      const puId = crypto.randomUUID();
      const matchId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();

      await progressUpdateRepo.create({
        id: puId,
        projectId: testProjectId,
        sourceType: 'text',
        rawText: 'Reported 140% complete on pump foundation ahead of schedule',
        status: 'processed',
        reportDate: '2026-09-08'
      });

      const messageSnapshot = {
        subject: 'URGENT: High Physical Anomaly on Crude Distillation Unit',
        headline: 'Progress Surge Detected',
        summary: 'Reported quantity 140m3 exceeds total planned 100m3 by 40%',
        recipient: 'lead-planner@fieldline.example.com'
      };

      await matchRepo.persistMatchesAndEventsAtomically({
        projectId: testProjectId,
        progressUpdateId: puId,
        matches: [
          {
            id: matchId,
            projectId: testProjectId,
            progressUpdateId: puId,
            activityId: testActivityId,
            confidenceScore: 0.92,
            matchMethod: 'llm_assisted',
            status: 'suggested',
            reviewState: 'awaiting_review',
            anomalyScore: 0.95,
            anomalySeverity: 'high',
            anomalyReasonsJson: JSON.stringify(['Quantity exceeds baseline limit by 40%'])
          }
        ],
        events: [
          {
            projectId: testProjectId,
            eventType: 'anomaly_detected',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: 'High anomaly detected in report'
          }
        ],
        notifications: [
          {
            id: outboxId,
            projectId: testProjectId,
            activityMatchId: matchId,
            notificationType: 'anomaly_alert',
            channel: 'email',
            payload: { message: messageSnapshot } as any,
            idempotencyKey: `fieldline-anomaly-alert:${matchId}`
          }
        ]
      });

      // Assert anomaly match persisted
      const match = await matchRepo.getById(matchId);
      expect(match?.anomalySeverity).toBe('high');
      expect(match?.anomalyScore).toBe(0.95);

      // Assert notification outbox row exists with exact payload snapshot
      const outboxItem = await outboxRepo.getById(outboxId);
      expect(outboxItem).not.toBeNull();
      expect(outboxItem?.status).toBe('pending');
      expect(outboxItem?.idempotencyKey).toBe(`fieldline-anomaly-alert:${matchId}`);

      const parsedPayload = JSON.parse(outboxItem!.payloadJson);
      expect(parsedPayload.message.headline).toBe('Progress Surge Detected');
      expect(parsedPayload.message.recipient).toBe('lead-planner@fieldline.example.com');
    });
  });

  describe('Scenario C & D: Delivery Failure, Retry State, & Snapshot Preservation', () => {
    it('handles delivery failure: transitions to retry_wait with backoff while anomaly remains valid', async () => {
      const puId = crypto.randomUUID();
      const matchId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();

      await progressUpdateRepo.create({
        id: puId,
        projectId: testProjectId,
        sourceType: 'text',
        rawText: 'Anomalous piping progress update',
        status: 'processed',
        reportDate: '2026-09-10'
      });

      const messageSnapshot = {
        subject: 'Alert: Piping Anomaly',
        body: 'Physical verification required',
        idempotencyToken: `token-${Date.now()}`
      };

      await matchRepo.persistMatchesAndEventsAtomically({
        projectId: testProjectId,
        progressUpdateId: puId,
        matches: [
          {
            id: matchId,
            projectId: testProjectId,
            progressUpdateId: puId,
            activityId: testActivityId,
            confidenceScore: 0.94,
            matchMethod: 'llm_assisted',
            status: 'suggested',
            reviewState: 'awaiting_review',
            anomalyScore: 0.88,
            anomalySeverity: 'high',
            anomalyReasonsJson: JSON.stringify(['Material pacing mismatch'])
          }
        ],
        events: [],
        notifications: [
          {
            id: outboxId,
            projectId: testProjectId,
            activityMatchId: matchId,
            notificationType: 'anomaly_alert',
            channel: 'email',
            payload: messageSnapshot as any,
            idempotencyKey: `fieldline-anomaly-alert:${matchId}`
          }
        ]
      });

      // Worker claims the item
      const claimed = await outboxRepo.claimById(outboxId);
      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe('processing');

      // Simulate Resend API network outage: mark failure with retry
      const nextAttemptTime = new Date(Date.now() + 60000).toISOString();
      const updated = await outboxRepo.scheduleRetry(
        outboxId,
        'RESEND_503',
        'Resend 503 Service Unavailable: rate limit exceeded',
        nextAttemptTime
      );

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('retry_wait');
      expect(updated?.lastErrorSummary).toContain('Resend 503 Service Unavailable');

      // Crucial: The underlying activity match and anomaly remain 100% intact and valid
      const match = await matchRepo.getById(matchId);
      expect(match).not.toBeNull();
      expect(match?.anomalySeverity).toBe('high');
      expect(match?.status).toBe('suggested');

      // Scenario D: Verify exact same payload snapshot and idempotency key are preserved for retry
      const forRetry = await outboxRepo.getById(outboxId);
      expect(forRetry?.payloadJson).toBe(JSON.stringify(messageSnapshot));
      expect(forRetry?.idempotencyKey).toBe(`fieldline-anomaly-alert:${matchId}`);

      // Successful retry: mark delivered
      const delivered = await outboxRepo.markDelivered(outboxId);
      expect(delivered).not.toBeNull();
      expect(delivered?.status).toBe('delivered');
      expect(delivered?.deliveredAt).toBeDefined();
    });
  });

  describe('Scenario E: Application Restart & Stale Processing Recovery', () => {
    it('recovers abandoned processing notifications after process crash/restart', async () => {
      const matchId = crypto.randomUUID();
      const notifId = crypto.randomUUID();

      await matchRepo.create({
        id: matchId,
        projectId: testProjectId,
        progressUpdateId: sharedPuId,
        activityId: testActivityId,
        confidenceScore: 0.9,
        matchMethod: 'llm_assisted',
        status: 'suggested'
      });

      await outboxRepo.create({
        id: notifId,
        projectId: testProjectId,
        activityMatchId: matchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: { crashTest: true } as any,
        idempotencyKey: `crash-test-${notifId}`
      });

      // Worker claims item right before crash
      const claimed = await outboxRepo.claimById(notifId);
      expect(claimed?.status).toBe('processing');

      // Simulate restart: server starts up and invokes requeueStaleProcessing(0)
      const recoveredCount = await outboxRepo.requeueStaleProcessing(0);
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      // Verify item returned to retry_wait state and can be claimed again
      const refreshed = await outboxRepo.getById(notifId);
      expect(refreshed?.status).toBe('retry_wait');
      expect(refreshed?.lockedAt).toBeNull();

      // Ensure it can be claimed again after recovery
      const reclaimed = await outboxRepo.claimById(notifId);
      expect(reclaimed?.status).toBe('processing');
      expect(reclaimed?.id).toBe(notifId);
    });
  });

  describe('Scenario F: Concurrent Worker Instances Claiming', () => {
    it('guarantees exactly one logical claim when concurrent workers race for a notification', async () => {
      const matchId = crypto.randomUUID();
      const notifId = crypto.randomUUID();

      await matchRepo.create({
        id: matchId,
        projectId: testProjectId,
        progressUpdateId: sharedPuId,
        activityId: testActivityId,
        confidenceScore: 0.9,
        matchMethod: 'llm_assisted',
        status: 'suggested'
      });

      await outboxRepo.create({
        id: notifId,
        projectId: testProjectId,
        activityMatchId: matchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: { raceConditionTest: true } as any,
        idempotencyKey: `race-test-${notifId}`
      });

      // Race two concurrent claim attempts
      const [claimA, claimB] = await Promise.all([
        outboxRepo.claimById(notifId),
        outboxRepo.claimById(notifId)
      ]);

      // Exactly one must succeed, the other must receive null
      const claimedCount = (claimA ? 1 : 0) + (claimB ? 1 : 0);
      expect(claimedCount).toBe(1);

      const winningClaim = claimA || claimB;
      expect(winningClaim?.id).toBe(notifId);
      expect(winningClaim?.status).toBe('processing');
    });
  });
});
