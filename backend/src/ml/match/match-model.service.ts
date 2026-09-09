import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MatchModelArtifact,
  MatchFeatureVector,
  MATCH_FEATURE_NAMES,
  MatchFeatureName,
  SUPPORTED_MATCH_MODEL_VERSION
} from '../types.js';
import { matchFeatureVectorToArray } from './match-feature-extractor.js';
import { ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export interface MatchModelServiceOptions {
  artifactPath?: string;
  artifact?: MatchModelArtifact;
  strict?: boolean;
}

/**
 * Validates a MatchModelArtifact object against canonical constraints.
 * Throws a ValidationError if the artifact is missing required fields, has mismatched
 * dimensions, contains non-finite numbers, or has non-positive standard deviations.
 * Never silently repairs invalid learned parameters.
 */
export function validateMatchModelArtifact(data: unknown): MatchModelArtifact {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Match Model artifact must be a valid JSON object');
  }

  const art = data as Partial<MatchModelArtifact>;

  if (art.modelType !== 'logistic_regression') {
    throw new ValidationError(`Expected modelType 'logistic_regression', got '${art.modelType}'`);
  }

  if (typeof art.version !== 'string' || art.version.trim().length === 0) {
    throw new ValidationError('Match Model artifact missing valid version string');
  }

  if (art.version !== SUPPORTED_MATCH_MODEL_VERSION) {
    throw new ValidationError(
      `Unsupported Match Model artifact version: expected '${SUPPORTED_MATCH_MODEL_VERSION}', got '${art.version}'`
    );
  }

  // Verify feature names
  if (!Array.isArray(art.featureNames) || art.featureNames.length !== MATCH_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Match Model artifact featureNames must have length ${MATCH_FEATURE_NAMES.length}, got ${art.featureNames?.length}`
    );
  }

  for (let i = 0; i < MATCH_FEATURE_NAMES.length; i++) {
    if (art.featureNames[i] !== MATCH_FEATURE_NAMES[i]) {
      throw new ValidationError(
        `Feature name mismatch at index ${i}: expected '${MATCH_FEATURE_NAMES[i]}', got '${art.featureNames[i]}'`
      );
    }
  }

  // Verify means
  if (!Array.isArray(art.means) || art.means.length !== MATCH_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Match Model artifact means must have length ${MATCH_FEATURE_NAMES.length}, got ${art.means?.length}`
    );
  }
  for (let i = 0; i < art.means.length; i++) {
    const val = art.means[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new ValidationError(`Non-finite mean parameter detected at index ${i}: ${val}`);
    }
  }

  // Verify standard deviations: must be finite and strictly > 0
  if (!Array.isArray(art.stds) || art.stds.length !== MATCH_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Match Model artifact stds must have length ${MATCH_FEATURE_NAMES.length}, got ${art.stds?.length}`
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

  // Verify weights
  if (!Array.isArray(art.weights) || art.weights.length !== MATCH_FEATURE_NAMES.length) {
    throw new ValidationError(
      `Match Model artifact weights must have length ${MATCH_FEATURE_NAMES.length}, got ${art.weights?.length}`
    );
  }
  for (let i = 0; i < art.weights.length; i++) {
    const val = art.weights[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new ValidationError(`Non-finite weight parameter detected at index ${i}: ${val}`);
    }
  }

  // Verify bias
  if (typeof art.bias !== 'number' || !Number.isFinite(art.bias)) {
    throw new ValidationError(`Non-finite bias parameter detected: ${art.bias}`);
  }

  // Verify threshold
  if (
    typeof art.threshold !== 'number' ||
    !Number.isFinite(art.threshold) ||
    art.threshold < 0 ||
    art.threshold > 1
  ) {
    throw new ValidationError(`Decision threshold must be a finite number in [0, 1], got: ${art.threshold}`);
  }

  return {
    modelType: art.modelType,
    version: art.version,
    featureNames: [...art.featureNames],
    means: [...art.means],
    stds: [...art.stds],
    weights: [...art.weights],
    bias: art.bias,
    threshold: art.threshold
  };
}

/**
 * Numerically protected sigmoid function.
 * Clips z to [-25.0, 25.0] to prevent overflow/underflow and NaN/Infinity.
 */
export function safeSigmoid(z: number): number {
  if (Number.isNaN(z)) {
    return 0.5;
  }
  const zClipped = Math.max(-25.0, Math.min(25.0, z));
  return 1.0 / (1.0 + Math.exp(-zClipped));
}

/**
 * Native TypeScript Match Model Inference Service (Phase 9).
 *
 * Runs offline-trained logistic regression inference directly in Node.js
 * with zero production ML framework dependencies.
 */
export class MatchModelService {
  private artifact: MatchModelArtifact | null = null;
  private available: boolean = false;
  private loadError: Error | null = null;

  constructor(options: MatchModelServiceOptions = {}) {
    if (options.artifact) {
      try {
        this.artifact = validateMatchModelArtifact(options.artifact);
        this.available = true;
      } catch (err: any) {
        this.loadError = err;
        this.available = false;
        if (options.strict) {
          throw err;
        }
        logger.warn(`MatchModelService: Provided in-memory artifact failed validation: ${err.message}`);
      }
      return;
    }

    let artifactPath = options.artifactPath;
    if (!artifactPath) {
      const defaultPath = fileURLToPath(new URL('../artifacts/match-model.json', import.meta.url));
      if (fs.existsSync(defaultPath)) {
        artifactPath = defaultPath;
      } else {
        const fallbackPath = path.resolve(process.cwd(), 'backend/src/ml/artifacts/match-model.json');
        artifactPath = fs.existsSync(fallbackPath) ? fallbackPath : defaultPath;
      }
    }

    try {
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`Match model artifact file not found at: ${artifactPath}`);
      }
      const rawJson = fs.readFileSync(artifactPath, 'utf-8');
      const parsed = JSON.parse(rawJson);
      this.artifact = validateMatchModelArtifact(parsed);
      this.available = true;
      logger.info(
        `MatchModelService: Successfully loaded and validated match-model.json (v${this.artifact.version})`
      );
    } catch (err: any) {
      this.loadError = err;
      this.available = false;
      if (options.strict) {
        throw err;
      }
      logger.warn(
        `MatchModelService: ML match model inference is unavailable due to load/validation failure: ${err.message}. Gracefully falling back to deterministic candidate scores.`
      );
    }
  }

  /**
   * Returns true if a valid learned Match Model artifact is loaded and ready for inference.
   */
  isAvailable(): boolean {
    return this.available && this.artifact !== null;
  }

  /**
   * Returns the error that caused model initialization to fail, if any.
   */
  getLoadError(): Error | null {
    return this.loadError;
  }

  /**
   * Returns a read-only copy of the active model artifact parameters, or null if unavailable.
   */
  getArtifact(): Readonly<MatchModelArtifact> | null {
    return this.artifact ? { ...this.artifact } : null;
  }

  /**
   * Predicts match probability p ∈ [0, 1] from candidate-level features.
   *
   * Standardizes input features using learned training means and standard deviations:
   *   x'_i = (x_i - μ_i) / σ_i
   *
   * Computes linear logit:
   *   z = ∑ w_i x'_i + b
   *
   * Applies numerically protected sigmoid:
   *   p = 1 / (1 + e^-z)
   *
   * Throws an error if the model artifact is not available.
   */
  predict(features: MatchFeatureVector | number[]): number {
    if (!this.isAvailable() || !this.artifact) {
      throw new Error(
        `MatchModelService: Cannot predict because model artifact is unavailable (${this.loadError?.message || 'not loaded'})`
      );
    }

    const featureArray: number[] = Array.isArray(features)
      ? features
      : matchFeatureVectorToArray(features);

    if (featureArray.length !== MATCH_FEATURE_NAMES.length) {
      throw new ValidationError(
        `Feature vector must contain exactly ${MATCH_FEATURE_NAMES.length} values, got ${featureArray.length}`
      );
    }

    const { means, stds, weights, bias } = this.artifact;
    let z = bias;

    for (let i = 0; i < MATCH_FEATURE_NAMES.length; i++) {
      const rawVal = featureArray[i];
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) {
        throw new ValidationError(`Feature value at index ${i} is non-finite: ${rawVal}`);
      }
      const standardized = (rawVal - means[i]) / stds[i];
      z += weights[i] * standardized;
    }

    const p = safeSigmoid(z);
    return Math.round(p * 10000) / 10000;
  }
}

export const defaultMatchModelService = new MatchModelService();
