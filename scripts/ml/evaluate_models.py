"""
FieldLine ML Models Evaluation Script (Python 3 + NumPy)
Evaluates trained artifacts against held-out splits to enforce engineering acceptance gates.

Acceptance Targets for Match Model (Phase 7):
- Top-1 Accuracy: >= 90% (true activity ranked #1)
- Top-3 Recall:   >= 95% (true activity within top 3)
- ROC-AUC:        >= 0.85
"""

import os
import sys
import json
from collections import defaultdict
from typing import Dict, Any, List, Tuple
import numpy as np

from common import (
    FEATURE_NAMES,
    HELD_OUT_ACTIVITIES,
    load_dataset,
    extract_matrices,
    grouped_activity_split,
    sigmoid,
    compute_metrics
)


def evaluate_match_model(
    artifact_path: str,
    dataset_path: str
) -> Dict[str, Any]:
    """
    Evaluates Match Model artifact on strict held-out activity split.
    Computes both candidate-pair classification metrics and query-level ranking metrics.
    """
    if not os.path.exists(artifact_path):
        raise FileNotFoundError(f"Match Model artifact not found at {artifact_path}")
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Dataset not found at {dataset_path}")

    # 1. Load artifact
    with open(artifact_path, 'r', encoding='utf-8') as f:
        artifact = json.load(f)

    # Validate artifact parameters
    feature_names = artifact['featureNames']
    assert feature_names == FEATURE_NAMES, f"Feature name mismatch: {feature_names} vs {FEATURE_NAMES}"
    means = np.array(artifact['means'], dtype=np.float64)
    stds = np.array(artifact['stds'], dtype=np.float64)
    weights = np.array(artifact['weights'], dtype=np.float64)
    bias = float(artifact['bias'])
    threshold = float(artifact.get('threshold', 0.50))

    assert len(means) == 8 and np.all(np.isfinite(means)), "Invalid means in artifact"
    assert len(stds) == 8 and np.all(np.isfinite(stds)) and np.all(stds > 0), "Invalid stds in artifact"
    assert len(weights) == 8 and np.all(np.isfinite(weights)), "Invalid weights in artifact"
    assert np.isfinite(bias), "Invalid bias in artifact"

    # 2. Load dataset and split strictly by held-out activities
    records = load_dataset(dataset_path)
    train_records, test_records = grouped_activity_split(records, HELD_OUT_ACTIVITIES)

    # 3. Candidate-Pair Classification Metrics on Held-Out Test Split
    X_test, y_test = extract_matrices(test_records)
    X_test_norm = (X_test - means) / stds
    test_logits = np.dot(X_test_norm, weights) + bias
    test_probs = sigmoid(test_logits)
    class_metrics = compute_metrics(y_test, test_probs, threshold=threshold)

    # 4. Query-Level Ranking Metrics (Top-1 Accuracy and Top-3 Recall)
    # Evaluate across held-out queries (where targetActivityId is in HELD_OUT_ACTIVITIES)
    test_target_in_heldout = [r for r in test_records if r['targetActivityId'] in HELD_OUT_ACTIVITIES]
    queries = defaultdict(list)

    for r in test_target_in_heldout:
        key = (r['reference'], r.get('location', ''), r['targetActivityId'])
        feat_vec = np.array([float(r['features'][k]) for k in FEATURE_NAMES], dtype=np.float64)
        feat_norm = (feat_vec - means) / stds
        pred_score = float(sigmoid(np.dot(feat_norm, weights) + bias))
        queries[key].append({
            'candidateId': r['candidateActivityId'],
            'label': int(r['label']),
            'pred_score': pred_score
        })

    total_queries = len(queries)
    top1_correct = 0
    top3_correct = 0

    for key, candidates in queries.items():
        # Sort candidates descending by predicted score
        candidates.sort(key=lambda c: c['pred_score'], reverse=True)
        # Check Top-1
        if candidates[0]['label'] == 1:
            top1_correct += 1
        # Check Top-3
        if any(c['label'] == 1 for c in candidates[:3]):
            top3_correct += 1

    top1_accuracy = (top1_correct / total_queries) if total_queries > 0 else 0.0
    top3_recall = (top3_correct / total_queries) if total_queries > 0 else 0.0

    return {
        'total_dataset_records': len(records),
        'train_records': len(train_records),
        'test_records': len(test_records),
        'held_out_activities': sorted(list(HELD_OUT_ACTIVITIES)),
        'held_out_queries': total_queries,
        'classification_metrics': class_metrics,
        'ranking_metrics': {
            'top1_correct': top1_correct,
            'top1_accuracy': top1_accuracy,
            'top3_correct': top3_correct,
            'top3_recall': top3_recall
        }
    }


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, '../..'))
    artifact_path = os.path.join(project_root, 'backend/src/ml/artifacts/match-model.json')
    dataset_path = os.path.join(script_dir, 'datasets/match_dataset.jsonl')

    print("=" * 70)
    print("FieldLine ML Evaluation: Strict Holdout Acceptance Gates (Phase 7)")
    print("=" * 70)

    try:
        results = evaluate_match_model(artifact_path, dataset_path)
    except Exception as e:
        print(f"EVALUATION FAILED WITH ERROR: {e}")
        sys.exit(1)

    cm = results['classification_metrics']
    rm = results['ranking_metrics']

    print(f"Dataset: {results['total_dataset_records']} records across 30 activities")
    print(f"Train Split: {results['train_records']} candidate pairs")
    print(f"Held-Out Test Split: {results['test_records']} candidate pairs across {len(results['held_out_activities'])} activities")
    print(f"Held-Out Activities: {results['held_out_activities']}")
    print(f"Held-Out Evaluation Queries: {results['held_out_queries']}")

    print("\n--- Classification Performance (Held-Out Split) ---")
    print(f"  Accuracy  : {cm['accuracy'] * 100:.2f}%")
    print(f"  Precision : {cm['precision'] * 100:.2f}%")
    print(f"  Recall    : {cm['recall'] * 100:.2f}%")
    print(f"  F1-Score  : {cm['f1'] * 100:.2f}%")
    print(f"  ROC-AUC   : {cm['roc_auc']:.4f}")

    print("\n--- Ranking Performance (Held-Out Queries) ---")
    print(f"  Top-1 Accuracy : {rm['top1_accuracy'] * 100:.2f}% ({rm['top1_correct']}/{results['held_out_queries']})")
    print(f"  Top-3 Recall   : {rm['top3_recall'] * 100:.2f}% ({rm['top3_correct']}/{results['held_out_queries']})")

    print("\n--- Engineering Acceptance Targets Verification ---")
    target_top1 = 0.90
    target_top3 = 0.95
    target_roc_auc = 0.85

    top1_pass = rm['top1_accuracy'] >= target_top1
    top3_pass = rm['top3_recall'] >= target_top3
    roc_auc_pass = cm['roc_auc'] >= target_roc_auc

    print(f"  [ {'PASS' if top1_pass else 'FAIL'} ] Top-1 Accuracy >= {target_top1 * 100:.0f}% (Actual: {rm['top1_accuracy'] * 100:.2f}%)")
    print(f"  [ {'PASS' if top3_pass else 'FAIL'} ] Top-3 Recall   >= {target_top3 * 100:.0f}% (Actual: {rm['top3_recall'] * 100:.2f}%)")
    print(f"  [ {'PASS' if roc_auc_pass else 'FAIL'} ] ROC-AUC        >= {target_roc_auc:.2f} (Actual: {cm['roc_auc']:.4f})")
    print("=" * 70)

    if not (top1_pass and top3_pass and roc_auc_pass):
        print("FAIL: One or more acceptance gates failed!")
        sys.exit(1)
    else:
        print("SUCCESS: All Phase 7 acceptance gates verified on held-out split.")
        sys.exit(0)


if __name__ == '__main__':
    main()
