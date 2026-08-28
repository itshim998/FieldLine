import { MatchConfidenceTier, MatchReviewState } from '../../models/domain.types.js';
import { CandidateMatch } from './activity-matching.types.js';

export const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.90;
export const DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD = 0.60;
export const DEFAULT_AUTO_CONFIRM_MARGIN = 0.15;
export const DEFAULT_MIN_CONFIDENCE_THRESHOLD = 0.40;

export interface MatchReviewDecision {
  tier: MatchConfidenceTier;
  autoConfirm: boolean;
  reviewState: MatchReviewState;
  reason: string;
}

export interface ReviewPolicyOptions {
  highThreshold?: number;
  mediumThreshold?: number;
  autoConfirmMargin?: number;
}

/**
 * Deterministic review policy function that classifies match confidence and determines
 * whether a match qualifies for automatic system confirmation or requires human review/resolution.
 *
 * Invariant: No ambiguous AI match silently becomes canonical project truth.
 */
export function classifyMatchConfidence(
  bestMatch: CandidateMatch | null,
  alternatives: CandidateMatch[] = [],
  options?: ReviewPolicyOptions
): MatchReviewDecision {
  const highThreshold = options?.highThreshold ?? DEFAULT_HIGH_CONFIDENCE_THRESHOLD;
  const mediumThreshold = options?.mediumThreshold ?? DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD;
  const autoConfirmMargin = options?.autoConfirmMargin ?? DEFAULT_AUTO_CONFIRM_MARGIN;

  // 1. No candidate found
  if (!bestMatch) {
    return {
      tier: 'low',
      autoConfirm: false,
      reviewState: 'unresolved',
      reason: 'No candidate activity matched the field observation above minimum threshold.'
    };
  }

  const score = bestMatch.confidenceScore;

  // 2. High score candidate evaluation
  if (score >= highThreshold) {
    // Check if runner-up is too close (ambiguous high scores)
    if (alternatives.length > 0) {
      const runnerUpScore = alternatives[0].confidenceScore;
      const separation = Math.round((score - runnerUpScore) * 100) / 100;

      if (separation < autoConfirmMargin) {
        return {
          tier: 'medium',
          autoConfirm: false,
          reviewState: 'awaiting_review',
          reason: `High candidate score (${(score * 100).toFixed(0)}%) is ambiguous due to runner-up candidate '${alternatives[0].activityName}' (${(runnerUpScore * 100).toFixed(0)}%) within ${(autoConfirmMargin * 100).toFixed(0)}% auto-confirm margin. Requires human review.`
        };
      }
    }

    // Unambiguous high confidence match -> Auto-confirm
    return {
      tier: 'high',
      autoConfirm: true,
      reviewState: 'resolved',
      reason: `High confidence match (${(score * 100).toFixed(0)}%) with unambiguous separation from alternatives.`
    };
  }

  // 3. Medium confidence candidate evaluation
  if (score >= mediumThreshold) {
    return {
      tier: 'medium',
      autoConfirm: false,
      reviewState: 'awaiting_review',
      reason: `Medium confidence match (${(score * 100).toFixed(0)}%) requires human confirmation.`
    };
  }

  // 4. Low confidence candidate evaluation -> Unresolved
  return {
    tier: 'low',
    autoConfirm: false,
    reviewState: 'unresolved',
    reason: `Low confidence match (${(score * 100).toFixed(0)}%) is unresolved. Human must choose the correct activity.`
  };
}
