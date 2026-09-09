# FieldLine ML Training & Evaluation Protocol

> **Document Status:** Authoritative Training, Evaluation & Retraining Specification  
> **Environment:** Python 3.11.0 + NumPy 2.4.3 (`requirements.txt`)  
> **Target Models:** Match Model (Logistic Regression) & Anomaly Model (Standardized Distance)  
> **Production Boundary:** Offline Training Only (Zero Production Dependency)  

---

## 1. Match Dataset (`match_dataset.jsonl`)

The match training dataset is located at `scripts/ml/datasets/match_dataset.jsonl`.

### Structure & Dataset Scope
- **Total Records**: 624 candidate-pair evaluation rows across 30 schedule activities.
- **Class Balance**: 156 positive pairs ($y = 1$), 468 negative pairs ($y = 0$) — a natural 1:3 positive-to-negative ratio reflecting realistic candidate generation.
- **Negative Mining Methodology**:
  - *Hard Negatives*: Same physical area or discipline with conflicting WBS or distinct component IDs (e.g. `ACT-B01` vs `ACT-B02`).
  - *Soft Negatives*: Distant areas or mismatched trade disciplines that share generic keywords (e.g. "piling" or "foundation").
- **Independent Labeling**: Gold labels are determined by schedule truth, independent of model features.

### Strict Grouped Activity Holdout Split
To prevent data leakage and guarantee that the model generalizes to **completely new activities unseen during training**, the dataset is partitioned at the **activity level** (not by random row splitting):

```text
30 Total Activities
 ├── Training Set (22 activities, 359 candidate pairs)
 └── Held-Out Test Set (8 activities, 265 candidate pairs, 44 queries)
```

The 8 held-out activities span multiple engineering disciplines:
- `ACT-B02`: Foundation — Crude Pump Piling
- `ACT-C01`: Structural — Pipe Rack PR-07 Steel
- `ACT-D02`: Piping — Process Pipe Rack CS Spooling
- `ACT-E02`: Electrical — MCC Room Cable Tray
- `ACT-A03`: Civil — Stormwater Basin Excavation
- `ACT-A04`: Civil — Perimeter Access Road Compaction
- `ACT-D04`: Piping — Crude Feedstock Line Flange
- `ACT-F02`: Commissioning — Hydrotest Package A

**Zero Leakage Invariant**:
$$\text{Activities}(\text{Train}) \cap \text{Activities}(\text{Test}) = \emptyset$$
If either the target activity or candidate activity belongs to the held-out set, the entire pair is assigned strictly to the held-out evaluation split.

---

## 2. Match Model Training

Training is executed from scratch using pure NumPy in `scripts/ml/train_match_model.py`.

### Feature Normalization
Feature means $\boldsymbol{\mu}$ and standard deviations $\boldsymbol{\sigma}$ are computed **strictly on the training split**:
$$z_j = \frac{x_j - \mu_j}{\sigma_j} \quad (\sigma_j \ge 10^{-7})$$

Learned training parameters:
| Feature | Training Mean ($\mu$) | Training Std ($\sigma$) |
|---|---|---|
| `name_similarity` | 0.1690 | 0.2449 |
| `description_similarity` | 0.1272 | 0.1695 |
| `location_exact_match` | 0.5543 | 0.4970 |
| `location_similarity` | 0.6714 | 0.3978 |
| `location_contradiction` | 0.2507 | 0.4334 |
| `wbs_match` | 0.0613 | 0.2398 |
| `exact_id_match` | 0.0613 | 0.2398 |
| `score_gap_from_second_candidate` | 0.1234 | 0.2311 |

### Optimization Formulation
- **Objective**: Binary Cross-Entropy with L2 regularization and inverse-frequency class weighting:
  $$\mathcal{L}(\mathbf{w}, b) = -\frac{1}{N} \sum_{i=1}^{N} \left[ w_{y_i} \left( y_i \log(\hat{p}_i) + (1 - y_i) \log(1 - \hat{p}_i) \right) \right] + \frac{\lambda}{2N} \|\mathbf{w}\|_2^2$$
- **Class Weights**:
  $$w_1 = \frac{N}{2 N_1} = 1.6027, \quad w_0 = \frac{N}{2 N_0} = 0.7267$$
- **Algorithm**: Batch Gradient Descent with Momentum
  - Learning rate $\alpha = 0.05$
  - Regularization $\lambda = 0.01$
  - Momentum $\beta = 0.90$
  - Epochs: 1,000
  - Random seed: 42
  - Initialization: Gaussian weights $\sim \mathcal{N}(0, 0.05)$, bias $b = 0.0$

### Learned Parameters
| Feature | Learned Weight ($w$) |
|---|---|
| `name_similarity` | +1.1553 |
| `description_similarity` | +1.5946 |
| `location_exact_match` | +0.4315 |
| `location_similarity` | +0.3518 |
| `location_contradiction` | -0.4500 |
| `wbs_match` | +1.1467 |
| `exact_id_match` | +0.5528 |
| `score_gap_from_second_candidate` | +1.6808 |
| **Bias ($b$)** | **-0.5726** |

**Sanity Check on Signs**:
- All positive semantic alignment features (`name_similarity`, `description_similarity`, `wbs_match`, `score_gap_from_second_candidate`) received positive weights.
- `location_contradiction` received an intuitive negative weight ($-0.4500$).

---

## 3. Evaluation & Acceptance Gates

Evaluated via `scripts/ml/evaluate_models.py` on the held-out test split (44 queries across 8 unseen activities):

