import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { newDb } from 'pg-mem';
import { DefaultAnomalyNotificationService } from '../src/services/anomaly/anomaly-notification.service.js';
import { SqliteNotificationOutboxRepository } from '../src/repositories/notification-outbox.repository.js';
import { PostgresNotificationOutboxRepository } from '../src/repositories/postgres/postgres-notification-outbox.repository.js';
import { AnomalyMessageGeneratorService } from '../src/services/anomaly/anomaly-message.types.js';
import { EmailDeliveryService } from '../src/services/anomaly/email/email-delivery.types.js';
import { initPostgres, closePostgres } from '../src/database/postgres.js';
import { runPostgresMigrations } from '../src/database/postgres-migrator.js';

describe('Phase 4 Anomaly Notification Identity Correctness & Relational Integrity', () => {
  let sqliteDb: Database.Database;
  let sqliteOutboxRepo: SqliteNotificationOutboxRepository;

  const mockGenerator: AnomalyMessageGeneratorService = {
    generateAnomalyMessage: vi.fn().mockImplementation(async (input) => ({
      title: 'CRITICAL: Rapid Excavation Variance Detected',
      summary: 'Physical progress increased by 80% in 24 hours.',
      details: 'Statistical deviation verified against baseline distribution.',
      recommendedAction: 'Inspect foundation depth immediately.',
      fullMessage: 'Comprehensive natural-language prose alert.',
      activityMatchId: input.activityMatchId,
      projectName: input.projectName,
      activityExternalId: input.activityExternalId,
      activityName: input.activityName,
      activityLocation: input.activityLocation || null,
      reportDate: input.reportDate,
      reporterName: input.reporterName || null,
      previousPercent: input.previousPercent || null,
      reportedPercent: input.reportedPercent,
      severity: input.anomalySeverity,
      anomalyScore: input.anomalyScore,
      anomalyReasons: input.anomalyReasons,
      generatedBy: 'groq',
      generatedAt: new Date().toISOString()
    }))
  };

  const mockEmailDelivery: EmailDeliveryService = {
    sendAnomalyAlert: vi.fn().mockResolvedValue({
      sent: true,
      provider: 'resend',
      providerMessageId: 'resend_msg_auth_test_123'
    })
  };

  beforeEach(() => {
    sqliteDb = new Database(':memory:');
    sqliteDb.pragma('foreign_keys = ON');

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        start_date TEXT,
        target_end_date TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS activity_matches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        progress_update_id TEXT NOT NULL,
        activity_id TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        match_method TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'suggested',
        anomaly_score REAL,
        anomaly_severity TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS notification_outbox (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        activity_match_id TEXT NOT NULL REFERENCES activity_matches(id),
        notification_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_attempt_at TEXT,
        locked_at TEXT,
        last_attempt_at TEXT,
        delivered_at TEXT,
        provider_message_id TEXT,
        last_error_code TEXT,
        last_error_summary TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE TABLE IF NOT EXISTS project_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        event_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        summary TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);

    sqliteOutboxRepo = new SqliteNotificationOutboxRepository(() => sqliteDb);
  });

  afterEach(() => {
    sqliteDb.close();
  });

  describe('Verification 1: Duplicate & Invalid Identifier Guards (SQLite & Domain Service)', () => {
    it('successfully creates outbox row when authoritative projectId and activityMatchId are provided', async () => {
      const realProjectId = crypto.randomUUID();
      const realMatchId = crypto.randomUUID();

      // Seed parent project and match
      sqliteDb
        .prepare('INSERT INTO projects (id, code, name) VALUES (?, ?, ?)')
        .run(realProjectId, 'PRJ-AUTH-01', 'Refinery Expansion — Unit 4');
      sqliteDb
        .prepare(
          'INSERT INTO activity_matches (id, project_id, progress_update_id, activity_id, confidence_score, match_method) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(realMatchId, realProjectId, 'pu-1', 'act-1', 0.95, 'exact_id');

      const service = new DefaultAnomalyNotificationService({
        messageGeneratorService: mockGenerator,
        emailDeliveryService: mockEmailDelivery,
        outboxRepo: sqliteOutboxRepo
      });

      const result = await service.notifyAnomalyAlert({
        prediction: {
          severity: 'high',
          anomalyScore: 0.92,
          reviewRecommended: true,
          reasons: ['Progress exceeds 3x planned velocity']
        },
        context: {
          projectId: realProjectId,
          projectName: 'Refinery Expansion — Unit 4',
          activityExternalId: 'ACT-CRUDE-01',
          activityName: 'Crude Distillation Pump Foundation',
          reportDate: '2026-09-13',
          reportedPercent: 85,
          activityMatchId: realMatchId
        }
      });

      expect(result.outboxItem).not.toBeNull();
      expect(result.outboxItem?.projectId).toBe(realProjectId);
      expect(result.outboxItem?.projectId).not.toBe('Refinery Expansion — Unit 4');
      expect(result.outboxItem?.activityMatchId).toBe(realMatchId);
      expect(result.outboxItem?.idempotencyKey).toBe(`fieldline-anomaly-alert:${realMatchId}`);

      // Verify row in database
      const row = sqliteDb
        .prepare('SELECT * FROM notification_outbox WHERE id = ?')
        .get(result.outboxItem!.id) as any;
      expect(row.project_id).toBe(realProjectId);
      expect(row.activity_match_id).toBe(realMatchId);
      expect(row.project_id).not.toBe('Refinery Expansion — Unit 4');
    });

    it('NEVER fabricates synthetic match ID when activityMatchId is null or undefined', async () => {
      const realProjectId = crypto.randomUUID();
      sqliteDb
        .prepare('INSERT INTO projects (id, code, name) VALUES (?, ?, ?)')
        .run(realProjectId, 'PRJ-AUTH-02', 'Hydrocracker Complex');

      const service = new DefaultAnomalyNotificationService({
        messageGeneratorService: mockGenerator,
        emailDeliveryService: mockEmailDelivery,
        outboxRepo: sqliteOutboxRepo
      });

      // Invoke notifyAnomalyAlert with activityMatchId = null
      const resultNull = await service.notifyAnomalyAlert({
        prediction: {
          severity: 'high',
          anomalyScore: 0.95,
          reviewRecommended: true,
          reasons: ['Unphysical leap']
        },
        context: {
          projectId: realProjectId,
          projectName: 'Hydrocracker Complex',
          activityExternalId: 'ACT-HC-01',
          activityName: 'Reactor Column Pour',
          reportDate: '2026-09-13',
          reportedPercent: 90,
          activityMatchId: null
        }
      });

      expect(resultNull.outboxItem).toBeNull();
      expect(resultNull.message).toBeNull();
      expect(resultNull.delivery).toBeNull();

      // Invoke recordNotificationIntent with activityMatchId = undefined
      const intentResult = service.recordNotificationIntent({
        prediction: {
          severity: 'high',
          anomalyScore: 0.95,
          reviewRecommended: true,
          reasons: ['Unphysical leap']
        },
        context: {
          projectId: realProjectId,
          projectName: 'Hydrocracker Complex',
          activityExternalId: 'ACT-HC-01',
          activityName: 'Reactor Column Pour',
          reportDate: '2026-09-13',
          reportedPercent: 90,
          activityMatchId: undefined
        }
      });

      expect(intentResult).toBeNull();

      // Invariant: ZERO outbox rows exist, and NO match_* synthetic identifier was ever inserted
      const totalCount = sqliteDb
        .prepare('SELECT COUNT(*) as cnt FROM notification_outbox')
        .get() as any;
      expect(totalCount.cnt).toBe(0);

      const fakeMatches = sqliteDb
        .prepare("SELECT * FROM notification_outbox WHERE activity_match_id LIKE 'match_%'")
        .all();
      expect(fakeMatches.length).toBe(0);
    });

    it('NEVER substitutes projectName when projectId is missing or undefined', async () => {
      const realMatchId = crypto.randomUUID();

      const service = new DefaultAnomalyNotificationService({
        messageGeneratorService: mockGenerator,
        emailDeliveryService: mockEmailDelivery,
        outboxRepo: sqliteOutboxRepo
      });

      const result = await service.notifyAnomalyAlert({
        prediction: {
          severity: 'high',
          anomalyScore: 0.88,
          reviewRecommended: true,
          reasons: ['Rate deviation']
        },
        context: {
          projectId: undefined,
          projectName: 'Sulfur Recovery Unit',
          activityExternalId: 'ACT-SRU-01',
          activityName: 'Catalyst Bed Loading',
          reportDate: '2026-09-13',
          reportedPercent: 75,
          activityMatchId: realMatchId
        }
      });

      expect(result.outboxItem).toBeNull();

      // Ensure zero rows inserted
      const rows = sqliteDb.prepare('SELECT * FROM notification_outbox').all();
      expect(rows.length).toBe(0);
    });

    it('does not create outbox row for normal or cold-start predictions', async () => {
      const realProjectId = crypto.randomUUID();
      const realMatchId = crypto.randomUUID();

      const service = new DefaultAnomalyNotificationService({
        messageGeneratorService: mockGenerator,
        emailDeliveryService: mockEmailDelivery,
        outboxRepo: sqliteOutboxRepo
      });

      const normalResult = await service.notifyAnomalyAlert({
        prediction: {
          severity: 'normal',
          anomalyScore: 0.1,
          reviewRecommended: false,
          reasons: []
        },
        context: {
          projectId: realProjectId,
          projectName: 'Normal Project',
          activityExternalId: 'ACT-NORM-01',
          activityName: 'Standard Excavation',
          reportDate: '2026-09-13',
          reportedPercent: 20,
          activityMatchId: realMatchId
        }
      });

      expect(normalResult.outboxItem).toBeNull();
      expect(sqliteDb.prepare('SELECT COUNT(*) as cnt FROM notification_outbox').get()).toEqual({ cnt: 0 });
    });
  });

  describe('Verification 2: PostgreSQL Foreign Key Integrity & Rejection of Display Names', () => {
    let pgPool: any;
    let pgOutboxRepo: PostgresNotificationOutboxRepository;
    const testProjectId = crypto.randomUUID();
    const testScheduleId = crypto.randomUUID();
    const testActivityId = crypto.randomUUID();
    const testPuId = crypto.randomUUID();
    const testMatchId = crypto.randomUUID();

    beforeEach(async () => {
      const memDb = newDb({ noAstCoverageCheck: true });
      const { Pool } = memDb.adapters.createPg();
      pgPool = new Pool();

      await initPostgres({ pool: pgPool });
      await runPostgresMigrations(pgPool);
      pgOutboxRepo = new PostgresNotificationOutboxRepository(() => pgPool);

      // Seed valid parent entities in PostgreSQL
      await pgPool.query(
        `INSERT INTO projects (id, code, name, status) VALUES ($1, $2, $3, 'active')`,
        [testProjectId, 'PG-AUTH-TEST', 'Postgres Authority Project']
      );

      await pgPool.query(
        `INSERT INTO schedules (id, project_id, name, source_type) VALUES ($1, $2, $3, 'csv')`,
        [testScheduleId, testProjectId, 'Baseline Schedule']
      );

      await pgPool.query(
        `INSERT INTO activities (id, schedule_id, project_id, external_id, name, planned_start, planned_finish)
         VALUES ($1, $2, $3, 'ACT-PG-01', 'Postgres Activity', '2026-09-01', '2026-09-30')`,
        [testActivityId, testScheduleId, testProjectId]
      );

      await pgPool.query(
        `INSERT INTO progress_updates (id, project_id, report_date, source_type, raw_text, status)
         VALUES ($1, $2, '2026-09-13', 'text', 'Progress report', 'processed')`,
        [testPuId, testProjectId]
      );

      await pgPool.query(
        `INSERT INTO activity_matches (id, project_id, progress_update_id, activity_id, confidence_score, match_method, status)
         VALUES ($1, $2, $3, $4, 0.95, 'llm_assisted', 'suggested')`,
        [testMatchId, testProjectId, testPuId, testActivityId]
      );
    });

    afterEach(async () => {
      await closePostgres();
    });

    it('succeeds in PostgreSQL when passed real projectId and real activityMatchId', async () => {
      const notifId = crypto.randomUUID();
      const outboxItem = await pgOutboxRepo.create({
        id: notifId,
        projectId: testProjectId,
        activityMatchId: testMatchId,
        notificationType: 'anomaly_alert',
        channel: 'email',
        payload: {
          messageInput: {
            projectName: 'Postgres Authority Project',
            activityExternalId: 'ACT-PG-01',
            activityName: 'Postgres Activity',
            reportDate: '2026-09-13',
            reportedPercent: 80,
            anomalyScore: 0.95,
            anomalySeverity: 'high',
            anomalyReasons: ['Speed anomaly'],
            activityMatchId: testMatchId
          },
          message: null
        },
        idempotencyKey: `pg-auth-test-${notifId}`
      });

      expect(outboxItem.id).toBe(notifId);
      expect(outboxItem.projectId).toBe(testProjectId);
      expect(outboxItem.activityMatchId).toBe(testMatchId);

      // Verify row in PostgreSQL
      const pgRes = await pgPool.query('SELECT * FROM notification_outbox WHERE id = $1', [notifId]);
      expect(pgRes.rows.length).toBe(1);
      expect(pgRes.rows[0].project_id).toBe(testProjectId);
      expect(pgRes.rows[0].activity_match_id).toBe(testMatchId);
    });

    it('strictly FAILS in PostgreSQL when projectName is passed instead of projectId (foreign key violation)', async () => {
      const notifId = crypto.randomUUID();

      // Attempting to pass projectName ('Postgres Authority Project') instead of a valid project ID
      await expect(
        pgOutboxRepo.create({
          id: notifId,
          projectId: 'Postgres Authority Project', // INVALID display name
          activityMatchId: testMatchId,
          notificationType: 'anomaly_alert',
          channel: 'email',
          payload: { test: true } as any,
          idempotencyKey: `pg-invalid-project-${notifId}`
        })
      ).rejects.toThrow();
    });

    it('strictly FAILS in PostgreSQL when fabricated synthetic matchId is passed (foreign key violation)', async () => {
      const notifId = crypto.randomUUID();
      const fakeMatchId = `match_${Date.now()}`; // INVALID synthetic identifier

      await expect(
        pgOutboxRepo.create({
          id: notifId,
          projectId: testProjectId,
          activityMatchId: fakeMatchId, // Does NOT exist in activity_matches
          notificationType: 'anomaly_alert',
          channel: 'email',
          payload: { test: true } as any,
          idempotencyKey: `pg-fake-match-${notifId}`
        })
      ).rejects.toThrow();
    });

    it('Verification 3: executes full end-to-end anomaly notification flow on PostgreSQL', async () => {
      const pgNotificationService = new DefaultAnomalyNotificationService({
        messageGeneratorService: mockGenerator,
        emailDeliveryService: mockEmailDelivery,
        outboxRepo: pgOutboxRepo as any
      });

      const result = await pgNotificationService.notifyAnomalyAlert({
        prediction: {
          severity: 'high',
          anomalyScore: 0.94,
          reviewRecommended: true,
          reasons: ['Progress pace 4x expected velocity']
        },
        context: {
          projectId: testProjectId,
          projectName: 'Postgres Authority Project',
          activityExternalId: 'ACT-PG-01',
          activityName: 'Postgres Activity',
          reportDate: '2026-09-13',
          reportedPercent: 88,
          activityMatchId: testMatchId
        }
      });

      expect(result.outboxItem).not.toBeNull();
      expect(result.outboxItem?.projectId).toBe(testProjectId);
      expect(result.outboxItem?.activityMatchId).toBe(testMatchId);
      expect(result.outboxItem?.status).toBe('delivered');
      expect(result.outboxItem?.providerMessageId).toBe('resend_msg_auth_test_123');
      expect(result.delivery?.sent).toBe(true);

      // Verify row in PostgreSQL has authoritative relational IDs
      const dbRow = await pgPool.query('SELECT * FROM notification_outbox WHERE activity_match_id = $1', [testMatchId]);
      expect(dbRow.rows.length).toBe(1);
      expect(dbRow.rows[0].project_id).toBe(testProjectId);
      expect(dbRow.rows[0].activity_match_id).toBe(testMatchId);
      expect(dbRow.rows[0].status).toBe('delivered');

      // Verify idempotency: calling again with same match does NOT create duplicate row
      const secondResult = await pgNotificationService.notifyAnomalyAlert({
        prediction: {
          severity: 'high',
          anomalyScore: 0.94,
          reviewRecommended: true,
          reasons: ['Progress pace 4x expected velocity']
        },
        context: {
          projectId: testProjectId,
          projectName: 'Postgres Authority Project',
          activityExternalId: 'ACT-PG-01',
          activityName: 'Postgres Activity',
          reportDate: '2026-09-13',
          reportedPercent: 88,
          activityMatchId: testMatchId
        }
      });

      expect(secondResult.outboxItem?.id).toBe(result.outboxItem?.id);
      const rowCountRes = await pgPool.query('SELECT COUNT(*) as count FROM notification_outbox WHERE activity_match_id = $1', [testMatchId]);
      expect(parseInt(rowCountRes.rows[0].count, 10)).toBe(1);
    });
  });
});
