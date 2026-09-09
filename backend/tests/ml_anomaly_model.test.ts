import { describe, it, expect } from 'vitest';
import { defaultAnomalyModelService } from '../src/ml/anomaly/anomaly-model.service.js';
import { extractAnomalyFeatures } from '../src/ml/anomaly/anomaly-feature-extractor.js';
import { ANOMALY_FEATURE_NAMES, AnomalyFeatureVector } from '../src/ml/types.js';
import { ActivityProgress } from '../src/models/domain.types.js';

describe('Phase 24 — ML Anomaly Model Vitest Suite', () => {
  describe('1. Production Artifact Integrity', () => {
    it('successfully loads and validates the production anomaly-model.json artifact', () => {
      expect(defaultAnomalyModelService.isAvailable()).toBe(true);
      const artifact = defaultAnomalyModelService.getArtifact();
      expect(artifact).not.toBeNull();
      expect(artifact?.modelType).toBe('standardized_distance_anomaly');
      expect(artifact?.version).toBe('1.0.0');
      expect(artifact?.featureNames).toEqual(ANOMALY_FEATURE_NAMES);
      expect(artifact?.featureNames).toHaveLength(5);
      expect(artifact?.means).toHaveLength(5);
      expect(artifact?.stds).toHaveLength(5);
      expect(artifact?.stds.every((s) => s > 0)).toBe(true);
      expect(typeof artifact?.d95).toBe('number');
      expect(artifact!.d95).toBeGreaterThan(0);
      expect(artifact?.severityThresholds.review).toBe(0.50);
      expect(artifact?.severityThresholds.high).toBe(0.75);
    });
  });

  describe('2. Progression Scenarios against Production Model', () => {
    const priorObservation: ActivityProgress = {
      id: 'prog-1',
      projectId: 'proj-1',
      activityId: 'act-b02',
      progressUpdateId: 'upd-1',
      actualPercent: 65,
      actualQuantity: null,
      actualStart: '2026-02-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-03-01',
      notes: null,
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z'
    };

    it('Scenario A: Normal Progression (+3% in 1 day) produces normal severity and no review recommendation', () => {
      const features = extractAnomalyFeatures({
        reportedPercent: 68,
        priorObservation,
        plannedPercent: 67,
        reportDate: '2026-03-02'
      });
      expect(features).not.toBeNull();

      const prediction = defaultAnomalyModelService.predict(features!);
      expect(prediction.anomalyScore).toBeLessThan(0.50);
      expect(prediction.severity).toBe('normal');
      expect(prediction.reviewRecommended).toBe(false);
    });

    it('Scenario B: Minor Negative Reconciliation Adjustment (-1% over 4 days) produces normal severity', () => {
      const features = extractAnomalyFeatures({
        reportedPercent: 64,
        priorObservation,
        plannedPercent: 65,
        reportDate: '2026-03-05'
      });
      expect(features).not.toBeNull();
      expect(features!.is_regression).toBe(1.0);

      const prediction = defaultAnomalyModelService.predict(features!);
      expect(prediction.severity).toBe('normal');
      expect(prediction.reviewRecommended).toBe(false);
      // Explanations for minor adjustments cite survey/reconciliation variance
      expect(
        prediction.reasons.some((r) =>
          r.toLowerCase().includes('reconciliation') || r.toLowerCase().includes('adjustment') || r.toLowerCase().includes('survey')
        )
      ).toBe(true);
    });

    it('Scenario C: Moderate Progression Regression produces elevated anomaly review flag', () => {
      const features = extractAnomalyFeatures({
        reportedPercent: 45, // -20% drop
        priorObservation,
        plannedPercent: 65,
        reportDate: '2026-03-02'
      });
      expect(features).not.toBeNull();

      const prediction = defaultAnomalyModelService.predict(features!);
      expect(prediction.anomalyScore).toBeGreaterThanOrEqual(0.50);
      expect(prediction.reviewRecommended).toBe(true);
      expect(['review', 'high']).toContain(prediction.severity);
    });

    it('Scenario D: Atypical Severe Regression produces high anomaly severity', () => {
      const features = extractAnomalyFeatures({
        reportedPercent: 10, // -55% severe drop
        priorObservation,
        plannedPercent: 65,
        reportDate: '2026-03-02'
      });
      expect(features).not.toBeNull();

      const prediction = defaultAnomalyModelService.predict(features!);
      expect(prediction.anomalyScore).toBeGreaterThanOrEqual(0.75);
      expect(prediction.severity).toBe('high');
      expect(prediction.reviewRecommended).toBe(true);
    });

    it('Scenario E: Extreme Daily Jump (+33% in 1 day) produces high anomaly severity', () => {
      const features = extractAnomalyFeatures({
        reportedPercent: 98, // +33% in 1 day
        priorObservation,
        plannedPercent: 67,
        reportDate: '2026-03-02'
      });
      expect(features).not.toBeNull();

      const prediction = defaultAnomalyModelService.predict(features!);
      expect(prediction.anomalyScore).toBeGreaterThanOrEqual(0.75);
      expect(prediction.severity).toBe('high');
      expect(prediction.reviewRecommended).toBe(true);
      expect(prediction.reasons.length).toBeGreaterThan(0);
      // Reason cites daily velocity or jump
      expect(
        prediction.reasons.some((r) =>
          r.toLowerCase().includes('velocity') || r.toLowerCase().includes('distribution') || r.toLowerCase().includes('standard deviation')
        )
      ).toBe(true);
    });
  });

  describe('3. Invariant & Vocabulary Adherence', () => {
    it('generates diagnostic reasons without forbidden accusatory vocabulary', () => {
      const extremeFeatures: AnomalyFeatureVector = {
        progress_delta: 50.0,
        daily_velocity: 50.0,
        progress_variance: 40.0,
        reported_percent: 99.0,
        is_regression: 0.0
      };

      const prediction = defaultAnomalyModelService.predict(extremeFeatures);
      const allText = prediction.reasons.join(' ').toLowerCase();

      // Prohibited accusatory terms
      expect(allText).not.toContain('fraud');
      expect(allText).not.toContain('deception');
      expect(allText).not.toContain('dishonest');
      expect(allText).not.toContain('fake');
      expect(allText).not.toContain('cheat');
      expect(allText).not.toContain('authenticity');
      expect(allText).not.toContain('lie');
    });

    it('returns safe cold-start fallback when canonical history is unavailable', () => {
      const coldStart = defaultAnomalyModelService.getColdStartPrediction();
      expect(coldStart.anomalyScore).toBe(0.0);
      expect(coldStart.severity).toBe('normal');
      expect(coldStart.reviewRecommended).toBe(false);
      expect(coldStart.reasons).toEqual([]);
    });
  });
});
