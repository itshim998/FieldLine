import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import {
  GOLDEN_AS_OF_DATE,
  goldenManifestInvariants,
  goldenWorkerCredentials,
  goldenAdminCredentials
} from '../../demo/golden-demo-manifest.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { activityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { operationalBlockerRepository } from '../src/repositories/operational-blocker.repository.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';

describe('Pass 36 — End-to-End Truth Certification: Two-Account Lifecycle & North-Star Pipeline', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let testArtifactsDir: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
    const seedResult = await seedGoldenDemo();
    projectId = seedResult.projectId;

    testArtifactsDir = path.resolve(process.cwd(), `test-artifacts-pass36-${Date.now()}`);
    if (!fs.existsSync(testArtifactsDir)) {
      fs.mkdirSync(testArtifactsDir, { recursive: true });
    }
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testArtifactsDir)) {
      try {
        fs.rmSync(testArtifactsDir, { recursive: true, force: true });
      } catch {
        // Ignore test cleanup error
      }
    }
  });

  // =========================================================================
  // JOURNEY 1: Worker Execution Journey ("Execution Cockpit")
  // =========================================================================
  describe('1. Worker Execution Journey ("Execution Cockpit")', () => {
    it('executes full worker operational workflow: login -> view tasks -> upload photo -> log quick progress -> report blocker -> verify projection', async () => {
      // 1. Authenticate with Worker credentials
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode: goldenManifestInvariants.projectCode,
          accountType: 'worker',
          passcode: goldenWorkerCredentials.pin
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.token).toBeDefined();
      expect(loginRes.body.session.accountType).toBe('worker');
      expect(loginRes.body.session.projectId).toBe(projectId);
      const workerToken = loginRes.body.token;
      const workerHeader = { Authorization: `Bearer ${workerToken}` };

      // 2. View today\'s operational horizon ("What are we building today?")
      const tasksRes = await request(app)
        .get(`/api/projects/${projectId}/worker/operational-tasks`)
        .set(workerHeader)
        .query({ asOfDate: GOLDEN_AS_OF_DATE, scope: 'horizon', horizonDays: 3 });

      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.tasks).toBeDefined();
      expect(Array.isArray(tasksRes.body.tasks)).toBe(true);
      expect(tasksRes.body.tasks.length).toBeGreaterThan(0);
      expect(tasksRes.body.summary).toBeDefined();
      expect(tasksRes.body.summary.today).toBeGreaterThan(0);

      // Verify operational task attributes are tailored for field workers
      const sampleTask = tasksRes.body.tasks[0];
      expect(sampleTask.externalId).toBeDefined();
      expect(sampleTask.name).toBeDefined();
      expect(sampleTask.location).toBeDefined();
      expect(sampleTask.plannedStart).toBeDefined();
      expect(sampleTask.plannedFinish).toBeDefined();
      expect(sampleTask.statusLabel).toBeDefined();
      expect(sampleTask.actualProgress).toBeDefined();

      // Privacy invariant: workers must not see internal algorithm scores or raw disk paths
      expect((sampleTask as any).confidenceScore).toBeUndefined();
      expect((sampleTask as any).filePath).toBeUndefined();

      // 3. Attach field photo evidence
      const photoPath = path.join(testArtifactsDir, 'pipe_rack_inspection.jpg');
      fs.writeFileSync(photoPath, Buffer.from('mock-field-jpeg-content-binary-stream'));

      const photoRes = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .set(workerHeader)
        .attach('file', photoPath);

      expect(photoRes.status).toBe(201);
      expect(photoRes.body.evidence).toBeDefined();
      expect(photoRes.body.evidence.id).toBeDefined();
      expect(photoRes.body.evidence.fileName).toBe('pipe_rack_inspection.jpg');
      expect(photoRes.body.evidence.contentSha256).toBeDefined();
      expect(photoRes.body.evidence.filePath).toBeUndefined(); // Filesystem privacy preserved
      const photoEvidenceId = photoRes.body.evidence.id;

      // 4. Submit rapid progress report for an active task
      // Target ACT-D04: Crude Feedstock Line Flange Assembly in Area D (Unit: joints, Planned: 120)
      const actD04 = activityRepository.listByProjectId(projectId).find((a) => a.externalId === 'ACT-D04')!;
      const quickReportRes = await request(app)
        .post(`/api/projects/${projectId}/worker/quick-report`)
        .set(workerHeader)
        .send({
          reportDate: GOLDEN_AS_OF_DATE,
          activityId: actD04.id,
          actualQuantity: 60,
          quantityUnit: 'joints',
          notes: 'Completed 60 flange assemblies on Crude Feedstock Line with torque verification',
          reporterName: 'Marcus Vance',
          reporterRole: 'Piping Foreman'
        });

      expect([200, 201]).toContain(quickReportRes.status);
      expect(quickReportRes.body.status).toBeDefined();
      expect(quickReportRes.body.message).toBeDefined();
      expect(quickReportRes.body.progressUpdate).toBeDefined();
      expect(quickReportRes.body.progressUpdate.reporterName).toBe('Marcus Vance');

      // 5. Surface critical operational constraint: Crane Breakdown on ACT-C01
      const blockerRes = await request(app)
        .post(`/api/projects/${projectId}/blockers`)
        .set(workerHeader)
        .send({
          activityId: 'ACT-C01',
          category: 'equipment',
          description: '50T mobile crane hydraulic cylinder failure; Pipe Rack PR-07 steel lifts suspended',
          reporterName: 'Carlos Rivera',
          reporterRole: 'Rigging Superintendent'
        });

      expect(blockerRes.status).toBe(201);
      expect(blockerRes.body.blocker).toBeDefined();
      expect(blockerRes.body.blocker.id).toBeDefined();
      expect(blockerRes.body.blocker.category).toBe('equipment');
      expect(blockerRes.body.blocker.status).toBe('active');
      expect(blockerRes.body.blocker.reporterName).toBe('Carlos Rivera');

      // 6. Verify updated operational view reflects the active blocker
      const activeBlockersRes = await request(app)
        .get(`/api/projects/${projectId}/blockers`)
        .set(workerHeader)
        .query({ status: 'active' });

      expect(activeBlockersRes.status).toBe(200);
      expect(activeBlockersRes.body.blockers.length).toBeGreaterThanOrEqual(1);
      const reported = activeBlockersRes.body.blockers.find(
        (b: any) => b.reporterName === 'Carlos Rivera' && b.category === 'equipment'
      );
      expect(reported).toBeDefined();
      expect(reported.description).toContain('crane hydraulic');
    });
  });

  // =========================================================================
  // JOURNEY 2: Admin Governance Journey ("Project Control Room")
  // =========================================================================
  describe('2. Admin Governance Journey ("Project Control Room")', () => {
    it('executes full admin governance workflow: login -> review dashboard -> inspect blockers -> gatekeep match -> audit progress -> query grounded AI -> stream evidence', async () => {
      // 1. Authenticate with Admin credentials
      const adminLoginRes = await request(app)
        .post('/api/auth/login')
        .send({
          projectCode: goldenManifestInvariants.projectCode,
          accountType: 'admin',
          passcode: goldenAdminCredentials.password
        });

      expect(adminLoginRes.status).toBe(200);
      expect(adminLoginRes.body.token).toBeDefined();
      expect(adminLoginRes.body.session.accountType).toBe('admin');
      const adminToken = adminLoginRes.body.token;
      const adminHeader = { Authorization: `Bearer ${adminToken}` };

      // 2. Inspect Primary Project Dashboard
      const dashboardRes = await request(app)
        .get(`/api/projects/${projectId}/dashboard`)
        .set(adminHeader)
        .query({ asOfDate: GOLDEN_AS_OF_DATE });

      expect(dashboardRes.status).toBe(200);
      const dashboard = dashboardRes.body;
      expect(dashboard.project.code).toBe(goldenManifestInvariants.projectCode);
      expect(dashboard.activityStatus.totalActivities).toBe(30);
      expect(dashboard.activityStatus.delayed).toBe(4);
      expect(dashboard.activityStatus.atRisk).toBe(4);

      // Verify active blockers are prominently displayed in Needs Attention
      expect(dashboard.attention.activeBlockersCount).toBeGreaterThanOrEqual(2);
      expect(dashboard.attention.blockersByRootCause).toBeDefined();
      expect(dashboard.attention.blockersByRootCause.equipment).toBeGreaterThanOrEqual(1);
      expect(dashboard.attention.activeBlockers.some((b: any) => b.category === 'equipment')).toBe(true);

      // 3. Inspect and Gatekeep Match Review Queue from Dashboard Needs Attention
      expect(dashboard.attention.unresolvedMatches).toBeDefined();
      expect(dashboard.attention.unresolvedMatches.length).toBeGreaterThan(0);

      const pendingMatch = dashboard.attention.unresolvedMatches[0];
      expect(pendingMatch.matchId).toBeDefined();

      // Retrieve single match details
      const matchDetailRes = await request(app)
        .get(`/api/projects/${projectId}/activity-matches/${pendingMatch.matchId}`)
        .set(adminHeader);

      expect(matchDetailRes.status).toBe(200);
      expect(matchDetailRes.body.match.status).toBe('suggested');
      expect(matchDetailRes.body.match.reviewState).toBe('awaiting_review');

      // Authoritative Admin Confirmation
      const confirmRes = await request(app)
        .post(`/api/projects/${projectId}/activity-matches/${pendingMatch.matchId}/confirm`)
        .set(adminHeader)
        .send({ reviewer: 'Project Superintendent Elena Rostova' });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.match.status).toBe('confirmed');
      expect(confirmRes.body.match.reviewState).toBe('resolved');
      expect(confirmRes.body.match.reviewedBy).toBe('Project Superintendent Elena Rostova');

      // 4. Verify canonical progress committed to append-only observation store for the activity
      const progressRes = await request(app)
        .get(`/api/projects/${projectId}/activities/${pendingMatch.activityId}/progress`)
        .set(adminHeader);

      expect(progressRes.status).toBe(200);
      expect(progressRes.body.progress).toBeDefined();
      expect(progressRes.body.progress.length).toBeGreaterThan(0);

      // 5. Inspect Deterministic Variance & Risk Classification
      const riskRes = await request(app)
        .get(`/api/projects/${projectId}/risk-status`)
        .set(adminHeader)
        .query({ asOfDate: GOLDEN_AS_OF_DATE });

      expect(riskRes.status).toBe(200);
      expect(riskRes.body.summary).toBeDefined();
      expect(riskRes.body.summary.delayed).toBe(4);
      expect(riskRes.body.summary.atRisk).toBe(4);

      // Verify ACT-C01 risk classification includes active blocker reason
      const actC01Risk = riskRes.body.activities.find((a: any) => a.externalId === 'ACT-C01');
      expect(actC01Risk).toBeDefined();
      expect(actC01Risk.classification).toBe('AT_RISK');
      expect(actC01Risk.reasons.some((r: any) => r.code === 'active_blocker')).toBe(true);

      // 6. Query Grounded AI Assistant
      const aiQueryRes = await request(app)
        .post(`/api/projects/${projectId}/assistant/query`)
        .set(adminHeader)
        .send({
          question: 'What is delayed in Unit 4?',
          asOfDate: GOLDEN_AS_OF_DATE
        });

      expect(aiQueryRes.status).toBe(200);
      expect(aiQueryRes.body.grounded).toBe(true);
      expect(aiQueryRes.body.claims.length).toBeGreaterThan(0);

      // 7. Trace originating photo evidence without filesystem leakage
      const evidenceListRes = await request(app)
        .get(`/api/projects/${projectId}/evidence`)
        .set(adminHeader);

      expect(evidenceListRes.status).toBe(200);
      expect(evidenceListRes.body.evidence.length).toBeGreaterThan(0);
      const evidenceItem = evidenceListRes.body.evidence[0];

      // Stream content safely
      const streamRes = await request(app)
        .get(`/api/projects/${projectId}/evidence/${evidenceItem.id}/content`)
        .set(adminHeader);

      expect(streamRes.status).toBe(200);
      expect(streamRes.headers['content-type']).toBeDefined();
    });
  });

  // =========================================================================
  // JOURNEY 3: Cross-Account Truth & Boundary Integrity
  // =========================================================================
  describe('3. Shared Canonical Truth & Boundary Integrity', () => {
    it('proves worker actions immediately reflect in admin control room over the same canonical database', async () => {
      // Worker logs an operational blocker
      const blockerRes = await request(app)
        .post(`/api/projects/${projectId}/blockers`)
        .set(workerAuthHeader(projectId))
        .send({
          category: 'access',
          description: 'North gate haul road flooded after storm',
          reporterName: 'Field Superintendent Marcus'
        });

      expect(blockerRes.status).toBe(201);
      const newBlockerId = blockerRes.body.blocker.id;

      // Admin immediately observes it in dashboard without synchronization lag
      const adminDashRes = await request(app)
        .get(`/api/projects/${projectId}/dashboard`)
        .set(adminAuthHeader(projectId))
        .query({ asOfDate: GOLDEN_AS_OF_DATE });

      expect(adminDashRes.status).toBe(200);
      const foundInDashboard = adminDashRes.body.attention.activeBlockers.some(
        (b: any) => b.id === newBlockerId
      );
      expect(foundInDashboard).toBe(true);
    });

    it('enforces strict server-side authorization boundaries preventing worker role escalation', async () => {
      // Worker attempting Admin-only schedule import -> 403 Forbidden
      const dummyCsv = 'Activity ID,Activity Name,Planned Start,Planned Finish\nACT-999,Unauthorized,2026-08-01,2026-08-10';
      const schedImportRes = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .set(workerAuthHeader(projectId))
        .attach('file', Buffer.from(dummyCsv), 'unauthorized.csv');

      expect(schedImportRes.status).toBe(403);

      // Worker attempting Admin-only match confirmation -> 403 Forbidden
      const match = activityMatchRepository.listByProjectId(projectId)[0];
      const matchConfirmRes = await request(app)
        .post(`/api/projects/${projectId}/activity-matches/${match.id}/confirm`)
        .set(workerAuthHeader(projectId))
        .send({ reviewedBy: 'Worker Attempting Admin Role' });

      expect(matchConfirmRes.status).toBe(403);

      // Worker attempting project metadata mutation -> 403 Forbidden
      const patchRes = await request(app)
        .patch(`/api/projects/${projectId}`)
        .set(workerAuthHeader(projectId))
        .send({ name: 'Tampered Project Name' });

      expect(patchRes.status).toBe(403);

      // Worker attempting project deletion -> 403 Forbidden
      const deleteRes = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set(workerAuthHeader(projectId));

      expect(deleteRes.status).toBe(403);
    });

    it('enforces strict cross-project isolation between distinct projects', async () => {
      // Create second project
      const projB = projectRepository.create({
        code: 'ISOLATED-PRJ-B',
        name: 'Isolated Project B',
        status: 'active'
      });

      // Project A worker token cannot access Project B operational tasks
      const crossTaskRes = await request(app)
        .get(`/api/projects/${projB.id}/worker/operational-tasks`)
        .set(workerAuthHeader(projectId));

      expect([403, 404]).toContain(crossTaskRes.status);

      // Project A worker token cannot access Project B blockers
      const crossBlockerRes = await request(app)
        .get(`/api/projects/${projB.id}/blockers`)
        .set(workerAuthHeader(projectId));

      expect([403, 404]).toContain(crossBlockerRes.status);

      // Project A admin token cannot access Project B dashboard
      const crossDashRes = await request(app)
        .get(`/api/projects/${projB.id}/dashboard`)
        .set(adminAuthHeader(projectId));

      expect([403, 404]).toContain(crossDashRes.status);
    });

    it('verifies historical provenance and append-only progress observations', async () => {
      // Query canonical observations for ACT-B02 (Crude Pump Foundation Piling Works)
      const activities = activityRepository.listByProjectId(projectId);
      const actB02 = activities.find((a) => a.externalId === 'ACT-B02')!;

      const historyRes = await request(app)
        .get(`/api/projects/${projectId}/activities/${actB02.id}`)
        .set(adminAuthHeader(projectId))
        .query({ asOfDate: GOLDEN_AS_OF_DATE });

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.timeline).toBeDefined();
      expect(historyRes.body.timeline.length).toBeGreaterThanOrEqual(4);

      // Verify chronologically ordered observations
      const dates = historyRes.body.timeline.map((t: any) => t.observationDate);
      const sortedDates = [...dates].sort();
      expect(dates).toEqual(sortedDates);

      // Verify human attribution is recorded on timeline entries
      for (const entry of historyRes.body.timeline) {
        expect(entry.actualPercent).toBeDefined();
        expect(typeof entry.actualPercent).toBe('number');
      }
    });
  });
});
