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
import { AnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { MatchModelService } from '../src/ml/match/match-model.service.js';
import { AnomalyModelArtifact, MatchModelArtifact, ANOMALY_FEATURE_NAMES, MATCH_FEATURE_NAMES } from '../src/ml/types.js';
import { CreateActivityInput, Activity } from '../src/models/domain.types.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('Phase 11 & 18 — Pre-Review Ingestion Integration & Match Explainability', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;
  let progressRepo: SqliteActivityProgressRepository;
  let eventRepo: SqliteProjectEventRepository;

  let testProjectId: string;
  let testScheduleId: string;
  let testUpdateId: string;

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
    testProjectId = project.id;

    const schedule = scheduleRepo.create({
      projectId: testProjectId,
      name: 'Baseline Schedule',
      sourceType: 'csv'
    });
    testScheduleId = schedule.id;

    const update = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-25',
      reporterName: 'Field Inspector',
      sourceType: 'text',
      rawText: 'Daily field observation report'
    });
    testUpdateId = update.id;
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  function createActivity(data: Partial<CreateActivityInput> & { externalId: string; name: string }): Activity {
    return activityRepo.create({
      projectId: testProjectId,
      scheduleId: testScheduleId,
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30',
      ...data
    });
  }

  it('1. Phase 11: Match output exposes full provenance (deterministicScore, mlConfidence, finalScore, rationale)', async () => {
    createActivity({
      externalId: 'ACT-B02',
      name: 'Crude Pump Foundation Piling Works',
      description: 'Piling works for foundation Block B',
      location: 'Area B'
    });

    const dummyMatchArtifact: MatchModelArtifact = {
      modelType: 'logistic_regression',
      version: '1.0.0',
      featureNames: [...MATCH_FEATURE_NAMES],
      means: [0, 0, 0, 0, 0, 0, 0, 0],
      stds: [1, 1, 1, 1, 1, 1, 1, 1],
      weights: [1, 1, 1, 1, 1, 1, 1, 1],
      bias: 0,
      threshold: 0.5
    };
    const matchService = new MatchModelService({ artifact: dummyMatchArtifact, strict: true });
    matchService.predict = () => 0.94;

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo,
      matchModelService: matchService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Crude Pump Foundation Piling Works',
          location: 'Area B',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction, { asOfDate: '2026-08-20' });
    expect(results).toHaveLength(1);
    const best = results[0].bestMatch;
    expect(best).not.toBeNull();

    // Verify Phase 11 provenance fields
    expect(best?.deterministicScore).toBeDefined();
    expect(best?.deterministicScore).toBe(best?.confidenceScore);
    expect(best?.mlConfidence).toBe(0.94);
    expect(best?.finalScore).toBeDefined();
    expect(best?.rationale).toContain('Learned ML confidence: 94%');
    expect(best?.activityExternalId).toBe('ACT-B02');
  });

  it('2. Phase 18: Evaluates candidates before confirmation and attaches anomaly prediction', async () => {
    const act = createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30'
    });

    // Seed prior canonical progress observation at 48% on 2026-08-15 (day 14 of 29 = 48.3% planned)
    progressRepo.create({
      projectId: testProjectId,
      activityId: act.id,
      actualPercent: 48,
      actualQuantity: null,
      asOfDate: '2026-08-15',
      status: 'in_progress'
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    // Report reports 65% on 2026-08-20 (day 19 of 29 = 65.5% planned; delta 17%, velocity 3.4%/day, variance 0% -> normal)
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Site Clearing',
          location: null,
          progress_percent: 65,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction, { asOfDate: '2026-08-20' });
    expect(results).toHaveLength(1);
    const best = results[0].bestMatch;
    expect(best).not.toBeNull();
    expect(best?.anomaly).toBeDefined();
    expect(best?.anomaly?.anomalyScore).toBeDefined();
    expect(best?.anomaly?.severity).toBe('normal');
    expect(best?.anomaly?.reviewRecommended).toBe(false);
  });


  it('3. Invariant: Current unconfirmed report does NOT mutate activity_progress during matching', async () => {
    const act = createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30'
    });

    const initialObservations = progressRepo.listByActivityId(act.id);
    expect(initialObservations).toHaveLength(0);

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Unit 4 Site Clearing & Grubbing',
          location: null,
          progress_percent: 75,
          status: 'in_progress'
        }
      ]
    };

    // Run matching with persistence enabled for matches
    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    // CRITICAL CANONICAL TRUTH INVARIANT:
    // Unconfirmed matching MUST NOT insert records into activity_progress table!
    const postObservations = progressRepo.listByActivityId(act.id);
    expect(postObservations).toHaveLength(0);
  });

  it('4. Candidate-Specific Anomaly Handling: Different candidates use their own history and planned progress', async () => {
    // Activity 1: Foundation Piling (prior observation = 80%)
    const act1 = createActivity({
      externalId: 'ACT-B02',
      name: 'Crude Pump Foundation Piling',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-20',
      location: 'Area B'
    });
    progressRepo.create({
      projectId: testProjectId,
      activityId: act1.id,
      actualPercent: 80,
      asOfDate: '2026-08-18',
      status: 'in_progress'
    });

    // Activity 2: Rough Grading (starts Aug 10, finishes Aug 30, total 20 days)
    const act2 = createActivity({
      externalId: 'ACT-A02',
      name: 'Crude Pump Rough Grading',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-30',
      location: 'Area B'
    });
    // On Aug 18 (day 8 of 20 = 40% planned), prior observation is 40%
    progressRepo.create({
      projectId: testProjectId,
      activityId: act2.id,
      actualPercent: 40,
      asOfDate: '2026-08-18',
      status: 'in_progress'
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    // An update reporting 50% on 2026-08-20:
    // For act1 (80% -> 50%): this is a severe regression (-30% drop)!
    // For act2 (40% -> 50%): this is a normal pacing transition (+10% over 2 days, 50% planned as of Aug 20)!
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Crude Pump Foundation',
          location: 'Area B',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };


    const results = await service.computeMatches(testProjectId, extraction, { asOfDate: '2026-08-20' });
    expect(results).toHaveLength(1);
    const candidates = [results[0].bestMatch!, ...results[0].alternatives];

    const matchAct1 = candidates.find(c => c.activityId === act1.id);
    const matchAct2 = candidates.find(c => c.activityId === act2.id);

    expect(matchAct1).toBeDefined();
    expect(matchAct2).toBeDefined();

    // Candidate 1 (ACT-B02, 80% -> 25%) should be flagged with high anomaly score due to regression
    expect(matchAct1?.anomaly).toBeDefined();
    expect(matchAct1?.anomaly?.severity).toBe('high');
    expect(matchAct1?.anomaly?.reviewRecommended).toBe(true);

    // Candidate 2 (ACT-A02, 20% -> 25%) should have normal severity
    expect(matchAct2?.anomaly).toBeDefined();
    expect(matchAct2?.anomaly?.severity).toBe('normal');
    expect(matchAct2?.anomaly?.reviewRecommended).toBe(false);
  });

  it('5. Safe Cold Start: Candidate with missing prior history produces safe cold-start result without fabricating history', async () => {
    createActivity({
      externalId: 'ACT-C01',
      name: 'Pipe Rack Structural Steel',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-30'
    });

    // Zero prior observations seeded
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Pipe Rack Structural Steel',
          location: null,
          progress_percent: 30,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction, { asOfDate: '2026-08-15' });
    const best = results[0].bestMatch;
    expect(best).not.toBeNull();

    // Safe cold-start contract
    expect(best?.anomaly).toBeDefined();
    expect(best?.anomaly?.anomalyScore).toBe(0.0);
    expect(best?.anomaly?.severity).toBe('normal');
    expect(best?.anomaly?.reviewRecommended).toBe(false);
    expect(best?.anomaly?.reasons).toEqual([]);
  });

  it('6. Candidate with null progress_percent does not receive anomaly prediction', async () => {
    createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing'
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      activityProgressRepo: progressRepo
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Unit 4 Site Clearing & Grubbing',
          location: null,
          progress_percent: null,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction, { asOfDate: '2026-08-15' });
    const best = results[0].bestMatch;
    expect(best).not.toBeNull();
    expect(best?.anomaly).toBeUndefined();
  });

  it('7. Emits anomaly prediction inside audit event payloadJson when persisted', async () => {
    const act = createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-30'
    });

    // Prior observation 14% on 2026-08-05 (day 4 of 29 = 13.8% planned)
    progressRepo.create({
      projectId: testProjectId,
      activityId: act.id,
      actualPercent: 14,
      asOfDate: '2026-08-05',
      status: 'in_progress'
    });

    const update8 = updateRepo.create({
      projectId: testProjectId,
      reportDate: '2026-08-08',
      reporterName: 'Field Inspector',
      sourceType: 'text',
      rawText: 'Daily field observation report for Aug 8'
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      projectEventRepo: eventRepo,
      activityProgressRepo: progressRepo
    });

    // Report reports 24% on 2026-08-08 (day 7 of 29 = 24.1% planned; delta 10% over 3 days, variance ~0%)
    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Unit 4 Site Clearing & Grubbing',
          location: null,
          progress_percent: 24,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProjectId, update8.id, extraction);
    expect(report.matches[0].bestMatch?.anomaly).toBeDefined();

    // Check emitted events
    const events = eventRepo.listByProjectId(testProjectId);
    expect(events.length).toBeGreaterThan(0);
    const matchEvent = events.find(e => e.entityType === 'activity_matches');
    expect(matchEvent).toBeDefined();

    const payload = JSON.parse(matchEvent!.payloadJson || '{}');
    expect(payload.anomaly).toBeDefined();
    expect(payload.anomaly.severity).toBe('normal');

  });
});
