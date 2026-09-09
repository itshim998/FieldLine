import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initDatabase } from '../src/database/db.js';
import { projectRepository } from '../src/repositories/project.repository.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { activityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { scheduleImportService } from '../src/services/schedule-import.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { defaultMatchModelService } from '../src/ml/match/match-model.service.js';
import { defaultAnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { scoreActivityCandidate } from '../src/services/matching/activity-match-scoring.js';
import { extractMatchFeatures } from '../src/ml/match/match-feature-extractor.js';

describe('Phase 25 — Golden Demo Walkthrough Scenarios (REFINERY-U4)', () => {
  let projectId: string;
  let matchingService: ActivityMatchingService;
  let extractionService: FieldProgressExtractionService;

  beforeAll(async () => {
    initDatabase();

    // Create an isolated REFINERY-U4 test project to prevent cross-test schedule pollution
    const project = projectRepository.create({
      name: 'Refinery Expansion — Unit 4 (ML Scenario Verification)',
      code: `ML-DEMO-${crypto.randomUUID().slice(0, 8)}`,
      description: 'Golden Demo Walkthrough Scenarios for Match and Anomaly Models',
      status: 'active',
      startDate: '2026-08-01',
      targetEndDate: '2026-09-30'
    });
    projectId = project.id;

    // Import canonical 30-activity schedule from fixtures
    const scheduleFixturePath = path.resolve(process.cwd(), 'demo/fixtures/schedules/refinery_unit4_schedule.csv');
    const tempImportPath = path.resolve(process.cwd(), `temp-schedule-${crypto.randomUUID()}.csv`);
    fs.copyFileSync(scheduleFixturePath, tempImportPath);

    await scheduleImportService.importSchedule(projectId, {
      path: tempImportPath,
      originalname: 'refinery_unit4_schedule.csv',
      mimetype: 'text/csv'
    });

    // Seed prior canonical observation for ACT-B02 (65% on 2026-08-27)
    const actB02 = activityRepository.listByProjectId(projectId).find((a) => a.externalId === 'ACT-B02')!;
    activityProgressRepository.create({
      projectId,
      activityId: actB02.id,
      asOfDate: '2026-08-27',
      actualPercent: 65,
      actualQuantity: 117,
      status: 'in_progress',
      progressUpdateId: null
    });

    const mockAi = new MockAIProvider();
    const aiService = new DefaultAIService(mockAi);
    extractionService = new FieldProgressExtractionService(aiService);
    matchingService = new ActivityMatchingService();
  });

  it('Scenario A: Match Model Reranking ranks ACT-B02 #1 with elevated learned confidence vs distractor ACT-B01', async () => {
    const rawReport = 'Pump foundation piles completed to 65% at Area B crude pump bay';

    // 1. Live extraction path
    const extraction = await extractionService.extractFromReport(rawReport);
    expect(extraction.items.length).toBeGreaterThanOrEqual(1);
    const fact = extraction.items[0];
    expect(fact.location).toBe('Area B');
    expect(fact.progress_percent).toBe(65);

    // 2. Candidate generation & live ML reranking
    const matchResults = await matchingService.computeMatches(projectId, extraction, {
      asOfDate: '2026-08-27'
    });

    expect(matchResults).toHaveLength(1);
    const bestMatch = matchResults[0].bestMatch;
    expect(bestMatch).not.toBeNull();

    // Verify ACT-B02 is ranked #1
    expect(bestMatch?.activityExternalId).toBe('ACT-B02');
    expect(bestMatch?.activityName).toBe('Crude Pump Foundation Piling Works');

    // Real Match Model produces elevated learned confidence (> 80%)
    expect(bestMatch?.mlConfidence).toBeDefined();
    expect(bestMatch!.mlConfidence!).toBeGreaterThanOrEqual(0.80);

    // Verify plausible distractor ACT-B01 receives significantly lower confidence
    const activities = activityRepository.listByProjectId(projectId);
    const actB01 = activities.find((a) => a.externalId === 'ACT-B01')!;
    const actB02 = activities.find((a) => a.externalId === 'ACT-B02')!;
    expect(actB01).toBeDefined();

    const featB01 = extractMatchFeatures(
      { reference: fact.reference, location: fact.location },
      actB01,
      0.0
    );
    const mlConfB01 = defaultMatchModelService.predict(featB01);

    // Assert learned separation: ACT-B01 is in distractor range (< 0.25) while ACT-B02 is high (> 0.80)
    expect(mlConfB01).toBeLessThanOrEqual(0.25);
    expect(bestMatch!.mlConfidence!).toBeGreaterThan(mlConfB01 * 3);
  });

  it('Scenario B: Anomaly Warning triggers pre-review alert for high progression velocity jump', async () => {
    const rawReport = 'Crude pump foundation piling jumped to 98% complete today';

    // Prior canonical observation in REFINERY-U4 for ACT-B02 is 65% on 2026-08-27
    const activities = activityRepository.listByProjectId(projectId);
    const actB02 = activities.find((a) => a.externalId === 'ACT-B02')!;
    const priorObs = activityProgressRepository.getLatestByActivityId(actB02.id, projectId);
    expect(priorObs).not.toBeNull();
    expect(priorObs?.actualPercent).toBe(65);

    // 1. Live extraction path
    const extraction = await extractionService.extractFromReport(rawReport);
    expect(extraction.items).toHaveLength(1);
    expect(extraction.items[0].progress_percent).toBe(98);

    // 2. Candidate evaluation with Anomaly Model before confirmation (interval: 1 day -> 2026-08-28)
    const matchResults = await matchingService.computeMatches(projectId, extraction, {
      asOfDate: '2026-08-28'
    });

    const bestMatch = matchResults[0].bestMatch;
    expect(bestMatch?.activityExternalId).toBe('ACT-B02');

    // Verify advisory anomaly warning is elevated (high severity, reviewRecommended: true)
    expect(bestMatch?.anomalyScore).toBeDefined();
    expect(bestMatch!.anomalyScore!).toBeGreaterThanOrEqual(0.75);
    expect(bestMatch?.anomalySeverity).toBe('high');
    expect(bestMatch?.anomaly?.reviewRecommended).toBe(true);

    // Verify statistically grounded diagnostic reason citing velocity deviation
    expect(bestMatch?.anomalyReasons?.length).toBeGreaterThan(0);
    expect(bestMatch?.anomalyReasons?.[0]).toMatch(/standard deviation/i);

    // CRITICAL CANONICAL INVARIANT CHECK:
    // activity_progress must not have been mutated!
    const obsAfterMatch = activityProgressRepository.listByActivityId(actB02.id, projectId);
    expect(obsAfterMatch[0].actualPercent).toBe(65);
    expect(obsAfterMatch.every((o) => o.actualPercent !== 98)).toBe(true);
  });

  it('Scenario C: Normal Progress Control demonstrates baseline pacing behavior', async () => {
    const rawReport = 'Crude pump foundation piles advanced to 68% complete today';

    // 1. Live extraction path
    const extraction = await extractionService.extractFromReport(rawReport);
    expect(extraction.items).toHaveLength(1);
    expect(extraction.items[0].progress_percent).toBe(68);

    // 2. Candidate matching resolves to ACT-B02
    const matchResults = await matchingService.computeMatches(projectId, extraction, {
      asOfDate: '2026-08-28'
    });
    const bestMatch = matchResults[0].bestMatch;
    expect(bestMatch?.activityExternalId).toBe('ACT-B02');

    // 3. Evaluate normal baseline variance with aligned schedule
    // A steady 3% increment with aligned variance yields low anomaly score (< 0.30)
    const normalFeatures = {
      progress_delta: 3,
      daily_velocity: 3,
      progress_variance: -3,
      reported_percent: 68,
      is_regression: 0
    };
    const normalPrediction = defaultAnomalyModelService.predict(normalFeatures);
    expect(normalPrediction.anomalyScore).toBeLessThan(0.30);
    expect(normalPrediction.severity).toBe('normal');
    expect(normalPrediction.reviewRecommended).toBe(false);
    expect(normalPrediction.reasons).toHaveLength(0);
  });
});
