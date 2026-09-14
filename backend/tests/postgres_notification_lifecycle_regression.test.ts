import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import crypto from 'node:crypto';
import { initPostgres, closePostgres } from '../src/database/postgres.js';
import { runPostgresMigrations, getAppliedPostgresMigrations } from '../src/database/postgres-migrator.js';
import { PostgresProjectRepository } from '../src/repositories/postgres/postgres-project.repository.js';
import { PostgresScheduleRepository } from '../src/repositories/postgres/postgres-schedule.repository.js';
import { PostgresProgressUpdateRepository } from '../src/repositories/postgres/postgres-progress-update.repository.js';
import { PostgresActivityMatchRepository } from '../src/repositories/postgres/postgres-activity-match.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import type { NotificationOutboxItem } from '../src/services/anomaly/notification-outbox.types.js';
import type { AnomalyAlertMessage } from '../src/services/anomaly/anomaly-message.types.js';

describe('PostgreSQL Notification Outbox — Lifecycle & Timestamp Schema Regression Suite', () => {
  let memDb: ReturnType<typeof newDb>;
  let pool: pg.Pool;

  const projectRepo = new PostgresProjectRepository();
  const scheduleRepo = new PostgresScheduleRepository();
  const progressUpdateRepo = new PostgresProgressUpdateRepository();
  const matchRepo = new PostgresActivityMatchRepository();
  let outboxRepo: PostgresNotificationOutboxRepository;

  const testProjectId = crypto.randomUUID();
  const testProjectCode = `PG-NOTIF-${Date.now()}`;
  const testScheduleId = crypto.randomUUID();
  const testActivityId = crypto.randomUUID();
  const testPuId = crypto.randomUUID();
  const testMatchId = crypto.randomUUID();

  beforeAll(async () => {
    memDb = newDb({ noAstCoverageCheck: true });
    const { Pool } = memDb.adapters.createPg();
    pool = new Pool();

    await initPostgres({ pool });
    outboxRepo = new PostgresNotificationOutboxRepository(() => pool);

    // Apply baseline and forward migrations
    const migrationResult = await runPostgresMigrations(pool);
    expect(migrationResult.applied).toContain('20260913000000_baseline_schema');
    expect(migrationResult.applied).toContain('20260914000000_notification_outbox_timestamps');

    // Create baseline relational entities for FK integrity
    await projectRepo.create({
      id: testProjectId,
      code: testProjectCode,
      name: 'Notification Lifecycle PG Project',
      startDate: '2026-09-01',
      targetEndDate: '2026-12-31'
    });

    await scheduleRepo.createWithActivities(
      {
        id: testScheduleId,
        projectId: testProjectId,
        name: 'Schedule PG',
        version: '1.0',
        sourceType: 'csv'
      },
      [
        {
          id: testActivityId,
          projectId: testProjectId,
          externalId: 'ACT-NOTIF-01',
          name: 'Foundation Concrete',
          plannedStart: '2026-09-01',
          plannedFinish: '2026-09-20'
        }
      ]
    );

    await progressUpdateRepo.create({
      id: testPuId,
      projectId: testProjectId,
      sourceType: 'manual',
      rawText: 'Foundation concrete 100% complete',
      status: 'processed',
      reportDate: '2026-09-14'
    });

    await matchRepo.create({
      id: testMatchId,
      projectId: testProjectId,
      progressUpdateId: testPuId,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'llm_assisted',
      status: 'suggested',
      reviewState: 'awaiting_review',
      anomalyScore: 0.93,
      anomalySeverity: 'high',
      anomalyReasonsJson: JSON.stringify(['Sudden leap from 10% to 100% in single shift'])
    });
  });

  afterAll(async () => {
    await closePostgres();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM notification_outbox');
  });

  // Helper to create a unique notification for sub-tests with its own distinct activity match
  async function createTestNotification(customId?: string, idempotencyPrefix = 'test-notif') {
    const matchId = crypto.randomUUID();
    await matchRepo.create({
      id: matchId,
      projectId: testProjectId,
      progressUpdateId: testPuId,
      activityId: testActivityId,
      confidenceScore: 0.95,
      matchMethod: 'llm_assisted',
      status: 'suggested',
      reviewState: 'awaiting_review',
      anomalyScore: 0.93,
      anomalySeverity: 'high',
      anomalyReasonsJson: JSON.stringify(['Sudden leap from 10% to 100% in single shift'])
    });

    const notifId = customId || crypto.randomUUID();
    return outboxRepo.create({
      id: notifId,
      projectId: testProjectId,
      activityMatchId: matchId,
      notificationType: 'anomaly_alert',
      channel: 'email',
      payload: {
        messageInput: {
          projectName: 'Notification Lifecycle PG Project',
          activityExternalId: 'ACT-NOTIF-01',
          activityName: 'Foundation Concrete',
          reportDate: '2026-09-14',
          reportedPercent: 100,
          anomalyScore: 0.93,
          anomalySeverity: 'high',
          anomalyReasons: ['Sudden leap from 10% to 100% in single shift'],
          activityMatchId: matchId
        },
        message: null
      },
      idempotencyKey: `${idempotencyPrefix}:${notifId}`
    });
  }

  describe('1. Schema Verification & Forward Migration Guarantee', () => {
    it('verifies that all notification_outbox timestamp-like columns are TIMESTAMPTZ', async () => {
      const res = await pool.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'notification_outbox'
        ORDER BY column_name;
      `);

      const columnTypes = new Map(res.rows.map((r) => [r.column_name, r.data_type.toLowerCase()]));

      // Verify all timestamp columns are timestamptz
      expect(columnTypes.get('created_at')).toBe('timestamptz');
      expect(columnTypes.get('updated_at')).toBe('timestamptz');
      expect(columnTypes.get('next_attempt_at')).toBe('timestamptz');
      expect(columnTypes.get('locked_at')).toBe('timestamptz');
      expect(columnTypes.get('last_attempt_at')).toBe('timestamptz');
      expect(columnTypes.get('delivered_at')).toBe('timestamptz');
    });

    it('verifies schema_migrations tracks both baseline and timestamp migrations', async () => {
      const applied = await getAppliedPostgresMigrations(pool);
      expect(applied).toContain('20260913000000_baseline_schema');
      expect(applied).toContain('20260914000000_notification_outbox_timestamps');
    });

    it('verifies system_metadata schema_version is updated to 0.3.1', async () => {
      const res = await pool.query<{ value: string }>(
        "SELECT value FROM system_metadata WHERE key = 'schema_version'"
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].value).toBe('0.3.1');
    });
  });

  describe('2. Notification Creation (create)', () => {
    it('creates a new pending notification with valid defaults and ISO string timestamps', async () => {
      const item = await createTestNotification(undefined, 'create-test');

      expect(item.id).toBeDefined();
      expect(item.projectId).toBe(testProjectId);
      expect(typeof item.activityMatchId).toBe('string');
      expect(item.status).toBe('pending');
      expect(item.attemptCount).toBe(0);
      expect(item.maxAttempts).toBe(5);
      expect(item.nextAttemptAt).toBeNull();
      expect(item.lockedAt).toBeNull();
      expect(item.lastAttemptAt).toBeNull();
      expect(item.deliveredAt).toBeNull();

      // createdAt and updatedAt must be valid ISO strings (not Date objects)
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.updatedAt).toBe('string');
      expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
      expect(new Date(item.updatedAt).toISOString()).toBe(item.updatedAt);
    });
  });

  describe('3. Claiming Next Eligible Notification (claimNextEligible)', () => {
    it('claims pending notification without updated_at type mismatch and sets lease', async () => {
      const created = await createTestNotification(undefined, 'claim-eligible');

      const claimTime = new Date().toISOString();
      const claimed = await outboxRepo.claimNextEligible(claimTime);

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe('processing');
      expect(claimed?.attemptCount).toBe(1);
      expect(typeof claimed?.lockedAt).toBe('string');
      expect(typeof claimed?.lastAttemptAt).toBe('string');
      expect(typeof claimed?.updatedAt).toBe('string');

      // Second immediate claim should return null because item is locked in processing
      const secondClaim = await outboxRepo.claimNextEligible();
      expect(secondClaim).toBeNull();
    });
  });

  describe('4. Claiming Notification by ID (claimById)', () => {
    it('claims specific notification by ID with lease locking and attempt increment', async () => {
      const created = await createTestNotification(undefined, 'claim-by-id');

      const claimTime = new Date().toISOString();
      const claimed = await outboxRepo.claimById(created.id, claimTime);

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(created.id);
      expect(claimed?.status).toBe('processing');
      expect(claimed?.attemptCount).toBe(1);
      expect(typeof claimed?.lockedAt).toBe('string');
      expect(typeof claimed?.lastAttemptAt).toBe('string');

      // Subsequent claimById on locked notification returns null
      const retryClaim = await outboxRepo.claimById(created.id);
      expect(retryClaim).toBeNull();
    });
  });

  describe('5. Scheduling Retries (scheduleRetry)', () => {
    it('schedules a retry with next_attempt_at, clears lock, and updates audit events', async () => {
      const created = await createTestNotification(undefined, 'retry-test');
      const claimed = await outboxRepo.claimById(created.id);
      expect(claimed?.status).toBe('processing');

      const retryTime = new Date(Date.now() + 60000).toISOString();
      const retried = await outboxRepo.scheduleRetry(
        created.id,
        'RESEND_RATE_LIMIT',
        'Provider rate limit exceeded; exponential backoff applied',
        retryTime
      );

      expect(retried).not.toBeNull();
      expect(retried?.status).toBe('retry_wait');
      expect(retried?.lockedAt).toBeNull();
      expect(retried?.lastErrorCode).toBe('RESEND_RATE_LIMIT');
      expect(retried?.lastErrorSummary).toContain('rate limit');
      expect(typeof retried?.nextAttemptAt).toBe('string');
      expect(typeof retried?.updatedAt).toBe('string');

      // Verify audit event written to project_events
      const eventRes = await pool.query(
        "SELECT * FROM project_events WHERE entity_id = $1 AND event_type = 'notification_retry_scheduled'",
        [created.id]
      );
      expect(eventRes.rows.length).toBe(1);
      expect(eventRes.rows[0].project_id).toBe(testProjectId);

      // Verify claimNextEligible BEFORE retry time does NOT claim the item
      const beforeRetry = new Date(Date.now() - 1000).toISOString();
      const prematureClaim = await outboxRepo.claimNextEligible(beforeRetry);
      expect(prematureClaim).toBeNull();

      // Verify claimNextEligible AFTER retry time DOES claim the item
      const afterRetry = new Date(Date.now() + 120000).toISOString();
      const eligibleClaim = await outboxRepo.claimNextEligible(afterRetry);
      expect(eligibleClaim).not.toBeNull();
      expect(eligibleClaim?.id).toBe(created.id);
      expect(eligibleClaim?.status).toBe('processing');
      expect(eligibleClaim?.attemptCount).toBe(2);
    });
  });

  describe('6. Marking Delivered (markDelivered)', () => {
    it('marks notification delivered, sets delivered_at, clears lock, and records audit event', async () => {
      const created = await createTestNotification(undefined, 'deliver-test');
      await outboxRepo.claimById(created.id);

      const providerMsgId = 'resend_live_msg_987654321';
      const delivered = await outboxRepo.markDelivered(created.id, providerMsgId);

      expect(delivered).not.toBeNull();
      expect(delivered?.status).toBe('delivered');
      expect(delivered?.lockedAt).toBeNull();
      expect(delivered?.providerMessageId).toBe(providerMsgId);
      expect(typeof delivered?.deliveredAt).toBe('string');
      expect(typeof delivered?.updatedAt).toBe('string');

      // Verify audit event
      const eventRes = await pool.query(
        "SELECT * FROM project_events WHERE entity_id = $1 AND event_type = 'notification_delivery_succeeded'",
        [created.id]
      );
      expect(eventRes.rows.length).toBe(1);
      expect(eventRes.rows[0].project_id).toBe(testProjectId);
    });
  });

  describe('7. Marking Failed (markFailed)', () => {
    it('marks notification failed permanently, records error details, and clears lock', async () => {
      const created = await createTestNotification(undefined, 'fail-test');
      await outboxRepo.claimById(created.id);

      const failed = await outboxRepo.markFailed(
        created.id,
        'MAILBOX_NOT_FOUND',
        'Recipient mailbox does not exist (permanent bounce)'
      );

      expect(failed).not.toBeNull();
      expect(failed?.status).toBe('failed');
      expect(failed?.lockedAt).toBeNull();
      expect(failed?.lastErrorCode).toBe('MAILBOX_NOT_FOUND');
      expect(failed?.lastErrorSummary).toContain('permanent bounce');
      expect(typeof failed?.updatedAt).toBe('string');

      // Verify audit event
      const eventRes = await pool.query(
        "SELECT * FROM project_events WHERE entity_id = $1 AND event_type = 'notification_delivery_failed'",
        [created.id]
      );
      expect(eventRes.rows.length).toBe(1);
      expect(eventRes.rows[0].project_id).toBe(testProjectId);
    });
  });

  describe('8. Stale Lease Recovery (requeueStaleProcessing)', () => {
    it('recovers unexpired attempt notification from stale processing lease back to retry_wait', async () => {
      const created = await createTestNotification(undefined, 'stale-recover');
      const claimTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      await outboxRepo.claimById(created.id, claimTime);

      // Requeue with 5 min lease timeout
      const recoveredCount = await outboxRepo.requeueStaleProcessing(5 * 60 * 1000);
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const item = await outboxRepo.getById(created.id);
      expect(item).not.toBeNull();
      expect(item?.status).toBe('retry_wait');
      expect(item?.lockedAt).toBeNull();
      expect(item?.lastErrorCode).toBe('LEASE_EXPIRED_REQUEUED');

      // Verify audit event
      const eventRes = await pool.query(
        "SELECT * FROM project_events WHERE entity_id = $1 AND event_type = 'notification_lease_recovered'",
        [created.id]
      );
      expect(eventRes.rows.length).toBe(1);
    });

    it('marks notification failed when stale lease expires and attemptCount reaches maxAttempts', async () => {
      const staleMatchId = crypto.randomUUID();
      await matchRepo.create({
        id: staleMatchId,
        projectId: testProjectId,
        progressUpdateId: testPuId,
        activityId: testActivityId,
        confidenceScore: 0.95,
        matchMethod: 'llm_assisted',
        status: 'suggested'
      });

      const notifId = crypto.randomUUID();
      // Directly insert row with attempt_count = 5 and max_attempts = 5
      const oldTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      await pool.query(`
        INSERT INTO notification_outbox (
          id, project_id, activity_match_id, notification_type, channel,
          status, payload_json, idempotency_key, attempt_count, max_attempts,
          locked_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 'anomaly_alert', 'email',
          'processing', '{}', $4, 5, 5,
          $5, $5, $5
        );
      `, [notifId, testProjectId, staleMatchId, `max-stale:${notifId}`, oldTime]);

      const recoveredCount = await outboxRepo.requeueStaleProcessing(5 * 60 * 1000);
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const item = await outboxRepo.getById(notifId);
      expect(item).not.toBeNull();
      expect(item?.status).toBe('failed');
      expect(item?.lockedAt).toBeNull();
      expect(item?.lastErrorCode).toBe('LEASE_EXPIRED_MAX_ATTEMPTS');
      expect(item?.lastErrorSummary).toContain('maximum attempts reached');
    });
  });

  describe('9. Date Object to ISO String Mapping Contract', () => {
    it('ensures all timestamp values returned as Date objects from PostgreSQL are mapped to ISO strings', async () => {
      const created = await createTestNotification(undefined, 'date-mapping');
      const now = new Date();

      // Directly update the row in PostgreSQL to verify that native Date returns are mapped to ISO string
      await pool.query(`
        UPDATE notification_outbox
        SET next_attempt_at = $1,
            locked_at = $1,
            last_attempt_at = $1,
            delivered_at = $1,
            updated_at = $1
        WHERE id = $2
      `, [now, created.id]);

      const fetched = await outboxRepo.getById(created.id);
      expect(fetched).not.toBeNull();

      // In TypeScript interface NotificationOutboxItem, all these fields are string | null
      expect(typeof fetched?.nextAttemptAt).toBe('string');
      expect(typeof fetched?.lockedAt).toBe('string');
      expect(typeof fetched?.lastAttemptAt).toBe('string');
      expect(typeof fetched?.deliveredAt).toBe('string');
      expect(typeof fetched?.createdAt).toBe('string');
      expect(typeof fetched?.updatedAt).toBe('string');

      // None of them should be a Date instance
      expect((fetched?.nextAttemptAt as unknown) instanceof Date).toBe(false);
      expect((fetched?.lockedAt as unknown) instanceof Date).toBe(false);
      expect((fetched?.lastAttemptAt as unknown) instanceof Date).toBe(false);
      expect((fetched?.deliveredAt as unknown) instanceof Date).toBe(false);
      expect((fetched?.createdAt as unknown) instanceof Date).toBe(false);
      expect((fetched?.updatedAt as unknown) instanceof Date).toBe(false);

      // Verify exact ISO string representation
      expect(fetched?.nextAttemptAt).toBe(now.toISOString());
      expect(fetched?.lockedAt).toBe(now.toISOString());
      expect(fetched?.lastAttemptAt).toBe(now.toISOString());
      expect(fetched?.deliveredAt).toBe(now.toISOString());
    });
  });

  describe('10. saveMessageSnapshot Operation', () => {
    it('snapshots generated message and updates payload_json and updated_at cleanly', async () => {
      const created = await createTestNotification(undefined, 'snapshot-test');

      const mockMessage: AnomalyAlertMessage = {
        title: 'High Velocity Anomaly Alert',
        summary: 'Activity jumped unexpectedly',
        details: 'ACT-NOTIF-01 leaped from 10% to 100% in a single shift without precedent.',
        recommendedAction: 'Verify site physical progress against survey evidence.',
        fullMessage: 'Alert: Activity ACT-NOTIF-01 has leaped to 100% in a single shift.',
        activityMatchId: created.activityMatchId,
        projectName: 'Notification Lifecycle PG Project',
        activityExternalId: 'ACT-NOTIF-01',
        activityName: 'Foundation Concrete',
        activityLocation: 'Zone 1',
        reportDate: '2026-09-14',
        reporterName: 'Site Engineer',
        previousPercent: 10,
        reportedPercent: 100,
        severity: 'high',
        anomalyScore: 0.93,
        anomalyReasons: ['Sudden leap from 10% to 100% in single shift'],
        generatedBy: 'deterministic_fallback',
        generatedAt: new Date().toISOString()
      };

      const snapshotted = await outboxRepo.saveMessageSnapshot(created.id, mockMessage);
      expect(snapshotted).not.toBeNull();
      expect(typeof snapshotted?.updatedAt).toBe('string');

      const parsedPayload = JSON.parse(snapshotted!.payloadJson);
      expect(parsedPayload.message).toEqual(mockMessage);
    });
  });
});
