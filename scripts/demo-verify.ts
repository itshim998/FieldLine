import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, initDatabase, isDatabaseHealthy } from '../backend/src/database/db.js';
import { projectRepository } from '../backend/src/repositories/project.repository.js';
import { scheduleRepository } from '../backend/src/repositories/schedule.repository.js';
import { activityRepository } from '../backend/src/repositories/activity.repository.js';
import { evidenceRepository } from '../backend/src/repositories/evidence.repository.js';
import { progressSnapshotService } from '../backend/src/services/snapshot/progress-snapshot.service.js';
import { riskClassificationService } from '../backend/src/services/risk/risk-classification.service.js';
import { projectIntelligenceService } from '../backend/src/services/intelligence/project-intelligence.service.js';
import { projectDashboardService } from '../backend/src/services/dashboard/project-dashboard.service.js';
import { assistantService } from '../backend/src/services/assistant/assistant.service.js';
import {
  GOLDEN_AS_OF_DATE,
  goldenManifestInvariants
} from '../demo/golden-demo-manifest.js';

export interface VerificationResult {
  passed: boolean;
  checksCount: number;
  failures: string[];
}

export async function verifyGoldenDemoEnvironment(): Promise<VerificationResult> {
  const failures: string[] = [];
  let checksCount = 0;

  const assert = (condition: boolean, description: string) => {
    checksCount++;
    if (!condition) {
      failures.push(`FAILED: ${description}`);
      console.error(`❌ ${description}`);
    } else {
      console.log(`✅ ${description}`);
    }
  };

  console.log('====================================================');
  console.log('🔍 Verifying FieldLine Golden Demo Environment');
  console.log(`Snapshot Date: ${GOLDEN_AS_OF_DATE}`);
  console.log('====================================================');

  // 1. Database Health Check
  assert(isDatabaseHealthy(), 'SQLite database is healthy and reachable');

  // 2. Project Invariants
  const project = projectRepository.getByCode(goldenManifestInvariants.projectCode);
  assert(!!project, `Golden project '${goldenManifestInvariants.projectCode}' exists in database`);

  if (!project) {
    return { passed: false, checksCount, failures };
  }

  const projectId = project.id;
  assert(project.name === goldenManifestInvariants.projectName, `Project name matches '${goldenManifestInvariants.projectName}'`);

  // 3. Schedule & Activity Invariants
  const schedules = scheduleRepository.listByProjectId(projectId);
  assert(schedules.length === goldenManifestInvariants.scheduleCount, `Expected exactly ${goldenManifestInvariants.scheduleCount} schedule, found ${schedules.length}`);

  const activities = activityRepository.listByProjectId(projectId);
  assert(activities.length === goldenManifestInvariants.activityCount, `Expected ${goldenManifestInvariants.activityCount} activities, found ${activities.length}`);

  const actMap = new Map(activities.map((a) => [a.externalId, a]));

  // Verify all work areas are represented
  const areas = new Set(activities.map((a) => a.location));
  assert(areas.has('Area A'), 'Area A activities exist');
  assert(areas.has('Area B'), 'Area B activities exist');
  assert(areas.has('Area C'), 'Area C activities exist');
  assert(areas.has('Area D'), 'Area D activities exist');
  assert(areas.has('Area E'), 'Area E activities exist');
  assert(areas.has('Area F'), 'Area F activities exist');

  // 4. Progress Snapshot Invariants
  const snapshot = progressSnapshotService.getProgressSnapshot(projectId, GOLDEN_AS_OF_DATE);
  assert(snapshot.summary.totalActivities === goldenManifestInvariants.activityCount, `Snapshot total activities equals ${goldenManifestInvariants.activityCount}`);
  assert(snapshot.summary.completed === goldenManifestInvariants.expectedRiskCounts.completed, `Completed activities in snapshot: ${snapshot.summary.completed} (expected ${goldenManifestInvariants.expectedRiskCounts.completed})`);
  assert(snapshot.summary.overdue === goldenManifestInvariants.expectedRiskCounts.delayed, `Overdue activities in snapshot: ${snapshot.summary.overdue} (expected ${goldenManifestInvariants.expectedRiskCounts.delayed})`);

  // 5. Risk Classification Engine Invariants
  const risks = riskClassificationService.getProjectRiskStatus(projectId, GOLDEN_AS_OF_DATE);
  assert(risks.summary.delayed === goldenManifestInvariants.expectedRiskCounts.delayed, `Risk engine delayed count: ${risks.summary.delayed} (expected ${goldenManifestInvariants.expectedRiskCounts.delayed})`);
  assert(risks.summary.atRisk === goldenManifestInvariants.expectedRiskCounts.atRisk, `Risk engine at-risk count: ${risks.summary.atRisk} (expected ${goldenManifestInvariants.expectedRiskCounts.atRisk})`);
  assert(risks.summary.completed === goldenManifestInvariants.expectedRiskCounts.completed, `Risk engine completed count: ${risks.summary.completed} (expected ${goldenManifestInvariants.expectedRiskCounts.completed})`);
  assert(
    risks.summary.onTrack + risks.summary.ahead === goldenManifestInvariants.expectedRiskCounts.onTrack,
    `Risk engine on-track + ahead count: ${risks.summary.onTrack + risks.summary.ahead} (expected ${goldenManifestInvariants.expectedRiskCounts.onTrack})`
  );

  // Verify specific classified activities
  for (const expDelayedId of goldenManifestInvariants.expectedDelayedIds) {
    const r = risks.activities.find((a) => a.externalId === expDelayedId);
    assert(r?.classification === 'DELAYED', `Activity ${expDelayedId} classified as DELAYED`);
  }

  for (const expAtRiskId of goldenManifestInvariants.expectedAtRiskIds) {
    const r = risks.activities.find((a) => a.externalId === expAtRiskId);
    assert(r?.classification === 'AT_RISK', `Activity ${expAtRiskId} classified as AT_RISK`);
  }

  for (const expCompletedId of goldenManifestInvariants.expectedCompletedIds) {
    const r = risks.activities.find((a) => a.externalId === expCompletedId);
    assert(r?.classification === 'COMPLETED', `Activity ${expCompletedId} classified as COMPLETED`);
  }

  // 6. Project Intelligence Invariants
  const intel = projectIntelligenceService.getIntelligence(projectId, {
    asOfDate: GOLDEN_AS_OF_DATE,
    recentDays: 7,
    approachingDays: 14
  });

  assert(intel.delayed.length === goldenManifestInvariants.expectedDelayedIds.length, `Intelligence delayed list length equals ${goldenManifestInvariants.expectedDelayedIds.length}`);
  assert(intel.atRisk.length === goldenManifestInvariants.expectedAtRiskIds.length, `Intelligence at-risk list length equals ${goldenManifestInvariants.expectedAtRiskIds.length}`);
  assert(intel.approachingMilestones.length === goldenManifestInvariants.expectedApproachingMilestoneIds.length, `Intelligence approaching milestones equals ${goldenManifestInvariants.expectedApproachingMilestoneIds.length}`);

  for (const mId of goldenManifestInvariants.expectedApproachingMilestoneIds) {
    const found = intel.approachingMilestones.some((m) => m.externalId === mId);
    assert(found, `Approaching milestone ${mId} identified in intelligence`);
  }

  // 7. Dashboard API Invariants
  const dashboard = projectDashboardService.getDashboard(projectId, {
    asOfDate: GOLDEN_AS_OF_DATE
  });
  assert(dashboard.project.code === goldenManifestInvariants.projectCode, 'Dashboard project code matches');
  assert(dashboard.activityStatus.totalActivities === goldenManifestInvariants.activityCount, 'Dashboard total activities matches');
  assert(dashboard.activityStatus.delayed === goldenManifestInvariants.expectedRiskCounts.delayed, 'Dashboard delayed count matches');
  assert(dashboard.activityStatus.atRisk === goldenManifestInvariants.expectedRiskCounts.atRisk, 'Dashboard at-risk count matches');
  assert(dashboard.milestones.upcoming.length === goldenManifestInvariants.expectedApproachingMilestoneIds.length, 'Dashboard upcoming milestones count matches');

  // 8. Grounded Assistant Invariants
  const assistantDelayed = await assistantService.answerQuestion(projectId, 'What is delayed?', {
    asOfDate: GOLDEN_AS_OF_DATE
  });
  assert(assistantDelayed.grounded === true, 'Assistant query "What is delayed?" is grounded');
  assert(assistantDelayed.claims.length > 0, 'Assistant generated factual claims for delayed query');

  const assistantRisk = await assistantService.answerQuestion(projectId, 'Which activities are at risk?', {
    asOfDate: GOLDEN_AS_OF_DATE
  });
  assert(assistantRisk.grounded === true, 'Assistant query "Which activities are at risk?" is grounded');

  const assistantTank = await assistantService.answerQuestion(projectId, 'Tell me about the crude pump foundation', {
    asOfDate: GOLDEN_AS_OF_DATE
  });
  assert(assistantTank.resolvedActivity !== null || assistantTank.grounded === true, 'Assistant resolves crude pump query to project state');

  // 9. Physical Evidence & Filesystem Invariants
  const evidenceList = evidenceRepository.listByProjectId(projectId);
  assert(evidenceList.length === goldenManifestInvariants.expectedEvidenceFileNames.length, `Expected ${goldenManifestInvariants.expectedEvidenceFileNames.length} evidence items, found ${evidenceList.length}`);

  for (const ev of evidenceList) {
    const fullDiskPath = path.resolve(process.cwd(), 'uploads', ev.filePath);
    assert(fs.existsSync(fullDiskPath), `Physical evidence file exists on disk: ${ev.fileName}`);
  }

  console.log('====================================================');
  if (failures.length === 0) {
    console.log(`🎉 ALL ${checksCount} GOLDEN DEMO VERIFICATION CHECKS PASSED!`);
    console.log('====================================================');
    return { passed: true, checksCount, failures: [] };
  } else {
    console.error(`❌ ${failures.length} VERIFICATION CHECKS FAILED!`);
    console.log('====================================================');
    return { passed: false, checksCount, failures };
  }
}

// Auto-run when executed directly via CLI
if (process.argv[1] && (process.argv[1].endsWith('demo-verify.ts') || process.argv[1].endsWith('demo-verify.js'))) {
  initDatabase();
  verifyGoldenDemoEnvironment()
    .then((result) => {
      if (!result.passed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Verification script crashed with error:', err);
      process.exit(1);
    });
}
