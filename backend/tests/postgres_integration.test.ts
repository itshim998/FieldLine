import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import crypto from 'node:crypto';
import { initPostgres, closePostgres, isPostgresHealthy, runInPostgresTransaction } from '../src/database/postgres.js';
import { runPostgresMigrations, getAppliedPostgresMigrations } from '../src/database/postgres-migrator.js';
import { PostgresProjectRepository } from '../src/repositories/postgres/postgres-project.repository.js';
import { PostgresScheduleRepository } from '../src/repositories/postgres/postgres-schedule.repository.js';
import { PostgresActivityRepository } from '../src/repositories/postgres/postgres-activity.repository.js';
import { PostgresEvidenceRepository } from '../src/repositories/postgres/postgres-evidence.repository.js';
import { PostgresProgressUpdateRepository } from '../src/repositories/postgres/postgres-progress-update.repository.js';
import { PostgresActivityMatchRepository } from '../src/repositories/postgres/postgres-activity-match.repository.js';
import { PostgresActivityProgressRepository } from '../src/repositories/postgres/postgres-activity-progress.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import { PostgresJobRepository } from '../src/repositories/postgres/postgres-job.repository.js';
import { PostgresOperationalBlockerRepository } from '../src/repositories/postgres/postgres-operational-blocker.repository.js';

