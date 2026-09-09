"""
FieldLine Anomaly Model Offline Baseline Fitting & Export (Python 3 + NumPy)
Zero third-party ML framework dependencies.

Implements Phases 14, 15, and 16 of ChatGPT_plan.md:
1. Loads scripts/ml/datasets/anomaly_dataset.jsonl.
2. Fits baseline means and standard deviations strictly on normal progression records.
3. Standardizes normal baseline records and calculates standardized Euclidean distance.
4. Computes 95th-percentile baseline distance d95.
5. Calibrates continuous scoring and policy bands over normal and synthetic cases.
6. Exports authoritative artifact to backend/src/ml/artifacts/anomaly-model.json.
"""

import os
import sys
import json
from typing import Dict, Any, List, Tuple
import numpy as np

from common import ANOMALY_FEATURE_NAMES, load_dataset


def fit_anomaly_baseline(
    dataset_path: str
) -> Tuple[np.ndarray, np.ndarray, float, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Fits baseline means, standard deviations, and d95 strictly over normal records.
    Returns (means, stds, d95, normal_records, synthetic_records).
    """
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Anomaly dataset not found at: {dataset_path}")

    records = load_dataset(dataset_path)
    normal_records = [r for r in records if r.get('is_normal') is True]
    synthetic_records = [r for r in records if r.get('is_normal') is not True]

    if len(normal_records) < 10:
        raise ValueError(f"Insufficient normal baseline records for fitting: {len(normal_records)}")

    # Extract normal feature matrix X_normal (K, 5)
    K = len(normal_records)
    D = len(ANOMALY_FEATURE_NAMES)
    X_normal = np.zeros((K, D), dtype=np.float64)

    for i, r in enumerate(normal_records):
        feat = r['features']
        for j, name in enumerate(ANOMALY_FEATURE_NAMES):
            X_normal[i, j] = float(feat[name])

    # 1. Feature means over normal baseline
    means = np.mean(X_normal, axis=0)

    # 2. Sample standard deviations over normal baseline
    # Use ddof=1 for unbiased sample standard deviation
    stds = np.std(X_normal, axis=0, ddof=1)

    # Invariant checks: finite numbers, stds strictly positive
    for j, name in enumerate(ANOMALY_FEATURE_NAMES):
        if not np.isfinite(means[j]):
            raise ValueError(f"Non-finite mean fitted for feature '{name}': {means[j]}")
        if not np.isfinite(stds[j]) or stds[j] <= 0:
            raise ValueError(f"Invalid non-positive or non-finite std fitted for feature '{name}': {stds[j]}")

    # 3. Standardize each normal observation
    Z_normal = (X_normal - means) / stds

    # 4. Standardized Euclidean distance for each normal observation
    # D^(k) = sqrt(sum_i (z_i^(k))^2)
    distances_normal = np.sqrt(np.sum(Z_normal ** 2, axis=1))

    # 5. Compute d95 = 95th percentile of normal baseline distances
    d95 = float(np.percentile(distances_normal, 95))

    if not np.isfinite(d95) or d95 <= 0:
        raise ValueError(f"Invalid non-positive d95 calculated: {d95}")

    return means, stds, d95, normal_records, synthetic_records


def calculate_anomaly_score(
    feature_vector: np.ndarray,
    means: np.ndarray,
    stds: np.ndarray,
    d95: float
) -> Tuple[float, float, str]:
    """
    Computes standardized Euclidean distance, continuous anomaly score, and severity band.
    """
    z = (feature_vector - means) / stds
    distance = float(np.sqrt(np.sum(z ** 2)))

    # Continuous anomaly score: 1 - 1 / (1 + (D / d95)^2)
    ratio = distance / d95
    raw_score = 1.0 - (1.0 / (1.0 + ratio ** 2))
    score = round(raw_score, 2)

    # Policy thresholds
    if score >= 0.75:
        severity = 'high'
    elif score >= 0.50:
        severity = 'review'
    else:
        severity = 'normal'

    return distance, score, severity


def export_anomaly_artifact(
    output_path: str,
    means: np.ndarray,
    stds: np.ndarray,
    d95: float,
    version: str = "1.0.0"
) -> Dict[str, Any]:
    """
    Exports the validated anomaly model artifact to disk as JSON.
    Guarantees absence of distanceThreshold.
    """
    artifact: Dict[str, Any] = {
        "modelType": "standardized_distance_anomaly",
        "version": version,
        "featureNames": list(ANOMALY_FEATURE_NAMES),
        "means": [round(float(m), 4) for m in means],
        "stds": [round(float(s), 4) for s in stds],
        "d95": round(float(d95), 4),
        "severityThresholds": {
            "review": 0.50,
            "high": 0.75
        }
    }

    # Strict invariant validation before writing
    assert artifact["modelType"] == "standardized_distance_anomaly"
    assert len(artifact["featureNames"]) == 5
    assert len(artifact["means"]) == 5
    assert len(artifact["stds"]) == 5
    assert all(s > 0 for s in artifact["stds"])
    assert artifact["d95"] > 0
    assert "distanceThreshold" not in artifact

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(artifact, f, indent=2)

    return artifact


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    dataset_path = os.path.join(script_dir, 'datasets', 'anomaly_dataset.jsonl')
    artifact_path = os.path.join(script_dir, '..', '..', 'backend', 'src', 'ml', 'artifacts', 'anomaly-model.json')
    artifact_path = os.path.abspath(artifact_path)

    print("=" * 70)
    print("FieldLine ML -- Unsupervised Anomaly Model Baseline Fitting")
    print("=" * 70)
    print(f"Dataset path : {dataset_path}")
    print(f"Artifact path: {artifact_path}")

    # 1. Fit baseline parameters on normal records
    means, stds, d95, normal_records, synthetic_records = fit_anomaly_baseline(dataset_path)

    print(f"\n[Baseline Fitting Complete]")
    print(f"  Normal baseline observations: {len(normal_records)}")
    print(f"  Synthetic simulation cases  : {len(synthetic_records)} (excluded from baseline parameters)")
    print("\nFitted Feature Parameters:")
    for j, name in enumerate(ANOMALY_FEATURE_NAMES):
        print(f"  {name:<18} : Mean = {means[j]:>8.4f}, Std = {stds[j]:>8.4f}")

    print(f"\nCalibrated Distance Scale (d95): {d95:.4f}")

    # 2. Verify mathematical properties
    # 2a. Zero distance test
    zero_dist, zero_score, zero_sev = calculate_anomaly_score(means, means, stds, d95)
    print(f"\nMathematical Property Checks:")
    print(f"  Zero distance input (x = mu) -> Distance: {zero_dist:.4f}, Score: {zero_score:.2f}, Severity: {zero_sev}")
    assert zero_dist == 0.0 and zero_score == 0.0, "Zero-distance score failure!"

    # 2b. d95 distance test (x such that D = d95)
    # Construct synthetic vector at distance exactly d95
    unit_step = np.zeros(5)
    unit_step[0] = d95 * stds[0]
    test_d95_vec = means + unit_step
    d95_dist, d95_score, d95_sev = calculate_anomaly_score(test_d95_vec, means, stds, d95)
    print(f"  Boundary distance input (D = d95) -> Distance: {d95_dist:.4f}, Score: {d95_score:.2f}, Severity: {d95_sev}")
    assert abs(d95_dist - d95) < 1e-4, "Distance scale mismatch"
    assert d95_score == 0.50, f"Expected score 0.50 at d95 boundary, got {d95_score}"
    assert d95_sev == 'review', f"Expected 'review' severity at score 0.50, got {d95_sev}"

    # 3. Calibration on normal dataset records
    normal_scores = []
    normal_severities = {'normal': 0, 'review': 0, 'high': 0}
    for r in normal_records:
        x = np.array([float(r['features'][k]) for k in ANOMALY_FEATURE_NAMES])
        _, sc, sev = calculate_anomaly_score(x, means, stds, d95)
        normal_scores.append(sc)
        normal_severities[sev] += 1

    print("\nNormal Baseline Distribution Calibration:")
    print(f"  Normal band (< 0.50)       : {normal_severities['normal']}/{len(normal_records)} ({normal_severities['normal']/len(normal_records)*100:.1f}%)")
    print(f"  Review band (0.50 - 0.74)  : {normal_severities['review']}/{len(normal_records)} ({normal_severities['review']/len(normal_records)*100:.1f}%)")
    print(f"  High band (>= 0.75)        : {normal_severities['high']}/{len(normal_records)} ({normal_severities['high']/len(normal_records)*100:.1f}%)")
    # By definition of 95th percentile, ~95% must be in normal band
    normal_pct = normal_severities['normal'] / len(normal_records)
    assert normal_pct >= 0.90, f"Normal baseline calibration failure: expected >= 90%, got {normal_pct*100:.1f}%"

    # 4. Calibration on synthetic anomalies
    print("\nSynthetic Perturbation Simulation Checks:")
    synthetic_severities = {'normal': 0, 'review': 0, 'high': 0}
    for r in synthetic_records:
        x = np.array([float(r['features'][k]) for k in ANOMALY_FEATURE_NAMES])
        dist, sc, sev = calculate_anomaly_score(x, means, stds, d95)
        synthetic_severities[sev] += 1
        print(f"  [{r['scenario']:<32}] Score: {sc:.2f} -> {sev.upper():<6} (Delta_p: {r['features']['progress_delta']}%, v: {r['features']['daily_velocity']}%, D: {dist:.2f})")

    # Verify synthetic cases trigger review or high
    elevated_count = synthetic_severities['review'] + synthetic_severities['high']
    print(f"\nSynthetic Perturbation Detection Rate: {elevated_count}/{len(synthetic_records)} elevated ({elevated_count/len(synthetic_records)*100:.1f}%)")
    assert elevated_count == len(synthetic_records), "All synthetic perturbations must trigger review or high!"

    # 5. Export artifact
    artifact = export_anomaly_artifact(artifact_path, means, stds, d95)
    print(f"\n[Artifact Exported Successfully]")
    print(f"  Destination: {artifact_path}")
    print(f"  Model Type : {artifact['modelType']}")
    print(f"  Version    : {artifact['version']}")
    print(f"  Features   : {artifact['featureNames']}")
    print(f"  Means      : {artifact['means']}")
    print(f"  Stds       : {artifact['stds']}")
    print(f"  d95        : {artifact['d95']}")
    print(f"  Thresholds : {artifact['severityThresholds']}")
    print("=" * 70)


if __name__ == '__main__':
    main()
