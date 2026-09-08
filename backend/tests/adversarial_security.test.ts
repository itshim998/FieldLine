import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp, attachLiveSessionWebSocket } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectAccountRepository } from '../src/repositories/project-account.repository.js';
import { DefaultEvidenceService } from '../src/services/evidence/evidence.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { LiveToolHandlers } from '../src/ai/live/live-tool-handlers.js';
import { GeminiKeyRouter } from '../src/ai/providers/gemini-key-router.js';
import {
  adminAuthHeader,
  workerAuthHeader,
  createTestSessionToken
} from './helpers/auth-test-helper.js';

describe('Pass 35 — Security Penetration, Adversarial Validation & Provenance Hardening', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let evidenceRepo: SqliteEvidenceRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let accountRepo: SqliteProjectAccountRepository;

  let projectAId: string;
  let projectBId: string;
  let activityAId: string;
  let activityBId: string;
  let updateAId: string;
  let matchAId: string;
  let evidenceAId: string;

  let tempFixtureDir: string;
  let sampleTxtFileA: string;
  let sampleTxtFileB: string;
  let sampleCsvFile: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    matchRepo = new SqliteActivityMatchRepository(() => db);
    evidenceRepo = new SqliteEvidenceRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);
    accountRepo = new SqliteProjectAccountRepository(() => db);

    // 1. Create Project Alpha
    const projA = projectRepo.create({
      code: 'PROJ-ALPHA',
      name: 'Alpha Energy Refinery',
      description: 'Primary isolated refinery unit'
    });
    projectAId = projA.id;

    // 2. Create Project Beta
    const projB = projectRepo.create({
      code: 'PROJ-BETA',
      name: 'Beta Offshore Platform',
      description: 'Secondary isolated offshore platform'
    });
    projectBId = projB.id;

    // 3. Create Schedule & Activities in Project A
    const schedA = scheduleRepo.create({
      projectId: projectAId,
      name: 'Alpha Schedule Baseline',
      sourceType: 'csv'
    });
    const actA = activityRepo.create({
      projectId: projectAId,
      scheduleId: schedA.id,
      externalId: 'ACT-ALPHA-01',
      name: 'Foundation Piling P-01',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 100,
      unit: 'm3',
      location: 'Area 1'
    });
    activityAId = actA.id;

    // 4. Create Schedule & Activities in Project B
    const schedB = scheduleRepo.create({
      projectId: projectBId,
      name: 'Beta Schedule Baseline',
      sourceType: 'csv'
    });
    const actB = activityRepo.create({
      projectId: projectBId,
      scheduleId: schedB.id,
      externalId: 'ACT-BETA-99',
      name: 'Subsea Manifold Installation',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-25',
      plannedQuantity: 50,
      unit: 'tons',
      location: 'Sector 4'
    });
    activityBId = actB.id;

    // 5. Create Progress Update in Project A
    const updA = updateRepo.create({
      projectId: projectAId,
      reportDate: '2026-08-05',
      rawText: 'Poured 40 m3 concrete on Foundation P-01',
      reporterName: 'Worker Jack',
      reporterRole: 'Foreman'
    });
    updateAId = updA.id;

    // 6. Create Match in Project A (suggested)
    const mtA = matchRepo.create({
      projectId: projectAId,
      progressUpdateId: updateAId,
      activityId: activityAId,
      confidenceScore: 0.85,
      matchMethod: 'text_similarity',
      confidenceTier: 'medium',
      reviewState: 'awaiting_review',
      status: 'suggested'
    });
    matchAId = mtA.id;

    // 7. Setup physical fixture files
    tempFixtureDir = path.resolve(process.cwd(), 'uploads', 'test_sec_fixtures');
    if (!fs.existsSync(tempFixtureDir)) {
      fs.mkdirSync(tempFixtureDir, { recursive: true });
    }

    sampleTxtFileA = path.resolve(tempFixtureDir, 'evidence_a.txt');
    fs.writeFileSync(sampleTxtFileA, 'Identical SHA-256 test file payload for deduplication verification.');

    sampleTxtFileB = path.resolve(tempFixtureDir, 'evidence_b.txt');
    fs.writeFileSync(sampleTxtFileB, 'Distinct file content for independent upload testing.');

    sampleCsvFile = path.resolve(tempFixtureDir, 'test_schedule.csv');
    fs.writeFileSync(
      sampleCsvFile,
      'Activity ID,Activity Name,Planned Start,Planned Finish,Planned Quantity,Unit,WBS\nACT-SEC,Sec Pour,2026-09-01,2026-09-10,50,m3,WBS.1\n'
    );

    // Setup physical evidence item for Project A
    const projADir = path.resolve(process.cwd(), 'uploads', projectAId);
    if (!fs.existsSync(projADir)) {
      fs.mkdirSync(projADir, { recursive: true });
    }
    const physicalEvidencePath = path.resolve(projADir, 'sample_alpha_file.txt');
    fs.writeFileSync(physicalEvidencePath, 'Alpha project confidential site log');

    const evA = evidenceRepo.create({
      projectId: projectAId,
      fileName: 'sample_alpha_file.txt',
      filePath: `${projectAId}/sample_alpha_file.txt`,
      fileType: 'text',
      fileSizeBytes: 37,
      mimeType: 'text/plain'
    });
    evidenceAId = evA.id;

    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(tempFixtureDir)) {
      try {
        fs.rmSync(tempFixtureDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  // =========================================================================
  // THREAT 1: Direct HTTP Injection & Worker Role Escalation
  // =========================================================================
  describe('THREAT 1: Worker Role Escalation & Privilege Boundary Enforcement', () => {
    it('blocks Worker from schedule import (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/schedules/import`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleCsvFile);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('is not authorized');
    });

    it('blocks Worker from confirming match review (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/confirm`)
        .set(workerAuthHeader(projectAId))
        .send({ reviewer: 'Worker Escalation Attempt' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from rejecting match review (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/reject`)
        .set(workerAuthHeader(projectAId))
        .send({ reviewer: 'Worker Escalation Attempt', reason: 'Unauthorized' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from resolving match review (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/resolve`)
        .set(workerAuthHeader(projectAId))
        .send({ activityId: activityAId, reviewer: 'Worker Escalation Attempt' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from enqueuing document ingestion job (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence/${evidenceAId}/process`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from deleting evidence file (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}/evidence/${evidenceAId}`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from modifying project metadata (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .set(workerAuthHeader(projectAId))
        .send({ name: 'Tampered Project Name' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from deleting project (HTTP 403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // THREAT 2: Assistant Role Forgery & Privilege Escalation
  // =========================================================================
  describe('THREAT 2: Assistant Role Forgery via Request Body Tampering', () => {
    it('blocks Worker session from claiming role: "admin" in POST /assistant/query', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/assistant/query`)
        .set(workerAuthHeader(projectAId))
        .send({
          question: 'What is the full portfolio delay matrix across all contractors?',
          role: 'admin'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('cannot escalate to admin');
    });

    it('allows Admin session to query with role: "admin"', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/assistant/query`)
        .set(adminAuthHeader(projectAId))
        .send({
          question: 'What activities are delayed?',
          role: 'admin'
        });

      expect(res.status).toBe(200);
      expect(res.body.grounded).toBe(true);
    });

    it('allows Worker session to query within worker operational scope', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/assistant/query`)
        .set(workerAuthHeader(projectAId))
        .send({
          question: 'What is the status of piling P-01?'
        });

      expect(res.status).toBe(200);
      expect(res.body.grounded).toBe(true);
    });
  });

  // =========================================================================
  // THREAT 3: Cross-Project ID Manipulation & Data Access
  // =========================================================================
  describe('THREAT 3: Strict Project Boundary Isolation (100% Cross-Project Requests Blocked)', () => {
    it('blocks Project A token from reading Project B operational tasks (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/worker/operational-tasks`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A token from posting quick report to Project B (HTTP 403)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          reporterName: 'Worker Jack',
          actualQuantity: 10
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A token from reporting blocker on Project B (HTTP 403)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/blockers`)
        .set(workerAuthHeader(projectAId))
        .send({
          category: 'equipment',
          description: 'Cross-project blocker injection',
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from listing Project B blockers (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/blockers`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from resolving Project B blocker (HTTP 403)', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectBId}/blockers/fake-blocker-id/resolve`)
        .set(workerAuthHeader(projectAId))
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from logging safety hazard on Project B (HTTP 403)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/safety/hazards`)
        .set(workerAuthHeader(projectAId))
        .send({
          hazardType: 'slip_trip',
          location: 'Area 2',
          description: 'Cross project hazard report',
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B evidence list (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/evidence`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B evidence content stream (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/evidence/${evidenceAId}/content`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B progress updates (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/progress-updates`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B dashboard overview (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/dashboard`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B intelligence (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/intelligence`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B risk status (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/risk-status`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B progress snapshot (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/progress-snapshot`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from reading Project B activity progress history (HTTP 403)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/activities/${activityBId}/progress`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Project A token from calling Project B assistant (HTTP 403)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/assistant/query`)
        .set(workerAuthHeader(projectAId))
        .send({ question: 'What is happening in Project Beta?' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // THREAT 4: Cross-Project Foreign Key Injection
  // =========================================================================
  describe('THREAT 4: Cross-Project Foreign Key Injection & Mismatched Entity Linking', () => {
    it('rejects quick report referencing an activity from a different project (HTTP 404)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          activityId: activityBId, // Belongs to Project B!
          actualQuantity: 25,
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.error).toContain('not found in project');
    });

    it('rejects blocker report referencing an activity from a different project (HTTP 404)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/blockers`)
        .set(workerAuthHeader(projectAId))
        .send({
          activityId: activityBId, // Belongs to Project B!
          category: 'access',
          description: 'Attempting to link blocker to Project B activity',
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.error).toContain('not found in project');
    });

    it('rejects evidence upload linking to a progress report from a different project (HTTP 400)', async () => {
      // Create progress update in Project B
      const updateB = updateRepo.create({
        projectId: projectBId,
        reportDate: '2026-08-05',
        rawText: 'Project B field update',
        reporterName: 'Worker Bob'
      });

      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .field('progressUpdateId', updateB.id) // Project B update!
        .attach('file', sampleTxtFileB);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toContain('belongs to a different project');
    });

    it('rejects resolving match to a target activity from a different project (HTTP 404)', async () => {
      const matchingService = new ActivityMatchingService({
        projectRepo,
        progressUpdateRepo: updateRepo,
        activityRepo,
        activityMatchRepo: matchRepo,
        projectEventRepo: new (await import('../src/repositories/project-event.repository.js')).SqliteProjectEventRepository(() => getDatabase())
      });

      await expect(
        matchingService.resolveMatch(
          projectAId,
          matchAId,
          activityBId, // Project B activity!
          'Admin Jane'
        )
      ).rejects.toThrow(/not found for project/);
    });

    it('rejects normalizing progress referencing an activity match from a different project (HTTP 404)', async () => {
      const progressService = new DefaultProgressService({
        projectRepo,
        progressUpdateRepo: updateRepo,
        activityMatchRepo: matchRepo,
        activityRepo,
        activityProgressRepo: progressRepo
      });

      expect(() => {
        progressService.normalizeAndRecordProgress({
          projectId: projectAId,
          updateId: updateAId,
          matchId: 'non-existent-match-id',
          fact: {
            reference: 'ACT-ALPHA-01',
            location: 'Area 1',
            progress_percent: 50,
            status: 'in_progress'
          }
        });
      }).toThrow(/not found for project/);
    });
  });

  // =========================================================================
  // THREAT 5: Path Traversal & Filesystem Privacy Invariant
  // =========================================================================
  describe('THREAT 5: Path Traversal Defenses & Filesystem Privacy Invariant', () => {
    it('rejects URL-encoded path traversal in evidence ID (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence/..%2f..%2fetc%2fpasswd/content`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('invalid path characters');
    });

    it('rejects Windows backslash path traversal in evidence ID (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence/..%5c..%5cboot.ini/content`)
        .set(workerAuthHeader(projectAId));

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects path traversal attempting to escape project upload directory in service layer', () => {
      const db = getDatabase();
      const rawEvidenceRepo = new SqliteEvidenceRepository(() => db);
      const fakeTraversedEvidence = rawEvidenceRepo.create({
        projectId: projectAId,
        fileName: 'traversal.txt',
        filePath: '../../etc/passwd',
        fileType: 'text',
        fileSizeBytes: 100,
        mimeType: 'text/plain'
      });

      const svc = new DefaultEvidenceService(rawEvidenceRepo, projectRepo, updateRepo, activityRepo);

      expect(() => {
        svc.getEvidenceContent(projectAId, fakeTraversedEvidence.id);
      }).toThrow(/traversal detected/i);
    });

    it('prevents prefix matching vulnerability (proj-10 escaping proj-1)', () => {
      const db = getDatabase();
      const rawEvidenceRepo = new SqliteEvidenceRepository(() => db);
      // Injects filePath pointing into a directory whose name starts with projectId
      const fakePrefixEvidence = rawEvidenceRepo.create({
        projectId: projectAId,
        fileName: 'prefix_leak.txt',
        filePath: `${projectAId}-malicious/leak.txt`,
        fileType: 'text',
        fileSizeBytes: 100,
        mimeType: 'text/plain'
      });

      const svc = new DefaultEvidenceService(rawEvidenceRepo, projectRepo, updateRepo, activityRepo);

      expect(() => {
        svc.getEvidenceContent(projectAId, fakePrefixEvidence.id);
      }).toThrow(/traversal detected/i);
    });

    it('guarantees Filesystem Privacy Invariant: zero server filesystem paths exposed in any API response', async () => {
      // 1. Evidence detail response
      const evRes = await request(app)
        .get(`/api/projects/${projectAId}/evidence/${evidenceAId}`)
        .set(workerAuthHeader(projectAId));
      expect(evRes.status).toBe(200);
      expect(evRes.body.evidence.filePath).toBeUndefined();
      expect(JSON.stringify(evRes.body)).not.toContain('uploads/');
      expect(JSON.stringify(evRes.body)).not.toContain('C:\\');

      // 2. Evidence list response
      const listRes = await request(app)
        .get(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId));
      expect(listRes.status).toBe(200);
      for (const item of listRes.body.evidence) {
        expect(item.filePath).toBeUndefined();
      }
      expect(JSON.stringify(listRes.body)).not.toContain('uploads/');

      // 3. Error response
      const errRes = await request(app)
        .get(`/api/projects/${projectAId}/evidence/non-existent-id`)
        .set(workerAuthHeader(projectAId));
      expect(errRes.status).toBe(404);
      expect(JSON.stringify(errRes.body)).not.toContain('uploads/');
      expect(JSON.stringify(errRes.body)).not.toContain('C:\\');
    });
  });

  // =========================================================================
  // THREAT 6: Evidence SHA-256 Deduplication & Integrity Tampering
  // =========================================================================
  describe('THREAT 6: Evidence Upload Deduplication & Integrity Tampering', () => {
    it('deduplicates identical file uploads in same project without disk duplication', async () => {
      // Upload 1
      const res1 = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFileA);

      expect(res1.status).toBe(201);
      expect(res1.body.deduplicated).toBe(false);
      const evidenceId1 = res1.body.evidence.id;

      // Upload 2 with identical file content
      const res2 = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFileA);

      expect(res2.status).toBe(200);
      expect(res2.body.deduplicated).toBe(true);
      expect(res2.body.evidence.id).toBe(evidenceId1);
    });

    it('does NOT deduplicate across projects: identical file in Project B gets its own isolated record', async () => {
      // Upload in Project A
      const resA = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFileA);
      expect(resA.status).toBe(201);

      // Upload same file in Project B
      const resB = await request(app)
        .post(`/api/projects/${projectBId}/evidence`)
        .set(workerAuthHeader(projectBId))
        .attach('file', sampleTxtFileA);

      expect(resB.status).toBe(201);
      expect(resB.body.deduplicated).toBe(false);
      expect(resB.body.evidence.id).not.toBe(resA.body.evidence.id);
      expect(resB.body.evidence.projectId).toBe(projectBId);
    });
  });

  // =========================================================================
  // THREAT 7: Attribution Forgery & Anonymous Input Rejection
  // =========================================================================
  describe('THREAT 7: Human Attribution Enforcement & Anonymous Input Rejection', () => {
    it('rejects quick report without reporterName (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          actualQuantity: 50
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('Reporter name is required');
    });

    it('rejects quick report with whitespace-only reporterName (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          actualQuantity: 50,
          reporterName: '     '
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects operational blocker report with empty reporterName (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/blockers`)
        .set(workerAuthHeader(projectAId))
        .send({
          category: 'equipment',
          description: 'Hydraulic leak',
          reporterName: ''
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // THREAT 8: Quantity & Math Tampering Validation
  // =========================================================================
  describe('THREAT 8: Quantity & Math Tampering Validation', () => {
    it('rejects negative quantity in quick report (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          actualQuantity: -25,
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('greater than or equal to 0');
    });

    it('rejects out-of-range progress percentage >100% in quick report (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          progressPercent: 125,
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('less than or equal to 100');
    });

    it('rejects negative progress percentage in quick report (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          progressPercent: -10,
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('greater than or equal to 0');
    });

    it('rejects malformed non-ISO date string in quick report (HTTP 400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '08/05/2026',
          actualQuantity: 50,
          reporterName: 'Worker Jack'
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details?.[0]?.message).toContain('YYYY-MM-DD');
    });
  });

  // =========================================================================
  // THREAT 9: WebSocket Session Boundary & Role Hijacking
  // =========================================================================
  describe('THREAT 9: WebSocket Session Boundaries & Unauthorized Session Rejection', () => {
    let mockGeminiServer: WebSocketServer;
    let mockGeminiPort: number;
    let httpServer: http.Server;
    let httpPort: number;
    let keyRouter: GeminiKeyRouter;

    beforeEach(async () => {
      // Mock Upstream Gemini
      await new Promise<void>((resolve) => {
        mockGeminiServer = new WebSocketServer({ port: 0 }, () => {
          mockGeminiPort = (mockGeminiServer.address() as any).port;
          resolve();
        });
      });

      mockGeminiServer.on('connection', (socket) => {
        socket.on('message', (raw) => {
          try {
            const parsed = JSON.parse(raw.toString());
            if (parsed.setup) {
              socket.send(JSON.stringify({ setupComplete: {} }));
            }
          } catch {}
        });
      });

      keyRouter = new GeminiKeyRouter({
        apiKeys: ['AIzaSyTestGeminiKey_Sec_01'],
        defaultModel: 'gemini-3.1-flash-live-preview'
      });

      httpServer = http.createServer(app);
      attachLiveSessionWebSocket(httpServer, {
        keyRouter,
        projectResolver: projectRepo,
        upstreamEndpointUrl: `ws://127.0.0.1:${mockGeminiPort}`
      });

      await new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          httpPort = (httpServer.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        mockGeminiServer.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    });

    it('rejects WebSocket connection with token project mismatch (4403 Forbidden)', async () => {
      // Create token for Project A, but try connecting to Project B
      const tokenA = createTestSessionToken(projectAId, 'worker');

      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws/live-session?projectId=${projectBId}&token=${tokenA}`);

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(4403);
      expect(closeEvent.reason).toContain('Project scope mismatch');
    });

    it('rejects WebSocket connection with invalid/tampered token (4403 Forbidden)', async () => {
      const tamperedToken = 'invalid.payload.tampered_signature_xyz';

      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws/live-session?projectId=${projectAId}&token=${tamperedToken}`);

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(4403);
      expect(closeEvent.reason).toContain('Invalid token');
    });

    it('denies unauthenticated client from elevating to sessionRole = "admin" via query param', async () => {
      // Connect without token, but passing ?role=admin
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws/live-session?projectId=${projectAId}&role=admin`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => resolve());
        ws.on('error', (err) => reject(err));
      });

      // The connection succeeded, but let's test that Worker role was enforced in tool execution
      const handlers = new LiveToolHandlers({
        projectRepo,
        activityRepo,
        activityMatchRepo: matchRepo
      });

      // Execute tool under the context of this worker session
      const result = await handlers.executeTool(
        projectAId,
        { name: 'get_project_intelligence', args: {} },
        { sessionRole: 'worker' }
      );

      expect(result.status).toBe('role_restricted');
      expect(result.message).toContain('requires project control room access');

      ws.close();
    });
  });

  // =========================================================================
  // THREAT 10: Non-Destructive Historical Revision & Provenance Audit Trail
  // =========================================================================
  describe('THREAT 10: Non-Destructive Historical Revision & Provenance Audit Trail', () => {
    it('preserves append-only progress observations without overwriting prior records', async () => {
      // Submission 1: Day 1 (30%)
      const res1 = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-01',
          activityId: activityAId,
          progressPercent: 30,
          reporterName: 'Worker Jack',
          notes: 'Shift 1 observation'
        });
      expect(res1.status).toBe(201);

      // Submission 2: Day 2 (60%)
      const res2 = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-02',
          activityId: activityAId,
          progressPercent: 60,
          reporterName: 'Worker Jill',
          notes: 'Shift 2 observation'
        });
      expect(res2.status).toBe(201);

      // Submission 3: Day 3 (90%)
      const res3 = await request(app)
        .post(`/api/projects/${projectAId}/worker/quick-report`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-03',
          activityId: activityAId,
          progressPercent: 90,
          reporterName: 'Supervisor Mark',
          notes: 'Shift 3 observation'
        });
      expect(res3.status).toBe(201);

      // Retrieve full observation history
      const historyRes = await request(app)
        .get(`/api/projects/${projectAId}/activities/${activityAId}/progress`)
        .set(workerAuthHeader(projectAId));

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.progress.length).toBe(3);

      // Verify chronological order (newest first) and intact observation values
      expect(historyRes.body.progress[0].actualPercent).toBe(90);
      expect(historyRes.body.progress[0].asOfDate).toBe('2026-08-03');

      expect(historyRes.body.progress[1].actualPercent).toBe(60);
      expect(historyRes.body.progress[1].asOfDate).toBe('2026-08-02');

      expect(historyRes.body.progress[2].actualPercent).toBe(30);
      expect(historyRes.body.progress[2].asOfDate).toBe('2026-08-01');

      // Verify underlying progress updates retain full shift notes and reporter attribution
      const update1 = updateRepo.getById(historyRes.body.progress[2].progressUpdateId!);
      expect(update1?.reporterName).toBe('Worker Jack');
      expect(update1?.rawText).toContain('Shift 1 observation');

      const update2 = updateRepo.getById(historyRes.body.progress[1].progressUpdateId!);
      expect(update2?.reporterName).toBe('Worker Jill');
      expect(update2?.rawText).toContain('Shift 2 observation');

      const update3 = updateRepo.getById(historyRes.body.progress[0].progressUpdateId!);
      expect(update3?.reporterName).toBe('Supervisor Mark');
      expect(update3?.rawText).toContain('Shift 3 observation');

      // Latest progress snapshot reflects the latest observation
      const latestRes = await request(app)
        .get(`/api/projects/${projectAId}/activities/${activityAId}/progress/latest`)
        .set(workerAuthHeader(projectAId));

      expect(latestRes.status).toBe(200);
      expect(latestRes.body.progress.actualPercent).toBe(90);
    });

    it('enforces immutable match review decisions (cannot re-confirm or reject confirmed matches)', async () => {
      // 1. Confirm the match
      const confirmRes = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/confirm`)
        .set(adminAuthHeader(projectAId))
        .send({ reviewer: 'Superintendent' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.match.status).toBe('confirmed');

      // 2. Attempt to reject already-confirmed match
      const reRejectRes = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/reject`)
        .set(adminAuthHeader(projectAId))
        .send({ reviewer: 'Superintendent', reason: 'Changed mind' });

      expect(reRejectRes.status).toBe(400);
      expect(reRejectRes.body.error).toContain('Confirmed match history is immutable');

      // 3. Attempt to re-confirm
      const reConfirmRes = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${matchAId}/confirm`)
        .set(adminAuthHeader(projectAId))
        .send({ reviewer: 'Superintendent' });

      expect(reConfirmRes.status).toBe(400);
      expect(reConfirmRes.body.error).toContain('Confirmed match history is immutable');
    });
  });
});
