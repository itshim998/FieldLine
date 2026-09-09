import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { MatchModelService } from '../src/ml/match/match-model.service.js';
import { MatchModelArtifact, MATCH_FEATURE_NAMES } from '../src/ml/types.js';
import { CreateActivityInput, Activity } from '../src/models/domain.types.js';
import { FieldProgressExtraction } from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('Phase 10 — Production Match Model Reranking & Strict Auto-Confirm Gate', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let updateRepo: SqliteProgressUpdateRepository;
  let matchRepo: SqliteActivityMatchRepository;

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
      reportDate: '2026-08-28',
      reporterName: 'Field Inspector',
      sourceType: 'manual',
      rawText: 'Progress observation report'
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

  // Mock ML service factory with custom predictions
  function createMockMlService(predictFn: (features: any) => number): MatchModelService {
    const dummyArtifact: MatchModelArtifact = {
      modelType: 'logistic_regression',
      version: '1.0.0',
      featureNames: [...MATCH_FEATURE_NAMES],
      means: [0, 0, 0, 0, 0, 0, 0, 0],
      stds: [1, 1, 1, 1, 1, 1, 1, 1],
      weights: [1, 1, 1, 1, 1, 1, 1, 1],
      bias: 0,
      threshold: 0.5
    };
    const service = new MatchModelService({ artifact: dummyArtifact, strict: true });
    service.predict = predictFn;
    return service;
  }

  it('1 & 2. Deterministic candidate generation still happens and ML is applied to candidates', async () => {
    createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      description: 'Vegetation clearing across footprint',
      location: 'Area A'
    });

    createActivity({
      externalId: 'ACT-A02',
      name: 'Unit 4 Rough Grading & Terracing',
      description: 'Bulk cut and fill earthmoving',
      location: 'Area A'
    });

    const mlService = createMockMlService(() => 0.88);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Site clearing completed',
          location: 'Area A',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    expect(results).toHaveLength(1);
    const best = results[0].bestMatch;
    expect(best).not.toBeNull();
    // Candidate generation produced candidates
    expect(best?.activityExternalId).toBe('ACT-A01');
    expect(best?.confidenceScore).toBeGreaterThan(0.4);
    // ML attached mlConfidence and finalScore
    expect(best?.mlConfidence).toBe(0.88);
    expect(best?.finalScore).toBeDefined();
    expect(best?.scoreGap).toBeDefined();
  });

  it('3. Final score uses the required 0.4 / 0.6 formula for non-exact candidates', async () => {
    createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      description: 'Vegetation clearing',
      location: 'Area A'
    });

    // Mock ML to return exactly 0.90
    const mlConfidence = 0.90;
    const mlService = createMockMlService(() => mlConfidence);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Site clearing',
          location: 'Area A',
          progress_percent: 40,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const best = results[0].bestMatch!;
    expect(best.matchMethod).not.toBe('exact_id');

    // Verify 0.4 * det + 0.6 * ml
    const detScore = best.confidenceScore;
    const expectedFinal = Math.round((detScore * 0.4 + mlConfidence * 0.6) * 1000) / 1000;
    expect(best.finalScore).toBe(expectedFinal);
  });

  it('4. Exact-ID candidates retain deterministic exact-ID behavior and are not overridden by ML', async () => {
    createActivity({
      externalId: 'ACT-A01',
      name: 'Unit 4 Site Clearing & Grubbing',
      location: 'Area A'
    });

    // Even if ML returns a low confidence (0.10), exact-ID retains deterministic score (0.99)
    const mlService = createMockMlService(() => 0.10);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'ACT-A01',
          location: 'Area A',
          progress_percent: 100,
          status: 'completed'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const best = results[0].bestMatch!;
    expect(best.matchMethod).toBe('exact_id');
    expect(best.confidenceScore).toBe(0.99);
    // Final score must equal deterministic exact-ID score, not 0.4 * 0.99 + 0.6 * 0.10
    expect(best.finalScore).toBe(0.99);
    // Exact ID preserves deterministic auto-confirm
    expect(results[0].reviewDecision?.autoConfirm).toBe(true);
    expect(results[0].reviewDecision?.reviewState).toBe('resolved');
  });

  it('5. Candidate reranking occurs after ML scoring', async () => {
    // Create two activities where Activity A has slightly higher deterministic score,
    // but Activity B gets a significantly higher ML score, flipping the ranking order!
    createActivity({
      externalId: 'ACT-A',
      name: 'Piping Spooling Header A',
      location: 'Area A'
    });

    createActivity({
      externalId: 'ACT-B',
      name: 'Piping Spooling Header B',
      location: 'Area A'
    });

    const mlService = createMockMlService((features) => {
      // Discriminate based on name similarity or feature
      const nameSim = Array.isArray(features) ? features[0] : features.name_similarity;
      return nameSim > 0.6 ? 0.99 : 0.10;
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Piping Spooling Header A',
          location: 'Area A',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    expect(results[0].bestMatch).not.toBeNull();
    // Candidates are sorted descending by finalScore
    const all = [results[0].bestMatch!, ...results[0].alternatives];
    for (let i = 0; i < all.length - 1; i++) {
      expect((all[i].finalScore ?? all[i].confidenceScore)).toBeGreaterThanOrEqual(
        (all[i + 1].finalScore ?? all[i + 1].confidenceScore)
      );
    }
  });

  it('6 & 7. Candidate rank is never used and score gap comes from deterministic candidate scores', async () => {
    createActivity({
      externalId: 'ACT-01',
      name: 'Excavation Trench 1',
      location: 'Area A'
    });

    createActivity({
      externalId: 'ACT-02',
      name: 'Excavation Trench 2',
      location: 'Area A'
    });

    let observedScoreGaps: number[] = [];

    const mlService = createMockMlService((features) => {
      const gap = Array.isArray(features) ? features[7] : features.score_gap_from_second_candidate;
      observedScoreGaps.push(gap);
      return 0.88;
    });

    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Excavation Trench 1',
          location: 'Area A',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    expect(results[0].bestMatch).not.toBeNull();
    // Check that observed score gap was deterministic separation >= 0
    expect(observedScoreGaps.length).toBeGreaterThanOrEqual(2);
    expect(observedScoreGaps[0]).toBeGreaterThanOrEqual(0);
    // For candidate #2, competitor is candidate #1, so gap is 0.0
    expect(observedScoreGaps[1]).toBe(0.0);
  });

  it('8. ML confidence alone cannot auto-confirm (fails when deterministic score < 0.90)', async () => {
    createActivity({
      externalId: 'ACT-C01',
      name: 'Structural Steel Erection Phase 1',
      location: 'Area C'
    });

    // ML confidence is very high (0.98), but deterministic score is around ~0.70
    const mlService = createMockMlService(() => 0.98);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Steel erection work',
          location: 'Area C',
          progress_percent: 30,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const match = results[0];
    expect(match.bestMatch?.confidenceScore).toBeLessThan(0.90);
    expect(match.bestMatch?.mlConfidence).toBe(0.98);

    // Auto-confirm MUST be false because deterministic score < 0.90
    expect(match.reviewDecision?.autoConfirm).toBe(false);
    expect(match.reviewDecision?.reviewState).toBe('awaiting_review');
  });

  it('9. Deterministic score alone cannot auto-confirm (fails when ML confidence < 0.85)', async () => {
    createActivity({
      externalId: 'ACT-D01',
      name: 'Foundation Excavation Trench',
      location: 'Block B',
      wbsCode: '3.1'
    });

    // Deterministic score will be high (~0.95), but ML confidence is mediocre (0.75 < 0.85)
    const mlService = createMockMlService(() => 0.75);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Excavation Trench',
          location: 'Block B',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const match = results[0];
    expect(match.bestMatch?.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(match.bestMatch?.mlConfidence).toBe(0.75);

    // Auto-confirm MUST be false because mlConfidence < 0.85
    expect(match.reviewDecision?.autoConfirm).toBe(false);
    expect(match.reviewDecision?.reviewState).toBe('awaiting_review');
    expect(match.confidenceTier).toBe('medium');
  });

  it('10. Score gap < 0.15 cannot auto-confirm (ambiguous runner-up)', async () => {
    // Two very similar activities creating a score gap < 0.15
    createActivity({
      externalId: 'ACT-E01',
      name: 'Foundation Excavation Trench A',
      location: 'Block B'
    });

    createActivity({
      externalId: 'ACT-E02',
      name: 'Foundation Excavation Trench B',
      location: 'Block B'
    });

    // Even if ML returns high confidence (0.95), runner-up is too close deterministically
    const mlService = createMockMlService(() => 0.95);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Excavation Trench',
          location: 'Block B',
          progress_percent: 50,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const match = results[0];
    // Deterministic scores are very close: gap < 0.15
    expect(match.bestMatch?.scoreGap).toBeLessThan(0.15);

    // Auto-confirm MUST be false because scoreGap < 0.15
    expect(match.reviewDecision?.autoConfirm).toBe(false);
    expect(match.reviewDecision?.reviewState).toBe('awaiting_review');
  });

  it('11. All three non-exact conditions pass -> auto-confirms successfully', async () => {
    createActivity({
      externalId: 'ACT-F01',
      name: 'Foundation Excavation Trench A',
      location: 'Block B'
    });

    createActivity({
      externalId: 'ACT-F02',
      name: 'Unrelated Electrical Transformer',
      location: 'Substation'
    });

    // 1. s_det >= 0.90
    // 2. p_ml >= 0.85
    // 3. scoreGap >= 0.15
    const mlService = createMockMlService(() => 0.92);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Excavation Trench A',
          location: 'Block B',
          progress_percent: 75,
          status: 'in_progress'
        }
      ]
    };

    const results = await service.computeMatches(testProjectId, extraction);
    const match = results[0];
    expect(match.bestMatch?.confidenceScore).toBeGreaterThanOrEqual(0.90);
    expect(match.bestMatch?.mlConfidence).toBeGreaterThanOrEqual(0.85);
    expect(match.bestMatch?.scoreGap).toBeGreaterThanOrEqual(0.15);

    // All conditions satisfied -> auto-confirms
    expect(match.reviewDecision?.autoConfirm).toBe(true);
    expect(match.reviewDecision?.reviewState).toBe('resolved');
    expect(match.confidenceTier).toBe('high');
  });

  it('12. When unconfirmed, match persists with status="suggested" and reviewState="awaiting_review"', async () => {
    createActivity({
      externalId: 'ACT-G01',
      name: 'Foundation Excavation Trench A',
      location: 'Block B'
    });

    // ML confidence low -> forced to awaiting_review
    const mlService = createMockMlService(() => 0.60);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Excavation Trench A',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress'
        }
      ]
    };

    const report = await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);
    expect(report.matches).toHaveLength(1);

    const persisted = matchRepo.listByProgressUpdateId(testUpdateId, testProjectId);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('suggested');
    expect(persisted[0].reviewState).toBe('awaiting_review');
    expect(persisted[0].reviewedBy).toBeNull();
  });

  it('13. ML predictions and matching do NOT mutate activity_progress (canonical truth protection)', async () => {
    createActivity({
      externalId: 'ACT-H01',
      name: 'Foundation Excavation Trench A',
      location: 'Block B'
    });

    const mlService = createMockMlService(() => 0.95);
    const service = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo: updateRepo,
      activityRepo,
      activityMatchRepo: matchRepo,
      matchModelService: mlService
    });

    const extraction: FieldProgressExtraction = {
      items: [
        {
          reference: 'Foundation Excavation Trench A',
          location: 'Block B',
          progress_percent: 80,
          status: 'in_progress'
        }
      ]
    };

    // Run matching with persistence
    await service.matchProgressUpdate(testProjectId, testUpdateId, extraction);

    // Query activity_progress table directly in SQLite
    const progressRows = db.prepare('SELECT * FROM activity_progress').all();
    expect(progressRows).toHaveLength(0);
  });
});
