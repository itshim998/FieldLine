import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { workerAuthHeader } from './helpers/auth-test-helper.js';
import { ResendEmailDeliveryService } from '../src/services/anomaly/email/resend-email-delivery.service.js';
import { DefaultAnomalyNotificationService } from '../src/services/anomaly/anomaly-notification.service.js';
import { DefaultWorkerOperationalService } from '../src/services/worker/worker-operational.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultProgressAnomalyEvaluationService } from '../src/services/anomaly/progress-anomaly-evaluation.service.js';

describe('Phase 3 — End-to-End Anomaly Evaluation to Email Delivery Integration', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;

  let testProjectId: string;
  let testScheduleId: string;
  let actFoundationId: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);

    app = createApp();

    const proj = projectRepo.create({
      code: 'REFINERY-P3',
      name: 'Refinery Unit 4 Expansion',
      description: 'Phase 3 Email Integration Project'
    });
    testProjectId = proj.id;

    const sched = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Master Baseline Schedule',
      sourceType: 'manual',
      isBaseline: true
    });
    testScheduleId = sched.id;

    const act1 = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-FOUND-01',
      name: 'Foundation Footing Concrete Pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      plannedQuantity: 100,
      unit: 'm3',
      location: 'Area B',
      baselineProgress: 0
    });
    actFoundationId = act1.id;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('1. End-to-End Direct Worker Report: Evaluates anomaly, persists match, renders email, and calls Resend API', async () => {
    // Seed prior canonical progress: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    let outgoingUrl = '';
    let outgoingInit: RequestInit | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      outgoingUrl = url;
      outgoingInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_direct_report_ok' })
      };
    });

    // Construct test service pipeline with mocked HTTP delivery
    const emailDelivery = new ResendEmailDeliveryService({
      apiKey: 're_test_key_phase3_direct',
      recipients: ['admin@refinery.com'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const notificationService = new DefaultAnomalyNotificationService({
      emailDeliveryService: emailDelivery
    });

    const progressService = new DefaultProgressService({
      activityProgressRepo,
      activityRepo,
      activityMatchRepo
    });

    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });

    const workerService = new DefaultWorkerOperationalService({
      projectRepo,
      activityRepo,
      snapshotService,
      progressUpdateRepo,
      activityMatchRepo,
      progressService,
      activityProgressRepo,
      anomalyNotificationService: notificationService
    });

    // Worker quick-report submitting 95% (+85% in 1 day => HIGH anomaly)
    const response = await workerService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: actFoundationId,
      progressPercent: 95,
      reporterName: 'Rajesh Kumar',
      reporterRole: 'Civil Lead',
      notes: 'Footing concrete pour completed rapidly',
      sourceType: 'manual'
    });

    // 1. Operational response succeeds
    expect(response.status).toBe('confirmed');
    expect(response.derivedPercent).toBe(95);

    // 2. Anomaly record was persisted
    const match = response.match;
    expect(match).toBeDefined();
    expect(match?.anomalySeverity).toBe('high');
    expect(match?.anomalyScore).toBeGreaterThanOrEqual(0.75);

    // 3. Resend email was delivered over HTTPS
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(outgoingUrl).toBe('https://api.resend.com/emails');

    const headers = outgoingInit?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer re_test_key_phase3_direct');
    expect(headers['Idempotency-Key']).toBe(`fieldline-anomaly-alert:${match?.id}`);

    const payload = JSON.parse(outgoingInit?.body as string);
    expect(payload.to).toEqual(['admin@refinery.com']);
    expect(payload.subject).toContain('[FieldLine Alert] HIGH: Foundation Footing Concrete Pour');

    // Authoritative facts verified inside email content
    expect(payload.html).toContain('Refinery Unit 4 Expansion');
    expect(payload.html).toContain('Foundation Footing Concrete Pour');
    expect(payload.html).toContain('ACT-FOUND-01');
    expect(payload.html).toContain('10%'); // Prior progress
    expect(payload.html).toContain('95%'); // Reported progress
    expect(payload.html).toContain('Area B');
    expect(payload.html).toContain('Rajesh Kumar');
    expect(payload.html).toContain('HIGH SEVERITY');
  });

  it('2. End-to-End Freeform AI Report: Extraction -> Matching -> Persistence -> Email Delivery', async () => {
    // Seed prior progress: 15% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 15,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    let outgoingInit: RequestInit | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      outgoingInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_freeform_ok' })
      };
    });

    const emailDelivery = new ResendEmailDeliveryService({
      apiKey: 're_test_key_phase3_freeform',
      recipients: ['admin@refinery.com'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const notificationService = new DefaultAnomalyNotificationService({
      emailDeliveryService: emailDelivery
    });

    const matchingService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      activityMatchRepo,
      activityProgressRepo,
      anomalyNotificationService: notificationService
    });

    // Create progress report record
    const updateRecord = progressUpdateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-16',
      rawText: 'Foundation Footing Concrete Pour at Area B reached 92%',
      reporterName: 'Carlos Ramos',
      sourceType: 'manual',
      status: 'received'
    });

    // Process matching with persistence
    const matchResult = await matchingService.matchProgressUpdate(
      testProjectId,
      updateRecord.id,
      {
        items: [
          {
            reference: 'Foundation Footing Concrete Pour',
            location: 'Area B',
            progress_percent: 92,
            status: 'in_progress'
          }
        ]
      },
      { persist: true }
    );

    expect(matchResult.matches).toHaveLength(1);
    const best = matchResult.matches[0].bestMatch;
    expect(best).toBeDefined();
    expect(best?.anomalySeverity).toBe('high');

    // Email delivery verified
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(outgoingInit?.body as string);
    expect(payload.subject).toContain('[FieldLine Alert] HIGH:');
    expect(payload.html).toContain('92%');
    expect(payload.html).toContain('15%');
  });

  it('3. Failure Independence: Resend failure (HTTP 503) DOES NOT roll back the anomaly or worker report', async () => {
    // Seed prior progress: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Resend simulates cluster outage
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Service Unavailable' })
    });

    const emailDelivery = new ResendEmailDeliveryService({
      apiKey: 're_test_key_fail',
      recipients: ['admin@refinery.com'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const notificationService = new DefaultAnomalyNotificationService({
      emailDeliveryService: emailDelivery
    });

    const progressService = new DefaultProgressService({
      activityProgressRepo,
      activityRepo,
      activityMatchRepo
    });

    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });

    const workerService = new DefaultWorkerOperationalService({
      projectRepo,
      activityRepo,
      snapshotService,
      progressUpdateRepo,
      activityMatchRepo,
      progressService,
      activityProgressRepo,
      anomalyNotificationService: notificationService
    });

    // Submit report with HIGH anomaly
    const response = await workerService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: actFoundationId,
      progressPercent: 95,
      reporterName: 'Carlos Ramos',
      sourceType: 'manual'
    });

    // 1. Worker operation still succeeded!
    expect(response.status).toBe('confirmed');
    expect(response.derivedPercent).toBe(95);

    // 2. Anomaly record remains fully intact in SQLite
    const matches = activityMatchRepo.listByProgressUpdateId(response.progressUpdate.id, testProjectId);
    expect(matches).toHaveLength(1);
    expect(matches[0].anomalySeverity).toBe('high');
    expect(matches[0].anomalyScore).toBeGreaterThanOrEqual(0.75);

    // 3. Canonical progress in SQLite remains committed
    const latestProgress = activityProgressRepo.getLatestByActivityId(actFoundationId);
    expect(latestProgress?.actualPercent).toBe(95);
  });

  it('4. Normal progress report does NOT trigger email delivery (Zero False Positives)', async () => {
    // Prior observation: 45% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 45,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    const mockFetch = vi.fn();

    const emailDelivery = new ResendEmailDeliveryService({
      apiKey: 're_test_key_normal',
      recipients: ['admin@refinery.com'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const notificationService = new DefaultAnomalyNotificationService({
      emailDeliveryService: emailDelivery
    });

    const progressService = new DefaultProgressService({
      activityProgressRepo,
      activityRepo,
      activityMatchRepo
    });

    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });

    const workerService = new DefaultWorkerOperationalService({
      projectRepo,
      activityRepo,
      snapshotService,
      progressUpdateRepo,
      activityMatchRepo,
      progressService,
      activityProgressRepo,
      anomalyNotificationService: notificationService
    });

    // Normal shift report: 45% -> 50%
    const response = await workerService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: actFoundationId,
      progressPercent: 50,
      reporterName: 'Carlos Ramos',
      sourceType: 'manual'
    });

    expect(response.status).toBe('confirmed');
    expect(response.match?.anomalySeverity).toBe('normal');

    // No email sent for normal report
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('5. Strict Persistence Precedence: Asserts that update record, match record, and canonical progress are ALREADY committed in SQLite at the moment fetch() is invoked', async () => {
    // Seed prior observation: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: actFoundationId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    let dbStateAtMomentOfFetch: {
      matchCount: number;
      matchSeverity: string | null;
      latestActualPercent: number | undefined;
      dbWriteSucceededDuringFetch: boolean;
    } | null = null;

    const mockFetch = vi.fn().mockImplementation(async () => {
      // Inspect SQLite database at the EXACT moment fetch() is executing
      const matches = activityMatchRepo.listByProjectId(testProjectId);
      const latestProgress = activityProgressRepo.getLatestByActivityId(actFoundationId);

      // Verify that database is NOT locked by an open transaction by attempting an independent read & write
      let writeOk = false;
      try {
        const dummy = progressUpdateRepo.create({
          projectId: testProjectId,
          reportDate: '2026-08-16',
          rawText: 'Concurrent test update during active fetch',
          sourceType: 'manual',
          status: 'received'
        });
        writeOk = Boolean(dummy.id);
      } catch {
        writeOk = false;
      }

      dbStateAtMomentOfFetch = {
        matchCount: matches.length,
        matchSeverity: matches[0]?.anomalySeverity ?? null,
        latestActualPercent: latestProgress?.actualPercent,
        dbWriteSucceededDuringFetch: writeOk
      };

      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_precedence_verified' })
      };
    });

    const emailDelivery = new ResendEmailDeliveryService({
      apiKey: 're_test_key_precedence',
      recipients: ['admin@refinery.com'],
      enabled: true,
      fetchFn: mockFetch as any
    });

    const notificationService = new DefaultAnomalyNotificationService({
      emailDeliveryService: emailDelivery
    });

    const progressService = new DefaultProgressService({
      activityProgressRepo,
      activityRepo,
      activityMatchRepo
    });

    const snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });

    const workerService = new DefaultWorkerOperationalService({
      projectRepo,
      activityRepo,
      snapshotService,
      progressUpdateRepo,
      activityMatchRepo,
      progressService,
      activityProgressRepo,
      anomalyNotificationService: notificationService
    });

    await workerService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: actFoundationId,
      progressPercent: 95,
      reporterName: 'Carlos Ramos',
      sourceType: 'manual'
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(dbStateAtMomentOfFetch).not.toBeNull();
    // 1. The anomaly match was already committed in SQLite before fetch() was called
    expect(dbStateAtMomentOfFetch!.matchCount).toBeGreaterThanOrEqual(1);
    expect(dbStateAtMomentOfFetch!.matchSeverity).toBe('high');
    // 2. The canonical progress was already committed at 95% in SQLite before fetch() was called
    expect(dbStateAtMomentOfFetch!.latestActualPercent).toBe(95);
    // 3. SQLite was NOT locked in an uncommitted transaction during fetch()
    expect(dbStateAtMomentOfFetch!.dbWriteSucceededDuringFetch).toBe(true);
  });
});
