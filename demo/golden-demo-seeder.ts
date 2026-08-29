import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { projectRepository } from '../backend/src/repositories/project.repository.js';
import { scheduleImportService } from '../backend/src/services/schedule-import.service.js';
import { activityRepository } from '../backend/src/repositories/activity.repository.js';
import { evidenceService } from '../backend/src/services/evidence/evidence.service.js';
import { evidenceRepository } from '../backend/src/repositories/evidence.repository.js';
import { progressUpdateRepository } from '../backend/src/repositories/progress-update.repository.js';
import { activityMatchRepository } from '../backend/src/repositories/activity-match.repository.js';
import { progressService } from '../backend/src/services/progress/progress.service.js';
import { projectEventRepository } from '../backend/src/repositories/project-event.repository.js';
import {
  goldenProjectManifest,
  goldenManifestInvariants
} from './golden-demo-manifest.js';
import { logger } from '../backend/src/config/logger.js';
import { env } from '../backend/src/config/env.js';

export interface SeedGoldenDemoResult {
  projectId: string;
  projectCode: string;
  projectName: string;
  scheduleId: string;
  activitiesCount: number;
  evidenceCount: number;
  progressReportsCount: number;
  canonicalObservationsCount: number;
  asOfDate: string;
}

export async function seedGoldenDemo(): Promise<SeedGoldenDemoResult> {
  const rootDir = process.cwd();
  const demoFixturesDir = path.resolve(rootDir, 'demo/fixtures');
  const schedulesFixtureDir = path.join(demoFixturesDir, 'schedules');
  const evidenceFixtureDir = path.join(demoFixturesDir, 'evidence');

  logger.info('====================================================');
  logger.info('🏭 Seeding Golden Demo Project: Refinery Expansion — Unit 4');
  logger.info('====================================================');

  // 1. Check or Create Golden Project (Idempotency)
  let project = projectRepository.getByCode(goldenProjectManifest.code);
  if (!project) {
    project = projectRepository.create({
      name: goldenProjectManifest.name,
      code: goldenProjectManifest.code,
      description: goldenProjectManifest.description,
      status: 'active',
      startDate: '2026-08-01',
      targetEndDate: '2026-09-30'
    });
    logger.info(`✅ Created Golden Demo Project: [${project.code}] ${project.name} (${project.id})`);
  } else {
    logger.info(`ℹ️ Found existing Golden Demo Project: [${project.code}] (${project.id})`);
  }
  const projectId = project.id;

  // 2. Import Canonical 30-Activity Schedule
  const scheduleCsvPath = path.join(schedulesFixtureDir, 'refinery_unit4_schedule.csv');
  if (!fs.existsSync(scheduleCsvPath)) {
    throw new Error(`Schedule fixture missing at: ${scheduleCsvPath}`);
  }

  // Create temporary copy for importService to process (as it cleans up the source file)
  const tempImportPath = path.resolve(rootDir, `temp-golden-schedule-${Date.now()}.csv`);
  fs.copyFileSync(scheduleCsvPath, tempImportPath);

  const importSummary = await scheduleImportService.importSchedule(projectId, {
    path: tempImportPath,
    originalname: 'refinery_unit4_schedule.csv',
    mimetype: 'text/csv'
  });

  const scheduleId = importSummary.schedule.id;
  logger.info(`✅ Imported canonical schedule: ${importSummary.schedule.name} (${importSummary.activitiesImported} activities)`);

  // Map activities by externalId
  const activities = activityRepository.listByProjectId(projectId);
  const actMap = new Map(activities.map((a) => [a.externalId, a]));

  // 3. Upload Physical Evidence Files
  const evidenceFiles = goldenManifestInvariants.expectedEvidenceFileNames;
  const evidenceMap = new Map<string, any>();

  for (const fileName of evidenceFiles) {
    const fixtureFilePath = path.join(evidenceFixtureDir, fileName);
    if (!fs.existsSync(fixtureFilePath)) {
      throw new Error(`Evidence fixture missing at: ${fixtureFilePath}`);
    }

    // Temporary upload copy so original fixture is preserved
    const tempUploadPath = path.resolve(rootDir, `temp-evidence-${Date.now()}-${fileName}`);
    fs.copyFileSync(fixtureFilePath, tempUploadPath);

    const ext = path.extname(fileName).toLowerCase();
    const mime = ext === '.csv' ? 'text/csv' : 'text/plain';

    const uploaded = await evidenceService.uploadEvidence(projectId, {
      path: tempUploadPath,
      originalname: fileName,
      mimetype: mime,
      size: fs.statSync(fixtureFilePath).size
    });

    evidenceMap.set(fileName, uploaded);
    logger.info(`📎 Stored physical evidence: ${fileName} -> ID: ${uploaded.id}`);
  }

  // 4. Seed Multi-Date Progress Reports, Matches, Human Reviews & Canonical Progress
  let totalObservations = 0;

  // =========================================================================
  // Report 1: 2026-08-14 (D-14) — Initial Site Earthworks & Piling Kickoff
  // =========================================================================
  const ev14 = evidenceMap.get('daily_site_report_2026-08-14.txt');
  const report14 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-14',
    reporterName: 'Senior Site Engineer (Civil & Earthworks)',
    reporterRole: 'Civil Superintendent',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'daily_site_report_2026-08-14.txt'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev14.id, report14.id, projectId);

  const observations14 = [
    { extId: 'ACT-A01', percent: 100, status: 'completed' as const, ref: 'Unit 4 Site Clearing & Grubbing' },
    { extId: 'ACT-A02', percent: 30, status: 'in_progress' as const, ref: 'Rough grading and terracing at Area A' },
    { extId: 'ACT-B01', percent: 60, status: 'in_progress' as const, ref: 'North Tank Farm Foundation Excavation' },
    { extId: 'ACT-B02', percent: 20, status: 'in_progress' as const, ref: 'Crude Pump Foundation Piling Works' },
    { extId: 'ACT-C01', percent: 15, status: 'in_progress' as const, ref: 'Pipe Rack PR-07 Structural Steel Erection' }
  ];

  for (const obs of observations14) {
    const act = actMap.get(obs.extId)!;
    const match = activityMatchRepository.create({
      projectId,
      progressUpdateId: report14.id,
      evidenceId: ev14.id,
      activityId: act.id,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      matchedText: obs.ref,
      rationale: `Direct canonical match with ${act.name}`,
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-14T18:00:00.000Z'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId: report14.id,
      matchId: match.id,
      fact: {
        reference: obs.ref,
        location: act.location,
        progress_percent: obs.percent,
        status: obs.status
      },
      asOfDate: '2026-08-14'
    });
    totalObservations++;
  }

  // =========================================================================
  // Report 2: 2026-08-18 (D-10) — Tank Foundation & Civil Milestones
  // =========================================================================
  const ev18 = evidenceMap.get('daily_site_report_2026-08-18.txt');
  const report18 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-18',
    reporterName: 'Area Superintendent',
    reporterRole: 'Site Construction Lead',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'daily_site_report_2026-08-18.txt'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev18.id, report18.id, projectId);

  const observations18 = [
    { extId: 'ACT-B01', percent: 100, status: 'completed' as const, ref: 'North Tank Farm Foundation Excavation' },
    { extId: 'ACT-B02', percent: 38, status: 'in_progress' as const, ref: 'Crude Pump Foundation Piling Works' },
    { extId: 'ACT-D01', percent: 100, status: 'completed' as const, ref: 'Cooling Water Underground Header Installation' },
    { extId: 'ACT-E01', percent: 100, status: 'completed' as const, ref: 'Electrical Substation Civil & Trenching Works' },
    { extId: 'ACT-E02', percent: 25, status: 'in_progress' as const, ref: 'MCC Room Cable Tray Installation & Earthing' }
  ];

  for (const obs of observations18) {
    const act = actMap.get(obs.extId)!;
    const match = activityMatchRepository.create({
      projectId,
      progressUpdateId: report18.id,
      evidenceId: ev18.id,
      activityId: act.id,
      confidenceScore: 0.96,
      matchMethod: 'exact_id',
      matchedText: obs.ref,
      rationale: `Matched ${act.name}`,
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-18T18:00:00.000Z'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId: report18.id,
      matchId: match.id,
      fact: {
        reference: obs.ref,
        location: act.location,
        progress_percent: obs.percent,
        status: obs.status
      },
      asOfDate: '2026-08-18'
    });
    totalObservations++;
  }

  // =========================================================================
  // Report 3: 2026-08-21 (D-7) — Mid-Month Area A & B Progress CSV Update
  // =========================================================================
  const ev21 = evidenceMap.get('civil_progress_update_2026-08-21.csv');
  const report21 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-21',
    reporterName: 'Document Ingestion: civil_progress_update_2026-08-21.csv',
    reporterRole: 'Automated CSV Ingestion',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'civil_progress_update_2026-08-21.csv'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev21.id, report21.id, projectId);

  const observations21 = [
    { extId: 'ACT-A02', percent: 50, status: 'in_progress' as const, ref: 'Unit 4 Site Rough Grading & Terracing' },
    { extId: 'ACT-B02', percent: 52, status: 'in_progress' as const, ref: 'Crude Pump Foundation Piling Works' },
    { extId: 'ACT-C01', percent: 31, status: 'in_progress' as const, ref: 'Pipe Rack PR-07 Structural Steel Erection' },
    { extId: 'ACT-B03', percent: 40, status: 'in_progress' as const, ref: 'Substation Heavy Equipment Mat Foundation' },
    { extId: 'ACT-A03', percent: 45, status: 'in_progress' as const, ref: 'Stormwater Retention Basin Excavation' },
    { extId: 'ACT-A04', percent: 35, status: 'in_progress' as const, ref: 'Perimeter Access Road Sub-base Compaction' }
  ];

  for (const obs of observations21) {
    const act = actMap.get(obs.extId)!;
    const match = activityMatchRepository.create({
      projectId,
      progressUpdateId: report21.id,
      evidenceId: ev21.id,
      activityId: act.id,
      confidenceScore: 0.94,
      matchMethod: 'text_similarity',
      matchedText: obs.ref,
      rationale: `CSV structured row matched ${act.name}`,
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-21T18:00:00.000Z'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId: report21.id,
      matchId: match.id,
      fact: {
        reference: obs.ref,
        location: act.location,
        progress_percent: obs.percent,
        status: obs.status
      },
      asOfDate: '2026-08-21'
    });
    totalObservations++;
  }

  // =========================================================================
  // Report 4: 2026-08-24 (D-4) — Weekly Report with Rich Review Scenarios
  // =========================================================================
  const ev24 = evidenceMap.get('weekly_execution_report_2026-08-24.txt');
  const report24 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-24',
    reporterName: 'Resident Construction Manager',
    reporterRole: 'Construction Lead',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'weekly_execution_report_2026-08-24.txt'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev24.id, report24.id, projectId);

  // 4a. Confirmed Observations
  const observations24 = [
    { extId: 'ACT-D02', percent: 50, status: 'in_progress' as const, ref: 'Process Pipe Rack Carbon Steel Spooling' },
    { extId: 'ACT-B03', percent: 55, status: 'in_progress' as const, ref: 'Substation Heavy Equipment Mat Foundation' },
    { extId: 'ACT-E02', percent: 48, status: 'in_progress' as const, ref: 'MCC Room Cable Tray Installation & Earthing' },
    { extId: 'ACT-C02', percent: 35, status: 'in_progress' as const, ref: 'Main Pipe Bridge Column Splice & Bolting' },
    { extId: 'ACT-B04', percent: 30, status: 'in_progress' as const, ref: 'Compressor House Deep Foundation Piers' }
  ];

  for (const obs of observations24) {
    const act = actMap.get(obs.extId)!;
    const match = activityMatchRepository.create({
      projectId,
      progressUpdateId: report24.id,
      evidenceId: ev24.id,
      activityId: act.id,
      confidenceScore: 0.92,
      matchMethod: 'text_similarity',
      matchedText: obs.ref,
      rationale: `Matched ${act.name}`,
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-24T18:00:00.000Z'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId: report24.id,
      matchId: match.id,
      fact: {
        reference: obs.ref,
        location: act.location,
        progress_percent: obs.percent,
        status: obs.status
      },
      asOfDate: '2026-08-24'
    });
    totalObservations++;
  }

  // 4b. Human Review Scenario 1: DELIBERATE REJECTED MATCH
  // Observation mentions turbine generator foundation (Unit 5), incorrectly candidate-matched to Compressor House
  const actCompressor = actMap.get('ACT-B04')!;
  activityMatchRepository.create({
    projectId,
    progressUpdateId: report24.id,
    evidenceId: ev24.id,
    activityId: actCompressor.id,
    confidenceScore: 0.45,
    matchMethod: 'text_similarity',
    matchedText: 'Gas turbine generator auxiliary concrete pad',
    rationale: 'Low confidence keyword similarity on "concrete pad"',
    status: 'rejected',
    confidenceTier: 'low',
    reviewState: 'unresolved',
    reviewedBy: 'Chief Engineer Davis',
    reviewedAt: '2026-08-24T19:30:00.000Z'
  });

  // 4c. Human Review Scenario 2: SUGGESTED MATCH (AWAITING REVIEW)
  const actFlush = actMap.get('ACT-F01')!;
  activityMatchRepository.create({
    projectId,
    progressUpdateId: report24.id,
    evidenceId: ev24.id,
    activityId: actFlush.id,
    confidenceScore: 0.68,
    matchMethod: 'text_similarity',
    matchedText: 'Underground header flush preparation in progress',
    rationale: 'Medium confidence match on flush preparation activities; awaiting reviewer confirmation.',
    status: 'suggested',
    confidenceTier: 'medium',
    reviewState: 'awaiting_review',
    reviewedBy: null,
    reviewedAt: null
  });

  // 4d. Human Review Scenario 3: MANUALLY RESOLVED MATCH
  const actSteam = actMap.get('ACT-D03')!;
  activityMatchRepository.create({
    projectId,
    progressUpdateId: report24.id,
    evidenceId: ev24.id,
    activityId: actSteam.id,
    confidenceScore: 0.72,
    matchMethod: 'manual',
    matchedText: 'Header installation tie-in welds',
    rationale: 'Ambiguous candidate resolved to High Pressure Steam Header Tie-in Welds by engineer.',
    status: 'confirmed',
    confidenceTier: 'medium',
    reviewState: 'resolved',
    reviewedBy: 'Senior Inspector Martinez',
    reviewedAt: '2026-08-24T19:45:00.000Z'
  });

  // =========================================================================
  // Report 5: 2026-08-27 (D-1) — Comprehensive Multi-Area Site Progress Log
  // =========================================================================
  const ev27 = evidenceMap.get('piping_and_electrical_log_2026-08-27.txt');
  const report27 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-27',
    reporterName: 'Lead Project Field Inspector',
    reporterRole: 'Field Inspection Lead',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'piping_and_electrical_log_2026-08-27.txt'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev27.id, report27.id, projectId);

  const observations27 = [
    // Area A
    { extId: 'ACT-A02', percent: 65, status: 'in_progress' as const, ref: 'Unit 4 Site Rough Grading & Terracing' },
    { extId: 'ACT-A03', percent: 75, status: 'in_progress' as const, ref: 'Stormwater Retention Basin Excavation' },
    { extId: 'ACT-A04', percent: 60, status: 'in_progress' as const, ref: 'Perimeter Access Road Sub-base Compaction' },
    // Area B
    { extId: 'ACT-B02', percent: 65, status: 'in_progress' as const, ref: 'Crude Pump Foundation Piling Works' },
    { extId: 'ACT-B03', percent: 65, status: 'in_progress' as const, ref: 'Substation Heavy Equipment Mat Foundation' },
    { extId: 'ACT-B04', percent: 45, status: 'in_progress' as const, ref: 'Compressor House Deep Foundation Piers' },
    // Area C
    { extId: 'ACT-C01', percent: 50, status: 'in_progress' as const, ref: 'Pipe Rack PR-07 Structural Steel Erection' },
    { extId: 'ACT-C02', percent: 55, status: 'in_progress' as const, ref: 'Main Pipe Bridge Column Splice & Bolting' },
    { extId: 'ACT-C03', percent: 30, status: 'in_progress' as const, ref: 'Compressor Shelter Superstructure Frame' },
    { extId: 'ACT-C04', percent: 35, status: 'in_progress' as const, ref: 'Substation Multi-Tier Cable Support Structure' },
    // Area D
    { extId: 'ACT-D02', percent: 55, status: 'in_progress' as const, ref: 'Process Pipe Rack Carbon Steel Spooling' },
    { extId: 'ACT-D03', percent: 60, status: 'in_progress' as const, ref: 'High Pressure Steam Header Tie-in Welds' },
    { extId: 'ACT-D04', percent: 35, status: 'in_progress' as const, ref: 'Crude Feedstock Line Flange Assembly' },
    { extId: 'ACT-D05', percent: 20, status: 'in_progress' as const, ref: 'Flare Header Stainless Steel Line Welding' },
    // Area E
    { extId: 'ACT-E02', percent: 70, status: 'in_progress' as const, ref: 'MCC Room Cable Tray Installation & Earthing' },
    { extId: 'ACT-E03', percent: 40, status: 'in_progress' as const, ref: 'HV Feeder Cable Pulling Section 1' },
    { extId: 'ACT-E04', percent: 30, status: 'in_progress' as const, ref: 'Instrument Air Header Distribution Tubing' },
    { extId: 'ACT-E05', percent: 15, status: 'in_progress' as const, ref: 'Control Room Marshalling Cabinet Termination' },
    // Area F
    { extId: 'ACT-F01', percent: 70, status: 'in_progress' as const, ref: 'Cooling Water Header Flush & Hydrostatic Test' },
    { extId: 'ACT-F02', percent: 25, status: 'in_progress' as const, ref: 'Unit 4 Hydrotest Package A Pre-Commissioning' },
    { extId: 'ACT-F03', percent: 10, status: 'in_progress' as const, ref: 'Emergency Shutdown Loop Logic Verification' }
  ];

  for (const obs of observations27) {
    const act = actMap.get(obs.extId)!;
    const match = activityMatchRepository.create({
      projectId,
      progressUpdateId: report27.id,
      evidenceId: ev27.id,
      activityId: act.id,
      confidenceScore: 0.95,
      matchMethod: 'exact_id',
      matchedText: obs.ref,
      rationale: `Canonical inspection log matched ${act.name}`,
      status: 'confirmed',
      confidenceTier: 'high',
      reviewState: 'resolved',
      reviewedBy: 'system',
      reviewedAt: '2026-08-27T18:00:00.000Z'
    });

    progressService.normalizeAndRecordProgress({
      projectId,
      updateId: report27.id,
      matchId: match.id,
      fact: {
        reference: obs.ref,
        location: act.location,
        progress_percent: obs.percent,
        status: obs.status
      },
      asOfDate: '2026-08-27'
    });
    totalObservations++;
  }

  // =========================================================================
  // Report 6: 2026-08-28 (D0) — Presentation Audit Memorandum
  // =========================================================================
  const ev28 = evidenceMap.get('site_inspection_note_2026-08-28.txt');
  const report28 = progressUpdateRepository.create({
    projectId,
    reportDate: '2026-08-28',
    reporterName: 'Chief Project Verification Officer',
    reporterRole: 'SIH Presentation Audit Lead',
    sourceType: 'text',
    rawText: fs.readFileSync(path.join(evidenceFixtureDir, 'site_inspection_note_2026-08-28.txt'), 'utf-8'),
    status: 'processed'
  });
  evidenceRepository.attachToProgressUpdate(ev28.id, report28.id, projectId);

  // 5. Emit Audit Project Events
  projectEventRepository.create({
    projectId,
    eventType: 'schedule_imported',
    summary: `Canonical schedule imported: 30 activities across 6 EPC areas`,
    payloadJson: JSON.stringify({ scheduleId, activityCount: 30 })
  });

  projectEventRepository.create({
    projectId,
    eventType: 'progress_recorded',
    summary: `Presentation baseline progress established as of ${goldenManifestInvariants.projectCode} evaluation`,
    payloadJson: JSON.stringify({ observationsCount: totalObservations, asOfDate: '2026-08-28' })
  });

  logger.info(`✨ Golden demo seeding complete! Total canonical progress observations: ${totalObservations}`);

  return {
    projectId,
    projectCode: project.code,
    projectName: project.name,
    scheduleId,
    activitiesCount: activities.length,
    evidenceCount: evidenceFiles.length,
    progressReportsCount: 6,
    canonicalObservationsCount: totalObservations,
    asOfDate: '2026-08-28'
  };
}
