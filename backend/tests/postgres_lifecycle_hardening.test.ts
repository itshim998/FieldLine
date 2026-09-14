import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import crypto from 'node:crypto';
import {
  initPostgres,
  closePostgres,
  isPostgresHealthy,
  checkPostgresSchemaReadiness,
  assertPostgresSchemaReady,
  setPostgresPoolInstance,
  CRITICAL_POSTGRES_TABLES
} from '../src/database/postgres.js';
import {
  runPostgresMigrations,
  getAppliedPostgresMigrations
} from '../src/database/postgres-migrator.js';
import { PostgresProjectRepository } from '../src/repositories/postgres/postgres-project.repository.js';
import { PostgresScheduleRepository } from '../src/repositories/postgres/postgres-schedule.repository.js';
import { PostgresActivityRepository } from '../src/repositories/postgres/postgres-activity.repository.js';
import { PostgresActivityMatchRepository } from '../src/repositories/postgres/postgres-activity-match.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import { env, getValidatedEnv } from '../src/config/env.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import { goldenManifestInvariants } from '../../demo/golden-demo-manifest.js';

describe('PostgreSQL / Supabase Production Lifecycle & Hardening Suite', () => {
  let memDb: ReturnType<typeof newDb>;
  let pool: pg.Pool;
  let originalProvider: string;

  beforeEach(async () => {
    originalProvider = env.DATABASE_PROVIDER;
    (env as any).DATABASE_PROVIDER = 'postgres';

    memDb = newDb({ noAstCoverageCheck: true });
    const { Pool } = memDb.adapters.createPg();
    pool = new Pool();
    setPostgresPoolInstance(pool);
  });

  afterEach(async () => {
    (env as any).DATABASE_PROVIDER = originalProvider;
    await closePostgres();
  });

  describe('1. Configuration & Default Values', () => {
    it('defaults AUTO_SEED_DEMO to false when unspecified', () => {
      const parsed = getValidatedEnv({
        PORT: '3001',
        DATABASE_PROVIDER: 'sqlite'
      });
      expect(parsed.AUTO_SEED_DEMO).toBe(false);
    });

    it('defaults DATABASE_AUTO_MIGRATE to false when unspecified', () => {
      const parsed = getValidatedEnv({
        PORT: '3001',
        DATABASE_PROVIDER: 'sqlite'
      });
      expect(parsed.DATABASE_AUTO_MIGRATE).toBe(false);
    });

    it('defaults DATABASE_SSL_REJECT_UNAUTHORIZED to false to support Supabase pooler CA chain', () => {
      const parsed = getValidatedEnv({
        PORT: '3001',
        DATABASE_PROVIDER: 'sqlite'
      });
      expect(parsed.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(false);
    });

    it('allows explicit override of DATABASE_AUTO_MIGRATE=true for local non-Supabase dev', () => {
      const parsed = getValidatedEnv({
        PORT: '3001',
        DATABASE_PROVIDER: 'sqlite',
        DATABASE_AUTO_MIGRATE: 'true'
      });
      expect(parsed.DATABASE_AUTO_MIGRATE).toBe(true);
    });
  });

  describe('2. Schema-Readiness Check', () => {
    it('reports missing critical tables on an unmigrated database', async () => {
      const readiness = await checkPostgresSchemaReadiness(pool);
      expect(readiness.ready).toBe(false);
      expect(readiness.missingTables.length).toBe(CRITICAL_POSTGRES_TABLES.length);
      for (const table of CRITICAL_POSTGRES_TABLES) {
        expect(readiness.missingTables).toContain(table);
      }
    });

    it('assertPostgresSchemaReady throws safe diagnostic without credentials on unmigrated database', async () => {
      await expect(assertPostgresSchemaReady(pool)).rejects.toThrow(
        /FieldLine database schema is not ready\. Missing table\(s\): .* Apply pending Supabase migrations before starting the backend\./
      );
    });

    it('detects partial schema when essential tables are missing', async () => {
      // Simulate partial migration by creating only projects and schedules
      await pool.query(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, code TEXT UNIQUE);
        CREATE TABLE schedules (id TEXT PRIMARY KEY, project_id TEXT, name TEXT);
      `);

      const readiness = await checkPostgresSchemaReadiness(pool);
      expect(readiness.ready).toBe(false);
      expect(readiness.existingTables).toContain('projects');
      expect(readiness.existingTables).toContain('schedules');
      expect(readiness.missingTables).toContain('activities');
      expect(readiness.missingTables).toContain('notification_outbox');
      expect(readiness.missingTables).toContain('processing_jobs');

      await expect(assertPostgresSchemaReady(pool)).rejects.toThrow(
        /FieldLine database schema is not ready\. Missing table\(s\): activities, progress_updates, evidence/
      );
    });

    it('confirms readiness when all 13 critical tables exist', async () => {
      // Pre-apply migration (simulating Supabase having already migrated)
      await runPostgresMigrations(pool);

      const readiness = await checkPostgresSchemaReadiness(pool);
      expect(readiness.ready).toBe(true);
      expect(readiness.missingTables).toHaveLength(0);

      // assertPostgresSchemaReady should not throw
      await expect(assertPostgresSchemaReady(pool)).resolves.toBeUndefined();
    });
  });

  describe('3. Production Single-Authority Migration Flow (First-Start & Restart)', () => {
    it('First start: connects with pre-migrated schema without running application migrations, seeds Golden Demo', async () => {
      // Step A: Supabase GitHub integration deploys schema beforehand
      await runPostgresMigrations(pool);
      const appliedBefore = await getAppliedPostgresMigrations(pool);
      expect(appliedBefore.length).toBeGreaterThan(0);

      // Step B: FieldLine initializes with autoMigrate: false (production default)
      const initializedPool = await initPostgres({ pool, autoMigrate: false });
      expect(initializedPool).toBe(pool);
      expect(await isPostgresHealthy(pool)).toBe(true);

      // Step C: Schema readiness check passes
      const readiness = await checkPostgresSchemaReadiness(pool);
      expect(readiness.ready).toBe(true);

      // Step D: Seed Golden Demo (AUTO_SEED_DEMO=true)
      const seedResult = await seedGoldenDemo();
      expect(seedResult.projectCode).toBe(goldenManifestInvariants.projectCode);
      expect(seedResult.activitiesCount).toBe(goldenManifestInvariants.activityCount);
      expect(seedResult.evidenceCount).toBe(goldenManifestInvariants.expectedEvidenceFileNames.length);

      // Verify records in DB
      const projectRepo = new PostgresProjectRepository(() => pool);
      const activityRepo = new PostgresActivityRepository(() => pool);
      const scheduleRepo = new PostgresScheduleRepository(() => pool);

      const project = await projectRepo.getByCode(goldenManifestInvariants.projectCode);
      expect(project).toBeDefined();

      const activities = await activityRepo.listByProjectId(project!.id);
      expect(activities).toHaveLength(goldenManifestInvariants.activityCount);

      const schedules = await scheduleRepo.listByProjectId(project!.id);
      expect(schedules).toHaveLength(1);
    });

    it('Second start (Restart): preserves existing data, skips migration, and does not duplicate project or activities', async () => {
      // 1. First run: Schema pre-applied + Golden Demo seeded
      await runPostgresMigrations(pool);
      await seedGoldenDemo();

      const projectRepo = new PostgresProjectRepository(() => pool);
      const scheduleRepo = new PostgresScheduleRepository(() => pool);
      const activityRepo = new PostgresActivityRepository(() => pool);

      const projectFirst = await projectRepo.getByCode(goldenManifestInvariants.projectCode);
      expect(projectFirst).toBeDefined();
      const schedFirst = await scheduleRepo.listByProjectId(projectFirst!.id);
      const actFirst = await activityRepo.listByProjectId(projectFirst!.id);
      expect(schedFirst).toHaveLength(1);
      expect(actFirst).toHaveLength(30);

      // 2. Restart simulation:
      // In production, startup connects, checks schema readiness, does NOT run migrations
      await assertPostgresSchemaReady(pool);

      // Re-running seedGoldenDemo directly should be completely idempotent
      const restartSeedResult = await seedGoldenDemo();
      expect(restartSeedResult.projectId).toBe(projectFirst!.id);
      expect(restartSeedResult.projectCode).toBe(projectFirst!.code);
      expect(restartSeedResult.activitiesCount).toBe(30);

      // Verify no duplicate schedules or activities were created
      const schedAfter = await scheduleRepo.listByProjectId(projectFirst!.id);
      const actAfter = await activityRepo.listByProjectId(projectFirst!.id);
      expect(schedAfter).toHaveLength(1);
      expect(actAfter).toHaveLength(30);
    });

    it('Simulated missing migration scenario: halts startup before workers can start', async () => {
      // Database has only partial tables
      await pool.query(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, code TEXT UNIQUE);
      `);

      let workerStarted = false;
      let serverStarted = false;

      const startupSimulation = async () => {
        // Step 1: verify connection & schema readiness
        await assertPostgresSchemaReady(pool);
        // Step 2: workers should only start AFTER schema readiness succeeds
        workerStarted = true;
        serverStarted = true;
      };

      await expect(startupSimulation()).rejects.toThrow(
        /FieldLine database schema is not ready/
      );
      expect(workerStarted).toBe(false);
      expect(serverStarted).toBe(false);
    });
  });

  describe('4. Notification Outbox Transactional Safety', () => {
    it('persists activity matches, project events, and notification outbox records in the same transaction', async () => {
      await runPostgresMigrations(pool);

      const projectRepo = new PostgresProjectRepository(() => pool);
      const scheduleRepo = new PostgresScheduleRepository(() => pool);
      const matchRepo = new PostgresActivityMatchRepository(() => pool);
      const outboxRepo = new PostgresNotificationOutboxRepository(() => pool);

      const projId = crypto.randomUUID();
      await projectRepo.create({
        id: projId,
        name: 'Outbox Test Project',
        code: `PROJ-OUTBOX-${Date.now()}`
      });

      const schedId = crypto.randomUUID();
      const actId = crypto.randomUUID();
      await scheduleRepo.createWithActivities(
        {
          id: schedId,
          projectId: projId,
          name: 'Schedule 1',
          sourceType: 'csv'
        },
        [
          {
            id: actId,
            projectId: projId,
            externalId: 'ACT-OUTBOX-1',
            name: 'Piping Inspection',
            plannedStart: '2026-09-01',
            plannedFinish: '2026-09-10'
          }
        ]
      );

      const puId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO progress_updates (id, project_id, report_date, raw_text, status, source_type)
         VALUES ($1, $2, '2026-09-05', 'Completed piping test', 'processed', 'text')`,
        [puId, projId]
      );

      const matchId = crypto.randomUUID();
      const notifId = crypto.randomUUID();
      const idempotencyKey = `fieldline-anomaly-alert:${matchId}`;

      // Persist matches, events, and outbox atomically
      const persistedMatches = await matchRepo.persistMatchesAndEventsAtomically({
        projectId: projId,
        progressUpdateId: puId,
        matches: [
          {
            id: matchId,
            projectId: projId,
            progressUpdateId: puId,
            activityId: actId,
            confidenceScore: 0.95,
            matchMethod: 'exact_id',
            status: 'confirmed',
            anomalyScore: 0.85,
            anomalySeverity: 'high'
          }
        ],
        events: [
          {
            projectId: projId,
            eventType: 'progress_recorded',
            summary: 'Piping observation matched'
          }
        ],
        notifications: [
          {
            id: notifId,
            projectId: projId,
            activityMatchId: matchId,
            notificationType: 'anomaly_alert',
            channel: 'email',
            payload: {
              messageInput: {
                projectName: 'Outbox Test Project',
                activityExternalId: 'ACT-OUTBOX-1',
                activityName: 'Piping Inspection',
                reportDate: '2026-09-05',
                reportedPercent: 85,
                anomalyScore: 0.85,
                anomalySeverity: 'high',
                anomalyReasons: ['Unusually rapid progression']
              }
            },
            idempotencyKey
          }
        ]
      });

      expect(persistedMatches).toHaveLength(1);
      expect(persistedMatches[0].id).toBe(matchId);

      // Verify outbox record exists and links directly to match
      const outboxItem = await outboxRepo.getById(notifId);
      expect(outboxItem).toBeDefined();
      expect(outboxItem?.activityMatchId).toBe(matchId);
      expect(outboxItem?.status).toBe('pending');
      expect(outboxItem?.idempotencyKey).toBe(idempotencyKey);
    });
  });
});
