import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { ProgressService, DefaultProgressService } from '../src/services/progress/progress.service.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('Phase 24 — ML Pipeline End-to-End Integration Vitest Suite', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;

  let matchingService: ActivityMatchingService;
  let progressService: ProgressService;

  let projectId: string;
  let scheduleId: string;
  let pumpActivityId: string;
  let tankActivityId: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    updateRepo = new SqliteProgressUpdateRepository(() => db);
    matchRepo = new SqliteActivityMatchRepository(() => db);
    progressRepo = new SqliteActivityProgressRepository(() => db);
    eventRepo = new SqliteProjectEventRepository(() => db);

    const project = projectRepo.create({
      name: 'Refinery Expansion Unit 4',
      code: 'REF-U4',
      status: 'active'
    });
    projectId = project.id;

    const schedule = scheduleRepo.create({
      projectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    scheduleId = schedule.id;

    const act1 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-B02',
      name: 'Crude Pump Foundation Piling Works',
      description: 'Piling and foundations for Area B crude pumps',
      location: 'Area B',
      wbsCode: 'REF-U4-B02',
      plannedStart: '2026-02-01',
      plannedFinish: '2026-03-30',
      baselineProgress: 0
    });
    pumpActivityId = act1.id;

    const act2 = activityRepo.create({
      projectId,
      scheduleId,
      externalId: 'ACT-B01',
      name: 'North Tank Farm Excavation',
      description: 'Excavation works at North Tank Farm Area B',
      location: 'Area B',
      wbsCode: 'REF-U4-B01',
      plannedStart: '2026-01-15',
      plannedFinish: '2026-02-28',
      baselineProgress: 0
    });
    tankActivityId = act2.id;

    // Record initial prior canonical progress observation: 65% on 2026-03-01
    progressRepo.create({
      projectId,
      activityId: pumpActivityId,
      progressUpdateId: null,
      actualPercent: 65,
      actualQuantity: null,
      actualStart: '2026-02-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-03-01',
      notes: 'Standard progress'
    });

    matchingService = new ActivityMatchingService({
      activityRepo,
      activityMatchRepo: matchRepo,
      progressUpdateRepo: updateRepo,
      activityProgressRepo: progressRepo,
      projectRepo,
      projectEventRepo: eventRepo
    });

    progressService = new DefaultProgressService({
      projectRepo,
      activityProgressRepo: progressRepo,
      activityMatchRepo: matchRepo,
      activityRepo,
      progressUpdateRepo: updateRepo
    });
  });

  afterEach(() => {
    db.close();
  });

  it('Pipeline Flow: Ingestion -> Match Reranking -> Pre-Review Anomaly Warning -> Review -> Canonical Normalization', async () => {
    // 1. Ingestion: Worker submits progress report on 2026-03-02 reporting a jump to 98%
    const updateRecord = updateRepo.create({
      projectId,
      reportDate: '2026-03-02',
      sourceType: 'text',
      rawText: 'Crude pump foundation piling jumped to 98% complete today',
      reporterName: 'Field Inspector',
      reporterRole: 'inspector'
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Piling work at Area B',
          location: 'Area B',
          progress_percent: 98,
          status: 'in_progress'
        }
      ]
    };

    // 2. Matching Engine & Advisory Persistence:
    const matchReport = await matchingService.matchProgressUpdate(
      projectId,
      updateRecord.id,
      extraction,
      { persist: true }
    );

    expect(matchReport.matches).toHaveLength(1);
    const result = matchReport.matches[0];
    expect(result.bestMatch).not.toBeNull();
    expect(result.bestMatch?.activityExternalId).toBe('ACT-B02');

    // Verify Match Model advisory confidence
    expect(result.bestMatch?.mlConfidence).toBeDefined();
    expect(typeof result.bestMatch?.mlConfidence).toBe('number');
    expect(result.bestMatch?.mlConfidence).toBeGreaterThan(0.70);

    // Verify Pre-Review Anomaly Warning was calculated
    expect(result.bestMatch?.anomaly).toBeDefined();
    expect(result.bestMatch?.anomalyScore).toBeGreaterThanOrEqual(0.75);
    expect(result.bestMatch?.anomalySeverity).toBe('high');
    expect(result.bestMatch?.anomalyReasons?.length).toBeGreaterThan(0);

    // Verify Dual-Threshold Auto-Confirm Gate held the candidate in review
    // (non-exact match requires supervisor confirmation)
    expect(result.bestMatch?.matchMethod).not.toBe('exact_id');
    const persistedMatches = matchRepo.listByProgressUpdateId(updateRecord.id, projectId);
    expect(persistedMatches).toHaveLength(1);
    const persistedMatch = persistedMatches[0];
    expect(persistedMatch.status).toBe('suggested');
    expect(persistedMatch.reviewState).toBe('awaiting_review');

    // Persisted advisory columns check
    expect(persistedMatch.mlConfidence).toBeCloseTo(result.bestMatch!.mlConfidence!, 4);
    expect(persistedMatch.anomalyScore).toBeCloseTo(result.bestMatch!.anomalyScore!, 2);
    expect(persistedMatch.anomalySeverity).toBe('high');
    expect(persistedMatch.anomalyReasons).toEqual(result.bestMatch?.anomalyReasons);

    // CRITICAL CANONICAL BOUNDARY CHECK:
    // activity_progress must NOT have been mutated prior to supervisor confirmation!
    const observationsBeforeConfirmation = progressRepo.listByActivityId(pumpActivityId, projectId);
    expect(observationsBeforeConfirmation).toHaveLength(1);
    expect(observationsBeforeConfirmation[0].actualPercent).toBe(65);
    expect(observationsBeforeConfirmation[0].asOfDate).toBe('2026-03-01');

    // 3. Human Review: Supervisor confirms the match
    const confirmedMatch = await matchingService.confirmMatch(
      projectId,
      persistedMatch.id,
      'admin-supervisor'
    );
    expect(confirmedMatch.status).toBe('confirmed');
    expect(confirmedMatch.reviewState).toBe('resolved');

    // 4. Canonical Normalization: Progress is recorded deterministically
    const canonicalProgress = progressService.normalizeAndRecordProgress({
      projectId,
      updateId: updateRecord.id,
      matchId: confirmedMatch.id,
      fact: {
        reference: 'Pump foundation piles',
        location: null,
        progress_percent: 98,
        status: 'in_progress'
      },
      asOfDate: '2026-03-02'
    });

    expect(canonicalProgress.actualPercent).toBe(98);
    expect(canonicalProgress.asOfDate).toBe('2026-03-02');

    // Verify activity_progress now contains exactly 2 records with true historical integrity (newest first)
    const observationsAfterConfirmation = progressRepo.listByActivityId(pumpActivityId, projectId);
    expect(observationsAfterConfirmation).toHaveLength(2);
    expect(observationsAfterConfirmation[0].actualPercent).toBe(98);
    expect(observationsAfterConfirmation[1].actualPercent).toBe(65);

    // Verify canonical progress contains pure domain data (no ML score pollution)
    expect((canonicalProgress as any).mlConfidence).toBeUndefined();
    expect((canonicalProgress as any).anomalyScore).toBeUndefined();
  });
});
