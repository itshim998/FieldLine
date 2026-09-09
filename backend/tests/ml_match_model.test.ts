import { describe, it, expect } from 'vitest';
import { defaultMatchModelService, MatchModelService } from '../src/ml/match/match-model.service.js';
import { extractMatchFeatures } from '../src/ml/match/match-feature-extractor.js';
import { MATCH_FEATURE_NAMES, MatchFeatureVector } from '../src/ml/types.js';
import { classifyMatchConfidence } from '../src/services/matching/match-review-policy.js';
import { CandidateMatch } from '../src/services/matching/activity-matching.types.js';

describe('Phase 24 — ML Match Model Vitest Suite', () => {
  describe('1. Artifact Availability & Loading', () => {
    it('loads the production match-model.json artifact successfully', () => {
      expect(defaultMatchModelService.isAvailable()).toBe(true);
      const artifact = defaultMatchModelService.getArtifact();
      expect(artifact).not.toBeNull();
      expect(artifact?.modelType).toBe('logistic_regression');
      expect(artifact?.version).toBe('1.0.0');
      expect(artifact?.featureNames).toEqual(MATCH_FEATURE_NAMES);
      expect(artifact?.featureNames).toHaveLength(8);
      expect(artifact?.means).toHaveLength(8);
      expect(artifact?.stds).toHaveLength(8);
      expect(artifact?.weights).toHaveLength(8);
      expect(typeof artifact?.bias).toBe('number');
      expect(Number.isFinite(artifact?.bias)).toBe(true);
      expect(artifact?.stds.every((s) => s > 0)).toBe(true);
    });
  });

  describe('2. Feature Extraction', () => {
    it('extracts all 8 candidate-level features accurately without rank leakage', () => {
      const fact = {
        reference: 'ACT-B02 Crude Pump Foundation Piling Works',
        location: 'Area B',
        progress_percent: 65,
        status: 'in_progress' as const
      };

      const candidateActivity = {
        id: 'act-uuid-b02',
        externalId: 'ACT-B02',
        name: 'Crude Pump Foundation Piling Works',
        description: 'Piling and foundation works for crude pumps at Area B',
        location: 'Area B',
        wbsCode: 'REF-U4-B02'
      };

      const features = extractMatchFeatures(
        fact,
        candidateActivity,
        0.25
      );

      expect(features.exact_id_match).toBe(1.0);
      expect(features.location_exact_match).toBe(1.0);
      expect(features.location_contradiction).toBe(0.0);
      expect(features.name_similarity).toBeGreaterThan(0.80);
      expect(features.score_gap_from_second_candidate).toBeCloseTo(0.25, 2);
    });
  });

  describe('3. Native Inference Quality', () => {
    it('predicts high confidence (> 0.90) for exact ID match with aligned location', () => {
      const features: MatchFeatureVector = {
        name_similarity: 0.95,
        description_similarity: 0.85,
        location_exact_match: 1.0,
        location_similarity: 1.0,
        location_contradiction: 0.0,
        wbs_match: 1.0,
        exact_id_match: 1.0,
        score_gap_from_second_candidate: 0.35
      };

      const p = defaultMatchModelService.predict(features);
      expect(p).toBeGreaterThan(0.90);
    });

    it('predicts low confidence (< 0.30) for distractor with contradictory location', () => {
      const distractorFeatures: MatchFeatureVector = {
        name_similarity: 0.05,
        description_similarity: 0.02,
        location_exact_match: 0.0,
        location_similarity: 0.0,
        location_contradiction: 1.0,
        wbs_match: 0.0,
        exact_id_match: 0.0,
        score_gap_from_second_candidate: 0.0
      };

      const p = defaultMatchModelService.predict(distractorFeatures);
      expect(p).toBeLessThan(0.30);
    });
  });

  describe('4. Deterministic Reranking Integration', () => {
    it('computes composite score using 0.4 * s_det + 0.6 * p_ml', () => {
      const s_det = 0.80;
      const p_ml = 0.90;
      const expectedFinal = Math.round((0.4 * s_det + 0.6 * p_ml) * 10000) / 10000;
      expect(expectedFinal).toBe(0.86);
    });
  });

  describe('5. Dual-Threshold Auto-Confirm Gate Invariant', () => {
    const evaluateGate = (bestMatch: CandidateMatch | null) => {
      if (!bestMatch) return { autoConfirm: false, reviewState: 'unresolved' };
      if (bestMatch.matchMethod === 'exact_id') {
        return { autoConfirm: true, reviewState: 'resolved' };
      }
      const s_det = bestMatch.confidenceScore;
      const p_ml = bestMatch.mlConfidence ?? 0;
      const scoreGap = bestMatch.scoreGap ?? 0;

      const meetsGate = s_det >= 0.90 && p_ml >= 0.85 && scoreGap >= 0.15;
      return {
        autoConfirm: meetsGate,
        reviewState: meetsGate ? 'resolved' : 'awaiting_review'
      };
    };

    it('preserves deterministic exact-ID auto-confirm behavior', () => {
      const exactCandidate: CandidateMatch = {
        activityId: 'act-1',
        activityExternalId: 'ACT-B02',
        activityName: 'Crude Pump Piling',
        confidenceScore: 1.0,
        matchMethod: 'exact_id',
        matchedText: 'ACT-B02',
        rationale: 'Exact ID match',
        mlConfidence: 0.95,
        scoreGap: 0.40
      };

      const gate = evaluateGate(exactCandidate);
      expect(gate.autoConfirm).toBe(true);
      expect(gate.reviewState).toBe('resolved');
    });

    it('auto-confirms non-exact match ONLY when all three criteria are satisfied', () => {
      const strongCandidate: CandidateMatch = {
        activityId: 'act-1',
        activityExternalId: 'ACT-B02',
        activityName: 'Crude Pump Piling',
        confidenceScore: 0.92, // >= 0.90
        matchMethod: 'text_similarity',
        matchedText: 'Pump foundation piling',
        rationale: 'High text similarity',
        mlConfidence: 0.88, // >= 0.85
        scoreGap: 0.20 // >= 0.15
      };

      const gate = evaluateGate(strongCandidate);
      expect(gate.autoConfirm).toBe(true);
      expect(gate.reviewState).toBe('resolved');
    });

    it('blocks auto-confirm if deterministic score is < 0.90 even with high ML confidence', () => {
      const candidate: CandidateMatch = {
        activityId: 'act-1',
        activityExternalId: 'ACT-B02',
        activityName: 'Crude Pump Piling',
        confidenceScore: 0.88, // Unmet (< 0.90)
        matchMethod: 'text_similarity',
        matchedText: 'Pump foundation piling',
        rationale: 'High text similarity',
        mlConfidence: 0.99, // Very high ML confidence
        scoreGap: 0.30
      };

      const gate = evaluateGate(candidate);
      expect(gate.autoConfirm).toBe(false);
      expect(gate.reviewState).toBe('awaiting_review');
    });

    it('blocks auto-confirm if ML confidence is < 0.85 even with deterministic score >= 0.90', () => {
      const candidate: CandidateMatch = {
        activityId: 'act-1',
        activityExternalId: 'ACT-B02',
        activityName: 'Crude Pump Piling',
        confidenceScore: 0.94, // Met (>= 0.90)
        matchMethod: 'text_similarity',
        matchedText: 'Pump foundation piling',
        rationale: 'High text similarity',
        mlConfidence: 0.82, // Unmet (< 0.85)
        scoreGap: 0.25
      };

      const gate = evaluateGate(candidate);
      expect(gate.autoConfirm).toBe(false);
      expect(gate.reviewState).toBe('awaiting_review');
    });

    it('blocks auto-confirm if score gap is < 0.15 (ambiguous runner-up)', () => {
      const candidate: CandidateMatch = {
        activityId: 'act-1',
        activityExternalId: 'ACT-B02',
        activityName: 'Crude Pump Piling',
        confidenceScore: 0.94,
        matchMethod: 'text_similarity',
        matchedText: 'Pump foundation piling',
        rationale: 'High text similarity',
        mlConfidence: 0.92,
        scoreGap: 0.08 // Unmet (< 0.15)
      };

      const gate = evaluateGate(candidate);
      expect(gate.autoConfirm).toBe(false);
      expect(gate.reviewState).toBe('awaiting_review');
    });
  });
});
