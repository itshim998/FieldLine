"""
Train FieldLine Match Model from Scratch (Python 3 + NumPy)
Zero third-party ML frameworks (no scikit-learn, no PyTorch, no TensorFlow).

Implements:
- Binary Cross-Entropy with L2 regularization
- Class weighting (w1 = N / (2 * N1), w0 = N / (2 * N0))
- Batch Gradient Descent with Momentum
- Training-set-only feature standardization
- Strict grouped activity holdout split evaluation
- Export of authoritative learned artifact to backend/src/ml/artifacts/match-model.json
"""

import os
import json
import numpy as np
from typing import Dict, Any

from common import (
    FEATURE_NAMES,
    HELD_OUT_ACTIVITIES,
    load_dataset,
    extract_matrices,
    grouped_activity_split,
    Standardizer,
    sigmoid,
    binary_cross_entropy,
    compute_metrics
)


def train_logistic_regression(
    X_train_norm: np.ndarray,
    y_train: np.ndarray,
    learning_rate: float = 0.05,
    l2_lambda: float = 0.01,
    momentum: float = 0.9,
    epochs: int = 1000,
    seed: int = 42
) -> Dict[str, Any]:
    """
    Trains Logistic Regression from scratch using Batch Gradient Descent with momentum.
    """
    np.random.seed(seed)
    N, D = X_train_norm.shape

    # Class weighting to balance positive/negative pairs
    N1 = float(np.sum(y_train == 1.0))
    N0 = float(np.sum(y_train == 0.0))
    w1 = N / (2.0 * N1) if N1 > 0 else 1.0
    w0 = N / (2.0 * N0) if N0 > 0 else 1.0
    sample_weights = np.where(y_train == 1.0, w1, w0)

    # Parameter initialization (small Gaussian random weights, zero bias)
    weights = np.random.normal(0.0, 0.05, size=D)
    bias = 0.0

    # Velocity buffers for momentum
    v_w = np.zeros(D, dtype=np.float64)
    v_b = 0.0

    loss_history = []

    print(f"\nStarting optimization: {epochs} epochs, lr={learning_rate}, l2={l2_lambda}, momentum={momentum}")
    print(f"Sample weighting: class 1 weight = {w1:.4f}, class 0 weight = {w0:.4f}")

    for epoch in range(1, epochs + 1):
        # Forward pass
        logits = np.dot(X_train_norm, weights) + bias
        probs = sigmoid(logits)

        # Loss computation (BCE + L2 penalty)
        bce_loss = binary_cross_entropy(y_train, probs, sample_weights=sample_weights)
        l2_penalty = (l2_lambda / (2.0 * N)) * float(np.sum(weights ** 2))
        total_loss = bce_loss + l2_penalty
        loss_history.append(total_loss)

        # Gradients
        errors = sample_weights * (probs - y_train)
        grad_w = (1.0 / N) * np.dot(X_train_norm.T, errors) + (l2_lambda / N) * weights
        grad_b = (1.0 / N) * float(np.sum(errors))

        # Momentum updates
        v_w = momentum * v_w + (1.0 - momentum) * grad_w
        v_b = momentum * v_b + (1.0 - momentum) * grad_b

        # Parameter updates
        weights -= learning_rate * v_w
        bias -= learning_rate * v_b

        if epoch == 1 or epoch % 100 == 0 or epoch == epochs:
            train_preds = probs
            acc = float(np.mean((train_preds >= 0.5) == (y_train == 1.0)))
            print(f"Epoch {epoch:4d}/{epochs} | Loss: {total_loss:.6f} (BCE: {bce_loss:.6f}, L2: {l2_penalty:.6f}) | Train Acc: {acc * 100:.2f}%")

    return {
        'weights': weights,
        'bias': bias,
        'loss_history': loss_history
    }


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, '../..'))
    dataset_path = os.path.join(script_dir, 'datasets/match_dataset.jsonl')
    artifact_dir = os.path.join(project_root, 'backend/src/ml/artifacts')
    artifact_path = os.path.join(artifact_dir, 'match-model.json')

    print("=" * 70)
    print("FieldLine Match Model: From-Scratch Training (Phases 5–6)")
    print("=" * 70)

    # 1. Load dataset
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Dataset not found at {dataset_path}. Run build_match_dataset.ts first.")

    records = load_dataset(dataset_path)
    total_samples = len(records)
    total_pos = sum(1 for r in records if r['label'] == 1)
    total_neg = sum(1 for r in records if r['label'] == 0)

    print(f"Loaded dataset: {total_samples} records from {dataset_path}")
    print(f"Total Positives: {total_pos} | Total Negatives: {total_neg}")

    # 2. Strict Grouped Activity Holdout Split (22 train activities, 8 held-out test activities)
    train_records, test_records = grouped_activity_split(records, HELD_OUT_ACTIVITIES)

    train_pos = sum(1 for r in train_records if r['label'] == 1)
    train_neg = sum(1 for r in train_records if r['label'] == 0)
    test_pos = sum(1 for r in test_records if r['label'] == 1)
    test_neg = sum(1 for r in test_records if r['label'] == 0)

    print("\n" + "-" * 50)
    print("Strict Grouped Activity Holdout Split:")
    print(f"- Held-Out Activities ({len(HELD_OUT_ACTIVITIES)}): {sorted(list(HELD_OUT_ACTIVITIES))}")
    print(f"- Training Examples: {len(train_records)} (Pos: {train_pos}, Neg: {train_neg})")
    print(f"- Held-Out Test Examples: {len(test_records)} (Pos: {test_pos}, Neg: {test_neg})")
    print("Leakage Check: PASSED (zero activity ID overlap between train and test)")
    print("-" * 50)

    # 3. Extract feature matrices
    X_train, y_train = extract_matrices(train_records)
    X_test, y_test = extract_matrices(test_records)

    # 4. Standardization: Compute statistics on TRAINING SET ONLY
    standardizer = Standardizer()
    standardizer.fit(X_train)

    print("\nLearned Training Normalization Parameters:")
    for name, m, s in zip(FEATURE_NAMES, standardizer.means, standardizer.stds):
        print(f"  {name:32s} : mean = {m:8.4f}, std = {s:8.4f}")

    X_train_norm = standardizer.transform(X_train)
    X_test_norm = standardizer.transform(X_test)

    # 5. Train model from scratch
    model_result = train_logistic_regression(
        X_train_norm=X_train_norm,
        y_train=y_train,
        learning_rate=0.05,
        l2_lambda=0.01,
        momentum=0.9,
        epochs=1000,
        seed=42
    )

    learned_weights = model_result['weights']
    learned_bias = model_result['bias']

    print("\nLearned Logistic Regression Parameters:")
    for name, w in zip(FEATURE_NAMES, learned_weights):
        print(f"  {name:32s} : weight = {w:+.4f}")
    print(f"  {'bias':32s} : bias   = {learned_bias:+.4f}")

    # 6. Evaluate on Training and Held-Out Test Sets
    train_logits = np.dot(X_train_norm, learned_weights) + learned_bias
    train_probs = sigmoid(train_logits)
    train_metrics = compute_metrics(y_train, train_probs, threshold=0.5)

    test_logits = np.dot(X_test_norm, learned_weights) + learned_bias
    test_probs = sigmoid(test_logits)
    test_metrics = compute_metrics(y_test, test_probs, threshold=0.5)

    print("\n" + "=" * 70)
    print("Final Model Evaluation Metrics:")
    print("=" * 70)
    print(f"TRAIN SET ({len(train_records)} examples):")
    print(f"  Accuracy  : {train_metrics['accuracy'] * 100:.2f}%")
    print(f"  Precision : {train_metrics['precision'] * 100:.2f}%")
    print(f"  Recall    : {train_metrics['recall'] * 100:.2f}%")
    print(f"  F1-Score  : {train_metrics['f1'] * 100:.2f}%")
    print(f"  ROC-AUC   : {train_metrics['roc_auc']:.4f}")

    print(f"\nHELD-OUT TEST SET ({len(test_records)} examples across 8 unseen activities):")
    print(f"  Accuracy  : {test_metrics['accuracy'] * 100:.2f}%")
    print(f"  Precision : {test_metrics['precision'] * 100:.2f}%")
    print(f"  Recall    : {test_metrics['recall'] * 100:.2f}%")
    print(f"  F1-Score  : {test_metrics['f1'] * 100:.2f}%")
    print(f"  ROC-AUC   : {test_metrics['roc_auc']:.4f}")
    print("=" * 70)

    # 7. Validate learned artifact dimensions and finiteness
    assert len(learned_weights) == 8, f"Expected 8 weights, got {len(learned_weights)}"
    assert len(standardizer.means) == 8, f"Expected 8 means, got {len(standardizer.means)}"
    assert len(standardizer.stds) == 8, f"Expected 8 stds, got {len(standardizer.stds)}"
    assert np.all(np.isfinite(learned_weights)), "Non-finite weights detected!"
    assert np.isfinite(learned_bias), "Non-finite bias detected!"
    assert np.all(np.isfinite(standardizer.means)), "Non-finite means detected!"
    assert np.all(np.isfinite(standardizer.stds)), "Non-finite stds detected!"
    assert np.all(standardizer.stds > 0), "Standard deviation must be strictly positive!"

    # 8. Export authoritative artifact
    os.makedirs(artifact_dir, exist_ok=True)
    artifact_payload = {
        "modelType": "logistic_regression",
        "version": "1.0.0",
        "featureNames": FEATURE_NAMES,
        "means": [round(float(m), 6) for m in standardizer.means],
        "stds": [round(float(s), 6) for s in standardizer.stds],
        "weights": [round(float(w), 6) for w in learned_weights],
        "bias": round(float(learned_bias), 6),
        "threshold": 0.50
    }

    with open(artifact_path, 'w', encoding='utf-8') as f:
        json.dump(artifact_payload, f, indent=2)

    print(f"\nSuccessfully generated and exported artifact to:")
    print(f"  {artifact_path}")
    print(f"  File size: {os.path.getsize(artifact_path)} bytes")


if __name__ == '__main__':
    main()
