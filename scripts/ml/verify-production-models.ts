/**
 * Phase 26 — FieldLine ML Production Model Verification Script
 *
 * Lightweight, deterministic, developer-side production sanity verifier.
 * Validates that authoritative model artifacts exist, adhere strictly to schemas
 * and feature order contracts, reject obsolete parameters (distanceThreshold),
 * and successfully produce valid inference through native TypeScript services
 * without mutating database state.
 *
 * Usage:
 *   npm run ml:verify
 *   npx tsx scripts/ml/verify-production-models.ts
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MATCH_FEATURE_NAMES,
  ANOMALY_FEATURE_NAMES,
  MatchFeatureVector,
  AnomalyFeatureVector
} from '../../backend/src/ml/types.js';
import {
  MatchModelService,
  validateMatchModelArtifact
} from '../../backend/src/ml/match/match-model.service.js';
import {
  AnomalyModelService,
  validateAnomalyModelArtifact
} from '../../backend/src/ml/anomaly/anomaly-model.service.js';
import { extractMatchFeatures } from '../../backend/src/ml/match/match-feature-extractor.js';
import { logger } from '../../backend/src/config/logger.js';

// Silence background info logging for clean verification output
logger.info = () => {};
logger.debug = () => {};

export interface VerificationCheck {
  name: string;
  status: 'passed' | 'failed';
  error?: string;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  scenarioResults?: {
    scenarioA: { matchScore: number };
    scenarioB: { anomalyScore: number; severity: string; reviewRecommended: boolean; reasons: string[] };
    scenarioC: { anomalyScore: number; severity: string; reviewRecommended: boolean };
  };
}

export interface VerifyOptions {
  silent?: boolean;
  repoRoot?: string;
}

/**
 * Runs the full production model verification suite.
 */
