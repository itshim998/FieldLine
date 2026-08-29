import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { workerRunner } from '../src/jobs/worker-runner.js';
import { aiService, DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteEvidenceRepository } from '../src/repositories/evidence.repository.js';
import {
  GOLDEN_AS_OF_DATE,
  goldenProject,
  goldenScheduleCsv,
  goldenFieldReportText,
  goldenExtraction,
  goldenExpectedSnapshot,
  goldenExpectedRisks
} from './fixtures/critical_workflow_golden_fixture.js';

describe('Pass 23 — Critical Regression & Evaluation Suite', () => {
  let app: ReturnType<typeof createApp>;
  let mockAiProvider: MockAIProvider;
  const testArtifactsDir = path.resolve(process.cwd(), 'test-critical-workflow-artifacts');

  beforeEach(() => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();

    if (!fs.existsSync(testArtifactsDir)) {
      fs.mkdirSync(testArtifactsDir, { recursive: true });
    }

    mockAiProvider = new MockAIProvider();
    if (aiService instanceof DefaultAIService) {
      aiService.setProvider(mockAiProvider);
    }
  });

  afterEach(() => {
    closeDatabase();
    if (fs.existsSync(testArtifactsDir)) {
      try {
        fs.rmSync(testArtifactsDir, { recursive: true, force: true });
      } catch {
        // Ignore test temp folder cleanup
      }
    }
  });

  // =========================================================================
  // SUITE 1: Flagship End-to-End Golden Critical Workflow
  // =========================================================================
  describe('1. Flagship End-to-End Critical Workflow Pipeline', () => {
    it('proves the complete 13-stage pipeline from schedule import to grounded assistant query', async () => {
      // -------------------------------------------------------------
      // Stage 1: Clean Test DB & Project Creation
      // -------------------------------------------------------------
      const projectRes = await request(app)
        .post('/api/projects')
        .send(goldenProject);
      expect(projectRes.status).toBe(201);
      expect(projectRes.body.project.id).toBeDefined();
      expect(projectRes.body.project.code).toBe(goldenProject.code);
      const projectId = projectRes.body.project.id;

      // -------------------------------------------------------------
      // Stage 2: Schedule Import
      // -------------------------------------------------------------
      const scheduleRes = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', Buffer.from(goldenScheduleCsv), 'baseline_schedule.csv');
      expect(scheduleRes.status).toBe(201);
      expect(scheduleRes.body.schedule).toBeDefined();
      expect(scheduleRes.body.activitiesImported).toBe(6);
      const scheduleId = scheduleRes.body.schedule.id;

      // -------------------------------------------------------------
      // Stage 3: Verify Activities
      // -------------------------------------------------------------
      const activitiesRes = await request(app)
        .get(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);
      expect(activitiesRes.status).toBe(200);
      expect(activitiesRes.body.activities).toHaveLength(6);
      const activities = activitiesRes.body.activities;
      const actMap = new Map<string, any>(activities.map((a: any) => [a.externalId, a]));

      expect(actMap.has('ACT-101')).toBe(true);
      expect(actMap.has('ACT-102')).toBe(true);
      expect(actMap.has('ACT-103')).toBe(true);
      expect(actMap.has('ACT-104')).toBe(true);
      expect(actMap.has('ACT-105')).toBe(true);
      expect(actMap.has('ACT-106')).toBe(true);

      // -------------------------------------------------------------
      // Stage 4: Upload Field Evidence
      // -------------------------------------------------------------
      const reportFilePath = path.join(testArtifactsDir, 'daily_field_report_2026-08-20.txt');
      fs.writeFileSync(reportFilePath, goldenFieldReportText, 'utf-8');

      const evidenceUploadRes = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .attach('file', reportFilePath);
      expect(evidenceUploadRes.status).toBe(201);
      expect(evidenceUploadRes.body.evidence.id).toBeDefined();
      expect(evidenceUploadRes.body.evidence.fileName).toBe('daily_field_report_2026-08-20.txt');
      expect(evidenceUploadRes.body.evidence.filePath).not.toContain(process.cwd()); // No filesystem leakage
      const evidenceId = evidenceUploadRes.body.evidence.id;

      // -------------------------------------------------------------
      // Stage 5: Create / Enqueue Document Processing Job
      // -------------------------------------------------------------
      const jobEnqueueRes = await request(app)
        .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
        .send();
      expect(jobEnqueueRes.status).toBe(202);
      expect(jobEnqueueRes.body.job).toBeDefined();
      expect(jobEnqueueRes.body.job.status).toBe('queued');
      const jobId = jobEnqueueRes.body.job.id;

      // -------------------------------------------------------------
      // Stage 6 & 7: Worker Processing & AI Structured Extraction
      // -------------------------------------------------------------
      mockAiProvider.setMockStructuredResponse(goldenExtraction);

      const processed = await workerRunner.processNextJob();
      expect(processed).toBe(true);

      // Verify job completion
      const jobStatusRes = await request(app)
        .get(`/api/projects/${projectId}/jobs/${jobId}`);
      expect(jobStatusRes.status).toBe(200);
      expect(jobStatusRes.body.job.status).toBe('completed');
      expect(jobStatusRes.body.job.result).toBeDefined();
      expect(jobStatusRes.body.job.result.matchCount).toBeGreaterThan(0);
      const progressUpdateId = jobStatusRes.body.job.result.progressUpdateId;

      // -------------------------------------------------------------
      // Stage 8: Activity Matching & Review Policy Verification
      // -------------------------------------------------------------
      const matchesRes = await request(app)
        .get(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/matches`);
      expect(matchesRes.status).toBe(200);
      const matches = matchesRes.body.matches;
      expect(matches.length).toBeGreaterThanOrEqual(4);

      const match101 = matches.find((m: any) => m.activityId === actMap.get('ACT-101').id);
      const match102 = matches.find((m: any) => m.activityId === actMap.get('ACT-102').id);
      const match103 = matches.find((m: any) => m.activityId === actMap.get('ACT-103').id);
      const match104 = matches.find((m: any) => m.activityId === actMap.get('ACT-104').id);

      expect(match101).toBeDefined();
      expect(match102).toBeDefined();
      expect(match103).toBeDefined();
      expect(match104).toBeDefined();

      // -------------------------------------------------------------
      // Stage 9: Human Review & Confirmation Workflow
      // -------------------------------------------------------------
      // Confirm any suggested matches atomically
      for (const m of [match101, match102, match103, match104]) {
        if (m.status === 'suggested') {
          const confirmRes = await request(app)
            .post(`/api/projects/${projectId}/activity-matches/${m.id}/confirm`)
            .send({ reviewer: 'Resident Engineer Bob' });
          expect(confirmRes.status).toBe(200);
          expect(confirmRes.body.match.status).toBe('confirmed');
        } else {
          expect(m.status).toBe('confirmed');
        }
      }

      // -------------------------------------------------------------
      // Stage 10: Canonical Progress Recording (ProgressService)
      // -------------------------------------------------------------
      // Record progress observations for confirmed matches as of GOLDEN_AS_OF_DATE
      const p101 = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/progress`)
        .send({
          matchId: match101.id,
          fact: { reference: 'Site Earthworks & Clearing', location: 'Sector 1', progress_percent: 40, status: 'in_progress' },
          asOfDate: GOLDEN_AS_OF_DATE
        });
      expect(p101.status).toBe(200);
      expect(p101.body.progress.actualPercent).toBe(40);
      expect(p101.body.progress.status).toBe('in_progress');

      const p102 = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/progress`)
        .send({
          matchId: match102.id,
          fact: { reference: 'Foundation Piling Block 1', location: 'Block 1', progress_percent: 50, status: 'in_progress' },
          asOfDate: GOLDEN_AS_OF_DATE
        });
      expect(p102.status).toBe(200);
      expect(p102.body.progress.actualPercent).toBe(50);

      const p103 = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/progress`)
        .send({
          matchId: match103.id,
          fact: { reference: 'Underground Drainage Conduit', location: 'Zone A', progress_percent: 100, status: 'completed' },
          asOfDate: GOLDEN_AS_OF_DATE
        });
      expect(p103.status).toBe(200);
      expect(p103.body.progress.actualPercent).toBe(100);
      expect(p103.body.progress.actualFinish).toBe(GOLDEN_AS_OF_DATE);

      const p104 = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${progressUpdateId}/progress`)
        .send({
          matchId: match104.id,
          fact: { reference: 'Structural Pier Concrete Pouring', location: 'Pier 4', progress_percent: 60, status: 'in_progress' },
          asOfDate: GOLDEN_AS_OF_DATE
        });
      expect(p104.status).toBe(200);
      expect(p104.body.progress.actualPercent).toBe(60);

      // Verify canonical progress on activity
      const act101Progress = await request(app)
        .get(`/api/projects/${projectId}/activities/${actMap.get('ACT-101').id}/progress/latest`);
      expect(act101Progress.status).toBe(200);
      expect(act101Progress.body.progress.actualPercent).toBe(40);

      // -------------------------------------------------------------
      // Stage 11: Progress Snapshot & Risk Classification
      // -------------------------------------------------------------
      const snapshotRes = await request(app)
        .get(`/api/projects/${projectId}/progress-snapshot`)
        .query({ asOfDate: GOLDEN_AS_OF_DATE });
      expect(snapshotRes.status).toBe(200);
      const snapshot = snapshotRes.body;

      expect(snapshot.summary.totalActivities).toBe(goldenExpectedSnapshot.summary.totalActivities);
      expect(snapshot.summary.overallActualProgress).toBe(goldenExpectedSnapshot.summary.overallActualProgress);
      expect(snapshot.summary.overallPlannedProgress).toBe(goldenExpectedSnapshot.summary.overallPlannedProgress);
      expect(snapshot.summary.progressVariance).toBe(goldenExpectedSnapshot.summary.progressVariance);
      expect(snapshot.summary.varianceState).toBe(goldenExpectedSnapshot.summary.varianceState);
      expect(snapshot.summary.overdue).toBe(goldenExpectedSnapshot.summary.overdue);

      const snap101 = snapshot.activities.find((a: any) => a.externalId === 'ACT-101');
      expect(snap101.plannedProgress).toBe(100);
      expect(snap101.actualProgress).toBe(40);
      expect(snap101.progressVariance).toBe(-60);
      expect(snap101.varianceState).toBe('behind');
      expect(snap101.overdue).toBe(true);

      const snap102 = snapshot.activities.find((a: any) => a.externalId === 'ACT-102');
      expect(snap102.plannedProgress).toBe(79.17);
      expect(snap102.actualProgress).toBe(50);
      expect(snap102.progressVariance).toBe(-29.17);
      expect(snap102.varianceState).toBe('behind');

      const snap103 = snapshot.activities.find((a: any) => a.externalId === 'ACT-103');
      expect(snap103.plannedProgress).toBe(100);
      expect(snap103.actualProgress).toBe(100);
      expect(snap103.status).toBe('completed');

      const riskRes = await request(app)
        .get(`/api/projects/${projectId}/risk-status`)
        .query({ asOfDate: GOLDEN_AS_OF_DATE });
      expect(riskRes.status).toBe(200);
      const risks = riskRes.body;

      expect(risks.summary.totalActivities).toBe(goldenExpectedRisks.summary.totalActivities);
      expect(risks.summary.delayed).toBe(goldenExpectedRisks.summary.delayed);
      expect(risks.summary.atRisk).toBe(goldenExpectedRisks.summary.atRisk);
      expect(risks.summary.completed).toBe(goldenExpectedRisks.summary.completed);
      expect(risks.summary.onTrack).toBe(goldenExpectedRisks.summary.onTrack);

      const risk101 = risks.activities.find((a: any) => a.externalId === 'ACT-101');
      expect(risk101.classification).toBe('DELAYED');

      const risk102 = risks.activities.find((a: any) => a.externalId === 'ACT-102');
      expect(risk102.classification).toBe('AT_RISK');

      const risk103 = risks.activities.find((a: any) => a.externalId === 'ACT-103');
      expect(risk103.classification).toBe('COMPLETED');

      // -------------------------------------------------------------
      // Stage 12: Project Intelligence
      // -------------------------------------------------------------
      const intelRes = await request(app)
        .get(`/api/projects/${projectId}/intelligence`)
        .query({ asOfDate: GOLDEN_AS_OF_DATE, recentDays: 7, approachingDays: 14 });
      expect(intelRes.status).toBe(200);
      const intel = intelRes.body;

      // 1. Delayed
      expect(intel.delayed).toHaveLength(1);
      expect(intel.delayed[0].externalId).toBe('ACT-101');
      expect(intel.delayed[0].classification).toBe('DELAYED');
      expect(intel.delayed[0].overdue).toBe(true);

      // 2. At Risk
      expect(intel.atRisk).toHaveLength(1);
      expect(intel.atRisk[0].externalId).toBe('ACT-102');
      expect(intel.atRisk[0].classification).toBe('AT_RISK');

      // 3. Completed Today
      expect(intel.completedToday).toHaveLength(1);
      expect(intel.completedToday[0].externalId).toBe('ACT-103');
      expect(intel.completedToday[0].actualPercent).toBe(100);
      expect(intel.completedToday[0].asOfDate).toBe(GOLDEN_AS_OF_DATE);

      // 4. Behind Schedule
      expect(intel.behindSchedule.map((b: any) => b.externalId)).toEqual(['ACT-101', 'ACT-102', 'ACT-104']);

      // 5. Approaching Milestones
      expect(intel.approachingMilestones).toHaveLength(1);
      expect(intel.approachingMilestones[0].externalId).toBe('ACT-105');
      expect(intel.approachingMilestones[0].milestoneDate).toBe('2026-08-26');
      expect(intel.approachingMilestones[0].daysUntil).toBe(6);

      // 6. Stale Activities
      expect(intel.staleActivities.map((s: any) => s.externalId)).toContain('ACT-106');

      // 7. Recent Changes
      expect(Array.isArray(intel.recentChanges)).toBe(true);

      // -------------------------------------------------------------
      // Stage 13: Dashboard API Aggregation
      // -------------------------------------------------------------
      const dashboardRes = await request(app)
        .get(`/api/projects/${projectId}/dashboard`)
        .query({ asOfDate: GOLDEN_AS_OF_DATE });
      expect(dashboardRes.status).toBe(200);
      const dashboard = dashboardRes.body;

      expect(dashboard.project.id).toBe(projectId);
      expect(dashboard.project.code).toBe(goldenProject.code);
      expect(dashboard.health.overallRiskClassification).toBe('DELAYED');
      expect(dashboard.health.overallActualProgress).toBe(41.67);
      expect(dashboard.health.overallPlannedProgress).toBe(57.45);
      expect(dashboard.health.progressVariance).toBe(-15.78);
      expect(dashboard.health.varianceState).toBe('behind');

      expect(dashboard.activityStatus.totalActivities).toBe(6);
      expect(dashboard.activityStatus.delayed).toBe(1);
      expect(dashboard.activityStatus.atRisk).toBe(1);
      expect(dashboard.activityStatus.completed).toBe(1);
      expect(dashboard.activityStatus.onTrack).toBe(3);
      expect(dashboard.activityStatus.overdueCount).toBe(1);

      expect(dashboard.milestones.upcoming).toHaveLength(1);
      expect(dashboard.milestones.upcoming[0].externalId).toBe('ACT-105');

      expect(dashboard.attention.delayedCount).toBe(1);
      expect(dashboard.attention.atRiskCount).toBe(1);

      // -------------------------------------------------------------
      // Stage 14: Grounded Assistant Endpoint
      // -------------------------------------------------------------
      mockAiProvider.setMockStructuredResponse((prompt: string) => {
        if (prompt.includes('--- VERIFIED FACTS ---')) {
          return {
            answer: 'Site Earthworks & Clearing (ACT-101) is delayed at 40% actual progress against planned finish 2026-08-10.',
            claims: [
              {
                type: 'metric',
                factRef: 'delayed:ACT-101',
                field: 'actualProgress',
                value: 40,
                text: 'Site Earthworks & Clearing (ACT-101) is delayed at 40% actual progress against planned finish 2026-08-10.'
              }
            ]
          };
        }

        return {
          intent: 'delayed',
          activityQuery: null,
          explicitDate: null
        };
      });

      const assistantRes = await request(app)
        .post(`/api/projects/${projectId}/assistant/query`)
        .send({ question: 'What is delayed?', asOfDate: GOLDEN_AS_OF_DATE });
      expect(assistantRes.status).toBe(200);
      expect(assistantRes.body.grounded).toBe(true);
      expect(assistantRes.body.intent.intent).toBe('delayed');
      expect(assistantRes.body.factRefs).toContain('delayed:ACT-101');
      expect(assistantRes.body.claims).toHaveLength(1);
      expect(assistantRes.body.claims[0].factRef).toBe('delayed:ACT-101');
      expect(assistantRes.body.claims[0].field).toBe('actualProgress');
      expect(assistantRes.body.claims[0].value).toBe(40);
      expect(assistantRes.body.answer).toContain('ACT-101');
    });
  });

  // =========================================================================
  // SUITE 2: Focused Failure Scenarios & Truth Protection
  // =========================================================================
  describe('2. Failure Scenarios & Domain Truth Protection', () => {
    let projectId: string;
    let scheduleId: string;

    beforeEach(async () => {
      const pRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Failure Test Project', code: 'FTP-01' });
      projectId = pRes.body.project.id;

      const sRes = await request(app)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach(
          'file',
          Buffer.from(
            'Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-101,Site Earthworks Sector 1,WBS-01,Sector 1,2026-08-01,2026-08-10,100,m3\nACT-102,Site Earthworks Sector 2,WBS-02,Sector 2,2026-08-01,2026-08-10,100,m3'
          ),
          'schedule.csv'
        );
      scheduleId = sRes.body.schedule.id;
    });

    it('1. Malformed schedule: rejects invalid file and leaves 0 partial activities', async () => {
      const invalidProjectRes = await request(app)
        .post('/api/projects')
        .send({ name: 'Invalid Schedule Test', code: 'IST-01' });
      const badProjectId = invalidProjectRes.body.project.id;

      const badCsv = 'NotAHeader,Garbage\n1,2,3';
      const importRes = await request(app)
        .post(`/api/projects/${badProjectId}/schedules/import`)
        .attach('file', Buffer.from(badCsv), 'corrupt.csv');

      expect(importRes.status).toBe(400);

      const db = getDatabase();
      const activityRepo = new SqliteActivityRepository(() => db);
      const acts = activityRepo.listByProjectId(badProjectId);
      expect(acts).toHaveLength(0);
    });

    it('2. Malformed document: worker processing fails cleanly leaving no partial canonical progress', async () => {
      const emptyFilePath = path.join(testArtifactsDir, 'empty.txt');
      fs.writeFileSync(emptyFilePath, '   \n  \n  ', 'utf-8');

      const evRes = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .attach('file', emptyFilePath);
      expect(evRes.status).toBe(201);
      const evidenceId = evRes.body.evidence.id;

      const jobRes = await request(app)
        .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
        .send();
      const jobId = jobRes.body.job.id;

      await workerRunner.processNextJob();

      const jobStatusRes = await request(app).get(`/api/projects/${projectId}/jobs/${jobId}`);
      expect(jobStatusRes.body.job.status).toBe('failed');
      expect(jobStatusRes.body.job.errorMessage).toBeDefined();

      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('3. AI extraction failure: failing AI provider fails job safely without corrupting state', async () => {
      const reportFilePath = path.join(testArtifactsDir, 'field_log.txt');
      fs.writeFileSync(reportFilePath, 'Site Earthworks Sector 1 is 50% finished on 2026-08-20.', 'utf-8');

      const evRes = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .attach('file', reportFilePath);
      const evidenceId = evRes.body.evidence.id;

      const jobRes = await request(app)
        .post(`/api/projects/${projectId}/evidence/${evidenceId}/process`)
        .send();
      const jobId = jobRes.body.job.id;

      // Inject deterministic failure into AI provider
      mockAiProvider.setFailure(true, new Error('Simulated Gemini 503 Overloaded'));

      await workerRunner.processNextJob();

      const jobStatusRes = await request(app).get(`/api/projects/${projectId}/jobs/${jobId}`);
      expect(jobStatusRes.body.job.status).toBe('failed');

      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('4. Missing activity: field report referencing unknown activity creates no canonical progress', async () => {
      const updateRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({
          reportDate: '2026-08-20',
          reporterName: 'Foreman',
          sourceType: 'manual',
          rawText: 'Solar panel roof array is 80% installed.'
        });
      const updateId = updateRes.body.progressUpdate.id;

      const matchRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: 'Solar panel roof array',
                location: 'Roof',
                progress_percent: 80,
                status: 'in_progress'
              }
            ]
          }
        });

      expect(matchRes.status).toBe(200);
      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('5. Ambiguous activity: close candidates remain suggested/unresolved without auto-confirmation', async () => {
      const updateRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({
          reportDate: '2026-08-20',
          reporterName: 'Foreman',
          sourceType: 'manual',
          rawText: 'Site Earthworks is 50% finished.'
        });
      const updateId = updateRes.body.progressUpdate.id;

      const matchRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: 'Site Earthworks', // Matches both ACT-101 and ACT-102 equally
                location: null,
                progress_percent: 50,
                status: 'in_progress'
              }
            ]
          }
        });

      expect(matchRes.status).toBe(200);
      expect(matchRes.body.matches[0].reviewDecision?.autoConfirm).toBe(false);

      const dbMatchesRes = await request(app).get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`);
      expect(dbMatchesRes.body.matches[0].status).toBe('suggested');
      expect(dbMatchesRes.body.matches[0].reviewState).toBe('awaiting_review');
      expect(dbMatchesRes.body.matches[0].reviewedBy).toBeNull();
    });

    it('6. Rejected match: rejected match cannot create canonical ActivityProgress', async () => {
      const updateRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({
          reportDate: '2026-08-20',
          reporterName: 'Inspector',
          sourceType: 'manual',
          rawText: 'Site Earthworks progress note.'
        });
      const updateId = updateRes.body.progressUpdate.id;

      // Ambiguous fact matching with medium confidence (suggested)
      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
        .send({
          extraction: {
            items: [
              {
                reference: 'Site Earthworks',
                location: null,
                progress_percent: 50,
                status: 'in_progress'
              }
            ]
          }
        });

      const matchesRes = await request(app).get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`);
      expect(matchesRes.body.matches[0].status).toBe('suggested');
      const matchId = matchesRes.body.matches[0].id;

      // Reject match
      const rejectRes = await request(app)
        .post(`/api/projects/${projectId}/activity-matches/${matchId}/reject`)
        .send({ reviewer: 'Lead Auditor', reason: 'Incorrect scope' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.match.status).toBe('rejected');

      // Attempting to record canonical progress on rejected match must fail
      const progressRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${updateId}/progress`)
        .send({
          matchId,
          fact: { reference: 'Site Earthworks', location: null, progress_percent: 50, status: 'in_progress' },
          asOfDate: '2026-08-20'
        });
      expect(progressRes.status).toBe(400);

      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('7. Duplicate evidence: identical file bytes deduplicated via SHA-256 with idempotent processing', async () => {
      const reportFilePath = path.join(testArtifactsDir, 'idempotent_report.txt');
      fs.writeFileSync(reportFilePath, 'Deterministic byte stream for SHA-256 deduplication.', 'utf-8');

      const ev1Res = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .attach('file', reportFilePath);
      expect(ev1Res.status).toBe(201);
      expect(ev1Res.body.deduplicated).toBe(false);
      const evidence1Id = ev1Res.body.evidence.id;

      // Upload identical file again
      const ev2Res = await request(app)
        .post(`/api/projects/${projectId}/evidence`)
        .attach('file', reportFilePath);
      expect(ev2Res.status).toBe(200);
      expect(ev2Res.body.deduplicated).toBe(true);
      expect(ev2Res.body.evidence.id).toBe(evidence1Id);

      const db = getDatabase();
      const evidenceRepo = new SqliteEvidenceRepository(() => db);
      expect(evidenceRepo.listByProjectId(projectId)).toHaveLength(1);
    });

    it('8. Contradictory report: subsequent conflicting reports preserve observation immutability and deterministic asOfDate', async () => {
      const actsRes = await request(app).get(`/api/projects/${projectId}/schedules/${scheduleId}/activities`);
      const act101 = actsRes.body.activities.find((a: any) => a.externalId === 'ACT-101');

      // First update on 2026-08-15: 40%
      const u1Res = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({ reportDate: '2026-08-15', reporterName: 'Alice', sourceType: 'manual', rawText: 'Update 1' });
      const u1Id = u1Res.body.progressUpdate.id;

      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${u1Id}/matches`)
        .send({
          extraction: {
            items: [{ reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 40, status: 'in_progress' }]
          }
        });
      const m1List = (await request(app).get(`/api/projects/${projectId}/progress-updates/${u1Id}/matches`)).body.matches;
      const m1Id = m1List[0].id;
      if (m1List[0].status === 'suggested') {
        await request(app).post(`/api/projects/${projectId}/activity-matches/${m1Id}/confirm`).send();
      }

      const p1Res = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${u1Id}/progress`)
        .send({
          matchId: m1Id,
          fact: { reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 40, status: 'in_progress' },
          asOfDate: '2026-08-15'
        });
      expect(p1Res.status).toBe(200);

      // Second contradictory update on 2026-08-20: 30% (claims reduced progress)
      const u2Res = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({ reportDate: '2026-08-20', reporterName: 'Bob', sourceType: 'manual', rawText: 'Update 2' });
      const u2Id = u2Res.body.progressUpdate.id;

      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${u2Id}/matches`)
        .send({
          extraction: {
            items: [{ reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 30, status: 'in_progress' }]
          }
        });
      const m2List = (await request(app).get(`/api/projects/${projectId}/progress-updates/${u2Id}/matches`)).body.matches;
      const m2Id = m2List[0].id;
      if (m2List[0].status === 'suggested') {
        await request(app).post(`/api/projects/${projectId}/activity-matches/${m2Id}/confirm`).send();
      }

      const p2Res = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${u2Id}/progress`)
        .send({
          matchId: m2Id,
          fact: { reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 30, status: 'in_progress' },
          asOfDate: '2026-08-20'
        });
      expect(p2Res.status).toBe(200);

      // Query snapshot as of 2026-08-15 -> must be 40%
      const snap15Res = await request(app)
        .get(`/api/projects/${projectId}/progress-snapshot`)
        .query({ asOfDate: '2026-08-15' });
      const actSnap15 = snap15Res.body.activities.find((a: any) => a.externalId === 'ACT-101');
      expect(actSnap15.actualProgress).toBe(40);

      // Query snapshot as of 2026-08-20 -> must be 30%
      const snap20Res = await request(app)
        .get(`/api/projects/${projectId}/progress-snapshot`)
        .query({ asOfDate: '2026-08-20' });
      const actSnap20 = snap20Res.body.activities.find((a: any) => a.externalId === 'ACT-101');
      expect(actSnap20.actualProgress).toBe(30);

      // Verify both historical observations are preserved in the DB
      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      const obs = progressRepo.listByActivityId(act101.id, projectId);
      expect(obs).toHaveLength(2);
    });

    it('9. Invalid date: rejects malformed date without arbitrary wall-clock fallback', async () => {
      const snapRes = await request(app)
        .get(`/api/projects/${projectId}/progress-snapshot`)
        .query({ asOfDate: 'invalid-date-format' });
      expect(snapRes.status).toBe(400);

      const intelRes = await request(app)
        .get(`/api/projects/${projectId}/intelligence`)
        .query({ asOfDate: '2026-99-99' });
      expect(intelRes.status).toBe(400);
    });

    it('10. Missing quantity / percentage: does not fabricate numbers for incomplete facts', async () => {
      const uRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({ reportDate: '2026-08-20', reporterName: 'Alice', sourceType: 'manual', rawText: 'Work ongoing.' });
      const uId = uRes.body.progressUpdate.id;

      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${uId}/matches`)
        .send({
          extraction: {
            items: [{ reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: null, status: 'in_progress' }]
          }
        });
      const mList = (await request(app).get(`/api/projects/${projectId}/progress-updates/${uId}/matches`)).body.matches;
      const matchId = mList[0].id;
      if (mList[0].status === 'suggested') {
        await request(app).post(`/api/projects/${projectId}/activity-matches/${matchId}/confirm`).send();
      }

      // Progress request without percentage and without quantity fails
      const pRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${uId}/progress`)
        .send({
          matchId,
          fact: { reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: null, status: 'in_progress' },
          asOfDate: '2026-08-20'
        });
      expect(pRes.status).toBe(400);

      const db = getDatabase();
      const progressRepo = new SqliteActivityProgressRepository(() => db);
      expect(progressRepo.listByProjectId(projectId)).toHaveLength(0);
    });

    it('11. Malformed assistant claim: field-level grounding validation rejects claim with invalid value', async () => {
      // Set up confirmed progress 40% on ACT-101
      const uRes = await request(app)
        .post(`/api/projects/${projectId}/progress-updates`)
        .send({ reportDate: '2026-08-20', reporterName: 'Alice', sourceType: 'manual', rawText: '40% done' });
      const uId = uRes.body.progressUpdate.id;

      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${uId}/matches`)
        .send({
          extraction: {
            items: [{ reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 40, status: 'in_progress' }]
          }
        });
      const mList = (await request(app).get(`/api/projects/${projectId}/progress-updates/${uId}/matches`)).body.matches;
      const matchId = mList[0].id;
      if (mList[0].status === 'suggested') {
        await request(app).post(`/api/projects/${projectId}/activity-matches/${matchId}/confirm`).send();
      }

      await request(app)
        .post(`/api/projects/${projectId}/progress-updates/${uId}/progress`)
        .send({
          matchId,
          fact: { reference: 'Site Earthworks Sector 1', location: 'Sector 1', progress_percent: 40, status: 'in_progress' },
          asOfDate: '2026-08-20'
        });

      // Configure MockAI to return an invalid metric claim value (99% instead of 40%)
      mockAiProvider.setMockStructuredResponse((prompt: string) => {
        if (prompt.includes('--- VERIFIED FACTS ---')) {
          return {
            answer: 'Site Earthworks Sector 1 is 99% complete.',
            claims: [
              {
                type: 'metric',
                factRef: 'delayed:ACT-101',
                field: 'actualProgress',
                value: 99, // Authoritative value is 40!
                text: 'Site Earthworks Sector 1 is 99% complete.'
              }
            ]
          };
        }
        return { intent: 'delayed', activityQuery: null, explicitDate: null };
      });

      const assistantRes = await request(app)
        .post(`/api/projects/${projectId}/assistant/query`)
        .send({ question: 'What is delayed?', asOfDate: '2026-08-20' });

      // Must fail with AI provider error (502 Bad Gateway)
      expect(assistantRes.status).toBe(502);
      expect(assistantRes.body.error).toMatch(/does not match authoritative fact value/i);
    });
  });

  // =========================================================================
  // SUITE 3: Cross-Project Isolation Across the Complete Workflow
  // =========================================================================
  describe('3. Cross-Project Isolation Across All Layers', () => {
    it('guarantees complete isolation between Project A and Project B', async () => {
      // 1. Create Project A & Project B
      const pARes = await request(app).post('/api/projects').send({ name: 'Project Alpha', code: 'PRJ-A' });
      const pBRes = await request(app).post('/api/projects').send({ name: 'Project Beta', code: 'PRJ-B' });
      const pA = pARes.body.project.id;
      const pB = pBRes.body.project.id;

      // 2. Import Schedules
      await request(app)
        .post(`/api/projects/${pA}/schedules/import`)
        .attach('file', Buffer.from('Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-A1,Alpha Excavation,WBS-1,Loc A,2026-08-01,2026-08-10,100,m3'), 'a.csv');
      await request(app)
        .post(`/api/projects/${pB}/schedules/import`)
        .attach('file', Buffer.from('Activity ID,Activity Name,WBS,Location,Planned Start,Planned Finish,Planned Quantity,Unit\nACT-B1,Beta Foundation,WBS-1,Loc B,2026-08-01,2026-08-10,100,m3'), 'b.csv');

      // 3. Upload Evidence
      const evAPath = path.join(testArtifactsDir, 'ev_a.txt');
      const evBPath = path.join(testArtifactsDir, 'ev_b.txt');
      fs.writeFileSync(evAPath, 'Alpha report content', 'utf-8');
      fs.writeFileSync(evBPath, 'Beta report content', 'utf-8');

      const evARes = await request(app).post(`/api/projects/${pA}/evidence`).attach('file', evAPath);
      await request(app).post(`/api/projects/${pB}/evidence`).attach('file', evBPath);

      // Verify Project A evidence cannot be accessed via Project B
      const crossEvRes = await request(app).get(`/api/projects/${pB}/evidence/${evARes.body.evidence.id}`);
      expect(crossEvRes.status).toBe(404);

      // 4. Record Distinct Progress
      const uARes = await request(app).post(`/api/projects/${pA}/progress-updates`).send({ reportDate: '2026-08-20', reporterName: 'Alice', sourceType: 'manual', rawText: 'A' });
      const uBRes = await request(app).post(`/api/projects/${pB}/progress-updates`).send({ reportDate: '2026-08-20', reporterName: 'Bob', sourceType: 'manual', rawText: 'B' });

      await request(app).post(`/api/projects/${pA}/progress-updates/${uARes.body.progressUpdate.id}/matches`).send({
        extraction: { items: [{ reference: 'Alpha Excavation', location: 'Loc A', progress_percent: 45, status: 'in_progress' }] }
      });
      await request(app).post(`/api/projects/${pB}/progress-updates/${uBRes.body.progressUpdate.id}/matches`).send({
        extraction: { items: [{ reference: 'Beta Foundation', location: 'Loc B', progress_percent: 75, status: 'in_progress' }] }
      });

      const mAList = (await request(app).get(`/api/projects/${pA}/progress-updates/${uARes.body.progressUpdate.id}/matches`)).body.matches;
      const mBList = (await request(app).get(`/api/projects/${pB}/progress-updates/${uBRes.body.progressUpdate.id}/matches`)).body.matches;
      const mA = mAList[0].id;
      const mB = mBList[0].id;

      if (mAList[0].status === 'suggested') {
        await request(app).post(`/api/projects/${pA}/activity-matches/${mA}/confirm`).send();
      }
      if (mBList[0].status === 'suggested') {
        await request(app).post(`/api/projects/${pB}/activity-matches/${mB}/confirm`).send();
      }

      const pARecordRes = await request(app).post(`/api/projects/${pA}/progress-updates/${uARes.body.progressUpdate.id}/progress`).send({
        matchId: mA,
        fact: { reference: 'Alpha Excavation', location: 'Loc A', progress_percent: 45, status: 'in_progress' },
        asOfDate: '2026-08-20'
      });
      expect(pARecordRes.status).toBe(200);

      const pBRecordRes = await request(app).post(`/api/projects/${pB}/progress-updates/${uBRes.body.progressUpdate.id}/progress`).send({
        matchId: mB,
        fact: { reference: 'Beta Foundation', location: 'Loc B', progress_percent: 75, status: 'in_progress' },
        asOfDate: '2026-08-20'
      });
      expect(pBRecordRes.status).toBe(200);

      // 5. Intelligence Isolation
      const intelA = (await request(app).get(`/api/projects/${pA}/intelligence`).query({ asOfDate: '2026-08-20' })).body;
      const intelB = (await request(app).get(`/api/projects/${pB}/intelligence`).query({ asOfDate: '2026-08-20' })).body;

      expect(intelA.delayed.map((d: any) => d.externalId)).toContain('ACT-A1');
      expect(intelA.delayed.map((d: any) => d.externalId)).not.toContain('ACT-B1');

      expect(intelB.delayed.map((d: any) => d.externalId)).toContain('ACT-B1');
      expect(intelB.delayed.map((d: any) => d.externalId)).not.toContain('ACT-A1');

      // 6. Dashboard Isolation
      const dashA = (await request(app).get(`/api/projects/${pA}/dashboard`).query({ asOfDate: '2026-08-20' })).body;
      const dashB = (await request(app).get(`/api/projects/${pB}/dashboard`).query({ asOfDate: '2026-08-20' })).body;

      expect(dashA.project.code).toBe('PRJ-A');
      expect(dashB.project.code).toBe('PRJ-B');
      expect(dashA.health.overallActualProgress).toBe(45);
      expect(dashB.health.overallActualProgress).toBe(75);
    });
  });

  // =========================================================================
  // SUITE 4: Output Determinism & Logical Equivalence Across Runs
  // =========================================================================
  describe('4. Determinism & Output Equivalence', () => {
    async function runDeterministicFixture() {
      initDatabase({ dbPath: ':memory:' });
      const localApp = createApp();

      const localMockAi = new MockAIProvider();
      if (aiService instanceof DefaultAIService) {
        aiService.setProvider(localMockAi);
      }
      localMockAi.setMockStructuredResponse(goldenExtraction);

      // Create Project
      const pRes = await request(localApp).post('/api/projects').send(goldenProject);
      const projectId = pRes.body.project.id;

      // Import Schedule
      const sRes = await request(localApp)
        .post(`/api/projects/${projectId}/schedules/import`)
        .attach('file', Buffer.from(goldenScheduleCsv), 'schedule.csv');

      // Upload Evidence
      const reportPath = path.join(testArtifactsDir, `det_${Date.now()}_${Math.random()}.txt`);
      fs.writeFileSync(reportPath, goldenFieldReportText, 'utf-8');
      const evRes = await request(localApp).post(`/api/projects/${projectId}/evidence`).attach('file', reportPath);

      // Process Job
      await request(localApp).post(`/api/projects/${projectId}/evidence/${evRes.body.evidence.id}/process`).send();
      await workerRunner.processNextJob();

      const actsRes = await request(localApp).get(`/api/projects/${projectId}/schedules/${sRes.body.schedule.id}/activities`);
      const actMap = new Map(actsRes.body.activities.map((a: any) => [a.externalId, a.id]));

      const jobsRes = await request(localApp).get(`/api/projects/${projectId}/jobs`);
      const updateId = jobsRes.body.jobs[0].result.progressUpdateId;

      const mRes = await request(localApp).get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`);
      for (const m of mRes.body.matches) {
        if (m.status === 'suggested') {
          await request(localApp).post(`/api/projects/${projectId}/activity-matches/${m.id}/confirm`).send();
        }
      }

      // Record Progress
      const match101 = mRes.body.matches.find((m: any) => m.activityId === actMap.get('ACT-101'));
      const match102 = mRes.body.matches.find((m: any) => m.activityId === actMap.get('ACT-102'));
      const match103 = mRes.body.matches.find((m: any) => m.activityId === actMap.get('ACT-103'));
      const match104 = mRes.body.matches.find((m: any) => m.activityId === actMap.get('ACT-104'));

      await request(localApp).post(`/api/projects/${projectId}/progress-updates/${updateId}/progress`).send({
        matchId: match101.id,
        fact: { reference: 'Site Earthworks & Clearing', location: 'Sector 1', progress_percent: 40, status: 'in_progress' },
        asOfDate: GOLDEN_AS_OF_DATE
      });
      await request(localApp).post(`/api/projects/${projectId}/progress-updates/${updateId}/progress`).send({
        matchId: match102.id,
        fact: { reference: 'Foundation Piling Block 1', location: 'Block 1', progress_percent: 50, status: 'in_progress' },
        asOfDate: GOLDEN_AS_OF_DATE
      });
      await request(localApp).post(`/api/projects/${projectId}/progress-updates/${updateId}/progress`).send({
        matchId: match103.id,
        fact: { reference: 'Underground Drainage Conduit', location: 'Zone A', progress_percent: 100, status: 'completed' },
        asOfDate: GOLDEN_AS_OF_DATE
      });
      await request(localApp).post(`/api/projects/${projectId}/progress-updates/${updateId}/progress`).send({
        matchId: match104.id,
        fact: { reference: 'Structural Pier Concrete Pouring', location: 'Pier 4', progress_percent: 60, status: 'in_progress' },
        asOfDate: GOLDEN_AS_OF_DATE
      });

      // Extract Logical Outputs
      const snapshot = (await request(localApp).get(`/api/projects/${projectId}/progress-snapshot`).query({ asOfDate: GOLDEN_AS_OF_DATE })).body;
      const intelligence = (await request(localApp).get(`/api/projects/${projectId}/intelligence`).query({ asOfDate: GOLDEN_AS_OF_DATE })).body;
      const dashboard = (await request(localApp).get(`/api/projects/${projectId}/dashboard`).query({ asOfDate: GOLDEN_AS_OF_DATE })).body;

      closeDatabase();

      return {
        snapshotSummary: snapshot.summary,
        snapshotActivities: snapshot.activities.map((a: any) => ({
          externalId: a.externalId,
          plannedProgress: a.plannedProgress,
          actualProgress: a.actualProgress,
          progressVariance: a.progressVariance,
          varianceState: a.varianceState,
          status: a.status,
          overdue: a.overdue
        })),
        delayedExternalIds: intelligence.delayed.map((d: any) => d.externalId),
        atRiskExternalIds: intelligence.atRisk.map((r: any) => r.externalId),
        completedTodayExternalIds: intelligence.completedToday.map((c: any) => c.externalId),
        behindScheduleExternalIds: intelligence.behindSchedule.map((b: any) => b.externalId),
        approachingMilestoneExternalIds: intelligence.approachingMilestones.map((m: any) => m.externalId),
        staleActivityExternalIds: intelligence.staleActivities.map((s: any) => s.externalId),
        dashboardHealth: {
          overallActualProgress: dashboard.health.overallActualProgress,
          overallPlannedProgress: dashboard.health.overallPlannedProgress,
          progressVariance: dashboard.health.progressVariance,
          varianceState: dashboard.health.varianceState,
          overallRiskClassification: dashboard.health.overallRiskClassification
        },
        dashboardActivityStatus: dashboard.activityStatus,
        dashboardAttention: {
          delayedCount: dashboard.attention.delayedCount,
          atRiskCount: dashboard.attention.atRiskCount,
          staleCount: dashboard.attention.staleCount
        }
      };
    }

    it('produces identical normalized logical outputs across two independent executions', async () => {
      const run1 = await runDeterministicFixture();
      const run2 = await runDeterministicFixture();

      expect(run1).toEqual(run2);
      expect(run1.snapshotSummary.overallActualProgress).toBe(41.67);
      expect(run1.delayedExternalIds).toEqual(['ACT-101']);
      expect(run1.atRiskExternalIds).toEqual(['ACT-102']);
      expect(run1.completedTodayExternalIds).toEqual(['ACT-103']);
      expect(run1.behindScheduleExternalIds).toEqual(['ACT-101', 'ACT-102', 'ACT-104']);
      expect(run1.approachingMilestoneExternalIds).toEqual(['ACT-105']);
    });
  });
});
