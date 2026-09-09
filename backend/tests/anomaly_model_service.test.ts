import { describe, it, expect } from 'vitest';
import {
  AnomalyModelService,
  validateAnomalyModelArtifact,
  defaultAnomalyModelService
} from '../src/ml/anomaly/anomaly-model.service.js';
import {
  extractAnomalyFeatures,
  anomalyFeatureVectorToArray
} from '../src/ml/anomaly/anomaly-feature-extractor.js';
import {
  AnomalyModelArtifact,
  ANOMALY_FEATURE_NAMES,
  COLD_START_ANOMALY_PREDICTION
} from '../src/ml/types.js';
import { ValidationError } from '../src/errors/AppError.js';
import { ActivityProgress } from '../src/models/domain.types.js';

describe('Phases 12, 13, 16, 17 — Anomaly Model Service & Artifact Validation', () => {
  const validArtifact: AnomalyModelArtifact = {
    modelType: 'standardized_distance_anomaly',
    version: '1.0.0',
    featureNames: [...ANOMALY_FEATURE_NAMES],
    means: [15.0, 5.0, 0.0, 50.0, 0.05],
    stds: [5.0, 2.5, 3.0, 25.0, 0.22],
    d95: 4.0,
    severityThresholds: {
      review: 0.50,
      high: 0.75
    }
  };

  // -------------------------------------------------------------------------
  // Artifact Validation
  // -------------------------------------------------------------------------
  describe('Artifact Validation (validateAnomalyModelArtifact)', () => {
    it('loads a valid artifact successfully', () => {
      const validated = validateAnomalyModelArtifact(validArtifact);
      expect(validated.modelType).toBe('standardized_distance_anomaly');
      expect(validated.featureNames).toEqual(ANOMALY_FEATURE_NAMES);
      expect(validated.d95).toBe(4.0);
    });

    it('fails when artifact is null or non-object', () => {
      expect(() => validateAnomalyModelArtifact(null)).toThrow(ValidationError);
      expect(() => validateAnomalyModelArtifact('string')).toThrow(ValidationError);
    });

    it('fails when modelType is incorrect', () => {
      const invalid = { ...validArtifact, modelType: 'logistic_regression' };
      expect(() => validateAnomalyModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('fails when version is missing or empty', () => {
      expect(() => validateAnomalyModelArtifact({ ...validArtifact, version: '' })).toThrow(ValidationError);
    });

    it('fails when featureNames count is wrong', () => {
      const invalid = { ...validArtifact, featureNames: ['progress_delta', 'daily_velocity'] };
      expect(() => validateAnomalyModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('fails when featureNames names or order do not match canonical schema', () => {
      const invalid = {
        ...validArtifact,
        featureNames: ['daily_velocity', 'progress_delta', 'progress_variance', 'reported_percent', 'is_regression']
      };
      expect(() => validateAnomalyModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('fails when means contains non-finite values (NaN, Infinity)', () => {
      const invalidNaN = { ...validArtifact, means: [15.0, NaN, 0.0, 50.0, 0.05] };
      expect(() => validateAnomalyModelArtifact(invalidNaN)).toThrow(ValidationError);

      const invalidInf = { ...validArtifact, means: [15.0, Infinity, 0.0, 50.0, 0.05] };
      expect(() => validateAnomalyModelArtifact(invalidInf)).toThrow(ValidationError);
    });

    it('fails when means array length is incorrect', () => {
      const invalid = { ...validArtifact, means: [15.0, 5.0, 0.0] };
      expect(() => validateAnomalyModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('fails when standard deviation is zero (zero-variance rejection)', () => {
      const invalidZero = { ...validArtifact, stds: [5.0, 0.0, 3.0, 25.0, 0.22] };
      expect(() => validateAnomalyModelArtifact(invalidZero)).toThrow(ValidationError);
    });

    it('fails when standard deviation is negative', () => {
      const invalidNeg = { ...validArtifact, stds: [5.0, -2.5, 3.0, 25.0, 0.22] };
      expect(() => validateAnomalyModelArtifact(invalidNeg)).toThrow(ValidationError);
    });

    it('fails when standard deviation is non-finite', () => {
      const invalidInf = { ...validArtifact, stds: [5.0, Infinity, 3.0, 25.0, 0.22] };
      expect(() => validateAnomalyModelArtifact(invalidInf)).toThrow(ValidationError);
    });

    it('fails when d95 is non-positive or non-finite', () => {
      expect(() => validateAnomalyModelArtifact({ ...validArtifact, d95: 0.0 })).toThrow(ValidationError);
      expect(() => validateAnomalyModelArtifact({ ...validArtifact, d95: -1.5 })).toThrow(ValidationError);
      expect(() => validateAnomalyModelArtifact({ ...validArtifact, d95: NaN })).toThrow(ValidationError);
    });

    it('fails when severityThresholds are invalid (review >= high or out of (0, 1))', () => {
      // review >= high
      expect(() =>
        validateAnomalyModelArtifact({
          ...validArtifact,
          severityThresholds: { review: 0.80, high: 0.70 }
        })
      ).toThrow(ValidationError);

      // review <= 0
      expect(() =>
        validateAnomalyModelArtifact({
          ...validArtifact,
          severityThresholds: { review: 0.0, high: 0.75 }
        })
      ).toThrow(ValidationError);

      // high >= 1.0
      expect(() =>
        validateAnomalyModelArtifact({
          ...validArtifact,
          severityThresholds: { review: 0.50, high: 1.0 }
        })
      ).toThrow(ValidationError);
    });

    it('confirms legacy distanceThreshold is NOT required and omitted', () => {
      const validated = validateAnomalyModelArtifact(validArtifact);
      expect((validated as any).distanceThreshold).toBeUndefined();
    });

    it('production defaultAnomalyModelService loads valid artifact from disk', () => {
      expect(defaultAnomalyModelService.isAvailable()).toBe(true);
      const art = defaultAnomalyModelService.getArtifact();
      expect(art).not.toBeNull();
      expect(art?.modelType).toBe('standardized_distance_anomaly');
      expect(art?.featureNames).toEqual(ANOMALY_FEATURE_NAMES);
      expect(art?.means).toHaveLength(5);
      expect(art?.stds).toHaveLength(5);
      expect(art?.stds.every(s => s > 0)).toBe(true);
      expect(art?.d95).toBeGreaterThan(0);
      expect((art as any).distanceThreshold).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Mathematical Behavior
  // -------------------------------------------------------------------------
  describe('Mathematical Behavior', () => {
    const service = new AnomalyModelService({ artifact: validArtifact, strict: true });

    it('1. zero-distance input (x = μ) produces anomaly score 0.00 and normal severity', () => {
      const meanFeatures = {
        progress_delta: validArtifact.means[0],
        daily_velocity: validArtifact.means[1],
        progress_variance: validArtifact.means[2],
        reported_percent: validArtifact.means[3],
        is_regression: validArtifact.means[4]
      };

      const result = service.predict(meanFeatures);
      expect(result.anomalyScore).toBe(0.0);
      expect(result.severity).toBe('normal');
      expect(result.reviewRecommended).toBe(false);
    });

    it('2. distance equal to d95 produces score exactly 0.50 and entry into review severity', () => {
      // Construct a vector exactly d95 units away from mean along progress_delta
      // z_0 = d95 => x_0 = μ_0 + d95 * σ_0
      const d95Delta = validArtifact.means[0] + validArtifact.d95 * validArtifact.stds[0];
      const features = {
        progress_delta: d95Delta,
        daily_velocity: validArtifact.means[1],
        progress_variance: validArtifact.means[2],
        reported_percent: validArtifact.means[3],
        is_regression: validArtifact.means[4]
      };

      const result = service.predict(features);
      // Continuous formula: 1 - 1/(1 + (d95/d95)^2) = 1 - 1/2 = 0.50
      expect(result.anomalyScore).toBe(0.50);
      expect(result.severity).toBe('review');
      expect(result.reviewRecommended).toBe(true);
    });

    it('3. larger distance produces a monotonically larger score', () => {
      // d1 = 2.0 (below d95 = 4.0) -> ratio = 0.5 -> score = 1 - 1/(1 + 0.25) = 0.20
      const d1Vec = {
        progress_delta: validArtifact.means[0] + 2.0 * validArtifact.stds[0],
        daily_velocity: validArtifact.means[1],
        progress_variance: validArtifact.means[2],
        reported_percent: validArtifact.means[3],
        is_regression: validArtifact.means[4]
      };
      // d2 = 4.0 (d95) -> score = 0.50
      const d2Vec = {
        progress_delta: validArtifact.means[0] + 4.0 * validArtifact.stds[0],
        daily_velocity: validArtifact.means[1],
        progress_variance: validArtifact.means[2],
        reported_percent: validArtifact.means[3],
        is_regression: validArtifact.means[4]
      };
      // d3 = 8.0 (2*d95) -> ratio = 2.0 -> score = 1 - 1/(1 + 4) = 0.80
      const d3Vec = {
        progress_delta: validArtifact.means[0] + 8.0 * validArtifact.stds[0],
        daily_velocity: validArtifact.means[1],
        progress_variance: validArtifact.means[2],
        reported_percent: validArtifact.means[3],
        is_regression: validArtifact.means[4]
      };

      const res1 = service.predict(d1Vec);
      const res2 = service.predict(d2Vec);
      const res3 = service.predict(d3Vec);

      expect(res1.anomalyScore).toBeLessThan(res2.anomalyScore);
      expect(res2.anomalyScore).toBeLessThan(res3.anomalyScore);
      expect(res1.anomalyScore).toBe(0.20);
      expect(res2.anomalyScore).toBe(0.50);
      expect(res3.anomalyScore).toBe(0.80);
      expect(res3.severity).toBe('high');
    });

    it('4. standardized Euclidean distance matches the stated formula across multiple dimensions', () => {
      // Set z = [1.0, 1.0, 1.0, 1.0, 0.0] -> sum(z^2) = 4.0 -> D = 2.0
      // ratio = 2.0 / 4.0 = 0.5 -> score = 1 - 1/1.25 = 0.20
      const multiDim = {
        progress_delta: validArtifact.means[0] + 1.0 * validArtifact.stds[0],
        daily_velocity: validArtifact.means[1] + 1.0 * validArtifact.stds[1],
        progress_variance: validArtifact.means[2] + 1.0 * validArtifact.stds[2],
        reported_percent: validArtifact.means[3] + 1.0 * validArtifact.stds[3],
        is_regression: validArtifact.means[4]
      };

      const res = service.predict(multiDim);
      expect(res.anomalyScore).toBe(0.20);
    });

    it('5. identical inputs produce identical outputs deterministically', () => {
      const input = {
        progress_delta: 20.0,
        daily_velocity: 7.0,
        progress_variance: -2.0,
        reported_percent: 65.0,
        is_regression: 0.0
      };

      const run1 = service.predict(input);
      const run2 = service.predict(input);
      const run3 = service.predict(input);

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    });
  });

  // -------------------------------------------------------------------------
  // Behavioral Scenarios
  // -------------------------------------------------------------------------
  describe('Behavioral Scenarios against Fitted Baseline', () => {
    const service = defaultAnomalyModelService;

    it('Scenario A: normal small positive progression -> severity: normal, reviewRecommended: false', () => {
      // Standard 10% progress over 2 days, on-plan variance
      const normalFeatures = {
        progress_delta: 14.0,
        daily_velocity: 4.67,
        progress_variance: 0.0,
        reported_percent: 50.0,
        is_regression: 0.0
      };

      const pred = service.predict(normalFeatures);
      expect(pred.severity).toBe('normal');
      expect(pred.reviewRecommended).toBe(false);
      expect(pred.anomalyScore).toBeLessThan(0.50);
    });

    it('Scenario B: small negative reconciliation adjustment -> severity: normal, non-judgmental reason', () => {
      // -1% adjustment over 3 days (minor survey reconciliation on an on-track activity)
      const minorRecon = {
        progress_delta: -1.0,
        daily_velocity: -0.33,
        progress_variance: -0.5,
        reported_percent: 50.0,
        is_regression: 1.0
      };

      const pred = service.predict(minorRecon);
      // Small adjustment within baseline variance should not be flagged as severe
      expect(pred.severity).toBe('normal');
      expect(pred.reviewRecommended).toBe(false);
      expect(pred.reasons.some(r => r.includes('reconciliation') || r.includes('survey'))).toBe(true);
    });

    it('Scenario C: moderate unusual regression -> severity: review or high', () => {
      // -15% drop over 2 days (unusual drop)
      const moderateDrop = {
        progress_delta: -15.0,
        daily_velocity: -7.5,
        progress_variance: -18.0,
        reported_percent: 35.0,
        is_regression: 1.0
      };

      const pred = service.predict(moderateDrop);
      expect(pred.anomalyScore).toBeGreaterThanOrEqual(0.50);
      expect(pred.reviewRecommended).toBe(true);
      expect(['review', 'high']).toContain(pred.severity);
      expect(pred.reasons.some(r => r.includes('progress drop') || r.includes('deviate'))).toBe(true);
    });

    it('Scenario D: severe regression -> severity: high, reviewRecommended: true', () => {
      // -50% unannounced collapse
      const severeCollapse = {
        progress_delta: -50.0,
        daily_velocity: -50.0,
        progress_variance: -55.0,
        reported_percent: 20.0,
        is_regression: 1.0
      };

      const pred = service.predict(severeCollapse);
      expect(pred.severity).toBe('high');
      expect(pred.reviewRecommended).toBe(true);
      expect(pred.anomalyScore).toBeGreaterThanOrEqual(0.75);
      expect(pred.reasons.some(r => r.includes('progress drop'))).toBe(true);
    });

    it('Scenario E: unusually large positive jump -> severity: high, reviewRecommended: true', () => {
      // +65% jump in 1 day
      const extremeJump = {
        progress_delta: 65.0,
        daily_velocity: 65.0,
        progress_variance: 40.0,
        reported_percent: 90.0,
        is_regression: 0.0
      };

      const pred = service.predict(extremeJump);
      expect(pred.severity).toBe('high');
      expect(pred.reviewRecommended).toBe(true);
      expect(pred.anomalyScore).toBeGreaterThanOrEqual(0.75);
      expect(pred.reasons.some(r => r.includes('velocity') || r.includes('increment'))).toBe(true);
    });

    it('does not claim every negative delta is anomalous', () => {
      // Very small negative adjustment (-0.5% over 3 days, on-plan variance)
      const tinyAdjustment = {
        progress_delta: -0.5,
        daily_velocity: -0.17,
        progress_variance: -0.2,
        reported_percent: 54.0,
        is_regression: 1.0
      };

      const pred = service.predict(tinyAdjustment);
      expect(pred.severity).toBe('normal');
      expect(pred.reviewRecommended).toBe(false);
    });

  });

  // -------------------------------------------------------------------------
  // Feature Extraction & Cold-Start Safety
  // -------------------------------------------------------------------------
  describe('Feature Extraction & Cold-Start Safety (extractAnomalyFeatures)', () => {
    const prior: ActivityProgress = {
      id: 'prog-01',
      projectId: 'proj-01',
      activityId: 'act-01',
      progressUpdateId: 'upd-01',
      actualPercent: 40,
      actualQuantity: null,
      actualStart: '2026-08-01',
      actualFinish: null,
      status: 'in_progress',
      asOfDate: '2026-08-15',
      notes: null,
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z'
    };

    it('returns null when priorObservation is null (cold start invariant)', () => {
      const feat = extractAnomalyFeatures({
        reportedPercent: 50,
        priorObservation: null,
        plannedPercent: 45,
        reportDate: '2026-08-20'
      });
      expect(feat).toBeNull();
    });

    it('correctly extracts the 5 features from prior observation and report', () => {
      const feat = extractAnomalyFeatures({
        reportedPercent: 55, // 55 - 40 = 15 delta
        priorObservation: prior, // date: 2026-08-15
        plannedPercent: 50, // 55 - 50 = +5 variance
        reportDate: '2026-08-18' // 3 days diff => 15 / 3 = 5.0 velocity
      });

      expect(feat).not.toBeNull();
      expect(feat?.progress_delta).toBe(15);
      expect(feat?.daily_velocity).toBe(5);
      expect(feat?.progress_variance).toBe(5);
      expect(feat?.reported_percent).toBe(55);
      expect(feat?.is_regression).toBe(0.0);
    });

    it('correctly sets is_regression to 1.0 on negative delta', () => {
      const feat = extractAnomalyFeatures({
        reportedPercent: 35, // 35 - 40 = -5 delta
        priorObservation: prior,
        plannedPercent: 40,
        reportDate: '2026-08-17' // 2 days => -2.5 velocity
      });

      expect(feat).not.toBeNull();
      expect(feat?.progress_delta).toBe(-5);
      expect(feat?.daily_velocity).toBe(-2.5);
      expect(feat?.is_regression).toBe(1.0);
    });

    it('converts to canonical array order correctly', () => {
      const feat = {
        progress_delta: 10,
        daily_velocity: 5,
        progress_variance: -2,
        reported_percent: 60,
        is_regression: 0.0
      };
      const arr = anomalyFeatureVectorToArray(feat);
      expect(arr).toEqual([10, 5, -2, 60, 0.0]);
    });
  });
});