export function verifyProductionModels(options: VerifyOptions = {}): VerificationResult {
  const silent = options.silent ?? false;
  const checks: VerificationCheck[] = [];

  const log = (msg: string) => {
    if (!silent) console.log(msg);
  };
  const logError = (msg: string) => {
    if (!silent) console.error(msg);
  };

  const recordPass = (name: string) => {
    checks.push({ name, status: 'passed' });
    log(`✓ ${name}`);
  };

  const recordFail = (name: string, error: string) => {
    checks.push({ name, status: 'failed', error });
    logError(`✗ ${name}: ${error}`);
  };

  log('[ML VERIFY] Starting production model verification...\n');

  const repoRoot =
    options.repoRoot ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const matchPath = path.resolve(repoRoot, 'backend/src/ml/artifacts/match-model.json');
  const anomalyPath = path.resolve(repoRoot, 'backend/src/ml/artifacts/anomaly-model.json');

  let rawMatch: any = null;
  let rawAnomaly: any = null;
  let matchService: MatchModelService | null = null;
  let anomalyService: AnomalyModelService | null = null;

  // -------------------------------------------------------------------------
  // 1. MATCH MODEL ARTIFACT CHECKS
  // -------------------------------------------------------------------------

  // Check 1: match-model.json exists
  try {
    if (!fs.existsSync(matchPath)) {
      throw new Error(`File not found at: ${matchPath}`);
    }
    const content = fs.readFileSync(matchPath, 'utf-8');
    rawMatch = JSON.parse(content);
    recordPass('match-model.json exists');
  } catch (err: any) {
    recordFail('match-model.json exists', err.message);
    return { passed: false, checks };
  }

  // Check 2: match artifact schema valid
  try {
    if (!rawMatch || typeof rawMatch !== 'object') {
      throw new Error('match-model.json must be a valid JSON object');
    }
    if (rawMatch.modelType !== 'logistic_regression') {
      throw new Error(`Expected modelType 'logistic_regression', got '${rawMatch.modelType}'`);
    }
    if (typeof rawMatch.version !== 'string' || rawMatch.version.trim().length === 0) {
      throw new Error('Missing or empty version string');
    }
    if (!Array.isArray(rawMatch.means) || rawMatch.means.length !== 8) {
      throw new Error(`means must have exactly 8 elements, got ${rawMatch.means?.length}`);
    }
    for (let i = 0; i < 8; i++) {
      const v = rawMatch.means[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`means[${i}] must be a finite number, got ${v}`);
      }
    }
    if (!Array.isArray(rawMatch.stds) || rawMatch.stds.length !== 8) {
      throw new Error(`stds must have exactly 8 elements, got ${rawMatch.stds?.length}`);
    }
    for (let i = 0; i < 8; i++) {
      const v = rawMatch.stds[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(`stds[${i}] must be a finite number > 0, got ${v}`);
      }
    }
    if (!Array.isArray(rawMatch.weights) || rawMatch.weights.length !== 8) {
      throw new Error(`weights must have exactly 8 elements, got ${rawMatch.weights?.length}`);
    }
    for (let i = 0; i < 8; i++) {
      const v = rawMatch.weights[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`weights[${i}] must be a finite number, got ${v}`);
      }
    }
    if (typeof rawMatch.bias !== 'number' || !Number.isFinite(rawMatch.bias)) {
      throw new Error(`bias must be a finite number, got ${rawMatch.bias}`);
    }
    if (
      typeof rawMatch.threshold !== 'number' ||
      !Number.isFinite(rawMatch.threshold) ||
      rawMatch.threshold < 0 ||
      rawMatch.threshold > 1
    ) {
      throw new Error(`threshold must be a finite number in [0, 1], got ${rawMatch.threshold}`);
    }

    // Verify against production validator
    validateMatchModelArtifact(rawMatch);
    recordPass('match artifact schema valid');
  } catch (err: any) {
    recordFail('match artifact schema valid', err.message);
    return { passed: false, checks };
  }

  // Check 3: match feature contract valid
  try {
    if (!Array.isArray(rawMatch.featureNames) || rawMatch.featureNames.length !== 8) {
      throw new Error(`featureNames must have exactly 8 elements, got ${rawMatch.featureNames?.length}`);
    }
    for (let i = 0; i < MATCH_FEATURE_NAMES.length; i++) {
      if (rawMatch.featureNames[i] !== MATCH_FEATURE_NAMES[i]) {
        throw new Error(
          `Feature mismatch at index ${i}: expected '${MATCH_FEATURE_NAMES[i]}', got '${rawMatch.featureNames[i]}'`
        );
      }
    }
    recordPass('match feature contract valid');
  } catch (err: any) {
    recordFail('match feature contract valid', err.message);
    return { passed: false, checks };
  }

  // Check 4: match inference smoke test passed
  try {
    matchService = new MatchModelService({ artifactPath: matchPath, strict: true });
    if (!matchService.isAvailable()) {
      throw new Error(`MatchModelService unavailable: ${matchService.getLoadError()?.message}`);
    }

    const testFeatures: MatchFeatureVector = {
      name_similarity: 0.85,
      description_similarity: 0.70,
      location_exact_match: 1.0,
      location_similarity: 1.0,
      location_contradiction: 0.0,
      wbs_match: 1.0,
      exact_id_match: 0.0,
      score_gap_from_second_candidate: 0.25
    };

    const p = matchService.predict(testFeatures);
    if (typeof p !== 'number' || !Number.isFinite(p) || Number.isNaN(p) || p < 0 || p > 1) {
      throw new Error(`Inference returned non-finite or out-of-range output: ${p}`);
    }
    recordPass('match inference smoke test passed');
  } catch (err: any) {
    recordFail('match inference smoke test passed', err.message);
    return { passed: false, checks };
  }

  log('');

  // -------------------------------------------------------------------------
  // 2. ANOMALY MODEL ARTIFACT CHECKS
  // -------------------------------------------------------------------------

  // Check 5: anomaly-model.json exists
  try {
    if (!fs.existsSync(anomalyPath)) {
      throw new Error(`File not found at: ${anomalyPath}`);
    }
    const content = fs.readFileSync(anomalyPath, 'utf-8');
    rawAnomaly = JSON.parse(content);
    recordPass('anomaly-model.json exists');
  } catch (err: any) {
    recordFail('anomaly-model.json exists', err.message);
    return { passed: false, checks };
  }

  // Check 6: anomaly artifact schema valid
  try {
    if (!rawAnomaly || typeof rawAnomaly !== 'object') {
      throw new Error('anomaly-model.json must be a valid JSON object');
    }
    if (rawAnomaly.modelType !== 'standardized_distance_anomaly') {
      throw new Error(`Expected modelType 'standardized_distance_anomaly', got '${rawAnomaly.modelType}'`);
    }
    if (typeof rawAnomaly.version !== 'string' || rawAnomaly.version.trim().length === 0) {
      throw new Error('Missing or empty version string');
    }
    if (!Array.isArray(rawAnomaly.means) || rawAnomaly.means.length !== 5) {
      throw new Error(`means must have exactly 5 elements, got ${rawAnomaly.means?.length}`);
    }
    for (let i = 0; i < 5; i++) {
      const v = rawAnomaly.means[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`means[${i}] must be a finite number, got ${v}`);
      }
    }
    if (!Array.isArray(rawAnomaly.stds) || rawAnomaly.stds.length !== 5) {
      throw new Error(`stds must have exactly 5 elements, got ${rawAnomaly.stds?.length}`);
    }
    for (let i = 0; i < 5; i++) {
      const v = rawAnomaly.stds[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
        throw new Error(`stds[${i}] must be a finite number strictly > 0, got ${v}`);
      }
    }
    if (typeof rawAnomaly.d95 !== 'number' || !Number.isFinite(rawAnomaly.d95) || rawAnomaly.d95 <= 0) {
      throw new Error(`d95 must be a finite number strictly > 0, got ${rawAnomaly.d95}`);
    }
    if (
      !rawAnomaly.severityThresholds ||
      typeof rawAnomaly.severityThresholds.review !== 'number' ||
      !Number.isFinite(rawAnomaly.severityThresholds.review) ||
      typeof rawAnomaly.severityThresholds.high !== 'number' ||
      !Number.isFinite(rawAnomaly.severityThresholds.high) ||
      rawAnomaly.severityThresholds.review <= 0 ||
      rawAnomaly.severityThresholds.review >= rawAnomaly.severityThresholds.high ||
      rawAnomaly.severityThresholds.high >= 1.0
    ) {
      throw new Error('severityThresholds must satisfy 0 < review < high < 1.0');
    }

    // Verify against production validator
    validateAnomalyModelArtifact(rawAnomaly);
    recordPass('anomaly artifact schema valid');
  } catch (err: any) {
    recordFail('anomaly artifact schema valid', err.message);
    return { passed: false, checks };
  }

  // Check 7: anomaly feature contract valid
  try {
    if (!Array.isArray(rawAnomaly.featureNames) || rawAnomaly.featureNames.length !== 5) {
      throw new Error(`featureNames must have exactly 5 elements, got ${rawAnomaly.featureNames?.length}`);
    }
    for (let i = 0; i < ANOMALY_FEATURE_NAMES.length; i++) {
      if (rawAnomaly.featureNames[i] !== ANOMALY_FEATURE_NAMES[i]) {
        throw new Error(
          `Feature mismatch at index ${i}: expected '${ANOMALY_FEATURE_NAMES[i]}', got '${rawAnomaly.featureNames[i]}'`
        );
      }
    }
    recordPass('anomaly feature contract valid');
  } catch (err: any) {
    recordFail('anomaly feature contract valid', err.message);
    return { passed: false, checks };
  }

  // Check 8: anomaly inference smoke tests passed
  try {
    anomalyService = new AnomalyModelService({ artifactPath: anomalyPath, strict: true });
    if (!anomalyService.isAvailable()) {
      throw new Error(`AnomalyModelService unavailable: ${anomalyService.getLoadError()?.message}`);
    }

    // Normal smoke case
    const normalFeatures: AnomalyFeatureVector = {
      progress_delta: 3,
      daily_velocity: 3,
      progress_variance: -2,
      reported_percent: 65,
      is_regression: 0
    };
    const normalPred = anomalyService.predict(normalFeatures);
    if (
      typeof normalPred.anomalyScore !== 'number' ||
      !Number.isFinite(normalPred.anomalyScore) ||
      normalPred.anomalyScore < 0 ||
      normalPred.anomalyScore > 1 ||
      normalPred.severity !== 'normal' ||
      normalPred.reviewRecommended !== false ||
      !Array.isArray(normalPred.reasons)
    ) {
      throw new Error(`Normal case inference returned unexpected output: ${JSON.stringify(normalPred)}`);
    }

    // Extreme smoke case
    const extremeFeatures: AnomalyFeatureVector = {
      progress_delta: 50,
      daily_velocity: 50,
      progress_variance: 45,
      reported_percent: 95,
      is_regression: 0
    };
    const extremePred = anomalyService.predict(extremeFeatures);
    if (
      typeof extremePred.anomalyScore !== 'number' ||
      !Number.isFinite(extremePred.anomalyScore) ||
      extremePred.anomalyScore < 0 ||
      extremePred.anomalyScore > 1 ||
      extremePred.severity !== 'high' ||
      extremePred.reviewRecommended !== true ||
      !Array.isArray(extremePred.reasons) ||
      extremePred.reasons.length === 0
    ) {
      throw new Error(`Extreme case inference returned unexpected output: ${JSON.stringify(extremePred)}`);
    }

    recordPass('anomaly inference smoke tests passed');
  } catch (err: any) {
    recordFail('anomaly inference smoke tests passed', err.message);
    return { passed: false, checks };
  }

  // Check 9: legacy distanceThreshold absent
  try {
    if ('distanceThreshold' in rawAnomaly) {
      throw new Error("Obsolete parameter 'distanceThreshold' must be absent from anomaly-model.json");
    }
    recordPass('legacy distanceThreshold absent');
  } catch (err: any) {
    recordFail('legacy distanceThreshold absent', err.message);
    return { passed: false, checks };
  }

  log('');

  // -------------------------------------------------------------------------
  // 3. REFINERY-U4 GOLDEN DEMO COMPATIBILITY SMOKE TESTS
  // -------------------------------------------------------------------------

  let scenarioResults: VerificationResult['scenarioResults'] | undefined;

  try {
    if (!matchService || !anomalyService) {
      throw new Error('Inference services uninitialized');
    }

    // Scenario A: "Pump foundation piles completed to 65% at Area B crude pump bay" -> ACT-B02
    const featA = extractMatchFeatures(
      {
        reference: 'Pump foundation piles completed to 65% at Area B crude pump bay',
        location: 'Area B'
      },
      {
        externalId: 'ACT-B02',
        name: 'Crude Pump Foundation Piling Works',
        description: 'Driven pile foundations for crude charge pumps P-101A/B',
        location: 'Area B',
        wbsCode: 'WBS-B.02'
      },
      0.25
    );
    const scoreA = matchService.predict(featA);
    if (typeof scoreA !== 'number' || !Number.isFinite(scoreA) || scoreA < 0 || scoreA > 1) {
      throw new Error(`Scenario A match inference produced invalid score: ${scoreA}`);
    }

    // Scenario B: "Crude pump foundation piling jumped to 98% complete today" (from 65% in 1 day)
    const featB: AnomalyFeatureVector = {
      progress_delta: 33,
      daily_velocity: 33,
      progress_variance: 30,
      reported_percent: 98,
      is_regression: 0
    };
    const predB = anomalyService.predict(featB);
    if (
      typeof predB.anomalyScore !== 'number' ||
      !Number.isFinite(predB.anomalyScore) ||
      predB.anomalyScore < 0 ||
      predB.anomalyScore > 1 ||
      predB.severity !== 'high' ||
      predB.reviewRecommended !== true ||
      !Array.isArray(predB.reasons) ||
      predB.reasons.length === 0
    ) {
      throw new Error(`Scenario B anomaly inference failed: ${JSON.stringify(predB)}`);
    }

    // Scenario C: "Crude pump foundation piles advanced to 68% complete today" (from 65% in 1 day)
    const featC: AnomalyFeatureVector = {
      progress_delta: 3,
      daily_velocity: 3,
      progress_variance: -3,
      reported_percent: 68,
      is_regression: 0
    };
    const predC = anomalyService.predict(featC);
    if (
      typeof predC.anomalyScore !== 'number' ||
      !Number.isFinite(predC.anomalyScore) ||
      predC.anomalyScore < 0 ||
      predC.anomalyScore > 1 ||
      predC.severity !== 'normal' ||
      predC.reviewRecommended !== false
    ) {
      throw new Error(`Scenario C anomaly inference failed: ${JSON.stringify(predC)}`);
    }

    scenarioResults = {
      scenarioA: { matchScore: scoreA },
      scenarioB: {
        anomalyScore: predB.anomalyScore,
        severity: predB.severity,
        reviewRecommended: predB.reviewRecommended,
        reasons: predB.reasons
      },
      scenarioC: {
        anomalyScore: predC.anomalyScore,
        severity: predC.severity,
        reviewRecommended: predC.reviewRecommended
      }
    };

    recordPass('production inference path validated');
  } catch (err: any) {
    recordFail('production inference path validated', err.message);
    return { passed: false, checks };
  }

  log('\nML production model verification: PASS');
  return { passed: true, checks, scenarioResults };
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-production-models.ts') ||
    process.argv[1].endsWith('verify-production-models.js'));

if (isMainModule) {
  try {
    const result = verifyProductionModels();
    if (!result.passed) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err: any) {
    console.error(`✗ Fatal error during production model verification: ${err.message}`);
    process.exit(1);
  }
}
