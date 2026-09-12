import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractMatchFeatures,
  matchFeatureVectorToArray,
  MatchFeatureFactInput,
  MatchFeatureActivityInput
} from '../src/ml/match/match-feature-extractor.js';
import { MATCH_FEATURE_NAMES, MatchModelArtifact } from '../src/ml/types.js';

describe('Match Feature Extractor (Phase 1 & Phase 3)', () => {
  const baseActivity: MatchFeatureActivityInput = {
    externalId: 'ACT-B02',
    name: 'Crude Pump Foundation Piling Works',
    description: 'Driving 180 heavy precast concrete and steel friction piles for crude feed pump house',
    wbsCode: 'WBS-02.02',
    location: 'Area B'
  };

  it('should extract exactly the 8 candidate-level features', () => {
    const fact: MatchFeatureFactInput = {
      reference: 'Piling work at crude pump bay',
      location: 'Area B'
    };

    const features = extractMatchFeatures(fact, baseActivity, 0.25);
    const keys = Object.keys(features);

    expect(keys).toHaveLength(8);
    expect(keys).toEqual(expect.arrayContaining([...MATCH_FEATURE_NAMES]));
    expect((features as unknown as Record<string, unknown>).candidate_rank).toBeUndefined();
  });

  it('should compute high name similarity for overlapping terms', () => {
    const fact: MatchFeatureFactInput = {
      reference: 'Crude pump foundation piling work',
      location: 'Area B'
    };

    const features = extractMatchFeatures(fact, baseActivity);
    expect(features.name_similarity).toBeGreaterThan(0.7);
  });

  it('should compute description similarity when description matches', () => {
    const fact: MatchFeatureFactInput = {
      reference: 'Driving 180 precast concrete friction piles',
      location: 'Area B'
    };

    const features = extractMatchFeatures(fact, baseActivity);
    expect(features.description_similarity).toBeGreaterThan(0.6);
  });

  describe('Location feature behaviors', () => {
    it('should set exact match = 1, similarity = 1, contradiction = 0 on identical location', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Piling works',
        location: 'Area B'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.location_exact_match).toBe(1.0);
      expect(features.location_similarity).toBe(1.0);
      expect(features.location_contradiction).toBe(0.0);
    });

    it('should set exact match = 0, similarity = 0.9, contradiction = 0 on substring location containment', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Piling works',
        location: 'Area B East'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.location_exact_match).toBe(0.0);
      expect(features.location_similarity).toBe(0.9);
      expect(features.location_contradiction).toBe(0.0);
    });

    it('should flag contradiction = 1.0 when locations explicitly conflict', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Piling works',
        location: 'Area F'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.location_exact_match).toBe(0.0);
      expect(features.location_contradiction).toBe(1.0);
    });

    it('should not flag contradiction if location is null or missing', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Piling works',
        location: null
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.location_exact_match).toBe(0.0);
      expect(features.location_contradiction).toBe(0.0);
    });
  });

  describe('WBS match behaviors', () => {
    it('should detect WBS code inside field reference', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Foundation work continuing per WBS-02.02 specification',
        location: 'Area B'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.wbs_match).toBe(1.0);
    });

    it('should detect WBS code inside field location', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Foundation work continuing',
        location: 'Area B / WBS-02.02'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.wbs_match).toBe(1.0);
    });

    it('should return 0.0 when WBS code is absent', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Foundation work continuing',
        location: 'Area B'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.wbs_match).toBe(0.0);
    });
  });

  describe('Exact ID match behaviors', () => {
    it('should set exact_id_match = 1.0 when reference is exact externalId', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'ACT-B02',
        location: null
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.exact_id_match).toBe(1.0);
    });

    it('should set exact_id_match = 1.0 when reference contains externalId as token', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'ACT-B02: crude pump piling completed',
        location: 'Area B'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.exact_id_match).toBe(1.0);
    });

    it('should set exact_id_match = 0.0 for descriptive text without the ID', () => {
      const fact: MatchFeatureFactInput = {
        reference: 'Crude pump foundation piling works',
        location: 'Area B'
      };

      const features = extractMatchFeatures(fact, baseActivity);
      expect(features.exact_id_match).toBe(0.0);
    });
  });

  describe('Score separation gap behaviors', () => {
    it('should clamp and record score gap in [0, 1]', () => {
      const fact: MatchFeatureFactInput = { reference: 'Test', location: null };
      expect(extractMatchFeatures(fact, baseActivity, 0.42).score_gap_from_second_candidate).toBe(0.42);
      expect(extractMatchFeatures(fact, baseActivity, -0.1).score_gap_from_second_candidate).toBe(0.0);
      expect(extractMatchFeatures(fact, baseActivity, 1.5).score_gap_from_second_candidate).toBe(1.0);
    });
  });

  describe('matchFeatureVectorToArray utility', () => {
    it('should produce an 8-element array matching MATCH_FEATURE_NAMES order', () => {
      const fact: MatchFeatureFactInput = { reference: 'ACT-B02', location: 'Area B' };
      const vector = extractMatchFeatures(fact, baseActivity, 0.3);
      const arr = matchFeatureVectorToArray(vector);

      expect(arr).toHaveLength(8);
      expect(arr[0]).toBe(vector.name_similarity);
      expect(arr[1]).toBe(vector.description_similarity);
      expect(arr[2]).toBe(vector.location_exact_match);
      expect(arr[3]).toBe(vector.location_similarity);
      expect(arr[4]).toBe(vector.location_contradiction);
      expect(arr[5]).toBe(vector.wbs_match);
      expect(arr[6]).toBe(vector.exact_id_match);
      expect(arr[7]).toBe(vector.score_gap_from_second_candidate);
    });
  });

  describe('Trained Match Model Artifact Verification (Phase 6 Artifact Contract)', () => {
    it('should load and validate the trained match-model.json artifact', () => {
      const artifactPath = path.resolve(process.cwd(), 'backend/src/ml/artifacts/match-model.json');
      expect(fs.existsSync(artifactPath)).toBe(true);

      const content = fs.readFileSync(artifactPath, 'utf-8');
      const artifact: MatchModelArtifact = JSON.parse(content);

      expect(artifact.modelType).toBe('logistic_regression');
      expect(artifact.version).toBe('1.0.0');
      expect(artifact.featureNames).toEqual([...MATCH_FEATURE_NAMES]);

      expect(artifact.means).toHaveLength(8);
      expect(artifact.stds).toHaveLength(8);
      expect(artifact.weights).toHaveLength(8);

      for (let i = 0; i < 8; i++) {
        expect(Number.isFinite(artifact.means[i])).toBe(true);
        expect(Number.isFinite(artifact.stds[i])).toBe(true);
        expect(artifact.stds[i]).toBeGreaterThan(0);
        expect(Number.isFinite(artifact.weights[i])).toBe(true);
      }

      expect(Number.isFinite(artifact.bias)).toBe(true);
      expect(artifact.threshold).toBeGreaterThanOrEqual(0.0);
      expect(artifact.threshold).toBeLessThanOrEqual(1.0);
    });
  });
});