describe('PostgreSQL Integration & Repository Equivalence', () => {
  let memDb: ReturnType<typeof newDb>;
  let pool: pg.Pool;

  const projectRepo = new PostgresProjectRepository();
  const scheduleRepo = new PostgresScheduleRepository();
  const activityRepo = new PostgresActivityRepository();
  const evidenceRepo = new PostgresEvidenceRepository();
  const progressUpdateRepo = new PostgresProgressUpdateRepository();
  const matchRepo = new PostgresActivityMatchRepository();
  const progressRepo = new PostgresActivityProgressRepository();
  const blockerRepo = new PostgresOperationalBlockerRepository();
  const outboxRepo = new PostgresNotificationOutboxRepository();
  const jobRepo = new PostgresJobRepository();

  const testProjectId = crypto.randomUUID();
  const testProjectCode = `TEST-PG-${Date.now()}`;
  const testScheduleId = crypto.randomUUID();
  const testActivityId = crypto.randomUUID();
  const testPuId = crypto.randomUUID();
  const testMatchId = crypto.randomUUID();

  beforeAll(async () => {
    memDb = newDb({ noAstCoverageCheck: true });
    const { Pool } = memDb.adapters.createPg();
    pool = new Pool();

    // Initialize shared pool
    await initPostgres({ pool });
    await runPostgresMigrations(pool);

    // Create baseline test project, schedule, and activity for FK integrity
    await projectRepo.create({
      id: testProjectId,
      code: testProjectCode,
      name: 'Postgres Equivalence Test Project',
      description: 'Testing PostgreSQL repository CRUD',
      startDate: '2026-09-01',
      targetEndDate: '2026-12-31'
    });

    await scheduleRepo.createWithActivities(
      {
        id: testScheduleId,
        projectId: testProjectId,
        name: 'Baseline Schedule PG',
        version: '1.0',
        sourceType: 'csv',
        sourceFilename: 'schedule.csv'
      },
      [
        {
          id: testActivityId,
          projectId: testProjectId,
          externalId: 'ACT-PG-01',
          name: 'Piping Installation',
          plannedStart: '2026-09-05',
          plannedFinish: '2026-09-20',
          unit: 'm',
          plannedQuantity: 500
        }
      ]
    );

    await progressUpdateRepo.create({
      id: testPuId,
      projectId: testProjectId,
      sourceType: 'pdf',
      rawText: 'Piping work completed on schedule',
      status: 'processed',
      reportDate: '2026-09-13'
    });

    await matchRepo.create({
      id: testMatchId,
      projectId: testProjectId,
      progressUpdateId: testPuId,
      activityId: testActivityId,
      confidenceScore: 0.85,
      matchMethod: 'llm_assisted',
      status: 'suggested',
      reviewState: 'awaiting_review'
    });
  });

  afterAll(async () => {
    await closePostgres();
  });

  describe('1. Database Connection & Health Check', () => {
    it('verifies postgres connectivity and reports healthy status', async () => {
      const healthy = await isPostgresHealthy();
      expect(healthy).toBe(true);
    });

    it('returns applied migrations from schema_migrations table', async () => {
      const applied = await getAppliedPostgresMigrations(pool);
      expect(applied.length).toBeGreaterThanOrEqual(1);
      expect(applied).toContain('20260913000000_baseline_schema');
    });
  });

  describe('2. Schema Verification', () => {
    it('contains all 14 expected tables in PostgreSQL public schema', async () => {
      const expectedTables = [
        'schema_migrations',
        'system_metadata',
        'projects',
        'project_accounts',
        'schedules',
        'activities',
        'evidence',
        'progress_updates',
        'activity_progress',
        'activity_matches',
        'project_events',
        'operational_blockers',
        'notification_outbox',
        'processing_jobs'
      ];

      const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);

      const tablesFound = res.rows.map((r: { table_name: string }) => r.table_name);
      for (const expected of expectedTables) {
        expect(tablesFound).toContain(expected);
      }
    });
  });

  describe('3. Repository Equivalence & CRUD Operations', () => {
    it('creates, retrieves, and lists projects', async () => {
      const fetched = await projectRepo.getById(testProjectId);
      expect(fetched).not.toBeNull();
      expect(fetched?.code).toBe(testProjectCode);

      const byCode = await projectRepo.getByCode(testProjectCode);
      expect(byCode).not.toBeNull();
      expect(byCode?.id).toBe(testProjectId);

      const count = await projectRepo.count();
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('imports schedule and activities in a transactional boundary', async () => {
      const scheduleId = crypto.randomUUID();
      const actId = crypto.randomUUID();

      const result = await scheduleRepo.createWithActivities(
        {
          id: scheduleId,
          projectId: testProjectId,
          name: 'Secondary Schedule PG',
          version: '1.1',
          sourceType: 'csv',
          sourceFilename: 'secondary.csv'
        },
        [
          {
            id: actId,
            projectId: testProjectId,
            externalId: 'ACT-PG-02',
            name: 'Electrical Cabling',
            plannedStart: '2026-09-10',
            plannedFinish: '2026-09-25',
            unit: 'm',
            plannedQuantity: 1000
          }
        ]
      );

      expect(result.schedule.id).toBe(scheduleId);
      expect(result.activities.length).toBe(1);

      const activities = await activityRepo.listByProjectId(testProjectId);
      expect(activities.length).toBeGreaterThanOrEqual(2);
    });

    it('creates progress update and attaches evidence', async () => {
      const evId = crypto.randomUUID();

      const evidence = await evidenceRepo.create({
        id: evId,
        projectId: testProjectId,
        progressUpdateId: testPuId,
        fileName: 'report.pdf',
        filePath: 'uploads/report.pdf',
        fileType: 'pdf',
        fileSizeBytes: 1024,
        mimeType: 'application/pdf'
      });
      expect(evidence.id).toBe(evId);

      const evidenceList = await evidenceRepo.listByProjectId(testProjectId);
      expect(evidenceList.length).toBeGreaterThanOrEqual(1);
      expect(evidenceList.some((e) => e.fileName === 'report.pdf')).toBe(true);
    });

    it('creates operational blockers and queries by project and status', async () => {
      const blockerId = crypto.randomUUID();
      const blocker = await blockerRepo.create({
        id: blockerId,
        projectId: testProjectId,
        activityId: testActivityId,
        category: 'equipment',
        description: 'Crane hydraulic failure halted installation',
        status: 'active',
        reporterName: 'Site Engineer'
      });

      expect(blocker.id).toBe(blockerId);
      expect(blocker.status).toBe('active');

      const openBlockers = await blockerRepo.listActiveByProject(testProjectId);
      expect(openBlockers.length).toBeGreaterThanOrEqual(1);
      expect(openBlockers.some((b) => b.category === 'equipment')).toBe(true);
    });
  });

  describe('4. Transaction Rollback Semantics', () => {
    it('executes pinned BEGIN and ROLLBACK when an error occurs in runInPostgresTransaction', async () => {
      const client = await pool.connect();
      let beginCalled = false;
      let rollbackCalled = false;
      let commitCalled = false;

      const originalQuery = client.query.bind(client);
      client.query = (async (queryText: any, values: any) => {
        const text = typeof queryText === 'string' ? queryText : queryText?.text;
        if (text === 'BEGIN') beginCalled = true;
        if (text === 'ROLLBACK') rollbackCalled = true;
        if (text === 'COMMIT') commitCalled = true;
        return originalQuery(queryText, values);
      }) as any;

      const mockPoolProvider = () => ({
        connect: async () => client
      } as any);

      await expect(
        runInPostgresTransaction(async (c) => {
          await c.query('SELECT 1');
          throw new Error('Simulated failure triggering rollback');
        }, mockPoolProvider)
      ).rejects.toThrow('Simulated failure triggering rollback');

      expect(beginCalled).toBe(true);
      expect(rollbackCalled).toBe(true);
      expect(commitCalled).toBe(false);
    });
  });

  describe('5. Canonical Truth Boundary', () => {
    it('unconfirmed matches do NOT insert rows into activity_progress', async () => {
      const pId = crypto.randomUUID();
      await projectRepo.create({
        id: pId,
        code: `CANONICAL-${Date.now()}`,
        name: 'Canonical Test',
        startDate: '2026-09-01',
        targetEndDate: '2026-10-01'
      });

      const sId = crypto.randomUUID();
      const aId = crypto.randomUUID();
      await scheduleRepo.createWithActivities(
        {
          id: sId,
          projectId: pId,
          name: 'Schedule',
          sourceType: 'csv'
        },
        [
          {
            id: aId,
            projectId: pId,
            externalId: 'ACT-C01',
            name: 'Activity',
            plannedStart: '2026-09-01',
            plannedFinish: '2026-09-10'
          }
        ]
      );

      const puId = crypto.randomUUID();
      await progressUpdateRepo.create({
        id: puId,
        projectId: pId,
        sourceType: 'text',
        rawText: 'Physical progress report text',
        status: 'processed',
        reportDate: '2026-09-05'
      });

      // Create a suggested match
      const mId = crypto.randomUUID();
      await matchRepo.create({
        id: mId,
        projectId: pId,
        progressUpdateId: puId,
        activityId: aId,
        confidenceScore: 0.85,
        matchMethod: 'llm_assisted',
        status: 'suggested',
        reviewState: 'awaiting_review'
      });

      // Canonical progress table must remain empty for this project
      const progressEntries = await progressRepo.listByProjectId(pId);
      expect(progressEntries.length).toBe(0);
    });
  });

  describe('6. Outbox Atomicity', () => {
    it('persists matches, events, and outbox notification atomically in PostgreSQL', async () => {
      const matchId = crypto.randomUUID();
      const outboxId = crypto.randomUUID();

      const createdMatches = await matchRepo.persistMatchesAndEventsAtomically({
        projectId: testProjectId,
        progressUpdateId: testPuId,
        matches: [
          {
            id: matchId,
            projectId: testProjectId,
            progressUpdateId: testPuId,
            activityId: testActivityId,
            confidenceScore: 0.95,
            matchMethod: 'llm_assisted',
            status: 'suggested',
            reviewState: 'awaiting_review',
            anomalyScore: 0.92,
            anomalySeverity: 'high',
            anomalyReasonsJson: JSON.stringify(['Physical progress exceeds planned pace by 40%'])
          }
        ],
        events: [
          {
            projectId: testProjectId,
            eventType: 'anomaly_detected',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: 'High anomaly detected in field report',
            payloadJson: JSON.stringify({ severity: 'high' })
          }
        ],
        notifications: [
          {
            id: outboxId,
            projectId: testProjectId,
            activityMatchId: matchId,
            notificationType: 'anomaly_alert',
            channel: 'email',
            payload: { matchId, score: 0.92 } as any,
            idempotencyKey: `fieldline-anomaly-alert:${matchId}`
          }
        ]
      });

      expect(createdMatches.length).toBe(1);
      expect(createdMatches[0].id).toBe(matchId);

      // Verify outbox row committed
      const notif = await outboxRepo.getById(outboxId);
      expect(notif).not.toBeNull();
      expect(notif?.status).toBe('pending');
      expect(notif?.activityMatchId).toBe(matchId);
    });
  });

  describe('7. Notification Claiming & Lease Recovery', () => {
    it('claims pending notifications and updates lease locked_at', async () => {
      const localMatchId = crypto.randomUUID();
      await matchRepo.create({
        id: localMatchId,
        projectId: testProjectId,
        progressUpdateId: testPuId,
        activityId: testActivityId,
        confidenceScore: 0.9,
        matchMethod: 'llm_assisted',
        status: 'suggested',
        reviewState: 'awaiting_review'
      });

      const notifId = crypto.randomUUID();
      await outboxRepo.create({
        id: notifId,
        projectId: testProjectId,
        activityMatchId: localMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: { test: true } as any,
        idempotencyKey: `lease-test-${notifId}`
      });

      const claimed = await outboxRepo.claimById(notifId);
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(notifId);
      expect(claimed?.status).toBe('processing');
      expect(claimed?.lockedAt).toBeDefined();

      // A second claim should not claim the same locked notification
      const secondClaim = await outboxRepo.claimById(notifId);
      expect(secondClaim).toBeNull();
    });

    it('recovers stale notification leases past timeout', async () => {
      const localMatchId = crypto.randomUUID();
      await matchRepo.create({
        id: localMatchId,
        projectId: testProjectId,
        progressUpdateId: testPuId,
        activityId: testActivityId,
        confidenceScore: 0.9,
        matchMethod: 'llm_assisted',
        status: 'suggested',
        reviewState: 'awaiting_review'
      });

      const notifId = crypto.randomUUID();
      await outboxRepo.create({
        id: notifId,
        projectId: testProjectId,
        activityMatchId: localMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: { test: true } as any,
        idempotencyKey: `stale-test-${notifId}`
      });

      await outboxRepo.claimById(notifId);

      // Requeue with timeout = 0 (immediately stale)
      const recovered = await outboxRepo.requeueStaleProcessing(0);
      expect(recovered).toBeGreaterThanOrEqual(1);

      // Now eligible to be claimed again
      const reclaimed = await outboxRepo.claimById(notifId);
      expect(reclaimed).not.toBeNull();
      expect(reclaimed?.id).toBe(notifId);
    });
  });

  describe('8. Processing Jobs Queue Semantics', () => {
    it('enqueues, claims, and marks jobs completed in PostgreSQL', async () => {
      const job = await jobRepo.create({
        projectId: testProjectId,
        jobType: 'document_ingestion',
        payload: { evidenceId: crypto.randomUUID() }
      });

      expect(job.status).toBe('queued');

      const claimed = await jobRepo.claimNextQueued();
      expect(claimed).not.toBeNull();
      expect(claimed?.status).toBe('processing');

      const completed = await jobRepo.markCompleted(claimed!.id, {
        pagesProcessed: 3,
        activitiesMatched: 2
      });

      expect(completed?.status).toBe('completed');
      expect(completed?.result).toEqual({ pagesProcessed: 3, activitiesMatched: 2 });
    });
  });
});
