import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import { LiveToolHandlers, LiveToolExecutionContext } from '../src/ai/live/live-tool-handlers.js';
import { DefaultProgressUpdateService } from '../src/services/progress-update.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';


describe('Pass 32 — Frictionless Field Capture (Voice, Rapid Input & Photo Evidence)', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;
  let evidenceRepo: SqliteEvidenceRepository;

  let projectAId: string;
  let projectBId: string;
  let testScheduleId: string;
  let actQuantityId: string;
  let actVoice1Id: string;
  let actVoice2Id: string;

  let tempDir: string;
  let samplePhotoFile: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);
    evidenceRepo = new SqliteEvidenceRepository(() => db);

    app = createApp();

    // Create Project A & Project B
    const projA = projectRepo.create({
      code: 'REFINERY-U4',
      name: 'Refinery Unit 4 Expansion',
      description: 'Golden Demo Test Project'
    });
    projectAId = projA.id;

    const projB = projectRepo.create({
      code: 'ISOLATED-PRJ',
      name: 'Isolated Second Project',
      description: 'Boundary enforcement project'
    });
    projectBId = projB.id;

    // Create baseline schedule
    const sched = scheduleRepo.create({
      projectId: projectAId,
      name: 'Master Baseline Schedule',
      sourceType: 'manual',
      isBaseline: true
    });
    testScheduleId = sched.id;

    // Activity with physical planned quantity (100 m3)
    const actQ = activityRepo.create({
      projectId: projectAId,
      scheduleId: testScheduleId,
      externalId: 'ACT-FOUND-01',
      name: 'Foundation Footing Concrete Pour',
      plannedStart: '2026-08-15',
      plannedFinish: '2026-08-30',
      plannedQuantity: 100,
      unit: 'm3',
      location: 'Area B',
      baselineProgress: 0
    });
    actQuantityId = actQ.id;

    // Unambiguous voice target
    const actV1 = activityRepo.create({
      projectId: projectAId,
      scheduleId: testScheduleId,
      externalId: 'ACT-PIPERACK-07',
      name: 'Pipe Rack PR-07 Structural Steel Erection',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-28',
      plannedQuantity: 250,
      unit: 'ton',
      location: 'Area C',
      baselineProgress: 0
    });
    actVoice1Id = actV1.id;

    // Ambiguous target sibling activities with identical prefixes
    const actV2 = activityRepo.create({
      projectId: projectAId,
      scheduleId: testScheduleId,
      externalId: 'ACT-PIPERACK-08',
      name: 'Pipe Rack PR-08 Structural Steel Erection',
      plannedStart: '2026-08-12',
      plannedFinish: '2026-08-30',
      plannedQuantity: 250,
      unit: 'ton',
      location: 'Area C',
      baselineProgress: 0
    });
    actVoice2Id = actV2.id;

    // Setup temporary fixture file for photo evidence testing
    tempDir = path.join(process.cwd(), 'scratch', `test_photo_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    samplePhotoFile = path.join(tempDir, 'site_photo_pour.jpg');
    fs.writeFileSync(samplePhotoFile, 'JPEG_MOCK_IMAGE_DATA_BYTES_FIELDLINE_2026');
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe('1. Rapid Numeric Quantity & Percentage Form Entry', () => {
    it('calculates deterministic progress (80%) when entering 80 m3 out of 100 m3 planned quantity', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-25',
          activityId: actQuantityId,
          actualQuantity: 80,
          quantityUnit: 'm3',
          reporterName: 'Carlos Ramos',
          reporterRole: 'Civil Lead',
          notes: 'Completed 80m3 pour on foundation footing. Surface finished cleanly.'
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('confirmed');
      expect(res.body.derivedPercent).toBe(80);
      expect(res.body.message).toContain('80%');

      // Verify progress update record with human attribution
      const updates = progressUpdateRepo.listByProjectId(projectAId);
      expect(updates).toHaveLength(1);
      expect(updates[0].reporterName).toBe('Carlos Ramos');
      expect(updates[0].reporterRole).toBe('Civil Lead');
      expect(updates[0].sourceType).toBe('manual');

      // Verify canonical activity progress record committed at 80%
      const latestProgress = activityProgressRepo.getLatestByActivityId(actQuantityId);
      expect(latestProgress).toBeDefined();
      expect(latestProgress!.actualPercent).toBe(80);
      expect(latestProgress!.actualQuantity).toBe(80);
      expect(latestProgress!.status).toBe('in_progress');
    });

    it('caps percentage at 100% when quantity exceeds planned target while preserving physical quantity', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-26',
          activityId: actQuantityId,
          actualQuantity: 120, // 120 / 100 = 120%
          quantityUnit: 'm3',
          reporterName: 'Carlos Ramos',
          reporterRole: 'Civil Lead'
        });

      expect(res.status).toBe(201);
      expect(res.body.derivedPercent).toBe(100);

      const latest = activityProgressRepo.getLatestByActivityId(actQuantityId);
      expect(latest!.actualPercent).toBe(100);
      expect(latest!.actualQuantity).toBe(120);
    });

    it('rejects submissions missing mandatory reporterName with HTTP 400', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-25',
          activityId: actQuantityId,
          actualQuantity: 80,
          reporterName: '' // Empty reporter name
        });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.details)).toContain('Reporter name');
    });
  });

  describe('2. Spoken Voice Dialogue & Canonical Truth Protection', () => {
    it('unambiguous voice report auto-confirms, commits progress, and dispatches verbal confirmation', async () => {
      const mockExtraction = {
        extractFromReport: vi.fn().mockResolvedValue({
          items: [
            {
              reference: 'Pipe Rack PR-07 Structural Steel Erection',
              location: 'Area C',
              progress_percent: 65,
              status: 'in_progress'
            }
          ]
        })
      } as unknown as FieldProgressExtractionService;

      const progressUpdateService = new DefaultProgressUpdateService(progressUpdateRepo, projectRepo);
      const matchingService = new ActivityMatchingService({
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        activityMatchRepo
      });
      const progressService = new DefaultProgressService({
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        activityMatchRepo,
        activityProgressRepo
      });
      const snapshotService = new DefaultProgressSnapshotService({
        projectRepo,
        activityRepo,
        activityProgressRepo
      });
      const intelligenceService = new DefaultProjectIntelligenceService({
        projectRepo,
        activityRepo,
        activityProgressRepo,
        progressSnapshotService: snapshotService
      });
      const activityResolver = new DeterministicActivityResolver();


      const handlers = new LiveToolHandlers({
        activityRepo,
        projectRepo,
        activityMatchRepo,
        activityResolver,
        snapshotService,
        intelligenceService,
        extractionService: mockExtraction,
        progressUpdateService,
        matchingService,
        progressService
      });

      const verbalConfirmations: string[] = [];
      const clientEvents: any[] = [];
      const mockContext: LiveToolExecutionContext = {
        session: {
          dispatchVerbalConfirmation: (text: string) => {
            verbalConfirmations.push(text);
          },
          sendToClient: (payload: Record<string, any>) => {
            clientEvents.push(payload);
          }
        }
      };

      const intakeRes = await handlers.recordFieldProgress(
        projectAId,
        'Pipe Rack PR-07 is at 65% erection',
        mockContext
      );

      expect(intakeRes.status).toBe('queued');

      // Wait for asynchronous processing pipeline to complete
      await new Promise((r) => setTimeout(r, 80));

      // 1. Progress update created with sourceType = 'voice'
      const updates = progressUpdateRepo.listByProjectId(projectAId);
      const voiceUpdate = updates.find((u) => u.sourceType === 'voice');
      expect(voiceUpdate).toBeDefined();

      // 2. Canonical progress committed to activity_progress at 65%
      const latest = activityProgressRepo.getLatestByActivityId(actVoice1Id);
      expect(latest).toBeDefined();
      expect(latest!.actualPercent).toBe(65);

      // 3. Spoken verbal confirmation dispatched
      expect(verbalConfirmations).toHaveLength(1);
      expect(verbalConfirmations[0]).toContain(
        'Update verified: Pipe Rack PR-07 Structural Steel Erection is saved at 65%.'
      );

      // 4. Client event dispatched for UI live waveform card
      expect(clientEvents).toHaveLength(1);
      expect(clientEvents[0].type).toBe('progress_verified');
      expect(clientEvents[0].progressPercent).toBe(65);
    });

    it('ambiguous voice report enters awaiting_review and routes to Admin review queue without mutating progress', async () => {
      // Mock extraction returning ambiguous reference matching both PR-07 and PR-08
      const mockExtraction = {
        extractFromReport: vi.fn().mockResolvedValue({
          items: [
            {
              reference: 'Pipe Rack Structural Steel', // Ambiguous: could be PR-07 or PR-08
              location: 'Area C',
              progress_percent: 50,
              status: 'in_progress'
            }
          ]
        })
      } as unknown as FieldProgressExtractionService;

      const progressUpdateService = new DefaultProgressUpdateService(progressUpdateRepo, projectRepo);
      const matchingService = new ActivityMatchingService({
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        activityMatchRepo
      });
      const progressService = new DefaultProgressService({
        projectRepo,
        progressUpdateRepo,
        activityRepo,
        activityMatchRepo,
        activityProgressRepo
      });
      const snapshotService = new DefaultProgressSnapshotService({
        projectRepo,
        activityRepo,
        activityProgressRepo
      });
      const intelligenceService = new DefaultProjectIntelligenceService({
        projectRepo,
        activityRepo,
        activityProgressRepo,
        progressSnapshotService: snapshotService
      });
      const activityResolver = new DeterministicActivityResolver();

      const handlers = new LiveToolHandlers({
        activityRepo,
        projectRepo,
        activityMatchRepo,
        activityResolver,
        snapshotService,
        intelligenceService,
        extractionService: mockExtraction,
        progressUpdateService,
        matchingService,
        progressService
      });

      const verbalConfirmations: string[] = [];
      const clientEvents: any[] = [];
      const mockContext: LiveToolExecutionContext = {
        session: {
          dispatchVerbalConfirmation: (text: string) => {
            verbalConfirmations.push(text);
          },
          sendToClient: (payload: Record<string, any>) => {
            clientEvents.push(payload);
          }
        }
      };

      await handlers.processProgressStatementAsync(
        projectAId,
        'Pipe rack structural steel in Area C is halfway done',
        projectRepo.getById(projectAId),
        mockContext
      );

      // 1. Progress update was created with sourceType = 'voice'
      const updates = progressUpdateRepo.listByProjectId(projectAId);
      const voiceUpdate = updates.find((u) => u.sourceType === 'voice');
      expect(voiceUpdate).toBeDefined();

      // 2. Ambiguous match was stored with reviewState = 'awaiting_review'
      const matches = activityMatchRepo.listByProgressUpdateId(voiceUpdate!.id, projectAId);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].reviewState).toBe('awaiting_review');
      expect(matches[0].status).toBe('suggested');

      // 3. CANONICAL TRUTH INVARIANT: Neither PR-07 nor PR-08 progress was mutated!
      expect(activityProgressRepo.getLatestByActivityId(actVoice1Id)).toBeNull();
      expect(activityProgressRepo.getLatestByActivityId(actVoice2Id)).toBeNull();

      // 4. Dispatched client event informing worker that update is queued for review
      expect(clientEvents).toHaveLength(1);
      expect(clientEvents[0].type).toBe('progress_review_needed');
      expect(clientEvents[0].reviewState).toBe('awaiting_review');

      // 5. Spoken verbal confirmation informed worker without stranding
      expect(verbalConfirmations).toHaveLength(1);
      expect(verbalConfirmations[0]).toContain('Update captured and submitted for review: ambiguous match routed to Admin review queue.');
    });
  });

  describe('3. Photo Evidence Upload & Deduplication', () => {
    it('uploads photo evidence linked to a progress update with SHA-256 deduplication', async () => {
      // 1. Submit progress update
      const updateRes = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-25',
          activityId: actQuantityId,
          progressPercent: 50,
          reporterName: 'Elena Rostova',
          notes: 'Photo taken of completed south rebar inspection.'
        });

      const updateId = updateRes.body.progressUpdate.id;

      // 2. Upload photo attached to this update
      const uploadRes1 = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', samplePhotoFile)
        .field('progressUpdateId', updateId)
        .field('fileType', 'image');

      expect(uploadRes1.status).toBe(201);
      expect(uploadRes1.body.deduplicated).toBe(false);
      expect(uploadRes1.body.evidence.progressUpdateId).toBe(updateId);
      expect(uploadRes1.body.evidence.contentSha256).toBeDefined();


      // 3. Re-upload same identical image -> verify SHA-256 deduplication
      const uploadRes2 = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', samplePhotoFile)
        .field('progressUpdateId', updateId)
        .field('fileType', 'image');

      expect(uploadRes2.status).toBe(200);
      expect(uploadRes2.body.deduplicated).toBe(true);
      expect(uploadRes2.body.evidence.id).toBe(uploadRes1.body.evidence.id);
    });
  });

  describe('4. Authorization & Project Boundary Protection', () => {
    it('allows Admin session token to submit quick-reports as well', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(adminAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-25',
          activityId: actQuantityId,
          progressPercent: 90,
          reporterName: 'Site Supervisor Dave'
        });

      expect(res.status).toBe(201);
      expect(res.body.derivedPercent).toBe(90);
    });

    it('rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .send({
          reportDate: '2026-08-25',
          activityId: actQuantityId,
          reporterName: 'Unauthorized Worker'
        });

      expect(res.status).toBe(401);
    });

    it('rejects Project A worker token attempting to post to Project B with HTTP 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-25',
          reporterName: 'Intruder'
        });

      expect(res.status).toBe(403);
    });
  });
});
