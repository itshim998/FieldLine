import { MatchMethod, MatchConfidenceTier } from '../../models/domain.types.js';
import { FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
import { MatchReviewDecision } from './match-review-policy.js';
import { AnomalyPrediction } from '../../ml/types.js';

/**
 * Individual candidate activity match for a field progress fact.
 */
export interface CandidateMatch {
  activityId: string;
  activityExternalId: string;
  activityName: string;
  confidenceScore: number;
  deterministicScore?: number;
  matchMethod: MatchMethod;
  matchedText: string | null;
  rationale: string;
  mlConfidence?: number | null;
  finalScore?: number;
  scoreGap?: number;
  anomaly?: AnomalyPrediction;
  anomalyScore?: number | null;
  anomalySeverity?: 'normal' | 'review' | 'high' | null;
  anomalyReasons?: string[] | null;
  previousPercent?: number | null;
}

/**
 * Result of matching a single field progress fact against candidate activities.
 */
export interface FieldFactMatchResult {
  fact: FieldProgressItem;
  bestMatch: CandidateMatch | null;
  alternatives: CandidateMatch[];
  confidenceTier?: MatchConfidenceTier;
  reviewDecision?: MatchReviewDecision;
}

/**
 * Full match result report for a progress update.
 */
export interface MatchReportResult {
  projectId: string;
  progressUpdateId: string;
  matches: FieldFactMatchResult[];
}

/**
 * Options for the matching engine execution.
 */
export interface MatchingOptions {
  persist?: boolean;
  minConfidenceThreshold?: number;
  alternativeScoreMargin?: number;
  maxAlternatives?: number;
  enableLlmDisambiguation?: boolean;
  asOfDate?: string;
}

