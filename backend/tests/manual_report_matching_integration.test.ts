import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { initDatabase, closeDatabase } from '../src/database/db.js';
import { seedGoldenDemo } from '../../demo/golden-demo-seeder.js';
import { activityRepository } from '../src/repositories/activity.repository.js';
import { activityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { activityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { progressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { workerAuthHeader, adminAuthHeader } from './helpers/auth-test-helper.js';
import { LiveToolHandlers } from '../src/ai/live/live-tool-handlers.js';
import { defaultAnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';

describe('Manual Field Report Matching Pipeline Integration', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;

  beforeEach(async () => {
    initDatabase({ dbPath: ':memory:' });
    app = createApp();
    const seedResult = await seedGoldenDemo();
    projectId = seedResult.projectId;
  });

  afterEach(() => {
    closeDatabase();
  });

  it('Requirement A & B & C & D: Manual text report creation automatically executes extraction, ML reranking, and persists matches', async () => {
    const rawText = 'Pump foundation piles completed to 65% at Area B crude pump bay.';
    const reportDate = '2026-08-27';

    // 1. Worker submits natural-language report via POST /api/projects/:projectId/progress-updates
    const postRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .set(workerAuthHeader(projectId))
      .send({
        reportDate,
        rawText,
        reporterName: 'Golden Worker',
        reporterRole: 'Piling Specialist'
      });

    expect(postRes.status).toBe(201);
    expect(postRes.body.progressUpdate).toBeDefined();
    const updateId = postRes.body.progressUpdate.id;
    expect(updateId).toBeDefined();

    // 2. Verify persisted activity_matches in database
    const persistedMatches = activityMatchRepository.listByProgressUpdateId(updateId, projectId);
    expect(persistedMatches.length).toBeGreaterThanOrEqual(1);

    // 3. Admin opens the report and fetches matches via GET
    const getRes = await request(app)
      .get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId));

    expect(getRes.status).toBe(200);
    expect(getRes.body.matches).toBeDefined();
    expect(getRes.body.matches.length).toBeGreaterThanOrEqual(1);

    // 4. Verify Golden Match Scenario A: ACT-B02 is ranked #1
    const activities = activityRepository.listByProjectId(projectId);
    const actB02 = activities.find((a) => a.externalId === 'ACT-B02');
    expect(actB02).toBeDefined();

    const bestMatch = getRes.body.matches[0];
    expect(bestMatch.activityId).toBe(actB02!.id);

    // 5. Verify ML Match confidence is elevated (>80%)
    expect(bestMatch.mlConfidence).toBeDefined();
    expect(bestMatch.mlConfidence).toBeGreaterThanOrEqual(0.80);

    // 6. Verify review policy: Non-exact match requires review (suggested / awaiting_review)
    expect(bestMatch.status).toBe('suggested');
    expect(bestMatch.reviewState).toBe('awaiting_review');
  });

  it('Requirement E & F: Anomaly Scenario B triggers high anomaly warning without mutating canonical progress', async () => {
    const rawText = 'Crude pump foundation piling jumped to 98% complete today.';
    const reportDate = '2026-08-28';

    const activities = activityRepository.listByProjectId(projectId);
    const actB02 = activities.find((a) => a.externalId === 'ACT-B02')!;

    // Baseline verification: Prior canonical observation is 65% as-of 2026-08-27
    const priorObs = activityProgressRepository.getLatestByActivityId(actB02.id, projectId);
    expect(priorObs).not.toBeNull();
    expect(priorObs?.actualPercent).toBe(65);

    // 1. Worker submits high progression velocity report
    const postRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .set(workerAuthHeader(projectId))
      .send({
        reportDate,
        rawText,
        reporterName: 'Golden Worker',
        reporterRole: 'Piling Specialist'
      });

    expect(postRes.status).toBe(201);
    const updateId = postRes.body.progressUpdate.id;

    // 2. Retrieve matches via Admin review endpoint
    const getRes = await request(app)
      .get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId));

    expect(getRes.status).toBe(200);
    const bestMatch = getRes.body.matches[0];
    expect(bestMatch.activityId).toBe(actB02.id);

    // 3. Verify elevated anomaly score (>= 0.75) and high severity warning
    expect(bestMatch.anomalyScore).toBeDefined();
    expect(bestMatch.anomalyScore).toBeGreaterThanOrEqual(0.75);
    expect(bestMatch.anomalySeverity).toBe('high');

    // 4. Verify diagnostic reason citing velocity
    expect(bestMatch.anomalyReasons).toBeDefined();
    expect(bestMatch.anomalyReasons.length).toBeGreaterThan(0);
    expect(bestMatch.anomalyReasons[0]).toMatch(/velocity|deviation/i);

    // 5. CRITICAL CANONICAL SAFETY INVARIANT:
    // Canonical ActivityProgress must NOT have been mutated!
    const obsAfterMatch = activityProgressRepository.listByActivityId(actB02.id, projectId);
    expect(obsAfterMatch[0].actualPercent).toBe(65);
    expect(obsAfterMatch.every((o) => o.actualPercent !== 98)).toBe(true);
  });

  it('Requirement G: Normal Scenario C exhibits baseline normal pacing and no velocity anomaly', async () => {
    const rawText = 'Crude pump foundation piles advanced to 68% complete today.';
    const reportDate = '2026-08-28';

    const postRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .set(workerAuthHeader(projectId))
      .send({
        reportDate,
        rawText,
        reporterName: 'Golden Worker',
        reporterRole: 'Piling Specialist'
      });

    expect(postRes.status).toBe(201);
    const updateId = postRes.body.progressUpdate.id;

    const getRes = await request(app)
      .get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId));

    expect(getRes.status).toBe(200);
    const bestMatch = getRes.body.matches[0];

    const activities = activityRepository.listByProjectId(projectId);
    const actB02 = activities.find((a) => a.externalId === 'ACT-B02')!;
    expect(bestMatch.activityId).toBe(actB02.id);

    // Unlike Scenario B (velocity 33%/day), Scenario C has steady advance (+3%) and no velocity anomaly reason
    const velocityReason = (bestMatch.anomalyReasons || []).find((r: string) => /daily velocity/i.test(r));
    expect(velocityReason).toBeUndefined();

    // Standard baseline progression response under normal schedule pacing yields low anomaly score (<0.30)
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

  it('Requirement H & I: Refreshing and re-running matching does not duplicate match rows or overwrite human decisions', async () => {
    const rawText = 'Pump foundation piles completed to 65% at Area B crude pump bay.';
    const reportDate = '2026-08-27';

    // 1. Submit report
    const postRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .set(workerAuthHeader(projectId))
      .send({ reportDate, rawText });

    const updateId = postRes.body.progressUpdate.id;

    // Initial matches count
    const initialMatches = activityMatchRepository.listByProgressUpdateId(updateId, projectId);
    expect(initialMatches.length).toBeGreaterThanOrEqual(1);

    // 2. Refresh Matches (GET /matches) multiple times
    const getRes1 = await request(app)
      .get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId));
    const getRes2 = await request(app)
      .get(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId));

    expect(getRes1.body.matches.length).toBe(initialMatches.length);
    expect(getRes2.body.matches.length).toBe(initialMatches.length);

    // 3. Human confirms match
    const matchToConfirm = initialMatches[0];
    const confirmRes = await request(app)
      .post(`/api/projects/${projectId}/activity-matches/${matchToConfirm.id}/confirm`)
      .set(adminAuthHeader(projectId))
      .send({ reviewer: 'Chief Inspector' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.match.status).toBe('confirmed');

    // 4. Re-run matching pipeline explicitly (POST /matches)
    const recomputeRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates/${updateId}/matches`)
      .set(adminAuthHeader(projectId))
      .send({
        extraction: {
          items: [
            {
              reference: 'crude pump foundation piles',
              location: 'Area B crude pump bay',
              progress_percent: 65,
              status: 'in_progress'
            }
          ]
        }
      });

    expect(recomputeRes.status).toBe(200);

    // 5. Verify database matches: Confirmed match is preserved and not duplicated!
    const matchesAfterRecompute = activityMatchRepository.listByProgressUpdateId(updateId, projectId);
    const confirmedMatches = matchesAfterRecompute.filter((m) => m.activityId === matchToConfirm.activityId && m.status === 'confirmed');
    expect(confirmedMatches).toHaveLength(1);
    expect(confirmedMatches[0].status).toBe('confirmed');
    expect(confirmedMatches[0].reviewedBy).toBe('Chief Inspector');
  });

  it('Requirement J: Existing Live Voice flow continues to function without regression', async () => {
    const liveToolHandlers = new LiveToolHandlers();
    const voiceStatement = 'Crude pump foundation piling reached 65% today';

    const result = await liveToolHandlers.recordFieldProgress(projectId, voiceStatement);
    expect(result.status).toBe('queued');

    // Wait briefly for asynchronous processing
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify a progress update with sourceType 'voice' was created
    const updates = progressUpdateRepository.listByProjectId(projectId);
    const voiceUpdate = updates.find((u) => u.sourceType === 'voice' && u.rawText === voiceStatement);
    expect(voiceUpdate).toBeDefined();
  });

  it('Requirement 13: Report list ordering places newly received reports first in the intake queue', async () => {
    // 1. Query reports before submission
    const beforeReports = progressUpdateRepository.listByProjectId(projectId);
    expect(beforeReports.length).toBeGreaterThan(0);

    // 2. Submit a new report with an earlier historical report date (e.g. 2026-08-20)
    const postRes = await request(app)
      .post(`/api/projects/${projectId}/progress-updates`)
      .set(workerAuthHeader(projectId))
      .send({
        reportDate: '2026-08-20',
        rawText: 'Retroactive report from earlier in the shift',
        reporterName: 'Intake Worker'
      });

    expect(postRes.status).toBe(201);
    const newId = postRes.body.progressUpdate.id;

    // 3. Query reports list via GET endpoint
    const listRes = await request(app)
      .get(`/api/projects/${projectId}/progress-updates`)
      .set(adminAuthHeader(projectId));

    expect(listRes.status).toBe(200);
    const updates = listRes.body.progressUpdates;

    // The newly received report must appear first in the intake queue
    expect(updates[0].id).toBe(newId);
    expect(updates[0].rawText).toBe('Retroactive report from earlier in the shift');
    expect(updates[0].reportDate).toBe('2026-08-20');
  });
});
