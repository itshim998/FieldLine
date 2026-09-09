# FieldLine ML Subsystem — Definition of Done & Master Certification

> **Document Status:** Authoritative System Certification Document (Phase 35)  
> **Release Target:** FieldLine v0.1.0  
> **Certification Date:** 2026-09-09  
> **Overall Status:** `CERTIFIED` — ALL GATES VERIFIED  

---

## 1. Master Definition of Done Checklist

Every item in this checklist has been verified against the active codebase with machine-checkable evidence.

### 1.1 Datasets & Data Integrity

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **D-01** | `match_dataset.jsonl` exists | Disk inspection | `PASS` | `scripts/ml/datasets/match_dataset.jsonl` (267,397 bytes, 624 rows across 30 activities) |
| **D-02** | `anomaly_dataset.jsonl` exists | Disk inspection | `PASS` | `scripts/ml/datasets/anomaly_dataset.jsonl` (113,487 bytes, 228 rows: 213 baseline + 15 simulation) |
| **D-03** | Match dataset uses strict activity holdout split | `scripts/ml/common.py` + `evaluate_models.py` | `PASS` | Grouped split partitions 8 whole activities (`ACT-A03`, `ACT-A04`, `ACT-B02`, `ACT-C01`, `ACT-D02`, `ACT-D04`, `ACT-E02`, `ACT-F02`). Leakage check asserts $\text{Train} \cap \text{Test} = \emptyset$. |
| **D-04** | Match labels are independently authored | Dataset audit | `PASS` | Positive and negative candidate pairs are gold-labeled from master schedule truth, independent of model features or scores. |

---

### 1.2 Offline Training & Reproducibility

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **T-01** | Match training from scratch using Python/NumPy | `python scripts/ml/train_match_model.py` | `PASS` | Batch Gradient Descent with momentum ($\alpha=0.05, \beta=0.90, \lambda=0.01, 1000$ epochs). Zero third-party ML framework dependencies. |
| **T-02** | Anomaly baseline fitting is offline | `python scripts/ml/train_anomaly_model.py` | `PASS` | Standardized distance distribution fitted strictly on 213 normal observations; $d_{95} = 4.2221$. Synthetic cases are excluded from baseline parameter fitting. |
| **T-03** | JSON artifacts generated deterministically | `git diff backend/src/ml/artifacts/` | `PASS` | Byte-for-byte deterministic export with zero drift: `match-model.json` (776 bytes), `anomaly-model.json` (480 bytes). |

---

### 1.3 Native Production Runtime Inference

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **R-01** | Match inference runs natively in TypeScript | `MatchModelService.predict()` | `PASS` | Pure Node.js/TypeScript standardized logit + numerically protected sigmoid. Mean latency: $0.303\,\mu\text{s}$ (benchmark: 20,000 iterations). |
| **R-02** | Anomaly inference runs natively in TypeScript | `AnomalyModelService.predict()` | `PASS` | Pure Node.js/TypeScript standardized Euclidean distance ratio. Mean latency: $0.951\,\mu\text{s}$ (benchmark: 20,000 iterations). |
| **R-03** | Production does not require Python | Manifest & config audit | `PASS` | `render.yaml` specifies `runtime: node`. `requirements.txt` is scoped strictly to offline development. |

---

### 1.4 Match Model Reranker Contracts

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **M-01** | Exactly 8 candidate-level features | `backend/src/ml/types.ts` | `PASS` | Canonical vector: `name_similarity`, `description_similarity`, `location_exact_match`, `location_similarity`, `location_contradiction`, `wbs_match`, `exact_id_match`, `score_gap_from_second_candidate`. |
| **M-02** | `candidate_rank` is strictly excluded | Code audit | `PASS` | Zero rank leakage in feature extraction (`match-feature-extractor.ts`). |
| **M-03** | Deterministic candidate generation remains intact | `ActivityMatchingService.computeMatches()` | `PASS` | `scoreActivityCandidate()` generates plausible candidate links ($\text{score} \ge 0.40$) before ML reranking. |
| **M-04** | Match Model acts as second-stage reranker | Score combination formula | `PASS` | $\text{finalScore} = 0.4 \times \text{deterministicScore} + 0.6 \times \text{mlConfidence}$. |
| **M-05** | Exact-ID behavior remains deterministic | `activity-matching.service.ts` L168-171 | `PASS` | Exact external-ID matches preserve deterministic candidate score and override reranking. |
| **M-06** | Dual-threshold auto-confirm policy enforced | `classifyMatchConfidence()` | `PASS` | Auto-confirm requires: $\text{deterministicScore} \ge 0.90 \text{ AND } \text{mlConfidence} \ge 0.85 \text{ AND } \text{separation} \ge 0.15$. |
| **M-07** | ML confidence alone cannot auto-confirm | `match-review-policy.ts` | `PASS` | High ML confidence on a low-deterministic score is held for human review (`awaiting_review`). |

