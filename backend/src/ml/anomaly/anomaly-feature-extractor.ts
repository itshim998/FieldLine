import { AnomalyFeatureVector, ANOMALY_FEATURE_NAMES } from '../types.js';
import { ActivityProgress } from '../../models/domain.types.js';
import { diffInCalendarDays } from '../../services/snapshot/progress-snapshot.calculator.js';

export interface ExtractAnomalyFeaturesInput {
  reportedPercent: number;
  priorObservation: ActivityProgress | null;
  plannedPercent: number;
  reportDate: string;
}

/**
 * Extracts the 5 canonical anomaly features from candidate update facts and prior canonical history.
 *
 * Invariant: If priorObservation is null (cold start), returns null so caller can
 * assign the safe COLD_START_ANOMALY_PREDICTION rather than inventing synthetic history.
 */
export function extractAnomalyFeatures(
  input: ExtractAnomalyFeaturesInput
): AnomalyFeatureVector | null {
  const { reportedPercent, priorObservation, plannedPercent, reportDate } = input;

  // Cold start safety invariant: do not fabricate previous progress
  if (!priorObservation) {
    return null;
  }

  // 1. progress_delta: Δp = current reported % - previous actual %
  const delta = Math.round((reportedPercent - priorObservation.actualPercent) * 100) / 100;

  // 2. daily_velocity: Δp / max(1, days_since_previous_update)
  const priorDate = (priorObservation.asOfDate || '').slice(0, 10);
  const repDate = (reportDate || '').slice(0, 10);
  let daysDiff = 1;
  try {
    daysDiff = Math.max(0, diffInCalendarDays(priorDate, repDate));
  } catch {
    daysDiff = 1;
  }
  const velocity = Math.round((delta / Math.max(1, daysDiff)) * 100) / 100;

  // 3. progress_variance: current reported % - planned % as-of report date
  const variance = Math.round((reportedPercent - plannedPercent) * 100) / 100;

  // 4. reported_percent: current reported %
  const reported = reportedPercent;

  // 5. is_regression: 1.0 if Δp < 0, else 0.0
  const isRegression = delta < 0 ? 1.0 : 0.0;

  return {
    progress_delta: delta,
    daily_velocity: velocity,
    progress_variance: variance,
    reported_percent: reported,
    is_regression: isRegression
  };
}

/**
 * Converts AnomalyFeatureVector to array in exact canonical order:
 * [progress_delta, daily_velocity, progress_variance, reported_percent, is_regression]
 */
export function anomalyFeatureVectorToArray(features: AnomalyFeatureVector): number[] {
  return [
    features.progress_delta,
    features.daily_velocity,
    features.progress_variance,
    features.reported_percent,
    features.is_regression
  ];
}
