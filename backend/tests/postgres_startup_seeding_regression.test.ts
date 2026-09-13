import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import crypto from 'node:crypto';
import { initPostgres, closePostgres } from '../src/database/postgres.js';
import {
  runPostgresMigrations,
  getAppliedPostgresMigrations
} from '../src/database/postgres-migrator.js';
import { PostgresProjectRepository } from '../src/repositories/postgres/postgres-project.repository.js';
import { PostgresScheduleRepository } from '../src/repositories/postgres/postgres-schedule.repository.js';
import { PostgresActivityRepository } from '../src/repositories/postgres/postgres-activity.repository.js';
import { PostgresEvidenceRepository } from '../src/repositories/postgres/postgres-evidence.repository.js';
import { PostgresProgressUpdateRepository } from '../src/repositories/postgres/postgres-progress-update.repository.js';
import { PostgresActivityMatchRepository } from '../src/repositories/postgres/postgres-activity-match.repository.js';
import { PostgresActivityProgressRepository } from '../src/repositories/postgres/postgres-activity-progress.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import { PostgresProjectAccountRepository } from '../src/repositories/postgres/postgres-project-account.repository.js';
import { PostgresOperationalBlockerRepository } from '../src/repositories/postgres/postgres-operational-blocker.repository.js';
import { PostgresProjectEventRepository } from '../src/repositories/postgres/postgres-project-event.repository.js';
import { PostgresSystemRepository } from '../src/repositories/postgres/postgres-system.repository.js';
import { PostgresJobRepository } from '../src/repositories/postgres/postgres-job.repository.js';

