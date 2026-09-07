import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { adminAuthHeader, workerAuthHeader, createTestSessionToken } from './helpers/auth-test-helper.js';

describe('Pass 29 — Server-Side Authorization, Route Guards & Privacy Sanitization', () => {
  let app: ReturnType<typeof createApp>;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let evidenceRepo: SqliteEvidenceRepository;

  let projectAId: string;
  let projectBId: string;
  let testScheduleId: string;
  let testActivityId: string;
  let testMatchId: string;
  let testEvidenceId: string;
  let tempFixtureDir: string;
  let sampleCsvFile: string;
  let sampleTxtFile: string;

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    const db = getDatabase();
    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    matchRepo = new SqliteActivityMatchRepository(() => db);
    evidenceRepo = new SqliteEvidenceRepository(() => db);

    // Create Project A and Project B
    const projA = projectRepo.create({
      code: 'PROJ-ALPHA',
      name: 'Project Alpha Facility',
      description: 'First secure test project'
    });
    projectAId = projA.id;

    const projB = projectRepo.create({
      code: 'PROJ-BETA',
      name: 'Project Beta Facility',
      description: 'Second isolated test project'
    });
    projectBId = projB.id;

    // Create test schedule and activity in Project A
    const sched = scheduleRepo.create({
      projectId: projectAId,
      name: 'Alpha Master Schedule',
      sourceType: 'csv'
    });
    testScheduleId = sched.id;

    const act = activityRepo.create({
      projectId: projectAId,
      scheduleId: testScheduleId,
      externalId: 'ACT-SEC-01',
      name: 'Containment Wall Pour',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-10',
      plannedQuantity: 200,
      unit: 'm3',
      location: 'Area 1'
    });
    testActivityId = act.id;

    const updateRepo = new SqliteProgressUpdateRepository(() => db);
    const update = updateRepo.create({
      projectId: projectAId,
      reportDate: '2026-08-01',
      rawText: 'Daily inspection notes for authorization tests',
      reporterName: 'Foreman Jack',
      reporterRole: 'Site Supervisor'
    });

    // Create a suggested match for review testing
    const match = matchRepo.create({
      projectId: projectAId,
      progressUpdateId: update.id,
      activityId: testActivityId,
      fieldFactId: 'FACT-001',
      matchedText: 'Containment wall concrete pouring',
      matchMethod: 'text_similarity',
      confidenceScore: 0.85,
      confidenceTier: 'medium',
      reviewState: 'awaiting_review',
      status: 'suggested'
    });
    testMatchId = match.id;

    // Create physical evidence files
    tempFixtureDir = path.resolve(process.cwd(), 'uploads', 'test_fixtures');
    if (!fs.existsSync(tempFixtureDir)) {
      fs.mkdirSync(tempFixtureDir, { recursive: true });
    }

    sampleCsvFile = path.resolve(tempFixtureDir, 'valid_schedule.csv');
    fs.writeFileSync(
      sampleCsvFile,
      'Activity ID,Activity Name,Planned Start,Planned Finish,Planned Quantity,Unit,WBS\nACT-N1,New Unit Pour,2026-09-01,2026-09-10,50,m3,WBS.1\n'
    );

    sampleTxtFile = path.resolve(tempFixtureDir, 'daily_inspection.txt');
    fs.writeFileSync(sampleTxtFile, 'Field daily report content for testing authorization.');

    // Pre-insert evidence item in database and filesystem
    const projectDir = path.resolve(process.cwd(), 'uploads', projectAId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    const physicalPath = path.resolve(projectDir, 'sample_evidence.txt');
    fs.writeFileSync(physicalPath, 'Evidence disk file content.');

    const ev = evidenceRepo.create({
      projectId: projectAId,
      fileName: 'sample_evidence.txt',
      filePath: `${projectAId}/sample_evidence.txt`,
      fileType: 'text',
      fileSizeBytes: 27,
      mimeType: 'text/plain'
    });
    testEvidenceId = ev.id;

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
  // 1. Unauthenticated Requests to Protected Endpoints (401 Unauthorized)
  // =========================================================================
  describe('1. Unauthenticated Request Rejection (HTTP 401)', () => {
    it('rejects unauthenticated POST /schedules/import with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/schedules/import`)
        .attach('file', sampleCsvFile);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /activity-matches/:id/confirm with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/confirm`)
        .send({ reviewer: 'Superintendent' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /activity-matches/:id/reject with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/reject`)
        .send({ reviewer: 'Superintendent', reason: 'Mismatched work area' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /activity-matches/:id/resolve with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/resolve`)
        .send({ activityId: testActivityId, reviewer: 'Superintendent' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /evidence/:id/process with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence/${testEvidenceId}/process`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated PATCH /projects/:projectId with 401', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .send({ name: 'Tampered Name' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated DELETE /projects/:projectId with 401', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /progress-updates with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/progress-updates`)
        .send({
          reportDate: '2026-08-05',
          rawText: 'Poured 50 m3 concrete',
          reporterName: 'Foreman',
          reporterRole: 'Lead'
        });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated POST /evidence upload with 401', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .attach('file', sampleTxtFile);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects unauthenticated GET /evidence/:id/content with 401', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence/${testEvidenceId}/content`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  // =========================================================================
  // 2. Worker Role Boundary Enforcement (HTTP 403 Forbidden on Admin Routes)
  // =========================================================================
  describe('2. Worker Role Boundary Enforcement (HTTP 403 Forbidden)', () => {
    it('blocks Worker from POST /schedules/import', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/schedules/import`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleCsvFile);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('is not authorized');
    });

    it('blocks Worker from POST /schedules alias', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/schedules`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleCsvFile);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from confirming match review', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/confirm`)
        .set(workerAuthHeader(projectAId))
        .send({ reviewer: 'Worker Jack' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from rejecting match review', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/reject`)
        .set(workerAuthHeader(projectAId))
        .send({ reviewer: 'Worker Jack', reason: 'Not my scope' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from resolving match review', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/resolve`)
        .set(workerAuthHeader(projectAId))
        .send({ activityId: testActivityId, reviewer: 'Worker Jack' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from triggering document ingestion process', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence/${testEvidenceId}/process`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from deleting evidence file', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}/evidence/${testEvidenceId}`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from PATCH /projects/:projectId', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .set(workerAuthHeader(projectAId))
        .send({ name: 'Renamed by Worker' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('blocks Worker from DELETE /projects/:projectId', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. Strict Project Scoping Isolation (HTTP 403 Cross-Project Tampering)
  // =========================================================================
  describe('3. Strict Project Scoping Isolation (HTTP 403)', () => {
    it('blocks Project A Admin from modifying Project B metadata', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectBId}`)
        .set(adminAuthHeader(projectAId))
        .send({ name: 'Malicious Project B Rename' });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A Admin from deleting Project B', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectBId}`)
        .set(adminAuthHeader(projectAId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A Worker from posting progress updates to Project B', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/progress-updates`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          rawText: 'Cross-project update injection attempt',
          reporterName: 'Sneaky',
          reporterRole: 'Infiltrator'
        });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A Worker from uploading evidence to Project B', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectBId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFile);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });

    it('blocks Project A token from reading Project B evidence content stream', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectBId}/evidence/${testEvidenceId}/content`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.error).toContain('Project scope mismatch');
    });
  });

  // =========================================================================
  // 4. Authorized Access for Allowed Roles (200 / 201 Success)
  // =========================================================================
  describe('4. Authorized Access for Worker and Admin Roles', () => {
    it('allows Worker to create a progress update', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/progress-updates`)
        .set(workerAuthHeader(projectAId))
        .send({
          reportDate: '2026-08-05',
          rawText: 'Poured 45 m3 of concrete on Pier 2',
          reporterName: 'Sanjay Deshmukh',
          reporterRole: 'Site Supervisor'
        });
      expect(res.status).toBe(201);
      expect(res.body.progressUpdate).toBeDefined();
      expect(res.body.progressUpdate.reporterName).toBe('Sanjay Deshmukh');
    });

    it('allows Worker to upload evidence', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFile);
      expect(res.status).toBe(201);
      expect(res.body.evidence).toBeDefined();
      expect(res.body.evidence.fileName).toBe('daily_inspection.txt');
    });

    it('allows Worker to read evidence file content stream', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence/${testEvidenceId}/content`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.text).toBe('Evidence disk file content.');
    });

    it('allows Admin to import schedule', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/schedules/import`)
        .set(adminAuthHeader(projectAId))
        .attach('file', sampleCsvFile);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.activitiesImported).toBe(1);
    });

    it('allows Admin to confirm match review', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/activity-matches/${testMatchId}/confirm`)
        .set(adminAuthHeader(projectAId))
        .send({ reviewer: 'Lead Engineer' });
      expect(res.status).toBe(200);
      expect(res.body.match.status).toBe('confirmed');
    });

    it('allows Admin to update project metadata', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .set(adminAuthHeader(projectAId))
        .send({ name: 'Updated Alpha Facility' });
      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe('Updated Alpha Facility');
    });

    it('allows Admin to delete a project', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectAId}`)
        .set(adminAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 5. Token Tampering and Malformed Headers (HTTP 401)
  // =========================================================================
  describe('5. Session Token Security & Tamper Proofing', () => {
    it('rejects malformed Authorization header (missing Bearer)', async () => {
      const validToken = createTestSessionToken(projectAId, 'admin');
      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .set('Authorization', `Token ${validToken}`)
        .send({ name: 'Bad Prefix' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });

    it('rejects tampered session token signature', async () => {
      const validToken = createTestSessionToken(projectAId, 'admin');
      const [payload, sig] = validToken.split('.');
      const tamperedToken = `${payload}.${sig.slice(0, -4)}xxxx`;

      const res = await request(app)
        .patch(`/api/projects/${projectAId}`)
        .set('Authorization', `Bearer ${tamperedToken}`)
        .send({ name: 'Tampered Signature' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTHENTICATION_ERROR');
    });
  });

  // =========================================================================
  // 6. Filesystem Privacy Invariant (filePath Stripped from All JSON Responses)
  // =========================================================================
  describe('6. Filesystem Privacy Invariant (filePath is never leaked)', () => {
    it('does not expose filePath in POST /evidence upload response', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId))
        .attach('file', sampleTxtFile);
      expect(res.status).toBe(201);
      expect(res.body.evidence).toBeDefined();
      expect(res.body.evidence.filePath).toBeUndefined();
    });

    it('does not expose filePath in GET /evidence list response', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.evidence.length).toBeGreaterThanOrEqual(1);
      for (const item of res.body.evidence) {
        expect(item.filePath).toBeUndefined();
      }
    });

    it('does not expose filePath in GET /evidence/:id detail response', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/evidence/${testEvidenceId}`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.evidence).toBeDefined();
      expect(res.body.evidence.filePath).toBeUndefined();
    });
  });

  // =========================================================================
  // 7. Role-Appropriate Operational Data Projection (Worker vs Admin)
  // =========================================================================
  describe('7. Role-Appropriate Operational Data Projection', () => {
    it('omits confidenceTier and confidenceScore when queried by Worker', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/activity-matches/${testMatchId}`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.match).toBeDefined();
      expect(res.body.match.confidenceScore).toBeUndefined();
      expect(res.body.match.confidenceTier).toBeNull();
      // Operational details remain intact
      expect(res.body.match.activityId).toBe(testActivityId);
      expect(res.body.match.matchedText).toBeDefined();
    });

    it('retains confidenceTier and confidenceScore when queried by Admin', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/activity-matches/${testMatchId}`)
        .set(adminAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.match).toBeDefined();
      expect(res.body.match.confidenceScore).toBe(0.85);
      expect(res.body.match.confidenceTier).toBe('medium');
    });

    it('omits match confidence metrics in activity detail when viewed by Worker', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectAId}/activities/${testActivityId}`)
        .set(workerAuthHeader(projectAId));
      expect(res.status).toBe(200);
      expect(res.body.activity).toBeDefined();
      if (res.body.matches && res.body.matches.length > 0) {
        for (const m of res.body.matches) {
          expect(m.confidenceScore).toBeUndefined();
          expect(m.confidenceTier).toBeNull();
        }
      }
    });
  });
});
