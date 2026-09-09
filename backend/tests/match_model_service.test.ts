import { describe, it, expect } from 'vitest';
import {
  MatchModelService,
  validateMatchModelArtifact,
  safeSigmoid,
  defaultMatchModelService
} from '../src/ml/match/match-model.service.js';
import { MatchModelArtifact, MATCH_FEATURE_NAMES } from '../src/ml/types.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Phase 9 — Native TypeScript MatchModelService', () => {
  const sampleValidArtifact: MatchModelArtifact = {
    modelType: 'logistic_regression',
    version: '1.0.0',
    featureNames: [...MATCH_FEATURE_NAMES],
    means: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    stds: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
    weights: [1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 2.0, 1.0],
    bias: 0.0,
    threshold: 0.50
  };

  describe('Artifact Validation (validateMatchModelArtifact)', () => {
    it('validates a correct artifact successfully', () => {
      const validated = validateMatchModelArtifact(sampleValidArtifact);
      expect(validated.modelType).toBe('logistic_regression');
      expect(validated.version).toBe('1.0.0');
      expect(validated.featureNames).toHaveLength(8);
      expect(validated.means).toHaveLength(8);
      expect(validated.stds).toHaveLength(8);
      expect(validated.weights).toHaveLength(8);
      expect(validated.bias).toBe(0.0);
      expect(validated.threshold).toBe(0.50);
    });

    it('rejects invalid or null objects', () => {
      expect(() => validateMatchModelArtifact(null)).toThrow(ValidationError);
      expect(() => validateMatchModelArtifact(undefined)).toThrow(ValidationError);
      expect(() => validateMatchModelArtifact('string')).toThrow(ValidationError);
    });

    it('rejects incorrect modelType', () => {
      const invalid = { ...sampleValidArtifact, modelType: 'random_forest' };
      expect(() => validateMatchModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('rejects missing or empty version string', () => {
      const invalid = { ...sampleValidArtifact, version: '' };
      expect(() => validateMatchModelArtifact(invalid)).toThrow(ValidationError);
    });

    it('rejects mismatched feature names or lengths', () => {
      const invalidLength = { ...sampleValidArtifact, featureNames: ['name_similarity'] };
      expect(() => validateMatchModelArtifact(invalidLength)).toThrow(ValidationError);

      const invalidNames = {
        ...sampleValidArtifact,
        featureNames: [
          'wrong_feature',
          'description_similarity',
          'location_exact_match',
          'location_similarity',
          'location_contradiction',
          'wbs_match',
          'exact_id_match',
          'score_gap_from_second_candidate'
        ]
      };
      expect(() => validateMatchModelArtifact(invalidNames)).toThrow(ValidationError);
    });

    it('rejects non-finite means', () => {
      const invalidMeans = {
        ...sampleValidArtifact,
        means: [0.5, NaN, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
      };
      expect(() => validateMatchModelArtifact(invalidMeans)).toThrow(ValidationError);

      const infiniteMeans = {
        ...sampleValidArtifact,
        means: [0.5, Infinity, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
      };
      expect(() => validateMatchModelArtifact(infiniteMeans)).toThrow(ValidationError);
    });

    it('rejects zero or negative standard deviations (stds[i] > 0 invariant)', () => {
      const zeroStd = {
        ...sampleValidArtifact,
        stds: [0.2, 0.0, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
      };
      expect(() => validateMatchModelArtifact(zeroStd)).toThrow(ValidationError);

      const negativeStd = {
        ...sampleValidArtifact,
        stds: [0.2, -0.1, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]
      };
      expect(() => validateMatchModelArtifact(negativeStd)).toThrow(ValidationError);
    });

    it('rejects non-finite weights and bias', () => {
      const invalidWeight = {
        ...sampleValidArtifact,
        weights: [1.0, 1.0, NaN, 1.0, -1.0, 1.0, 2.0, 1.0]
      };
      expect(() => validateMatchModelArtifact(invalidWeight)).toThrow(ValidationError);

      const invalidBias = {
        ...sampleValidArtifact,
        bias: NaN
      };
      expect(() => validateMatchModelArtifact(invalidBias)).toThrow(ValidationError);
    });

    it('rejects invalid threshold outside [0, 1]', () => {
      expect(() => validateMatchModelArtifact({ ...sampleValidArtifact, threshold: -0.1 })).toThrow(ValidationError);
      expect(() => validateMatchModelArtifact({ ...sampleValidArtifact, threshold: 1.1 })).toThrow(ValidationError);
      expect(() => validateMatchModelArtifact({ ...sampleValidArtifact, threshold: NaN })).toThrow(ValidationError);
    });
  });

  describe('Default Match Model Service Artifact Verification (Phase 8)', () => {
    it('loads the genuine production artifact successfully without errors', () => {
      expect(defaultMatchModelService.isAvailable()).toBe(true);
      expect(defaultMatchModelService.getLoadError()).toBeNull();

      const artifact = defaultMatchModelService.getArtifact();
      expect(artifact).not.toBeNull();
      expect(artifact?.modelType).toBe('logistic_regression');
      expect(artifact?.featureNames).toHaveLength(8);
      expect(artifact?.featureNames).toEqual([...MATCH_FEATURE_NAMES]);
      expect(artifact?.means).toHaveLength(8);
      expect(artifact?.stds).toHaveLength(8);
      expect(artifact?.weights).toHaveLength(8);
      expect(typeof artifact?.bias).toBe('number');
      expect(typeof artifact?.threshold).toBe('number');

      // Verify stds are strictly positive
      artifact?.stds.forEach(s => expect(s).toBeGreaterThan(0));

      // Verify that values are actual learned values, not illustrative plan defaults (bias: -1.35)
      expect(artifact?.bias).not.toBe(-1.35);
      expect(artifact?.bias).toBeCloseTo(-0.572576, 3);
    });
  });

  describe('Inference Computation & Mathematical Exactness', () => {
    it('computes known mathematical result accurately', () => {
      const service = new MatchModelService({
        artifact: sampleValidArtifact,
        strict: true
      });

      // When features === means, standardized vector is all 0s
      // z = 0 + bias = 0
      // p = sigmoid(0) = 0.5
      const meanFeatures = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const p = service.predict(meanFeatures);
      expect(p).toBe(0.5);

      // Now test with features that push z positive:
      // For feature 6 (exact_id_match, weight 2.0, mean 0.5, std 0.2):
      // if feature 6 = 1.0, standardized = (1.0 - 0.5) / 0.2 = 2.5
      // contribution = 2.0 * 2.5 = 5.0
      // z = 5.0
      // p = 1 / (1 + exp(-5.0)) = 0.993307...
      const highFeatures = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.0, 0.5];
      const pHigh = service.predict(highFeatures);
      const expectedP = Math.round((1.0 / (1.0 + Math.exp(-5.0))) * 10000) / 10000;
      expect(pHigh).toBe(expectedP);
      expect(pHigh).toBeCloseTo(0.9933, 3);
    });

    it('is strictly deterministic across repeated calls', () => {
      const service = defaultMatchModelService;
      const testVec = [0.8, 0.6, 1.0, 0.9, 0.0, 0.0, 0.0, 0.2];

      const p1 = service.predict(testVec);
      const p2 = service.predict(testVec);
      const p3 = service.predict(testVec);

      expect(p1).toBe(p2);
      expect(p2).toBe(p3);
    });

    it('accepts MatchFeatureVector object directly', () => {
      const service = defaultMatchModelService;
      const vectorObj = {
        name_similarity: 0.85,
        description_similarity: 0.40,
        location_exact_match: 1.0,
        location_similarity: 1.0,
        location_contradiction: 0.0,
        wbs_match: 1.0,
        exact_id_match: 0.0,
        score_gap_from_second_candidate: 0.25
      };

      const p = service.predict(vectorObj);
      expect(typeof p).toBe('number');
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
  });

  describe('Numerical Robustness (safeSigmoid)', () => {
    it('clips extreme large z without overflow', () => {
      expect(safeSigmoid(100)).toBeCloseTo(1.0, 6);
      expect(safeSigmoid(1000)).toBeCloseTo(1.0, 6);
      expect(safeSigmoid(Infinity)).toBeCloseTo(1.0, 6);
    });

    it('clips extreme negative z without underflow crash', () => {
      expect(safeSigmoid(-100)).toBeCloseTo(0.0, 6);
      expect(safeSigmoid(-1000)).toBeCloseTo(0.0, 6);
      expect(safeSigmoid(-Infinity)).toBeCloseTo(0.0, 6);
    });

    it('returns 0.5 for NaN input', () => {
      expect(safeSigmoid(NaN)).toBe(0.5);
    });
  });

  describe('Graceful Fallback on Missing/Corrupt Artifact', () => {
    it('handles non-existent artifact file without crashing (non-strict mode)', () => {
      const fallbackService = new MatchModelService({
        artifactPath: '/non/existent/path/match-model.json',
        strict: false
      });

      expect(fallbackService.isAvailable()).toBe(false);
      expect(fallbackService.getArtifact()).toBeNull();
      expect(fallbackService.getLoadError()).not.toBeNull();
      expect(fallbackService.getLoadError()?.message).toContain('not found');

      // Calling predict throws an informative error
      expect(() => fallbackService.predict([0, 0, 0, 0, 0, 0, 0, 0])).toThrow(/unavailable/);
    });

    it('throws in strict mode on non-existent artifact', () => {
      expect(() => {
        new MatchModelService({
          artifactPath: '/non/existent/path/match-model.json',
          strict: true
        });
      }).toThrow(/not found/);
    });
  });
});
