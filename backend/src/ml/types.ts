/**
 * ML Subsystem Core Type Contracts
 * Authoritative types for the FieldLine Match Model (Phases 1–6).
 */

export const SUPPORTED_MATCH_MODEL_VERSION = '1.0.0';

export const MATCH_FEATURE_NAMES = [
  'name_similarity',
  'description_similarity',
  'location_exact_match',
  'location_similarity',
  'location_contradiction',
  'wbs_match',
  'exact_id_match',
  'score_gap_from_second_candidate'
] as const;

export type MatchFeatureName = typeof MATCH_FEATURE_NAMES[number];

/**
 * The 8 candidate-level features used by the Match Model.
 * Note: These are candidate-level features derived from textual, location, WBS, ID,
 * and deterministic score-separation signals. Candidate rank is strictly excluded to
 * prevent rank leakage.
 */
export interface MatchFeatureVector {
  name_similarity: number;              // [0, 1] text similarity with activity name
  description_similarity: number;       // [0, 1] text similarity with activity description
  location_exact_match: number;         // 1.0 if reported location === activity location, else 0.0
  location_similarity: number;          // [0, 1] text similarity between locations
  location_contradiction: number;       // 1.0 if explicit mismatch between non-empty locations, else 0.0
  wbs_match: number;                    // 1.0 if reference or location contains WBS code, else 0.0
  exact_id_match: number;               // 1.0 if reference equals or contains activity externalId, else 0.0
  score_gap_from_second_candidate: number; // [0, 1] Deterministic score separation from runner-up
}

/**
 * Trained Match Model Artifact contract persisted to disk (JSON).
 */
export interface MatchModelArtifact {
  modelType: string;                    // 'logistic_regression'
  version: string;                      // Semantic version, e.g. '1.0.0'
  featureNames: string[];               // Exactly 8 feature names in fixed vector order
  means: number[];                      // Standardizer means for each feature (length 8)
  stds: number[];                       // Standardizer standard deviations (length 8, all > 0)
  weights: number[];                    // Learned logistic regression weights (length 8)
  bias: number;                         // Learned logistic regression bias
  threshold: number;                    // Decision threshold for binary classification
}

/**
 * Candidate pair categorization in the independent match dataset.
 */
export type CandidatePairType = 'positive' | 'hard_negative' | 'soft_negative';

/**
 * Independent ground-truth dataset row contract stored in match_dataset.jsonl.
 */
export interface MatchDatasetRecord {
  reference: string;
  location: string | null;
  activityId: string;                   // Evaluated candidate activity externalId
  targetActivityId: string;             // True ground-truth externalId
  candidateActivityId: string;          // Candidate externalId being scored
  pairType: CandidatePairType;
  features: MatchFeatureVector;
  label: 0 | 1;                         // 1 = match, 0 = non-match
}

// =========================================================================
// Anomaly Model Contracts (Phases 12–17)
// =========================================================================

export const SUPPORTED_ANOMALY_MODEL_VERSION = '1.0.0';

export const ANOMALY_FEATURE_NAMES = [
  'progress_delta',
  'daily_velocity',
  'progress_variance',
  'reported_percent',
  'is_regression'
] as const;

export type AnomalyFeatureName = typeof ANOMALY_FEATURE_NAMES[number];

/**
 * The 5 core progression features evaluated by the Anomaly Model.
 * Standardized against the learned baseline progression distribution.
 */
export interface AnomalyFeatureVector {
  progress_delta: number;         // Δp = current reported % - previous actual %
  daily_velocity: number;         // Δp / max(1, days_since_previous_update)
  progress_variance: number;      // current reported % - planned % as-of report date
  reported_percent: number;       // current reported % [0, 100]
  is_regression: number;          // 1.0 if Δp < 0, else 0.0
}

/**
 * Fitted Anomaly Model Artifact contract persisted to disk (JSON).
 * Zero decorative or redundant parameters; distanceThreshold is strictly excluded.
 */
export interface AnomalyModelArtifact {
  modelType: string;              // 'standardized_distance_anomaly'
  version: string;                // Semantic version, e.g. '1.0.0'
  featureNames: string[];         // Exactly 5 feature names in fixed vector order
  means: number[];                // Exactly 5 finite numeric baseline means
  stds: number[];                 // Exactly 5 finite, strictly positive numbers (stds[i] > 0)
  d95: number;                    // Finite, strictly positive 95th-percentile distance (d95 > 0)
  severityThresholds: {
    review: number;               // 0.50 (maps to D === d95)
    high: number;                 // 0.75
  };
}

/**
 * Anomaly severity classification level.
 * Evaluated strictly against continuous anomalyScore.
 */
export type AnomalySeverity = 'normal' | 'review' | 'high';

/**
 * Advisory prediction produced by the Anomaly Model.
 * Serves as a review-prioritization flag for supervisors before canonical confirmation.
 */
export interface AnomalyPrediction {
  anomalyScore: number;           // Continuous [0, 1] mapped via 1 - 1/(1 + (D/d95)^2)
  severity: AnomalySeverity;
  reviewRecommended: boolean;
  reasons: string[];              // Diagnostic explanations citing standardized deviations
}

/**
 * Safe cold-start prediction when prior canonical history is unavailable.
 */
export const COLD_START_ANOMALY_PREDICTION: Readonly<AnomalyPrediction> = Object.freeze({
  anomalyScore: 0.0,
  severity: 'normal' as const,
  reviewRecommended: false,
  reasons: []
});