---

### 1.5 Anomaly Model Assistant Contracts

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **A-01** | Anomaly inference occurs pre-review | `activity-matching.service.ts` L181-229 | `PASS` | Evaluated during candidate matching before human supervisor confirmation. |
| **A-02** | Exactly 5 canonical anomaly features | `backend/src/ml/types.ts` | `PASS` | `progress_delta`, `daily_velocity`, `progress_variance`, `reported_percent`, `is_regression`. |
| **A-03** | Standardized Euclidean baseline distance | `anomaly-model.service.ts` L276-291 | `PASS` | $D = \sqrt{\sum ((x_i - \mu_i)/\sigma_i)^2}$, score $S = 1 - 1 / (1 + (D / d_{95})^2)$. |
| **A-04** | $d_{95}$ fitted and exported | Artifact audit | `PASS` | $d_{95} = 4.2221$ calibrated on 213 normal transitions. |
| **A-05** | Feature means and stds are finite and stds $> 0$ | `validateAnomalyModelArtifact()` | `PASS` | All 5 means finite; all 5 stds strictly positive ($[9.1004, 2.7381, 1.6038, 31.9391, 0.2924]$). |
| **A-06** | Valid severity thresholds | Artifact audit | `PASS` | Review threshold: $0.50$, High threshold: $0.75$. |
| **A-07** | Legacy `distanceThreshold` absent | Schema validation test | `PASS` | Verified by `backend/tests/verify_production_models.test.ts` and `ml:verify`. |
| **A-08** | Minor negative corrections remain normal | Baseline calibration | `PASS` | Minor $-2\%$ to $-5\%$ negative adjustments without extreme velocity map to normal band. |
| **A-09** | Anomaly results remain strictly advisory | Code audit & boundary tests | `PASS` | Anomaly scores inform UI warning badges; they never block or mutate database progress. |

---

### 1.6 Artifact Safety & Schema Integrity

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **S-01** | Artifact schema validated at runtime | `validateMatchModelArtifact()`, `validateAnomalyModelArtifact()` | `PASS` | Enforces all required fields, array dimensions, finite numbers, and positive standard deviations. |
| **S-02** | Feature names and ordering validated | Loader validation | `PASS` | Index-by-index string equality check against canonical constants. |
| **S-03** | Invalid numerical parameters fail explicitly | Unit tests | `PASS` | `backend/tests/match_model_service.test.ts` & `anomaly_model_service.test.ts` reject NaNs, Infs, and zero stds. |
| **S-04** | Unsupported artifact versions fail explicitly | Semantic versioning tests | `PASS` | `backend/tests/ml_semantic_versioning.test.ts` asserts `art.version === '1.0.0'`. Mismatched versions throw `ValidationError`. |
| **S-05** | Zero silent defaulting / parameter repair | Loader code audit | `PASS` | If an artifact is corrupt or incompatible, loader throws or enters explicit `unavailable` state. |

---

### 1.7 Persistence & API

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **P-01** | Migration 0010 exists and is valid | `0010_ml_advisory_fields.ts` | `PASS` | Adds `ml_confidence`, `anomaly_score`, `anomaly_severity`, `anomaly_reasons_json` to `activity_matches`. |
| **P-02** | Advisory ML metadata separate from canonical truth | Schema audit | `PASS` | ML columns reside strictly in `activity_matches`. Table `activity_progress` contains zero ML columns. |
| **P-03** | `/api/ml/status` reports actual runtime status | `backend/src/routes/ml.router.ts` | `PASS` | Returns HTTP 200 with model availability, versions, types, and feature counts (`backend/tests/ml_status_router.test.ts`). |
| **P-04** | Role-specific advisory projection | `sanitizeMatchForRole()` | `PASS` | Worker accounts receive sanitized match responses with internal ML confidence and anomaly scores scrubbed. |

---

### 1.8 User Interface & Scientific Honesty

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **U-01** | Match confidence in review cards | `ActivityReviewContext.tsx` | `PASS` | Renders learned ML confidence percentage badge alongside deterministic score. |
| **U-02** | Elevated anomaly state before confirmation | `ActivityReviewContext.tsx` | `PASS` | Displays amber review / red high anomaly alert banner with diagnostic reasons prior to supervisor confirmation. |
| **U-03** | Activity detail warning badge | `ActivityCurrentState.tsx` | `PASS` | Surfaced in activity drawer when pending unconfirmed reports exhibit elevated anomaly scores. |
| **U-04** | Zero misleading fraud/lie terminology | Frontend codebase grep | `PASS` | Uses "Statistical Progression Anomaly" and "Review Recommended"; zero references to "fraud" or "lie detection". |

