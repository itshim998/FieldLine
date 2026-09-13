import { AnomalyPrediction } from '../../ml/types.js';
import { Activity } from '../../models/domain.types.js';
import { MaybePromise } from '../../database/provider.js';

export interface EvaluateProgressAnomalyInput {
  projectId: string;
  activityId: string;
  activity?: Pick<Activity, 'id' | 'plannedStart' | 'plannedFinish' | 'externalId' | 'name'> | null;
  reportedPercent: number | null | undefined;
  reportDate: string;
}

/**
 * Service contract for evaluating progress observations for statistical anomaly
 * against an activity's canonical historical and planned baseline context.
 *
 * Encapsulates the canonical lifecycle step:
 *   worker observation -> canonical activity association -> canonical anomaly evaluation -> persist advisory metadata
 */
export interface ProgressAnomalyEvaluationService {
  /**
   * Evaluates a reported progress percentage against the canonical baseline as of the given report date.
   *
   * Returns:
   * - null: if reportedPercent is null/undefined/non-numeric (no observation to evaluate)
   * - AnomalyPrediction: continuous anomaly score, severity ('normal' | 'review' | 'high'), and diagnostic reasons.
   *
   * Invariants:
   * 1. Safe Cold-Start: If no prior canonical observation exists, returns cold-start prediction (score 0.0, normal).
   * 2. Canonical Baseline Isolation: Uses latest canonical observation as of reportDate before the new observation is committed.
   * 3. Read-Only: Never mutates activity_progress or canonical truth.
   * 4. Error Resilience: Catches internal failures and falls back to safe cold-start rather than aborting the caller.
   */
  evaluateProgressAnomaly(input: EvaluateProgressAnomalyInput): MaybePromise<AnomalyPrediction | null>;
}
