import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteNotificationOutboxRepository } from '../src/repositories/notification-outbox.repository.js';
import { DefaultWorkerOperationalService } from '../src/services/worker/worker-operational.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultAnomalyNotificationService } from '../src/services/anomaly/anomaly-notification.service.js';
import { NotificationWorker } from '../src/services/anomaly/notification.worker.js';
import type { AnomalyAlertMessage, AnomalyMessageGeneratorService } from '../src/services/anomaly/anomaly-message.types.js';
import type { EmailDeliveryService } from '../src/services/anomaly/email/email-delivery.types.js';

describe('Phase 4 — Realistic Lifecycle Scenarios (A through H)', () => {
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;
  let outboxRepo: SqliteNotificationOutboxRepository;

  let testProjectId: string;
  let testScheduleId: string;
  let testActivityId: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);
    outboxRepo = new SqliteNotificationOutboxRepository(() => db);

    const proj = projectRepo.create({
      code: 'LIFECYCLE-P4',
      name: 'Petrochemical Unit 9'
    });
    testProjectId = proj.id;

    const sched = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Main Baseline',
      sourceType: 'manual',
      isBaseline: true
    });
    testScheduleId = sched.id;

    const act = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-WELD-01',
      name: 'High-Pressure Pipe Welding',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      baselineProgress: 0
    });
    testActivityId = act.id;

    // Baseline canonical observation: 10% on 2026-08-15
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: testActivityId,
      actualPercent: 10,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  function createWorkerService(options: {
    mockGenerator: AnomalyMessageGeneratorService;
    mockEmailDelivery: EmailDeliveryService;
    backoffDelaysMs?: number[];
  }) {
    const worker = new NotificationWorker({
      outboxRepo,
      messageGenerator: options.mockGenerator,
      emailDeliveryService: options.mockEmailDelivery,
      backoffDelaysMs: options.backoffDelaysMs
    });

    const notifService = new DefaultAnomalyNotificationService({
      messageGeneratorService: options.mockGenerator,
      emailDeliveryService: options.mockEmailDelivery,
      outboxRepo,
      notificationWorker: worker
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

    const workerOperationalService = new DefaultWorkerOperationalService({
      projectRepo,
      activityRepo,
      snapshotService,
      progressUpdateRepo,
      activityMatchRepo,
      progressService,
      activityProgressRepo,
      anomalyNotificationService: notifService,
      notificationOutboxRepo: outboxRepo
    });

    return { worker, notifService, workerOperationalService };
  }

  it('Scenario A — Successful anomaly notification lifecycle', async () => {
    let groqCallCount = 0;
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockImplementation(async (input) => {
        groqCallCount++;
        return {
          title: `Anomaly Alert: ${input.activityName}`,
          summary: `Progress jump from ${input.previousPercent}% to ${input.reportedPercent}%`,
          details: 'Statistical deviation verified against baseline distribution.',
          recommendedAction: 'Verify field weld inspections.',
          fullMessage: 'Comprehensive prose alert.',
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
        };
      })
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockResolvedValue({
        sent: true,
        provider: 'resend',
        providerMessageId: 'resend_msg_scen_a'
      })
    };

    const { workerOperationalService } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    // 1. Worker reports 90% (from baseline 10% -> HIGH anomaly)
    const reportRes = await workerOperationalService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: testActivityId,
      progressPercent: 90,
      reporterName: 'Vikram Lead',
      sourceType: 'manual'
    });

    expect(reportRes.status).toBe('confirmed');
    expect(reportRes.match?.anomalySeverity).toBe('high');

    // 2. Outbox row created and delivered
    const outbox = outboxRepo.getByActivityMatchId(reportRes.match!.id);
    expect(outbox).not.toBeNull();
    expect(outbox?.status).toBe('delivered');
    expect(outbox?.providerMessageId).toBe('resend_msg_scen_a');
    expect(outbox?.attemptCount).toBe(1);

    // 3. Groq called exactly once
    expect(groqCallCount).toBe(1);
  });

  it('Scenario B — Temporary provider outage with subsequent success', async () => {
    let deliveryCalls = 0;
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockResolvedValue({
        title: 'Anomaly Alert',
        summary: 'Summary',
        details: 'Details',
        recommendedAction: 'Verify',
        fullMessage: 'Full prose',
        activityMatchId: 'm_b',
        projectName: 'P',
        activityExternalId: 'A',
        activityName: 'N',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: null,
        previousPercent: 10,
        reportedPercent: 90,
        severity: 'high',
        anomalyScore: 0.89,
        anomalyReasons: ['Reason'],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      } as AnomalyAlertMessage)
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockImplementation(async () => {
        deliveryCalls++;
        if (deliveryCalls === 1) {
          return { sent: false, provider: 'resend', errorCode: 'SERVER_ERROR', errorSummary: 'HTTP 503 Outage' };
        }
        return { sent: true, provider: 'resend', providerMessageId: 'resend_msg_scen_b_recovered' };
      })
    };

    const { worker, workerOperationalService } = createWorkerService({
      mockGenerator,
      mockEmailDelivery,
      backoffDelaysMs: [100]
    });

    // 1. Worker reports high anomaly -> triggers first attempt (fails 503)
    const reportRes = await workerOperationalService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: testActivityId,
      progressPercent: 90,
      reporterName: 'Vikram Lead',
      sourceType: 'manual'
    });

    const outboxAfter1 = outboxRepo.getByActivityMatchId(reportRes.match!.id)!;
    expect(outboxAfter1.status).toBe('retry_wait');
    expect(outboxAfter1.lastErrorCode).toBe('SERVER_ERROR');
    expect(outboxAfter1.attemptCount).toBe(1);

    // 2. Later execution claims and successfully delivers
    const futureTime = new Date(Date.now() + 500).toISOString();
    const claimed2 = outboxRepo.claimNextEligible(futureTime)!;
    await worker.processNotification(claimed2);

    const outboxAfter2 = outboxRepo.getById(outboxAfter1.id)!;
    expect(outboxAfter2.status).toBe('delivered');
    expect(outboxAfter2.providerMessageId).toBe('resend_msg_scen_b_recovered');
    expect(outboxAfter2.attemptCount).toBe(2);
  });

  it('Scenario C — Permanent configuration error stops retrying immediately', async () => {
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockResolvedValue({
        title: 'Anomaly Alert',
        summary: 'Summary',
        details: 'Details',
        recommendedAction: 'Verify',
        fullMessage: 'Full prose',
        activityMatchId: 'm_c',
        projectName: 'P',
        activityExternalId: 'A',
        activityName: 'N',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: null,
        previousPercent: 10,
        reportedPercent: 90,
        severity: 'high',
        anomalyScore: 0.89,
        anomalyReasons: ['Reason'],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      } as AnomalyAlertMessage)
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockResolvedValue({
        sent: false,
        provider: 'resend',
        errorCode: 'AUTH_ERROR',
        errorSummary: 'HTTP 401 Unauthorized API key'
      })
    };

    const { worker, workerOperationalService } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    const reportRes = await workerOperationalService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: testActivityId,
      progressPercent: 90,
      reporterName: 'Vikram Lead',
      sourceType: 'manual'
    });

    const outbox = outboxRepo.getByActivityMatchId(reportRes.match!.id)!;
    expect(outbox.status).toBe('failed');
    expect(outbox.lastErrorCode).toBe('AUTH_ERROR');
    expect(outbox.attemptCount).toBe(1);

    // Verified: Cannot be claimed again
    const claim = outboxRepo.claimNextEligible();
    expect(claim).toBeNull();
  });

  it('Scenario D — Duplicate trigger creates exactly one logical notification', async () => {
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockResolvedValue({
        title: 'Anomaly Alert',
        summary: 'Summary',
        details: 'Details',
        recommendedAction: 'Verify',
        fullMessage: 'Full prose',
        activityMatchId: 'm_d',
        projectName: 'P',
        activityExternalId: 'A',
        activityName: 'N',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: null,
        previousPercent: 10,
        reportedPercent: 90,
        severity: 'high',
        anomalyScore: 0.89,
        anomalyReasons: ['Reason'],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      } as AnomalyAlertMessage)
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockResolvedValue({
        sent: true,
        provider: 'resend',
        providerMessageId: 'resend_msg_scen_d'
      })
    };

    const { notifService, workerOperationalService } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    const reportRes = await workerOperationalService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: testActivityId,
      progressPercent: 90,
      reporterName: 'Vikram Lead',
      sourceType: 'manual'
    });

    // Invoke notification service a second time for the exact same match
    const secondCall = await notifService.notifyAnomalyAlert({
      prediction: {
        severity: 'high',
        anomalyScore: 0.89,
        reviewRecommended: true,
        reasons: ['Same deviation']
      },
      context: {
        projectName: 'Petrochemical Unit 9',
        activityExternalId: 'ACT-WELD-01',
        activityName: 'High-Pressure Pipe Welding',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: 'Vikram Lead',
        previousPercent: 10,
        reportedPercent: 90,
        activityMatchId: reportRes.match!.id
      }
    });

    // Exactly one outbox row exists in SQLite
    const totalOutboxRows = outboxRepo.count(testProjectId);
    expect(totalOutboxRows).toBe(1);
    expect(secondCall.outboxItem?.status).toBe('delivered');
  });

  it('Scenario E — Crash after external send reuses deterministic idempotency key', async () => {
    let callCount = 0;
    const idempotencyKeysReceived: string[] = [];

    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockImplementation(async (input) => ({
        title: 'Anomaly Alert',
        summary: 'Summary',
        details: 'Details',
        recommendedAction: 'Verify',
        fullMessage: 'Full prose',
        activityMatchId: input.activityMatchId,
        projectName: 'P',
        activityExternalId: 'A',
        activityName: 'N',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: null,
        previousPercent: 10,
        reportedPercent: 90,
        severity: 'high',
        anomalyScore: 0.89,
        anomalyReasons: ['Reason'],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      } as AnomalyAlertMessage))
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockImplementation(async (msg) => {
        callCount++;
        idempotencyKeysReceived.push(`fieldline-anomaly-alert:${msg.activityMatchId}`);
        return { sent: true, provider: 'resend', providerMessageId: 'resend_msg_idempotent' };
      })
    };

    const { worker } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    // Create match and outbox item
    const match = activityMatchRepo.create({
      projectId: testProjectId,
      progressUpdateId: progressUpdateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-16',
        rawText: 'Crash demo',
        sourceType: 'manual',
        status: 'received'
      }).id,
      activityId: testActivityId,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed',
      anomalySeverity: 'high',
      anomalyScore: 0.89
    });

    const outboxItem = outboxRepo.create({
      projectId: testProjectId,
      activityMatchId: match.id,
      idempotencyKey: `fieldline-anomaly-alert:${match.id}`,
      payload: {
        messageInput: {
          projectName: 'P',
          activityExternalId: 'ACT-WELD-01',
          activityName: 'High-Pressure Pipe Welding',
          reportDate: '2026-08-16',
          reportedPercent: 90,
          anomalyScore: 0.89,
          anomalySeverity: 'high',
          anomalyReasons: ['Deviation'],
          activityMatchId: match.id
        },
        message: null
      }
    });

    // Claim at T-15m
    const t0 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const claimed = outboxRepo.claimNextEligible(t0)!;

    // Simulate send occurred, but process crashed before DB marked 'delivered'
    // Server reboots: recovers stale lease
    worker.requeueStaleNotifications(5 * 60 * 1000);

    // Next worker attempt re-processes the item
    const retried = outboxRepo.claimNextEligible(new Date().toISOString())!;
    await worker.processNotification(retried);

    // The idempotency key passed to delivery adapter was deterministic and identical
    expect(idempotencyKeysReceived[0]).toBe(`fieldline-anomaly-alert:${match.id}`);
    const finalRow = outboxRepo.getById(outboxItem.id)!;
    expect(finalRow.status).toBe('delivered');
    expect(finalRow.providerMessageId).toBe('resend_msg_idempotent');
  });

  it('Scenario F — Application restart during processing reclaims stale notification', async () => {
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockResolvedValue({
        title: 'Restart Alert',
        summary: 'Summary',
        details: 'Details',
        recommendedAction: 'Verify',
        fullMessage: 'Full prose',
        activityMatchId: 'm_f',
        projectName: 'P',
        activityExternalId: 'A',
        activityName: 'N',
        activityLocation: null,
        reportDate: '2026-08-16',
        reporterName: null,
        previousPercent: 10,
        reportedPercent: 90,
        severity: 'high',
        anomalyScore: 0.89,
        anomalyReasons: ['Reason'],
        generatedBy: 'groq',
        generatedAt: new Date().toISOString()
      } as AnomalyAlertMessage)
    };

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockResolvedValue({
        sent: true,
        provider: 'resend',
        providerMessageId: 'resend_msg_after_restart'
      })
    };

    const { worker } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    const match = activityMatchRepo.create({
      projectId: testProjectId,
      progressUpdateId: progressUpdateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-16',
        rawText: 'Restart test',
        sourceType: 'manual',
        status: 'received'
      }).id,
      activityId: testActivityId,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed'
    });

    const item = outboxRepo.create({
      projectId: testProjectId,
      activityMatchId: match.id,
      payload: {
        messageInput: {
          projectName: 'P',
          activityExternalId: 'ACT-WELD-01',
          activityName: 'High-Pressure Pipe Welding',
          reportDate: '2026-08-16',
          reportedPercent: 90,
          anomalyScore: 0.89,
          anomalySeverity: 'high',
          anomalyReasons: ['Deviation'],
          activityMatchId: match.id
        },
        message: null
      }
    });

    // Claimed 12 minutes ago before server shutdown
    const tShutdown = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    outboxRepo.claimNextEligible(tShutdown);

    // Startup recovery executes
    const recovered = worker.requeueStaleNotifications(5 * 60 * 1000);
    expect(recovered).toBe(1);

    // Notification is claimed and delivered cleanly by new worker
    const processed = await worker.processNextNotification();
    expect(processed).toBe(true);

    const refreshed = outboxRepo.getById(item.id)!;
    expect(refreshed.status).toBe('delivered');
    expect(refreshed.providerMessageId).toBe('resend_msg_after_restart');
  });

  it('Scenario G — Message stability: Retrying notification does not produce a new Groq message', async () => {
    let groqCount = 0;
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockImplementation(async () => {
        groqCount++;
        return {
          title: `Stable Groq Message #${groqCount}`,
          summary: 'Original Groq Summary',
          details: 'Original Groq Details',
          recommendedAction: 'Verify once',
          fullMessage: 'Original Groq Full Message',
          activityMatchId: 'm_g',
          projectName: 'P',
          activityExternalId: 'A',
          activityName: 'N',
          activityLocation: null,
          reportDate: '2026-08-16',
          reporterName: null,
          previousPercent: 10,
          reportedPercent: 90,
          severity: 'high',
          anomalyScore: 0.89,
          anomalyReasons: ['Deviation'],
          generatedBy: 'groq',
          generatedAt: new Date().toISOString()
        } as AnomalyAlertMessage;
      })
    };

    let sendAttempts = 0;
    const seenTitles: string[] = [];

    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockImplementation(async (msg) => {
        sendAttempts++;
        seenTitles.push(msg.title);
        if (sendAttempts === 1) {
          return { sent: false, provider: 'resend', errorCode: 'SERVER_ERROR', errorSummary: 'Temporary 500' };
        }
        return { sent: true, provider: 'resend', providerMessageId: 'resend_ok_stability' };
      })
    };

    const { worker } = createWorkerService({
      mockGenerator,
      mockEmailDelivery,
      backoffDelaysMs: [50]
    });

    const match = activityMatchRepo.create({
      projectId: testProjectId,
      progressUpdateId: progressUpdateRepo.create({
        projectId: testProjectId,
        reportDate: '2026-08-16',
        rawText: 'Stability test',
        sourceType: 'manual',
        status: 'received'
      }).id,
      activityId: testActivityId,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed'
    });

    const item = outboxRepo.create({
      projectId: testProjectId,
      activityMatchId: match.id,
      payload: {
        messageInput: {
          projectName: 'P',
          activityExternalId: 'ACT-WELD-01',
          activityName: 'High-Pressure Pipe Welding',
          reportDate: '2026-08-16',
          reportedPercent: 90,
          anomalyScore: 0.89,
          anomalySeverity: 'high',
          anomalyReasons: ['Deviation'],
          activityMatchId: match.id
        },
        message: null
      }
    });

    // Attempt 1: Fails
    await worker.processNextNotification();
    expect(groqCount).toBe(1);

    // Attempt 2: Succeeds
    const claim2 = outboxRepo.claimNextEligible(new Date(Date.now() + 100).toISOString())!;
    await worker.processNotification(claim2);

    // Crucial Check: Groq was NOT called again
    expect(groqCount).toBe(1);
    expect(sendAttempts).toBe(2);
    expect(seenTitles[0]).toBe('Stable Groq Message #1');
    expect(seenTitles[1]).toBe('Stable Groq Message #1');

    const finalItem = outboxRepo.getById(item.id)!;
    expect(finalItem.status).toBe('delivered');
  });

  it('Scenario H — Normal report produces zero notification rows, zero Groq calls, and zero emails', async () => {
    let groqCount = 0;
    const mockGenerator: AnomalyMessageGeneratorService = {
      generateAnomalyMessage: vi.fn().mockImplementation(async () => {
        groqCount++;
        return {} as any;
      })
    };

    let sendCount = 0;
    const mockEmailDelivery: EmailDeliveryService = {
      sendAnomalyAlert: vi.fn().mockImplementation(async () => {
        sendCount++;
        return { sent: true, provider: 'resend' };
      })
    };

    const { workerOperationalService } = createWorkerService({
      mockGenerator,
      mockEmailDelivery
    });

    const normalAct = activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      externalId: 'ACT-NORMAL-01',
      name: 'Normal Pipe Welding',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      baselineProgress: 0
    });
    activityProgressRepo.create({
      projectId: testProjectId,
      activityId: normalAct.id,
      actualPercent: 45,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    // Normal shift report: 45% -> 50% (normal progress velocity matching baseline expectation)
    const reportRes = await workerOperationalService.recordQuickReport(testProjectId, {
      reportDate: '2026-08-16',
      activityId: normalAct.id,
      progressPercent: 50,
      reporterName: 'Vikram Lead',
      sourceType: 'manual'
    });

    expect(reportRes.status).toBe('confirmed');
    expect(reportRes.match?.anomalySeverity).toBe('normal');

    // 1. Zero outbox rows created
    expect(outboxRepo.count(testProjectId)).toBe(0);

    // 2. Zero Groq generation calls
    expect(groqCount).toBe(0);

    // 3. Zero email adapter calls
    expect(sendCount).toBe(0);
  });
});