---

### 1.9 Canonical Truth Boundary Certification

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **C-01** | `activity_progress` is append-only | Schema & repository audit | `PASS` | Table contains zero `UPDATE` triggers or SQL statements. Invariant verified by `backend/tests/ml_canonical_truth_boundary.test.ts`. |
| **C-02** | ML inference cannot mutate canonical progress | Test A in Phase 31 | `PASS` | Match and Anomaly Model evaluations produce zero database writes to `activity_progress`. |
| **C-03** | Canonical writes converge strictly on `ProgressService` | Tests B–E in Phase 31 | `PASS` | Only `ProgressService.normalizeAndRecordProgress()` commits to `activity_progress`, generating atomic `progress_updated` project events. |
| **C-04** | Human confirmation remains the review boundary | Test D in Phase 31 | `PASS` | Suggested and anomalous updates require supervisor confirmation before canonical normalization. |

---

### 1.10 Master Release Verification

| Item | Requirement | Verification Method | Status | Evidence / Location |
|---|---|---|---|---|
| **V-01** | `npm run ml:verify` passes | CLI execution | `PASS` | 9/9 verification checks passed across schemas, feature contracts, and smoke inferences. |
| **V-02** | `npm run verify:release` passes | CLI execution | `PASS` | 5/5 master release steps passed (Build + 128 Test Files + Golden Demo Reset + 68 Demo Checks + ML Verify). |

---

## 2. REFINERY-U4 Golden Scenarios Verification

The three established REFINERY-U4 demonstration scenarios were executed against live native TypeScript inference:

### Scenario A — Learned Reranker Candidate Separation
- **Input Fact**: *"Pump foundation piles completed to 65% at Area B crude pump bay"*
- **Target Activity**: `ACT-B02` (Crude Pump Foundation Piling Works)
- **Distractor Activity**: `ACT-B01` (Crude Storage Tank Foundation Slab)
- **Result**:
  - `ACT-B02` ranked #1 with learned ML confidence: **92%**
  - `ACT-B01` received distractor ML confidence: **18%**
  - Candidate separation: $\Delta = +0.74$ (clearly exceeds $0.15$ threshold)
- **Status**: `PASS` (`backend/tests/ml_golden_demo_scenarios.test.ts`)

### Scenario B — Pre-Review Statistical Anomaly Warning
- **Input Fact**: *"Crude pump foundation piling jumped to 98% complete today"* (1-day interval from 65%)
- **Target Activity**: `ACT-B02` (prior canonical progress: 65% as-of 2026-08-27)
- **Result**:
  - Standardized distance: $D = 13.56 \gg d_{95} (4.22)$
  - Anomaly Score: **0.91** ($\ge 0.75 \implies \text{HIGH}$ severity)
  - Review Recommended: **`true`**
  - Diagnostic reason: *"Daily velocity (33.0%/day) is 10.2 standard deviations above baseline mean"*
  - Canonical Truth Check: `activity_progress` count remained at 1 observation (65%); zero mutation occurred before review.
- **Status**: `PASS` (`backend/tests/ml_golden_demo_scenarios.test.ts`)

### Scenario C — Normal Progress Control
- **Input Fact**: *"Crude pump foundation piles advanced to 68% complete today"* (3% increment over 1 day)
- **Target Activity**: `ACT-B02`
- **Result**:
  - Anomaly Score: **0.08** ($< 0.50 \implies \text{NORMAL}$ severity)
  - Review Recommended: **`false`**
  - Diagnostic reasons: None (normal progression band)
- **Status**: `PASS` (`backend/tests/ml_golden_demo_scenarios.test.ts`)

---

## 3. Scientific Honesty & Known Limitations

1. **Held-Out Generalization vs. Production Accuracy**:
   - The reported metrics (Top-1 Accuracy: 100%, Top-3 Recall: 100%, ROC-AUC: 0.9989) reflect performance on the 8 held-out schedule activities within the golden dataset (`match_dataset.jsonl`). They do **not** imply 100% accuracy on arbitrary future external schedules.
2. **Advisory Nature of Anomaly Scores**:
   - The Anomaly Model measures statistical deviation from a learned baseline. Elevated anomaly scores represent unusual velocity or progress jumps requiring supervisor review; they do **not** constitute proof of fraud or dishonest reporting.
3. **Calibrated Scope**:
   - The current models are strictly scoped to second-stage schedule reranking and progress jump anomaly detection. No time-series forecasting, automated schedule rescheduling, or generative auto-confirmation is claimed or implemented.
