import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  verifyProductionModels,
  VerificationResult
} from '../../scripts/ml/verify-production-models.js';
import { validateMatchModelArtifact } from '../src/ml/match/match-model.service.js';
import { validateAnomalyModelArtifact } from '../src/ml/anomaly/anomaly-model.service.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Phase 26 — Production Model Verification Suite', () => {
  it('1. Executes full production model verification and passes all invariant checks', () => {
    const result: VerificationResult = verifyProductionModels({ silent: true });

    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(10);

    const checkNames = result.checks.map((c) => c.name);
    expect(checkNames).toEqual([
      'match-model.json exists',
      'match artifact schema valid',
      'match feature contract valid',
      'match inference smoke test passed',
      'anomaly-model.json exists',
      'anomaly artifact schema valid',
      'anomaly feature contract valid',
      'anomaly inference smoke tests passed',
      'legacy distanceThreshold absent',
      'production inference path validated'
    ]);

    for (const check of result.checks) {
      expect(check.status).toBe('passed');
      expect(check.error).toBeUndefined();
    }
  });

  it('2. REFINERY-U4 golden scenario smoke tests produce valid advisory outputs', () => {
    const result = verifyProductionModels({ silent: true });
    expect(result.passed).toBe(true);
    expect(result.scenarioResults).toBeDefined();

    const { scenarioA, scenarioB, scenarioC } = result.scenarioResults!;

    // Scenario A: Match Model Reranking
    expect(scenarioA.matchScore).toBeGreaterThanOrEqual(0.70);
    expect(scenarioA.matchScore).toBeLessThanOrEqual(1.0);

    // Scenario B: Elevated Velocity Anomaly Alert
    expect(scenarioB.anomalyScore).toBeGreaterThanOrEqual(0.75);
    expect(scenarioB.severity).toBe('high');
    expect(scenarioB.reviewRecommended).toBe(true);
    expect(scenarioB.reasons.length).toBeGreaterThan(0);
    expect(scenarioB.reasons[0]).toMatch(/standard deviation/i);

    // Scenario C: Normal Steady Step Control
    expect(scenarioC.anomalyScore).toBeLessThan(0.30);
    expect(scenarioC.severity).toBe('normal');
    expect(scenarioC.reviewRecommended).toBe(false);
  });

  it('3. Fails clearly when an authoritative artifact file is missing', () => {
    const emptyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldline-empty-'));
    try {
      const result = verifyProductionModels({ silent: true, repoRoot: emptyTempDir });
      expect(result.passed).toBe(false);
      const failedCheck = result.checks.find((c) => c.status === 'failed');
      expect(failedCheck).toBeDefined();
      expect(failedCheck?.name).toBe('match-model.json exists');
      expect(failedCheck?.error).toMatch(/File not found/i);
    } finally {
      fs.rmSync(emptyTempDir, { recursive: true, force: true });
    }
  });

  it('4. Rejects obsolete distanceThreshold parameter if present in anomaly artifact', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldline-legacy-'));
    const artDir = path.join(tempDir, 'backend', 'src', 'ml', 'artifacts');
    fs.mkdirSync(artDir, { recursive: true });

    // Copy valid match model
    const realMatchPath = path.resolve(process.cwd(), 'backend/src/ml/artifacts/match-model.json');
    fs.copyFileSync(realMatchPath, path.join(artDir, 'match-model.json'));

    // Create anomaly model with legacy distanceThreshold
    const realAnomalyPath = path.resolve(process.cwd(), 'backend/src/ml/artifacts/anomaly-model.json');
    const anomalyJson = JSON.parse(fs.readFileSync(realAnomalyPath, 'utf-8'));
    anomalyJson.distanceThreshold = 3.5; // Injected obsolete parameter
    fs.writeFileSync(path.join(artDir, 'anomaly-model.json'), JSON.stringify(anomalyJson));

    try {
      const result = verifyProductionModels({ silent: true, repoRoot: tempDir });
      expect(result.passed).toBe(false);
      const legacyCheck = result.checks.find((c) => c.name === 'legacy distanceThreshold absent');
      expect(legacyCheck?.status).toBe('failed');
      expect(legacyCheck?.error).toMatch(/distanceThreshold.*must be absent/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. Rejects anomaly artifacts with non-positive standard deviations', () => {
    const invalidAnomaly = {
      modelType: 'standardized_distance_anomaly',
      version: '1.0.0',
      featureNames: [
        'progress_delta',
        'daily_velocity',
        'progress_variance',
        'reported_percent',
        'is_regression'
      ],
      means: [11.94, 5.12, -0.32, 54.38, 0.09],
      stds: [9.1, 2.7, 0.0, 31.9, 0.29], // zero std at index 2
      d95: 4.22,
      severityThresholds: { review: 0.5, high: 0.75 }
    };

    expect(() => validateAnomalyModelArtifact(invalidAnomaly)).toThrow(ValidationError);
    expect(() => validateAnomalyModelArtifact(invalidAnomaly)).toThrow(/strictly positive/i);
  });

  it('6. Rejects match artifacts with feature ordering mismatch', () => {
    const invalidMatch = {
      modelType: 'logistic_regression',
      version: '1.0.0',
      featureNames: [
        'description_similarity', // Inverted order
        'name_similarity',
        'location_exact_match',
        'location_similarity',
        'location_contradiction',
        'wbs_match',
        'exact_id_match',
        'score_gap_from_second_candidate'
      ],
      means: [0.1, 0.1, 0.5, 0.6, 0.2, 0.06, 0.06, 0.12],
      stds: [0.2, 0.1, 0.4, 0.3, 0.4, 0.2, 0.2, 0.2],
      weights: [1.1, 1.5, 0.4, 0.3, -0.4, 1.1, 0.5, 1.6],
      bias: -0.5,
      threshold: 0.5
    };

    expect(() => validateMatchModelArtifact(invalidMatch)).toThrow(ValidationError);
    expect(() => validateMatchModelArtifact(invalidMatch)).toThrow(/Feature name mismatch at index 0/i);
  });
});