describe('PostgreSQL Startup & Seeding Concurrency Regression Suite', () => {
  let memDb: ReturnType<typeof newDb>;
  let pool: pg.Pool;

  beforeAll(async () => {
    memDb = newDb({ noAstCoverageCheck: true });
    const { Pool } = memDb.adapters.createPg();
    pool = new Pool();
    await initPostgres({ pool });
  });

  afterAll(async () => {
    await closePostgres();
  });

  it('1. Concurrently executing runPostgresMigrations deduplicates in-flight calls and prevents race conditions', async () => {
    // Spawn 5 concurrent migration calls simultaneously
    const migrationPromises = [
      runPostgresMigrations(pool),
      runPostgresMigrations(pool),
      runPostgresMigrations(pool),
      runPostgresMigrations(pool),
      runPostgresMigrations(pool)
    ];

    const results = await Promise.all(migrationPromises);

    // All concurrent executions must resolve without error
    expect(results).toHaveLength(5);
    for (const res of results) {
      expect(res).toBeDefined();
      expect(Array.isArray(res.applied)).toBe(true);
      expect(Array.isArray(res.alreadyApplied)).toBe(true);
    }

    // Verify migrations table has exactly the expected migrations recorded
    const applied = await getAppliedPostgresMigrations(pool);
    expect(applied.length).toBeGreaterThan(0);

    // Verify there are no duplicate migration names in database
    const uniqueNames = new Set(applied);
    expect(uniqueNames.size).toBe(applied.length);
  });

  it('2. Subsequent runPostgresMigrations call is completely idempotent and reports all migrations already applied', async () => {
    const result = await runPostgresMigrations(pool);
    expect(result.applied).toHaveLength(0);
    expect(result.alreadyApplied.length).toBeGreaterThan(0);
  });

  it('3. PostgreSQL all 13 repositories conform to async interface signatures without unawaited promises', async () => {
    const projectRepo = new PostgresProjectRepository();
    const scheduleRepo = new PostgresScheduleRepository();
    const activityRepo = new PostgresActivityRepository();
    const evidenceRepo = new PostgresEvidenceRepository();
    const puRepo = new PostgresProgressUpdateRepository();
    const matchRepo = new PostgresActivityMatchRepository();
    const progressRepo = new PostgresActivityProgressRepository();
    const outboxRepo = new PostgresNotificationOutboxRepository();
    const accountRepo = new PostgresProjectAccountRepository();
    const blockerRepo = new PostgresOperationalBlockerRepository();
    const eventRepo = new PostgresProjectEventRepository();
    const systemRepo = new PostgresSystemRepository();
    const jobRepo = new PostgresJobRepository();

    const testProjId = crypto.randomUUID();
    const testCode = `PROJ-REG-${Date.now()}`;

    // 1. Test Project Repo
    const createdProject = await projectRepo.create({
      id: testProjId,
      code: testCode,
      name: 'Regression Test Project',
      description: 'Testing repo async signatures',
      startDate: '2026-09-01',
      targetEndDate: '2026-12-31'
    });
    expect(createdProject.id).toBe(testProjId);

    const fetchedProject = await projectRepo.getById(testProjId);
    expect(fetchedProject?.code).toBe(testCode);

    // 2. Test Schedule & 3. Activity Repo
    const testSchedId = crypto.randomUUID();
    const testActId = crypto.randomUUID();
    const createdSchedResult = await scheduleRepo.createWithActivities(
      {
        id: testSchedId,
        projectId: testProjId,
        name: 'Baseline Schedule',
        version: '1.0',
        sourceType: 'csv'
      },
      [
        {
          id: testActId,
          projectId: testProjId,
          externalId: 'ACT-REG-01',
          name: 'Piling Test Activity',
          plannedStart: '2026-09-02',
          plannedFinish: '2026-09-10'
        }
      ]
    );
    expect(createdSchedResult.schedule.id).toBe(testSchedId);

    const activities = await activityRepo.listByProjectId(testProjId);
    expect(activities).toHaveLength(1);
    expect(activities[0].id).toBe(testActId);

    // 4. Test Evidence Repo
    const testEvId = crypto.randomUUID();
    const evidence = await evidenceRepo.create({
      id: testEvId,
      projectId: testProjId,
      fileName: 'daily_log.txt',
      filePath: 'daily_log.txt',
      fileType: 'text',
      fileSizeBytes: 1024,
      mimeType: 'text/plain'
    });
    expect(evidence.id).toBe(testEvId);

    // 5. Test Progress Update Repo
    const testPuId = crypto.randomUUID();
    const pu = await puRepo.create({
      id: testPuId,
      projectId: testProjId,
      sourceType: 'voice',
      rawText: 'Piling completed 100%',
      status: 'processed',
      reportDate: '2026-09-05'
    });
    expect(pu.id).toBe(testPuId);

    // 6. Test Activity Match Repo with atomic confirmation
    const testMatchId = crypto.randomUUID();
    const match = await matchRepo.create({
      id: testMatchId,
      projectId: testProjId,
      progressUpdateId: testPuId,
      activityId: testActId,
      confidenceScore: 0.99,
      matchMethod: 'exact_id',
      status: 'confirmed',
      reviewState: 'resolved',
      reviewedBy: 'system'
    });
    expect(match.id).toBe(testMatchId);
    expect(match.status).toBe('confirmed');

    // 7. Test Activity Progress Repo
    const testProgId = crypto.randomUUID();
    const prog = await progressRepo.create({
      id: testProgId,
      projectId: testProjId,
      activityId: testActId,
      progressUpdateId: testPuId,
      asOfDate: '2026-09-05',
      actualPercent: 100
    });
    expect(prog.actualPercent).toBe(100);

    // 8. Test Outbox Repo with confirmed match linkage
    const testOutboxId = crypto.randomUUID();
    const outbox = await outboxRepo.create({
      id: testOutboxId,
      projectId: testProjId,
      activityMatchId: testMatchId,
      payload: {
        messageInput: {
          projectName: 'Test Project',
          activityExternalId: 'ACT-001',
          activityName: 'Test Activity',
          reportDate: '2026-09-05',
          reportedPercent: 50,
          anomalyScore: 0.9,
          anomalySeverity: 'high',
          anomalyReasons: ['Anomaly test']
        }
      }
    });
    expect(outbox.id).toBe(testOutboxId);
    expect(outbox.activityMatchId).toBe(testMatchId);

    // 9. Test Blocker Repo
    const testBlockerId = crypto.randomUUID();
    const blocker = await blockerRepo.create({
      id: testBlockerId,
      projectId: testProjId,
      activityId: testActId,
      category: 'weather',
      description: 'Heavy rain delay',
      status: 'active',
      reporterName: 'Carlos Rivera',
      reporterRole: 'Site Foreman'
    });
    expect(blocker.id).toBe(testBlockerId);

    const activeBlockers = await blockerRepo.listActiveByProject(testProjId);
    expect(activeBlockers).toHaveLength(1);

    // 10. Test System Repo
    const isHealthy = await systemRepo.isHealthy();
    expect(isHealthy).toBe(true);

    // 11. Test Account Repo
    const testAccId = crypto.randomUUID();
    const acc = await accountRepo.create({
      id: testAccId,
      projectId: testProjId,
      accountType: 'worker',
      credentialHash: 'hash123',
      displayName: 'Field Worker'
    });
    expect(acc.id).toBe(testAccId);

    // 12. Test Event Repo
    const testEvtId = crypto.randomUUID();
    const evt = await eventRepo.create({
      id: testEvtId,
      projectId: testProjId,
      eventType: 'progress_recorded',
      entityType: 'activity_progress',
      entityId: testProgId,
      summary: 'Progress recorded to 100%'
    });
    expect(evt.id).toBe(testEvtId);

    // 13. Test Job Repo
    const testJobId = crypto.randomUUID();
    const job = await jobRepo.create({
      id: testJobId,
      projectId: testProjId,
      jobType: 'document_ingestion',
      payload: { documentId: 'doc-123' }
    });
    expect(job.id).toBe(testJobId);
  });

  it('4. Outbox records enforce non-null foreign key linkage to valid activity matches', async () => {
    const outboxRepo = new PostgresNotificationOutboxRepository();
    const invalidMatchId = crypto.randomUUID();
    const testProjId = crypto.randomUUID();

    // Foreign key violation should be raised when referencing nonexistent match
    await expect(
      outboxRepo.create({
        projectId: testProjId,
        activityMatchId: invalidMatchId,
        payload: {
          messageInput: {
            projectName: 'Test Project',
            activityExternalId: 'ACT-001',
            activityName: 'Test Activity',
            reportDate: '2026-09-05',
            reportedPercent: 50,
            anomalyScore: 0.9,
            anomalySeverity: 'high',
            anomalyReasons: ['Anomaly test']
          }
        }
      })
    ).rejects.toThrow();
  });
});
