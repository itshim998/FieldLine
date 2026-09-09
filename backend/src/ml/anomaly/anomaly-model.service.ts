import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnomalyModelArtifact,
  AnomalyFeatureVector,
  AnomalyPrediction,
  AnomalySeverity,
  ANOMALY_FEATURE_NAMES,
  COLD_START_ANOMALY_PREDICTION,
  SUPPORTED_ANOMALY_MODEL_VERSION
} from '../types.js';
import { anomalyFeatureVectorToArray } from './anomaly-feature-extractor.js';
import { ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface AnomalyModelServiceOptions {
  artifactPath?: string;
  artifact?: AnomalyModelArtifact;
  strict?: boolean;
}

/**
 * Validates an AnomalyModelArtifact object against canonical constraints.
 * Throws a ValidationError if the artifact is missing required fields, has mismatched
 * dimensions, contains non-finite numbers, non-positive standard deviations, or invalid thresholds.
 *
 * Invariant: Never silently repairs invalid learned parameters.
 */
export function validateAnomalyModelArtifact(data: unknown): AnomalyModelArtifact {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Anomaly Model artifact must be a valid JSON object');
  }

  const art = data as Partial<AnomalyModelArtifact>;

  if (art.modelType !== 'standardized_distance_anomaly') {
    throw new ValidationError(`Expected modelType 'standardized_distance_anomaly', got '${art.modelType}'`);
  }

  if (typeof art.version !== 'string' || art.version.trim().length === 0) {
    throw new ValidationError('Anomaly Model artifact missing valid version string');
  }

  if (art.version !== SUPPORTED_ANOMALY_MODEL_VERSION) {
    throw new ValidationError(
      `Unsupported Anomaly Model artifact version: expected '${SUPPORTED_ANOMALY_MODEL_VERSION}', got '${art.version}'`
    );
  }

  // Verify feature names
  if (!Array.isArray(art.featureNames) || art.featureNames.length !== ANOMALY_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Anomaly Model artifact featureNames must have length ${ANOMALY_FEATURE_NAMES.length}, got ${art.featureNames?.length}`
    );
  }

  for (let i = 0; i < ANOMALY_FEATURE_NAMES.length; i++) {
    if (art.featureNames[i] !== ANOMALY_FEATURE_NAMES[i]) {
      throw new ValidationError(
        `Feature name mismatch at index ${i}: expected '${ANOMALY_FEATURE_NAMES[i]}', got '${art.featureNames[i]}'`
      );
    }
  }

  // Verify means: must be finite numbers
  if (!Array.isArray(art.means) || art.means.length !== ANOMALY_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Anomaly Model artifact means must have length ${ANOMALY_FEATURE_NAMES.length}, got ${art.means?.length}`
    );
  }
  for (let i = 0; i < art.means.length; i++) {
    const val = art.means[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new ValidationError(`Non-finite mean parameter detected at index ${i}: ${val}`);
    }
  }

  // Verify standard deviations: must be finite and strictly > 0 (no zero or negative stds)
  if (!Array.isArray(art.stds) || art.stds.length !== ANOMALY_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Anomaly Model artifact stds must have length ${ANOMALY_FEATURE_NAMES.length}, got ${art.stds?.length}`
    );
  }
  for (let i = 0; i < art.stds.length; i++) {
    const val = art.stds[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new ValidationError(`Non-finite std parameter detected at index ${i}: ${val}`);
    }
    if (val <= 0) {
      throw new ValidationError(
        `Standard deviation at index ${i} must be strictly positive (> 0), got: ${val}`
      );
    }
  }

  // Verify d95: must be finite number > 0
  if (typeof art.d95 !== 'number' || !Number.isFinite(art.d95) || art.d95 <= 0) {
    throw new ValidationError(`Invalid d95 scale in artifact: must be a finite number > 0, got: ${art.d95}`);
  }

  // Verify severityThresholds: 0 < review < high < 1.0
  if (
    !art.severityThresholds ||
    typeof art.severityThresholds.review !== 'number' ||
    !Number.isFinite(art.severityThresholds.review) ||
    typeof art.severityThresholds.high !== 'number' ||
    !Number.isFinite(art.severityThresholds.high) ||
    art.severityThresholds.review <= 0 ||
    art.severityThresholds.review >= art.severityThresholds.high ||
    art.severityThresholds.high >= 1.0
  ) {
    throw new ValidationError(
      `Invalid severityThresholds in artifact: must satisfy 0 < review < high < 1.0`
    );
  }

  return {
    modelType: art.modelType,
    version: art.version,
    featureNames: [...art.featureNames],
    means: [...art.means],
    stds: [...art.stds],
    d95: art.d95,
    severityThresholds: {
      review: art.severityThresholds.review,
      high: art.severityThresholds.high
    }
  };
}

/**
 * Native TypeScript Anomaly Inference Service (Phase 17).
 *
 * Runs unsupervised statistical anomaly scoring over progression transitions
 * to prioritize updates for human review before canonical confirmation.
 *
 * Positioning Invariant:
 * This service is NOT a lie detector or fraud detection system. It measures
 * statistical deviation from a learned normal baseline progression profile.
 */
export class AnomalyModelService {
  private artifact: AnomalyModelArtifact | null = null;
  private available: boolean = false;
  private loadError: Error | null = null;

  constructor(options: AnomalyModelServiceOptions = {}) {
    if (options.artifact) {
      try {
        this.artifact = validateAnomalyModelArtifact(options.artifact);
        this.available = true;
      } catch (err: any) {
        this.loadError = err;
        this.available = false;
        if (options.strict) {
          throw err;
        }
        logger.warn(`AnomalyModelService: Provided in-memory artifact failed validation: ${err.message}`);
      }
      return;
    }

    let artifactPath = options.artifactPath;
    if (!artifactPath) {
      const defaultPath = fileURLToPath(new URL('../artifacts/anomaly-model.json', import.meta.url));
      if (fs.existsSync(defaultPath)) {
        artifactPath = defaultPath;
      } else {
        const fallbackPath = path.resolve(process.cwd(), 'backend/src/ml/artifacts/anomaly-model.json');
        artifactPath = fs.existsSync(fallbackPath) ? fallbackPath : defaultPath;
      }
    }

    try {
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`Anomaly model artifact file not found at: ${artifactPath}`);
      }
      const rawJson = fs.readFileSync(artifactPath, 'utf-8');
      const parsed = JSON.parse(rawJson);
      this.artifact = validateAnomalyModelArtifact(parsed);
      this.available = true;
      logger.info(
        `AnomalyModelService: Successfully loaded and validated anomaly-model.json (v${this.artifact.version}, d95: ${this.artifact.d95})`
      );
    } catch (err: any) {
      this.loadError = err;
      this.available = false;
      if (options.strict) {
        throw err;
      }
      logger.warn(
        `AnomalyModelService: Anomaly model inference is unavailable due to load/validation failure: ${err.message}. Gracefully falling back to cold-start normal classification.`
      );
    }
  }

  isAvailable(): boolean {
    return this.available && this.artifact !== null;
  }

  getLoadError(): Error | null {
    return this.loadError;
  }

  getArtifact(): Readonly<AnomalyModelArtifact> | null {
    return this.artifact ? { ...this.artifact } : null;
  }

  /**
   * Safe cold-start fallback when prior canonical history is unavailable.
   */
  getColdStartPrediction(): AnomalyPrediction {
    return { ...COLD_START_ANOMALY_PREDICTION };
  }

  /**
   * Predicts anomaly score and severity band for an incoming progression observation vector.
   *
   * 1. Standardizes features: z_i = (x_i - μ_i) / σ_i
   * 2. Standardized Euclidean distance: D(x) = sqrt(sum(z_i^2))
   * 3. Continuous anomaly score: 1 - 1 / (1 + (D / d95)^2)
   *    (D = 0 -> 0.0; D = d95 -> 0.50)
   * 4. Categorizes severity against policy thresholds
   * 5. Generates statistically grounded diagnostic reasons
   */
  predict(features: AnomalyFeatureVector | number[]): AnomalyPrediction {
    if (!this.isAvailable() || !this.artifact) {
      // Graceful fallback if model is uninitialized
      return this.getColdStartPrediction();
    }

    const featureArray: number[] = Array.isArray(features)
      ? features
      : anomalyFeatureVectorToArray(features);

    if (featureArray.length !== ANOMALY_FEATURE_NAMES.length) {
      throw new ValidationError(
        `Feature vector must contain exactly ${ANOMALY_FEATURE_NAMES.length} values, got ${featureArray.length}`
      );
    }

    const { means, stds, d95, severityThresholds } = this.artifact;
    const z: number[] = new Array(ANOMALY_FEATURE_NAMES.length);
    let sumSq = 0;

    for (let i = 0; i < ANOMALY_FEATURE_NAMES.length; i++) {
      const rawVal = featureArray[i];
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) {
        throw new ValidationError(`Feature value at index ${i} is non-finite: ${rawVal}`);
      }
      const zi = (rawVal - means[i]) / stds[i];
      z[i] = zi;
      sumSq += zi * zi;
    }

    // Standardized Euclidean distance
    const distance = Math.sqrt(sumSq);

    // Continuous anomaly score: when distance === d95, score === 0.50
    const ratio = distance / d95;
    const rawScore = 1.0 - 1.0 / (1.0 + ratio * ratio);
    const anomalyScore = Math.round(rawScore * 100) / 100;

    // Severity band from exported policy thresholds
    let severity: AnomalySeverity = 'normal';
    if (anomalyScore >= severityThresholds.high) {
      severity = 'high';
    } else if (anomalyScore >= severityThresholds.review) {
      severity = 'review';
    }

    const reviewRecommended = severity !== 'normal';

    // Construct feature object for reason generator if raw array was passed
    const featureObj: AnomalyFeatureVector = Array.isArray(features)
      ? {
          progress_delta: featureArray[0],
          daily_velocity: featureArray[1],
          progress_variance: featureArray[2],
          reported_percent: featureArray[3],
          is_regression: featureArray[4]
        }
      : features;

    const reasons = this.generateReasons(featureObj, z, severity);

    return {
      anomalyScore,
      severity,
      reviewRecommended,
      reasons
    };
  }

  /**
   * Generates statistically grounded diagnostic reasons citing standardized deviations (z-scores).
   * Invariant: Does not use judgmental language ('fake', 'lying', 'fraud').
   */
  private generateReasons(
    features: AnomalyFeatureVector,
    z: number[],
    severity: AnomalySeverity
  ): string[] {
    const reasons: string[] = [];
    const [zDelta, zVel, zVar] = [z[0], z[1], z[2]];

    // 1. High daily velocity
    if (zVel > 2.5) {
      reasons.push(
        `Daily progress velocity (${features.daily_velocity}%/day) is well above learned baseline distribution (+${zVel.toFixed(1)} standard deviations from normal pacing).`
      );
    }

    // 2. Unusually large progress increment
    if (zDelta > 2.5) {
      reasons.push(
        `Reported progress increment (+${features.progress_delta}%) is far outside learned normal shift distribution (+${zDelta.toFixed(1)} standard deviations).`
      );
    }

    // 3. Significant regression
    if (features.progress_delta < 0 && zDelta < -2.5) {
      reasons.push(
        `Reported progress drop (${features.progress_delta}%) is statistically atypical relative to observed activity progression (${zDelta.toFixed(1)} standard deviations from baseline).`
      );
    } else if (features.progress_delta < 0 && Math.abs(zDelta) <= 1.5) {
      // 4. Minor reconciliation
      reasons.push(
        `Minor negative progress adjustment (${features.progress_delta}%) is consistent with normal baseline survey/measurement reconciliation variance.`
      );
    }

    // 5. Significant variance from planned progress
    if (zVar > 2.5) {
      reasons.push(
        `Reported progress is significantly ahead of planned schedule (+${features.progress_variance}% variance, +${zVar.toFixed(1)} standard deviations from baseline).`
      );
    } else if (zVar < -2.5) {
      reasons.push(
        `Reported progress is significantly behind planned schedule (${features.progress_variance}% variance, ${zVar.toFixed(1)} standard deviations from baseline).`
      );
    }

    // Default note if elevated without specific single-feature trigger
    if (severity !== 'normal' && reasons.length === 0) {
      reasons.push(
        `Multidimensional progression characteristics deviate noticeably from the learned activity baseline; supervisor verification recommended.`
      );
    }

    return reasons;
  }
}

export const defaultAnomalyModelService = new AnomalyModelService();
