import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MatchModelService,
  validateMatchModelArtifact
} from '../src/ml/match/match-model.service.js';
import {
  AnomalyModelService,
  validateAnomalyModelArtifact
} from '../src/ml/anomaly/anomaly-model.service.js';
import {
  SUPPORTED_MATCH_MODEL_VERSION,
  SUPPORTED_ANOMALY_MODEL_VERSION,
  MATCH_FEATURE_NAMES,
  ANOMALY_FEATURE_NAMES,
  MatchModelArtifact,
  AnomalyModelArtifact
} from '../src/ml/types.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('Phase 32 — ML Semantic Versioning & Feature Contract Certification', () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const matchArtifactPath = path.resolve(currentDir, '../src/ml/artifacts/match-model.json');
  const anomalyArtifactPath = path.resolve(currentDir, '../src/ml/artifacts/anomaly-model.json');

  const validMatchArtifact: MatchModelArtifact = JSON.parse(fs.readFileSync(matchArtifactPath, 'utf-8'));
  const validAnomalyArtifact: AnomalyModelArtifact = JSON.parse(fs.readFileSync(anomalyArtifactPath, 'utf-8'));

  // ---------------------------------------------------------------------------
  // 1. Certified Artifact Version & Contract Verification
  // ---------------------------------------------------------------------------
  it('Certified production match-model.json declares version 1.0.0 and canonical 8-feature contract', () => {
    expect(validMatchArtifact.version).toBe('1.0.0');
    expect(validMatchArtifact.version).toBe(SUPPORTED_MATCH_MODEL_VERSION);
    expect(validMatchArtifact.featureNames).toHaveLength(8);
    expect(validMatchArtifact.featureNames).toEqual([...MATCH_FEATURE_NAMES]);

    const service = new MatchModelService({ artifact: validMatchArtifact, strict: true });
    expect(service.isAvailable()).toBe(true);
    expect(service.getArtifact()?.version).toBe('1.0.0');
  });

  it('Certified production anomaly-model.json declares version 1.0.0 and canonical 5-feature contract', () => {
    expect(validAnomalyArtifact.version).toBe('1.0.0');
    expect(validAnomalyArtifact.version).toBe(SUPPORTED_ANOMALY_MODEL_VERSION);
    expect(validAnomalyArtifact.featureNames).toHaveLength(5);
    expect(validAnomalyArtifact.featureNames).toEqual([...ANOMALY_FEATURE_NAMES]);

    const service = new AnomalyModelService({ artifact: validAnomalyArtifact, strict: true });
    expect(service.isAvailable()).toBe(true);
    expect(service.getArtifact()?.version).toBe('1.0.0');
  });

  // ---------------------------------------------------------------------------
  // 2. Negative Tests: Unsupported Versions
  // ---------------------------------------------------------------------------
  it('Match Model rejects unsupported version (e.g. 0.9.0, 2.0.0, empty)', () => {
    // Version 2.0.0
    expect(() =>
      validateMatchModelArtifact({
        ...validMatchArtifact,
        version: '2.0.0'
      })
    ).toThrow(ValidationError);

    // Version 0.9.0
    expect(() =>
      validateMatchModelArtifact({
        ...validMatchArtifact,
        version: '0.9.0'
      })
    ).toThrow(/Unsupported Match Model artifact version/);

    // Missing version
    expect(() =>
      validateMatchModelArtifact({
        ...validMatchArtifact,
        version: ''
      })
    ).toThrow(/missing valid version string/);
  });

  it('Anomaly Model rejects unsupported version (e.g. 0.9.0, 2.0.0, empty)', () => {
    // Version 2.0.0
    expect(() =>
      validateAnomalyModelArtifact({
        ...validAnomalyArtifact,
        version: '2.0.0'
      })
    ).toThrow(ValidationError);

    // Version 0.9.0
    expect(() =>
      validateAnomalyModelArtifact({
        ...validAnomalyArtifact,
        version: '0.9.0'
      })
    ).toThrow(/Unsupported Anomaly Model artifact version/);

    // Missing version
    expect(() =>
      validateAnomalyModelArtifact({
        ...validAnomalyArtifact,
        version: ''
      })
    ).toThrow(/missing valid version string/);
  });

  // ---------------------------------------------------------------------------
  // 3. Negative Tests: Feature Contract Mismatches
  // ---------------------------------------------------------------------------
  it('Match Model rejects feature count or name mismatches', () => {
    // Truncated features
    expect(() =>
      validateMatchModelArtifact({
        ...validMatchArtifact,
        featureNames: validMatchArtifact.featureNames.slice(0, 7)
      })
    ).toThrow(/featureNames must have length 8/);

    // Altered feature name
    const corruptedFeatures = [...validMatchArtifact.featureNames];
    corruptedFeatures[0] = 'corrupted_feature_name';
    expect(() =>
      validateMatchModelArtifact({
        ...validMatchArtifact,
        featureNames: corruptedFeatures
      })
    ).toThrow(/Feature name mismatch at index 0/);
  });

  it('Anomaly Model rejects feature count or name mismatches', () => {
    // Truncated features
    expect(() =>
      validateAnomalyModelArtifact({
        ...validAnomalyArtifact,
        featureNames: validAnomalyArtifact.featureNames.slice(0, 4)
      })
    ).toThrow(/featureNames must have length 5/);

    // Altered feature name
    const corruptedFeatures = [...validAnomalyArtifact.featureNames];
    corruptedFeatures[1] = 'velocity_jump';
    expect(() =>
      validateAnomalyModelArtifact({
        ...validAnomalyArtifact,
        featureNames: corruptedFeatures
      })
    ).toThrow(/Feature name mismatch at index 1/);
  });

  // ---------------------------------------------------------------------------
  // 4. Loader Rejection Behavior (No Silent Fallback)
  // ---------------------------------------------------------------------------
  it('MatchModelService fails cleanly without silent fallback or dummy artifact substitution', () => {
    // Strict mode throws
    expect(
      () =>
        new MatchModelService({
          artifact: { ...validMatchArtifact, version: '9.9.9' },
          strict: true
        })
    ).toThrow(ValidationError);

    // Non-strict mode sets available=false and preserves loadError
    const service = new MatchModelService({
      artifact: { ...validMatchArtifact, version: '9.9.9' },
      strict: false
    });
    expect(service.isAvailable()).toBe(false);
    expect(service.getArtifact()).toBeNull();
    expect(service.getLoadError()?.message).toContain('Unsupported Match Model artifact version');
  });

  it('AnomalyModelService fails cleanly without silent fallback or dummy artifact substitution', () => {
    // Strict mode throws
    expect(
      () =>
        new AnomalyModelService({
          artifact: { ...validAnomalyArtifact, version: '9.9.9' },
          strict: true
        })
    ).toThrow(ValidationError);

    // Non-strict mode sets available=false and preserves loadError
    const service = new AnomalyModelService({
      artifact: { ...validAnomalyArtifact, version: '9.9.9' },
      strict: false
    });
    expect(service.isAvailable()).toBe(false);
    expect(service.getArtifact()).toBeNull();
    expect(service.getLoadError()?.message).toContain('Unsupported Anomaly Model artifact version');
  });
});