| Metric | Acceptance Target | Actual Measured Result | Status |
|---|---|---|---|
| **Top-1 Accuracy** (Query-level) | $\ge 90\%$ | **100.00%** (44/44) | **PASS** |
| **Top-3 Recall** (Query-level) | $\ge 95\%$ | **100.00%** (44/44) | **PASS** |
| **ROC-AUC** (Pair-level) | $\ge 0.85$ | **0.9989** | **PASS** |
| **Accuracy** (Pair-level) | — | 96.98% | — |
| **Precision** (Pair-level) | — | 84.62% | — |
| **Recall** (Pair-level) | — | 100.00% | — |
| **F1-Score** (Pair-level) | — | 91.67% | — |

---

## 4. Anomaly Model Baseline Fitting

Fitting is executed in `scripts/ml/train_anomaly_model.py` using `scripts/ml/datasets/anomaly_dataset.jsonl`.

### Dataset Composition
- **Normal Baseline Records**: 213 historical progression steps from normal site operations.
- **Synthetic Perturbation Cases**: 15 extreme cases (moderate regression, severe regression, velocity spikes).
- **Fitting Rule**: Baseline parameters are fitted **exclusively on the 213 normal records**. Synthetic cases are strictly excluded from parameter calculation.

### Fitted Normal Parameters
| Feature | Mean ($\mu$) | Sample Std ($\sigma$, ddof=1) |
|---|---|---|
| `progress_delta` | 11.9437 | 9.1004 |
| `daily_velocity` | 5.1228 | 2.7381 |
| `progress_variance` | -0.3206 | 1.6038 |
| `reported_percent` | 54.3897 | 31.9391 |
| `is_regression` | 0.0939 | 0.2924 |

### Standardized Distance & Scale Calibration
- **Standardized Distance**: $D = \sqrt{\sum_{j=0}^{4} \left(\frac{x_j - \mu_j}{\sigma_j}\right)^2}$
- **Calibrated Scale Factor**: $d_{95} = 4.2221$ (95th percentile of normal baseline distances).
- **Continuous Score**: $S = 1 - \frac{1}{1 + (D / d_{95})^2}$

### Calibration & Verification Results
- **Normal Baseline Distribution**:
  - `normal` band ($S < 0.50$): 199 / 213 (93.4%)
  - `review` band ($0.50 \le S < 0.75$): 14 / 213 (6.6%)
  - `high` band ($S \ge 0.75$): 0 / 213 (0.0%)
- **Synthetic Perturbation Detection**:
  - Moderate regressions (e.g. -14%): Scores $0.89 - 0.91 \implies$ `HIGH`
  - Severe regressions (e.g. -50%): Scores $0.99 \implies$ `HIGH`
  - Extreme velocity spikes (e.g. +65% in 1 day): Scores $0.98 - 0.99 \implies$ `HIGH`
  - Detection Rate: **15 / 15 (100.0%)** flagged as elevated review/high.

---

## 5. Retraining & Verification Workflow

To retrain the ML subsystem after updating dataset logs:

```bash
# 1. Train both models offline (Python 3 + NumPy)
npm run ml:train
# (or train individually: npm run ml:train:match / npm run ml:train:anomaly)

# 2. Evaluate held-out acceptance targets
npm run ml:evaluate

# 3. Verify production JSON artifacts and TypeScript inference
npm run ml:verify

# 4. Run complete Vitest suite
npm test

# 5. Run 5-stage master release verification
npm run verify:release
```

### Measured Execution Runtimes
On standard developer hardware (laptop CPU):
- Match Model Training: **0.35 s**
- Anomaly Model Fitting: **0.24 s**
- Combined Training (`npm run ml:train`): **1.88 s** (Target: $< 2\text{ s}$)
- Evaluation Script (`npm run ml:evaluate`): **0.42 s**

---

## 6. Production Runtime Boundary

| Subsystem Aspect | Offline Environment | Production Environment (Render Free Tier) |
|---|---|---|
| **Runtime** | Python 3.11 + NumPy 2.4.3 | Node.js 22 + TypeScript 5.7 |
| **Artifacts** | Training scripts & JSONL datasets | Lightweight JSON artifacts (`< 1.5 KB`) |
| **Inference Engine** | Not in production | Native TypeScript (`MatchModelService`, `AnomalyModelService`) |
| **Dependencies** | `numpy>=1.26.0` (in `requirements.txt`) | Zero ML libraries (no PyTorch, TF, scikit-learn, etc.) |
| **Hardware** | Developer workstation CPU | 512 MB RAM, 0.1 CPU free-tier container |

---

## 7. Limitations & Scientific Honesty

1. **Dataset Breadth**: The match dataset currently contains 624 candidate pairs across 30 refinery activities. While it covers major engineering disciplines (civil, mechanical, electrical, piping, commissioning), industrial deployments with thousands of activities will benefit from expanded field logs.
2. **Synthetic Anomaly Calibration**: The Anomaly Model is calibrated using real normal progress curves supplemented with 15 synthetic perturbation scenarios. Real-world unexpected site phenomena (severe weather, labor stoppages) should be continuously added to the normal baseline dataset as documented events.
3. **Advisory Semantics**: Anomaly scores reflect **statistical distance from normal pacing**, not intentional wrongdoing. A high score flags an update that deviates from historical pacing (e.g. a 40% jump in a single day), prompting supervisor verification before the change becomes canonical truth.
4. **Deterministic Authority**: Machine learning predictions are strictly advisory. Under no circumstances does the ML layer write to `activity_progress` or override human administrative determinations.
