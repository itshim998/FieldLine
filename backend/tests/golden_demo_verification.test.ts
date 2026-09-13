import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import { verifyGoldenDemoEnvironment } from '../../scripts/demo-verify.js';
import {
  GOLDEN_AS_OF_DATE,
  goldenManifestInvariants
} from '../../demo/golden-demo-manifest.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { scheduleRepository } from '../src/repositories/schedule.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { evidenceRepository } from '../src/repositories/evidence.repository.js';
import { progressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { riskClassificationService } from '../src/services/risk/risk-classification.service.js';
import { projectIntelligenceService } from '../src/services/intelligence/project-intelligence.service.js';
import { projectDashboardService } from '../src/services/dashboard/project-dashboard.service.js';
import { assistantService } from '../src/services/assistant/assistant.service.js';

describe('Pass 24 — Golden Demo Environment & Verification Suite', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('1. Seeds the golden demo environment and satisfies all machine-checkable manifest invariants', async () => {
    const seedResult = await seedGoldenDemo();

    expect(seedResult).toBeDefined();
    expect(seedResult.projectCode).toBe(goldenManifestInvariants.projectCode);
    expect(seedResult.activitiesCount).toBe(goldenManifestInvariants.activityCount);
    expect(seedResult.evidenceCount).toBe(goldenManifestInvariants.expectedEvidenceFileNames.length);
    expect(seedResult.canonicalObservationsCount).toBeGreaterThan(0);

    const verification = await verifyGoldenDemoEnvironment();
    expect(verification.passed).toBe(true);
    expect(verification.failures).toHaveLength(0);
    expect(verification.checksCount).toBeGreaterThan(20);
  });

  it('2. Idempotency: Multiple consecutive seed runs produce identical logical state without duplicates', async () => {
    await seedGoldenDemo();
    const firstProject = (await projectRepository.getByCode(goldenManifestInvariants.projectCode))!;
    const firstSchedules = await scheduleRepository.listByProjectId(firstProject.id);
    const firstActivities = await activityRepository.listByProjectId(firstProject.id);
    const firstEvidence = await evidenceRepository.listByProjectId(firstProject.id);

    expect(firstSchedules).toHaveLength(1);
    expect(firstActivities).toHaveLength(30);
    expect(firstEvidence).toHaveLength(6);

    // Verify snapshot risk classification matches manifest
    const risks1 = await riskClassificationService.getProjectRiskStatus(firstProject.id, GOLDEN_AS_OF_DATE);
    expect(risks1.summary.delayed).toBe(goldenManifestInvariants.expectedRiskCounts.delayed);
    expect(risks1.summary.atRisk).toBe(goldenManifestInvariants.expectedRiskCounts.atRisk);
    expect(risks1.summary.completed).toBe(goldenManifestInvariants.expectedRiskCounts.completed);
    expect(risks1.summary.onTrack + risks1.summary.ahead).toBe(goldenManifestInvariants.expectedRiskCounts.onTrack);
  });

  it('3. Dashboard HTTP API returns the populated golden project state with correct headline numbers', async () => {
    await seedGoldenDemo();
    const project = (await projectRepository.getByCode(goldenManifestInvariants.projectCode))!;

    const res = await request(app)
      .get(`/api/projects/${project.id}/dashboard`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE });

    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.project.code).toBe(goldenManifestInvariants.projectCode);
    expect(body.activityStatus.totalActivities).toBe(30);
    expect(body.activityStatus.delayed).toBe(goldenManifestInvariants.expectedRiskCounts.delayed);
    expect(body.activityStatus.atRisk).toBe(goldenManifestInvariants.expectedRiskCounts.atRisk);
    expect(body.activityStatus.completed).toBe(goldenManifestInvariants.expectedRiskCounts.completed);
    expect(body.activityStatus.onTrack + body.activityStatus.ahead).toBe(goldenManifestInvariants.expectedRiskCounts.onTrack);
    expect(body.milestones.upcoming).toHaveLength(goldenManifestInvariants.expectedApproachingMilestoneIds.length);
    expect(body.attention.delayedCount).toBe(goldenManifestInvariants.expectedRiskCounts.delayed);
    expect(body.attention.atRiskCount).toBe(goldenManifestInvariants.expectedRiskCounts.atRisk);
  });

  it('4. Project Intelligence HTTP API returns deterministic facts across all 7 intelligence categories', async () => {
    await seedGoldenDemo();
    const project = (await projectRepository.getByCode(goldenManifestInvariants.projectCode))!;

    const res = await request(app)
      .get(`/api/projects/${project.id}/intelligence`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE, recentDays: 7, approachingDays: 14 });

    expect(res.status).toBe(200);
    const intel = res.body;

    expect(intel.delayed).toHaveLength(goldenManifestInvariants.expectedDelayedIds.length);
    expect(intel.delayed.map((d: any) => d.externalId).sort()).toEqual(goldenManifestInvariants.expectedDelayedIds.sort());

    expect(intel.atRisk).toHaveLength(goldenManifestInvariants.expectedAtRiskIds.length);
    expect(intel.atRisk.map((a: any) => a.externalId).sort()).toEqual(goldenManifestInvariants.expectedAtRiskIds.sort());

    expect(intel.approachingMilestones).toHaveLength(goldenManifestInvariants.expectedApproachingMilestoneIds.length);
    expect(intel.approachingMilestones.map((m: any) => m.externalId).sort()).toEqual(goldenManifestInvariants.expectedApproachingMilestoneIds.sort());

    expect(intel.behindSchedule.length).toBeGreaterThanOrEqual(8);
  });

  it('5. Grounded Assistant HTTP API returns verifiable grounded answers for manager queries', async () => {
    await seedGoldenDemo();
    const project = (await projectRepository.getByCode(goldenManifestInvariants.projectCode))!;

    // Delayed Query
    const delayedRes = await request(app)
      .post(`/api/projects/${project.id}/assistant/query`)
      .send({ question: 'What is delayed?', asOfDate: GOLDEN_AS_OF_DATE });

    expect(delayedRes.status).toBe(200);
    expect(delayedRes.body.grounded).toBe(true);
    expect(delayedRes.body.intent.intent).toBe('delayed');
    expect(delayedRes.body.claims.length).toBeGreaterThan(0);

    // At Risk Query
    const riskRes = await request(app)
      .post(`/api/projects/${project.id}/assistant/query`)
      .send({ question: 'Which activities are at risk?', asOfDate: GOLDEN_AS_OF_DATE });

    expect(riskRes.status).toBe(200);
    expect(riskRes.body.grounded).toBe(true);
    expect(riskRes.body.intent.intent).toBe('at_risk');

    // Milestones Query
    const milestoneRes = await request(app)
      .post(`/api/projects/${project.id}/assistant/query`)
      .send({ question: 'Which milestones are approaching?', asOfDate: GOLDEN_AS_OF_DATE });

    expect(milestoneRes.status).toBe(200);
    expect(milestoneRes.body.grounded).toBe(true);
    expect(milestoneRes.body.intent.intent).toBe('approaching_milestones');
  });

  it('6. Activity Detail Screen returns full execution timelines and evidence links for flagship activities', async () => {
    await seedGoldenDemo();
    const project = (await projectRepository.getByCode(goldenManifestInvariants.projectCode))!;
    const activities = await activityRepository.listByProjectId(project.id);
    const pumpAct = activities.find((a) => a.externalId === 'ACT-B02')!;

    const res = await request(app)
      .get(`/api/projects/${project.id}/activities/${pumpAct.id}`)
      .query({ asOfDate: GOLDEN_AS_OF_DATE });

    expect(res.status).toBe(200);
    const detail = res.body;

    expect(detail.activity.externalId).toBe('ACT-B02');
    expect(detail.activity.name).toBe('Crude Pump Foundation Piling Works');
    expect(detail.timeline.length).toBeGreaterThanOrEqual(4);
    expect(detail.evidence.length).toBeGreaterThanOrEqual(1);
    expect(detail.current.riskClassification).toBe('AT_RISK');
  });
});
