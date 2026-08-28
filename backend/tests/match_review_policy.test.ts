import { describe, it, expect } from 'vitest';
import {
  classifyMatchConfidence,
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD,
  DEFAULT_AUTO_CONFIRM_MARGIN
} from '../src/services/matching/match-review-policy.js';
import { CandidateMatch } from '../src/services/matching/activity-matching.types.js';

describe('MatchReviewPolicy (Pass 19)', () => {
  const createCandidate = (
    id: string,
    score: number,
    method: 'exact_id' | 'text_similarity' | 'wbs_location' | 'manual' = 'text_similarity',
    name = `Activity ${id}`
  ): CandidateMatch => ({
    activityId: id,
    activityExternalId: `ACT-${id}`,
    activityName: name,
    confidenceScore: score,
    matchMethod: method,
    matchedText: name,
    rationale: `Scored ${score}`
  });

  describe('Section 30 Realistic Examples', () => {
    it('Safe example: top = 0.95, second = 0.41, method = exact_id -> auto-confirmed (HIGH)', () => {
      const top = createCandidate('1', 0.95, 'exact_id');
      const second = createCandidate('2', 0.41);

      const decision = classifyMatchConfidence(top, [second]);

      expect(decision.tier).toBe('high');
      expect(decision.autoConfirm).toBe(true);
      expect(decision.reviewState).toBe('resolved');
      expect(decision.reason).toContain('High confidence match');
    });

    it('Ambiguous example: top = 0.91, second = 0.90 -> NOT auto-confirmed (MEDIUM / Awaiting Review)', () => {
      const top = createCandidate('1', 0.91);
      const second = createCandidate('2', 0.90);

      const decision = classifyMatchConfidence(top, [second]);

      expect(decision.tier).toBe('medium');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('awaiting_review');
      expect(decision.reason).toContain('ambiguous due to runner-up');
    });

    it('Medium example: top = 0.72, second = 0.50 -> suggested (MEDIUM / Awaiting Review)', () => {
      const top = createCandidate('1', 0.72);
      const second = createCandidate('2', 0.50);

      const decision = classifyMatchConfidence(top, [second]);

      expect(decision.tier).toBe('medium');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('awaiting_review');
      expect(decision.reason).toContain('Medium confidence match');
    });

    it('Low example: top = 0.44, second = 0.41 -> unresolved (LOW / Unresolved)', () => {
      const top = createCandidate('1', 0.44);
      const second = createCandidate('2', 0.41);

      const decision = classifyMatchConfidence(top, [second]);

      expect(decision.tier).toBe('low');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('unresolved');
      expect(decision.reason).toContain('Low confidence match (44%) is unresolved');
    });
  });

  describe('Isolated High Candidate Policy', () => {
    it('should auto-confirm single strong candidate with no alternatives (score >= 0.90)', () => {
      const top = createCandidate('1', 0.91);
      const decision = classifyMatchConfidence(top, []);

      expect(decision.tier).toBe('high');
      expect(decision.autoConfirm).toBe(true);
      expect(decision.reviewState).toBe('resolved');
    });

    it('should auto-confirm candidate with score >= 0.90 and runner-up margin >= 0.15', () => {
      const top = createCandidate('1', 0.92);
      const runnerUp = createCandidate('2', 0.75); // separation = 0.17 >= 0.15

      const decision = classifyMatchConfidence(top, [runnerUp]);

      expect(decision.tier).toBe('high');
      expect(decision.autoConfirm).toBe(true);
      expect(decision.reviewState).toBe('resolved');
    });
  });

  describe('Boundary and Threshold Tests', () => {
    it('should handle exact high threshold boundary (0.90)', () => {
      const top = createCandidate('1', 0.90);
      const runnerUp = createCandidate('2', 0.70); // separation = 0.20

      const decision = classifyMatchConfidence(top, [runnerUp]);
      expect(decision.tier).toBe('high');
      expect(decision.autoConfirm).toBe(true);
    });

    it('should route score just below high threshold (0.89) to medium tier', () => {
      const top = createCandidate('1', 0.89);
      const decision = classifyMatchConfidence(top, []);

      expect(decision.tier).toBe('medium');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('awaiting_review');
    });

    it('should handle exact medium threshold boundary (0.60)', () => {
      const top = createCandidate('1', 0.60);
      const decision = classifyMatchConfidence(top, []);

      expect(decision.tier).toBe('medium');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('awaiting_review');
    });

    it('should route score just below medium threshold (0.59) to low / unresolved', () => {
      const top = createCandidate('1', 0.59);
      const decision = classifyMatchConfidence(top, []);

      expect(decision.tier).toBe('low');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('unresolved');
    });

    it('should handle null candidate match as low / unresolved', () => {
      const decision = classifyMatchConfidence(null, []);

      expect(decision.tier).toBe('low');
      expect(decision.autoConfirm).toBe(false);
      expect(decision.reviewState).toBe('unresolved');
      expect(decision.reason).toContain('No candidate activity matched');
    });
  });

  describe('Determinism', () => {
    it('should produce strictly identical outputs across repeated invocations', () => {
      const top = createCandidate('1', 0.93, 'exact_id');
      const second = createCandidate('2', 0.60);

      const d1 = classifyMatchConfidence(top, [second]);
      const d2 = classifyMatchConfidence(top, [second]);
      const d3 = classifyMatchConfidence(top, [second]);

      expect(d1).toEqual(d2);
      expect(d2).toEqual(d3);
    });
  });
});
