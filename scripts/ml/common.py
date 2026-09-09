"""
ML Subsystem Common Utilities (Python 3 + NumPy)
Zero third-party ML framework dependencies.
Authoritative data loading, grouped splitting, standardization, and metrics.
"""

import json
from typing import Dict, List, Tuple, Set, Any
import numpy as np

# Canonical feature ordering - exactly 8 candidate-level features
FEATURE_NAMES: List[str] = [
    'name_similarity',
    'description_similarity',
    'location_exact_match',
    'location_similarity',
    'location_contradiction',
    'wbs_match',
    'exact_id_match',
    'score_gap_from_second_candidate'
]

# Canonical anomaly feature ordering - exactly 5 core features
ANOMALY_FEATURE_NAMES: List[str] = [
    'progress_delta',
    'daily_velocity',
    'progress_variance',
    'reported_percent',
    'is_regression'
]


# Strict Grouped Activity Holdout Set: 8 complete activities
# (4 mandated by plan + 4 balanced coverage across disciplines)
HELD_OUT_ACTIVITIES: Set[str] = {
    'ACT-B02',  # Foundation: Crude Pump Piling (Mandated)
    'ACT-C01',  # Structural: Pipe Rack PR-07 Steel (Mandated)
    'ACT-D02',  # Piping: Process Pipe Rack CS Spooling (Mandated)
    'ACT-E02',  # Electrical: MCC Room Cable Tray (Mandated)
    'ACT-A03',  # Civil: Stormwater Basin Excavation
    'ACT-A04',  # Civil: Perimeter Access Road Compaction
    'ACT-D04',  # Piping: Crude Feedstock Line Flange
    'ACT-F02',  # Commissioning: Hydrotest Package A
}


def load_dataset(jsonl_path: str) -> List[Dict[str, Any]]:
    """Loads JSONL records into memory."""
    records: List[Dict[str, Any]] = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def extract_matrices(records: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extracts feature matrix X (N, 8) and label vector y (N,) from records.
    Adheres strictly to canonical FEATURE_NAMES order.
    """
    N = len(records)
    D = len(FEATURE_NAMES)
    X = np.zeros((N, D), dtype=np.float64)
    y = np.zeros(N, dtype=np.float64)

    for i, r in enumerate(records):
        feat_dict = r['features']
        for j, feat_name in enumerate(FEATURE_NAMES):
            X[i, j] = float(feat_dict.get(feat_name, 0.0))
        y[i] = float(r['label'])

    return X, y


def grouped_activity_split(
    records: List[Dict[str, Any]],
    held_out_activities: Set[str] = HELD_OUT_ACTIVITIES
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Splits records by grouped activities with ZERO cross-group leakage.
    If either targetActivityId or candidateActivityId is in held_out_activities,
    the record is assigned exclusively to the held-out test split.
    """
    train_records: List[Dict[str, Any]] = []
    test_records: List[Dict[str, Any]] = []

    for r in records:
        target_id = r.get('targetActivityId', r.get('activityId', ''))
        candidate_id = r.get('candidateActivityId', r.get('activityId', ''))

        if target_id in held_out_activities or candidate_id in held_out_activities:
            test_records.append(r)
        else:
            train_records.append(r)

    # Verification of zero leakage
    train_activities: Set[str] = set()
    for r in train_records:
        train_activities.add(r.get('targetActivityId', ''))
        train_activities.add(r.get('candidateActivityId', ''))

    overlap = train_activities.intersection(held_out_activities)
    assert len(overlap) == 0, f"STRICT LEAKAGE FAILURE: Activities {overlap} found in training set!"

    return train_records, test_records


class Standardizer:
    """
    Computes feature means and standard deviations strictly on training data.
    Guards against zero variance (std < 1e-7 => std = 1.0).
    """
    def __init__(self):
        self.means: np.ndarray = np.zeros(len(FEATURE_NAMES), dtype=np.float64)
        self.stds: np.ndarray = np.ones(len(FEATURE_NAMES), dtype=np.float64)
        self.fitted: bool = False

    def fit(self, X_train: np.ndarray) -> 'Standardizer':
        self.means = np.mean(X_train, axis=0)
        stds = np.std(X_train, axis=0)
        # Protect against divide-by-zero on zero-variance features
        self.stds = np.where(stds < 1e-7, 1.0, stds)
        self.fitted = True
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        if not self.fitted:
            raise RuntimeError("Standardizer must be fitted on training data before transform.")
        return (X - self.means) / self.stds


def sigmoid(z: np.ndarray) -> np.ndarray:
    """Numerically protected sigmoid function."""
    z_clipped = np.clip(z, -25.0, 25.0)
    return 1.0 / (1.0 + np.exp(-z_clipped))


def binary_cross_entropy(
    y_true: np.ndarray,
    p_pred: np.ndarray,
    sample_weights: np.ndarray = None,
    eps: float = 1e-15
) -> float:
    """Computes binary cross entropy with clipping protection."""
    p_clipped = np.clip(p_pred, eps, 1.0 - eps)
    bce = -(y_true * np.log(p_clipped) + (1.0 - y_true) * np.log(1.0 - p_clipped))
    if sample_weights is not None:
        bce = bce * sample_weights
    return float(np.mean(bce))


def compute_roc_auc(y_true: np.ndarray, p_pred: np.ndarray) -> float:
    """
    Computes ROC Area Under Curve (ROC-AUC) in pure NumPy via trapezoidal integration.
    """
    pos_count = np.sum(y_true == 1.0)
    neg_count = np.sum(y_true == 0.0)
    if pos_count == 0 or neg_count == 0:
        return 0.5

    # Sort pairs by descending predicted score
    desc_indices = np.argsort(-p_pred)
    y_sorted = y_true[desc_indices]
    p_sorted = p_pred[desc_indices]

    # Find distinct threshold cutoffs
    distinct_indices = np.where(np.diff(p_sorted))[0]
    threshold_indices = np.r_[distinct_indices, y_sorted.size - 1]

    tps = np.cumsum(y_sorted == 1.0)[threshold_indices]
    fps = np.cumsum(y_sorted == 0.0)[threshold_indices]

    tpr = np.r_[0.0, tps / pos_count]
    fpr = np.r_[0.0, fps / neg_count]

    # Trapezoid integration across FPR intervals (works across all NumPy versions)
    roc_auc = float(np.sum(np.diff(fpr) * (tpr[:-1] + tpr[1:]) / 2.0))
    return max(0.0, min(1.0, roc_auc))


def compute_metrics(y_true: np.ndarray, p_pred: np.ndarray, threshold: float = 0.5) -> Dict[str, float]:
    """Computes standard classification evaluation metrics."""
    y_pred = (p_pred >= threshold).astype(np.float64)
    tp = np.sum((y_pred == 1.0) & (y_true == 1.0))
    fp = np.sum((y_pred == 1.0) & (y_true == 0.0))
    tn = np.sum((y_pred == 0.0) & (y_true == 0.0))
    fn = np.sum((y_pred == 0.0) & (y_true == 1.0))

    accuracy = (tp + tn) / max(1, (tp + tn + fp + fn))
    precision = tp / max(1, (tp + fp)) if (tp + fp) > 0 else 0.0
    recall = tp / max(1, (tp + fn)) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall) / max(1e-9, (precision + recall)) if (precision + recall) > 0 else 0.0
    roc_auc = compute_roc_auc(y_true, p_pred)

    return {
        'accuracy': float(accuracy),
        'precision': float(precision),
        'recall': float(recall),
        'f1': float(f1),
        'roc_auc': float(roc_auc)
    }
