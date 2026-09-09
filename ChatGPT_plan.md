# FieldLine ML Implementation Plan — 0 → 100 (Corrected & Certified Blueprint)

> **Document Status:** Authoritative Implementation Blueprint  
> **Target Baseline:** FieldLine v0.1.0 (`main` branch, Pass 36 certified)  
> **Production Stack:** Node.js 22 + TypeScript + Express + Better-SQLite3 (Render Free Tier)  
> **Training Stack:** Offline Python 3 + NumPy (Zero production dependency)  

---

## 0. Executive Architectural Vision & Non-Negotiable Invariants

FieldLine implements a strict **Dual-Layer Architecture**:
1. **Probabilistic AI & ML Layer**: Generative AI (Gemini / Groq / MockAI) extracts structured facts from messy field evidence; lightweight, locally trained/fitted ML models rerank activity candidates and detect unusual progress velocity.
2. **Deterministic Authoritative Layer**: All mathematical percentage derivations, timeline reconciliations, schedule variances, risk classifications, and database mutations are executed deterministically in TypeScript and SQLite.

### The Two Locally Trained / Fitted ML Models
* **Model 1: `FieldLine Match Model` (Reranker)**:
  - *Purpose*: Learn how strongly candidate signals (name similarity, description similarity, location alignment, WBS code detection, candidate score separation) correlate with the true schedule activity.
  - *Role*: **Second-stage learned reranker and confidence scorer**, NOT a replacement for the deterministic candidate generator.
* **Model 2: `FieldLine Anomaly Model` (Review-Prioritization Assistant)**:
  - *Purpose*: Detect whether a newly reported progress update looks statistically unusual compared with the observed baseline progression of that activity.
  - *Role*: **Locally fitted / trained unsupervised statistical anomaly-detection model** serving as an advisory review-prioritization flag, surfacing an anomaly alert to the supervisor *before* the update can become canonical truth.
  - *Positioning*: **NOT a lie detector**. It does not prove fraud, deception, or worker dishonesty. It measures statistical deviation from a learned progression baseline to highlight updates that warrant supervisor verification.

### Core Architectural Invariants
1. **ML Prediction $\ne$ Canonical Truth**: Neither model is ever permitted to directly mutate `activity_progress`, modify baseline schedules, or alter deterministic risk classifications.
2. **Strict Dual-Threshold Auto-Confirm Gate**:
   - Exact external-ID matches (`exact_id`) retain their deterministic exact-ID auto-confirm path.
   - For all non-exact matches, automatic confirmation is strictly prohibited unless **BOTH** conditions are met simultaneously:
     1. Deterministic score $s_{\text{det}} \ge 0.90$ with clear candidate separation ($\ge 0.15$), **AND**
     2. Learned ML confidence $p_{\text{ml}} \ge 0.85$.
   - If either condition is unmet, the candidate **must** remain in the review path (`status: 'suggested'`, `reviewState: 'awaiting_review'`).
   - **ML confidence alone cannot auto-confirm any candidate.**
3. **Pre-Review Anomaly Visibility**: The Anomaly Model evaluates updates *during* candidate matching so that anomaly warnings appear directly on the supervisor's review screen *before* canonical confirmation.
4. **Zero Production ML Runtime**: Production runs on Node 22 (Render free tier, 512 MB RAM). Training is offline in Python/NumPy; production inference runs in native TypeScript from tiny JSON artifacts ($< 5\ \text{KB}$). No Python, PyTorch, TensorFlow, vector database, or GPU is required in production.

---

## Full End-to-End System Pipeline

```text
                        FIELD EVIDENCE
              (Text reports, PDFs, CSV, Audio)
                              │
                              ▼
                    Gemini / Groq / MockAI
                              │
                              ▼
                  Structured Field Facts
              (reference, location, %, status)
                              │
                              ▼
             ┌──────────────────────────────────┐
             │ Deterministic Candidate Matcher  │
             │     scoreActivityCandidate()     │
             │   (Generates top candidates ≥0.4)│
             └────────────────┬─────────────────┘
                              │
                              ▼
             ┌──────────────────────────────────┐
             │       MATCH MODEL (LOCAL ML)     │
             │    Logistic Regression Reranker  │
             │  (8 candidate-level features)    │
             └────────────────┬─────────────────┘
                              │
                              ▼
                     Reranked Candidates
                              │
                              ▼
             ┌──────────────────────────────────┐
             │      ANOMALY MODEL (LOCAL ML)    │
             │ Unsupervised Statistical Model   │
             │ (Standardized baseline distance) │
             └────────────────┬─────────────────┘
                              │
                              ▼
             ┌──────────────────────────────────┐
             │      HUMAN REVIEW INTERFACE      │
             │ ├─ Learned Match Confidence      │
             │ └─ Anomaly Alert (if elevated)   │
             │ [Confirm Match] [Reject] [Resolve]
             └────────────────┬─────────────────┘
                              │
                     Confirmed by Admin?
                              │
                              ▼
             ════════════════════════════════════
             🛡️ CANONICAL TRUTH BOUNDARY
             ════════════════════════════════════
                              │
                              ▼
             ┌──────────────────────────────────┐
             │    Canonical Progress Engine     │
             │   normalizeAndRecordProgress()   │
             │  (Append-only activity_progress) │
             └────────────────┬─────────────────┘
                              │
                              ▼
             ┌──────────────────────────────────┐
             │  Deterministic Snapshot & Risk   │
             │  Planned vs Actual, S-Curves     │
             └────────────────┬─────────────────┘
                              │
                              ▼
                     Grounded Assistant
```

---

# PHASE 1 — Dedicated ML Subsystem Boundary

To ensure zero architectural scattering and clean build isolation, all ML code is placed into two dedicated boundaries:

```text
backend/src/ml/
    index.ts                           <-- Singleton service exports & loaders
    types.ts                           <-- Model schemas, prediction interfaces, feature contracts
    artifacts/
        match-model.json               <-- Learned weights, bias, normalization parameters (~1 KB)
        anomaly-model.json             <-- Fitted baseline parameters, d95 scale, severity thresholds (~2 KB)
    match/
        match-feature-extractor.ts     <-- Extracts 8 candidate-level features from <FieldFact, Activity>
        match-model.service.ts         <-- Pure TypeScript logistic inference & candidate reranker
    anomaly/
        anomaly-feature-extractor.ts   <-- Extracts 5 core signals from <reported %, history, planned %>
        anomaly-model.service.ts       <-- Pure TypeScript statistical anomaly scoring & reason generator

scripts/ml/
    common.py                          <-- Pure Python/NumPy data loaders, standardizers, metrics
    train_match_model.py               <-- From-scratch batch gradient descent logistic regression
    train_anomaly_model.py             <-- Unsupervised baseline fitting, d95 calculation, & calibration
    evaluate_models.py                 <-- Strict activity-holdout evaluation (Top-1, Top-3, ROC-AUC)
    verify-production-models.ts        <-- Production sanity script (validates artifacts & inference)
    datasets/
        match_dataset.jsonl            <-- Authored positive & hard-negative candidate pairs
        anomaly_dataset.jsonl          <-- Normal progression profiles & controlled simulation cases
```

> [!IMPORTANT]
> Authoritative model artifacts reside exclusively in `backend/src/ml/artifacts/`. There is no redundant `ml/artifacts/` directory.

### Core Type Contracts (`backend/src/ml/types.ts`)
```ts
// --- Match Model Contracts ---
export interface MatchFeatureVector {
  name_similarity: number;              // [0, 1] Jaccard/n-gram similarity with activity name
  description_similarity: number;       // [0, 1] Similarity with activity description
  location_exact_match: number;         // 1.0 if reported location === activity location, else 0.0
  location_similarity: number;          // [0, 1] Text similarity between locations
  location_contradiction: number;       // 1.0 if explicit mismatch, else 0.0
  wbs_match: number;                    // 1.0 if reference/location contains WBS code, else 0.0
  exact_id_match: number;               // 1.0 if reference equals/contains activity externalId
  score_gap_from_second_candidate: number; // [0, 1] Deterministic score gap from runner-up
}

export interface MatchModelArtifact {
  modelType: string;                    // 'logistic_regression'
  version: string;                      // Semantic version (e.g. '1.0.0')
  featureNames: string[];               // 8 feature names in exact vector order
  means: number[];                      // Standardizer means for each feature
  stds: number[];                       // Standardizer standard deviations for each feature
  weights: number[];                    // Learned logistic regression weights
  bias: number;                         // Learned logistic regression bias
  threshold: number;                    // Decision threshold for binary classification metric
}

// --- Anomaly Model Contracts ---
export interface AnomalyFeatureVector {
  progress_delta: number;               // Δp = current reported % - previous actual %
  daily_velocity: number;               // Δp / max(1, days_since_previous_update)
  progress_variance: number;            // current reported % - planned % as-of report date
  reported_percent: number;             // current reported % [0, 100]
  is_regression: number;                // 1.0 if Δp < 0, else 0.0
}

export interface AnomalyModelArtifact {
  modelType: string;                    // 'standardized_distance_anomaly'
  version: string;                      // Semantic version (e.g. '1.0.0')
  featureNames: string[];               // 5 feature names in exact vector order
  means: number[];                      // Exactly 5 finite numeric baseline means
  stds: number[];                       // Exactly 5 finite, strictly positive numbers (stds[i] > 0)
  d95: number;                          // Finite, strictly positive 95th-percentile distance (d95 > 0)
  severityThresholds: {
    review: number;                     // 0.50 (maps to D === d95)
    high: number;                       // 0.75
  };
}

export interface AnomalyPrediction {
  anomalyScore: number;                 // Continuous [0, 1] mapped via 1 - 1/(1 + (D/d95)^2)
  severity: 'normal' | 'review' | 'high';
  reviewRecommended: boolean;
  reasons: string[];                    // Diagnostic explanations citing standardized deviations
}
```

> [!IMPORTANT]
> **Artifact Parameter Validation Invariant**: All learned numerical artifact parameters must be finite, and every standard deviation must be strictly positive (`stds[i] > 0`). Invalid artifacts fail validation rather than being silently repaired at inference time.

---

# PHASE 2 — Candidate Generation Engine (Preserved Intact)

`backend/src/services/matching/activity-match-scoring.ts` is **preserved intact**.

```ts
export function scoreActivityCandidate(
  fact: FieldProgressItem,
  activity: Activity
): CandidateMatch
```

- Handles exact external ID matches ($0.99$ / $0.95$).
- Computes baseline text similarity across name and description.
- Applies location modifiers ($+0.18$ exact, $+0.15$ substring, $-0.25$ mismatch, $+0.12$ mention).
- Evaluates WBS code presence ($+0.12$).

The Match Model does **not** replace this function. It acts as a second-stage scoring and reranking pass over candidates generated by it.

---

# PHASE 3 — Match Model Feature Contract (8 Candidate-Level Dimensions)

To eliminate deterministic rank leakage, **`candidate_rank` is strictly excluded**.

The feature extractor extracts 8 candidate-level features derived from textual, location, WBS, ID, and deterministic score-separation signals:

```ts
export interface MatchFeatureVector {
  name_similarity: number;              // [0, 1] Jaccard/n-gram similarity with activity name
  description_similarity: number;       // [0, 1] Similarity with activity description
  location_exact_match: number;         // 1.0 if reported location === activity location, else 0.0
  location_similarity: number;          // [0, 1] Text similarity between locations
  location_contradiction: number;       // 1.0 if explicit mismatch (both non-empty & conflicting)
  wbs_match: number;                    // 1.0 if reference or location contains WBS code, else 0.0
  exact_id_match: number;               // 1.0 if reference equals or contains activity externalId
  score_gap_from_second_candidate: number; // [0, 1] Deterministic score separation from runner-up
}
```

> [!NOTE]
> **Candidate-Level Feature Terminology**: These are **8 candidate-level features derived from textual, location, WBS, ID, and deterministic score-separation signals**. They are not eight independent raw physical observations; specifically, `score_gap_from_second_candidate` is derived from deterministic candidate scores to capture candidate separation without leaking heuristic rank.

- Reuses `computeTextSimilarity` from `backend/src/services/matching/text-similarity.ts`.
- Zero rank leakage: `candidate_rank` is strictly excluded so the model cannot simply memorize the heuristic matcher's sort order. It learns cross-signal weights over candidate-level signals without depending on the deterministic rank.

---

# PHASE 4 — Independent Ground-Truth Match Dataset (Preventing Label Leakage)

Do not label data based on the current matcher's output. Instead, author independent ground-truth pairs:

1. **Positive Pairs ($y = 1$)**:
   - 160 realistic contractor phrases, trade shorthands, and site observations mapped to their true schedule activity across all 30 `REFINERY-U4` activities.
   - Example: `"pump foundation piles completed to 65% at Area B crude pump bay"` $\rightarrow$ `ACT-B02`.
2. **Hard Negative Pairs ($y = 0$)**:
   - Same-discipline or same-area distractors.
   - Example: Pairing `"pump foundation piles"` with `ACT-B01` (North Tank Farm Excavation) or `ACT-C01` (PR-07 Structural Steel).
3. **Soft Negative Pairs ($y = 0$)**:
   - Unrelated activities in different areas.

Stored in `scripts/ml/datasets/match_dataset.jsonl`:
```json
{
  "reference": "piling work at crude pump bay",
  "activityId": "ACT-B02",
  "features": {
    "name_similarity": 0.82,
    "description_similarity": 0.61,
    "location_exact_match": 1.0,
    "location_similarity": 1.0,
    "location_contradiction": 0.0,
    "wbs_match": 0.0,
    "exact_id_match": 0.0,
    "score_gap_from_second_candidate": 0.18
  },
  "label": 1
}
```

---

# PHASE 5 — Strict Train/Test Separation (Activity Holdout)

> [!WARNING]
> Random row splitting allows near-identical paraphrases into both train and test sets, causing artificial overestimation of generalization.

**Mandated Strategy**: **Grouped Activity Holdout Split**:
- **Training Set (75% of activities)**: 22 activities across civil, structural, piping, and electrical packages.
- **Held-Out Test Set (25% of activities)**: 8 complete activities (including `ACT-B02`, `ACT-C01`, `ACT-D02`, `ACT-E02`) and all their associated candidate pairs.
- During evaluation, the model scores candidates for activities whose names, descriptions, and IDs were **never seen during training**.
- This proves that the model learned general feature correlations rather than memorizing activity-specific vocabulary.

---

# PHASE 6 — Train Match Model from Scratch (Python)

Implemented in `scripts/ml/train_match_model.py` using pure Python 3 + NumPy (zero third-party ML frameworks):

- **Model**: Logistic Regression with $L_2$ Regularization.
  $$z = \mathbf{w}^T \mathbf{x}_{\text{norm}} + b,\quad p = \sigma(z) = \frac{1}{1 + e^{-z}}$$
- **Loss Function**: Binary Cross-Entropy with $L_2$ penalty:
  $$\mathcal{L}(\mathbf{w}, b) = -\frac{1}{N} \sum_{i=1}^N \left[ y_i \ln p_i + (1 - y_i) \ln(1 - p_i) \right] + \frac{\lambda}{2N} \|\mathbf{w}\|_2^2$$
- **Optimization**: Batch Gradient Descent with momentum ($\alpha = 0.05, \lambda = 0.01, \text{epochs} = 1000$).
- **Class Balance**: Weighted loss weighting positive pairs ($w_1 = N / 2N_1, w_0 = N / 2N_0$) to reduce the effect of class imbalance and improve balanced classification performance across positive and negative candidate pairs.

---

# PHASE 7 — Strict Holdout Evaluation & Acceptance Targets

Executed by `scripts/ml/evaluate_models.py`:
- Evaluates on the held-out 8 activities.
- **Engineering Acceptance Targets** (must be verified on held-out split before export):
  - **Top-1 Accuracy Target**: $\ge 90\%$ of true activities ranked #1.
  - **Top-3 Recall Target**: $\ge 95\%$ of true activities within top 3 candidates.
  - **ROC-AUC Target**: $\ge 0.85$.
- *Note*: These values are quality gates for artifact promotion; actual measured metrics from the test split must be recorded in the evaluation report generated during training.

---

# PHASE 8 — Export Match Model Artifact

Exported to `backend/src/ml/artifacts/match-model.json` (~1 KB):
```json
{
  "modelType": "logistic_regression",
  "version": "1.0.0",
  "featureNames": [
    "name_similarity",
    "description_similarity",
    "location_exact_match",
    "location_similarity",
    "location_contradiction",
    "wbs_match",
    "exact_id_match",
    "score_gap_from_second_candidate"
  ],
  "means": [0.45, 0.32, 0.25, 0.35, 0.08, 0.12, 0.05, 0.14],
  "stds": [0.31, 0.28, 0.43, 0.38, 0.27, 0.32, 0.22, 0.18],
  "weights": [2.41, 1.15, 1.62, 0.85, -2.10, 1.45, 3.80, 1.25],
  "bias": -1.35,
  "threshold": 0.60
}
```

---

# PHASE 9 — TypeScript Native Match Inference

Implemented in `backend/src/ml/match/match-model.service.ts`:
- Loads `match-model.json` synchronously via `fs.readFileSync` using `new URL(...)`.
- Standardizes feature vector: $x'_i = (x_i - \mu_i) / \sigma_i$.
- Calculates dot product + bias: $z = \sum w_i x'_i + b$.
- Applies sigmoid: $p = 1 / (1 + e^{-z})$.
- Target execution latency: $< 5\ \mu\text{s}$ per candidate (expected performance to be verified by benchmarking).
- **Graceful Fallback**: If artifact is missing or corrupted, returns the candidate's deterministic score.

---

# PHASE 10 — Reranker Integration into `ActivityMatchingService`

Integrated into `backend/src/services/matching/activity-matching.service.ts`:

```ts
// 1. Deterministic candidate generation (preserved intact)
const candidates: CandidateMatch[] = [];
for (const activity of activities) {
  const candidate = scoreActivityCandidate(fact, activity);
  if (candidate.confidenceScore >= minConfidenceThreshold) {
    candidates.push(candidate);
  }
}

// 2. Score top candidates with Match Model
const rankedWithMl = candidates.map((candidate, idx) => {
  const runnerUp = idx === 0 ? candidates[1] : candidates[0];
  const scoreGap = runnerUp ? Math.max(0, candidate.confidenceScore - runnerUp.confidenceScore) : 1.0;
  
  const features = extractMatchFeatures(fact, candidate, scoreGap);
  const mlConfidence = matchModelService.predict(features);
  
  return {
    ...candidate,
    mlConfidence,
    finalScore: candidate.matchMethod === 'exact_id' 
      ? candidate.confidenceScore 
      : Math.round((candidate.confidenceScore * 0.4 + mlConfidence * 0.6) * 100) / 100
  };
});

// 3. Rerank candidates by final learned score
rankedWithMl.sort((a, b) => b.finalScore - a.finalScore);

// 4. Strict Auto-Confirm Safety Gate
const bestMatch = rankedWithMl[0] || null;
const alternatives = rankedWithMl.slice(1, 1 + maxAlternatives);
const reviewDecision = classifyMatchConfidence(bestMatch, alternatives);

// ENFORCE DUAL-THRESHOLD INVARIANT:
// - Exact external ID matches retain the deterministic auto-confirm path.
// - For all non-exact matches, auto-confirmation requires BOTH:
//     deterministic confidenceScore >= 0.90 AND ML mlConfidence >= 0.85 (with unambiguous separation >= 0.15).
// - If either condition is unmet, autoConfirm MUST be overridden to false and reviewState to 'awaiting_review'.
if (bestMatch) {
  const isExactId = bestMatch.matchMethod === 'exact_id';
  const meetsDualThreshold = 
    bestMatch.confidenceScore >= 0.90 && 
    bestMatch.mlConfidence !== undefined && 
    bestMatch.mlConfidence >= 0.85;

  if (!isExactId) {
    if (!meetsDualThreshold) {
      reviewDecision.autoConfirm = false;
      reviewDecision.reviewState = 'awaiting_review';
      if (reviewDecision.tier === 'high') {
        reviewDecision.tier = 'medium';
      }
    }
  }
}
```

---

# PHASE 11 — Explainable Match Output

The match result exposes clear provenance (numerical values below are illustrative example targets):
```json
{
  "activityId": "ACT-B02",
  "deterministicScore": 0.81,
  "mlConfidence": 0.94,
  "finalConfidence": 0.89,
  "rationale": "Reference strongly matches activity name 'Crude Pump Foundation Piling Works' (82%); Location 'Area B' verified; Learned ML confidence: 94%."
}
```

---

# PHASE 12 — Anomaly Model Definition (Unsupervised Statistical Baseline)

Name: **Progress Anomaly Detection Model**.
- Role: An **unsupervised statistical anomaly-detection model** providing an advisory review-prioritization flag for project supervisors.
- Architecture: Fits a parametric multidimensional normal progression distribution ($\boldsymbol{\mu}, \boldsymbol{\sigma}$) over verified progress transitions and measures standardized Euclidean distance over the fitted normal baseline to identify statistical outliers.
- **Strict Prohibition**: It is **not** a supervised classifier, **not** a fraud detector, and **not** a lie detector.
- Permitted Terminology: `anomaly score`, `review priority`, `unusual progression`, `supervisor verification`, `statistical deviation from learned baseline`.
- Prohibited Terminology: `authenticity confidence`, `worker honesty`, `lie probability`, `fraud probability`, `"worker is lying"`, `"report is fake"`.

---

# PHASE 13 — Grounded Normal Progress Features (5 Core Dimensions)

To prevent data sparsity and cold-start failures, `reported_quantity_delta` and `number_of_previous_updates` are removed.

The 5 core features:
```ts
export interface AnomalyFeatureVector {
  progress_delta: number;         // Δp = current reported % - previous actual %
  daily_velocity: number;         // Δp / max(1, days_since_previous_update)
  progress_variance: number;      // current reported % - planned % as-of report date
  reported_percent: number;       // current reported % [0, 100]
  is_regression: number;          // 1.0 if Δp < 0, else 0.0
}
```

---

# PHASE 14 — Fitted Progression Baseline & Honest Synthetic Data Disclosure

### Dataset Disclosure & Scope
- **Honest Data Disclaimer**: FieldLine does not claim to possess a large multi-year real-world construction anomaly dataset. The training distribution is fitted on **FieldLine-domain progression profiles** (from golden schedules, verified milestones, and execution S-curves) augmented with **controlled synthetic perturbation simulations** for boundary calibration.
- **Simulation Scenarios**:
  - Normal pacing transitions (typical continuous progression).
  - Normal small negative adjustments (measurement/survey reconciliations).
  - Simulated severe negative drops (unannounced regressions).
  - Simulated extreme single-interval jumps (excessive daily velocity).
- **Advisory Role**: Simulations calibrate the statistical distance boundary; predictions represent statistical divergence from the modeled baseline, **not** proof of data falsification or wrongdoing.

---

# PHASE 15 — Standardized Distance Anomaly Scoring & Statistical Reason Generator

Implemented in `scripts/ml/train_anomaly_model.py` and `backend/src/ml/anomaly/`:

### 1. The Explicit Training → Artifact → Inference Contract
The Anomaly Subsystem follows a strictly calibrated 3-stage mathematical contract:

```text
OFFLINE TRAINING (Python/NumPy)
  1. Fit means (μ) and stds (σ) over normal baseline records
  2. Compute standardized distance D^(k) for each normal observation
  3. Calculate 95th-percentile distance: D95 = Percentile_95({D^(k)})
  4. Export { means, stds, d95, severityThresholds } to anomaly-model.json
               │
               ▼
STATIC ARTIFACT (anomaly-model.json)
  - d95: 2.31 (illustrative placeholder; calibrated from normal training data)
  - severityThresholds: { review: 0.50, high: 0.75 }
  - (distanceThreshold is completely removed; zero decorative parameters)
               │
               ▼
TYPESCRIPT INFERENCE (anomaly-model.service.ts)
  1. Standardize incoming features: z_i = (x_i - μ_i) / σ_i
  2. Compute Euclidean distance: D = sqrt(sum(z_i^2))
  3. Calculate continuous anomaly score: score = 1 - 1 / (1 + (D / d95)^2)
  4. Classify severity against severityThresholds: normal (< 0.50), review (0.50-0.75), high (≥ 0.75)
```

### 2. Offline Baseline Fitting & $D_{95}$ Calculation (Python/NumPy)
- The normal training distribution in `scripts/ml/datasets/anomaly_dataset.jsonl` fits the baseline parameters:
  - Mean vector: $\boldsymbol{\mu} = [\mu_{\Delta p}, \mu_v, \mu_{\text{var}}, \mu_p, \mu_{\text{reg}}]^T$
  - Standard deviation vector: $\boldsymbol{\sigma} = [\sigma_{\Delta p}, \sigma_v, \sigma_{\text{var}}, \sigma_p, \sigma_{\text{reg}}]^T$
- For each normal baseline observation $\mathbf{x}^{(k)}$ ($k = 1, \dots, K$) in the training set:
  $$D^{(k)} = \sqrt{ \sum_{i=1}^5 \left( \frac{x_i^{(k)} - \mu_i}{\sigma_i} \right)^2 }$$
- $D_{95}$ is computed during offline training as the exact 95th percentile of distances across the normal baseline distribution:
  $$D_{95} = \text{Percentile}_{95}(\{ D^{(1)}, D^{(2)}, \dots, D^{(K)} \})$$
  and exported directly into `backend/src/ml/artifacts/anomaly-model.json` as the `d95` field.

### 3. Online Standardized Distance & Continuous Anomaly Scoring (TypeScript)
- For any incoming observation vector $\mathbf{x}$, standardized distance is:
  $$D(\mathbf{x}) = \sqrt{ \sum_{i=1}^5 \left( \frac{x_i - \mu_i}{\sigma_i} \right)^2 }$$
- Continuous anomaly score function using the exported $D_{95}$ (loaded as `artifact.d95`):
  $$\text{anomalyScore} = 1 - \frac{1}{1 + (D(\mathbf{x}) / d_{95})^2}$$
  *(By definition, when $D(\mathbf{x}) = d_{95}$, $\text{anomalyScore} = 1 - \frac{1}{1 + 1} = 0.50$, perfectly aligning the 95th-percentile baseline boundary with the entry into the review severity band).*

### 4. Learned Policy Bands (Operating on Continuous Anomaly Score)
Policy bands are evaluated strictly against the continuous `anomalyScore` (never against an ad-hoc distance threshold):
- $\text{anomalyScore} < \text{severityThresholds.review}$ ($< 0.50$) $\rightarrow \text{severity: 'normal'}$, $\text{reviewRecommended: false}$ (within normal baseline variance).
- $\text{severityThresholds.review} \le \text{anomalyScore} < \text{severityThresholds.high}$ ($0.50 - <0.75$) $\rightarrow \text{severity: 'review'}$, $\text{reviewRecommended: true}$ (elevated deviation; verification advised).
- $\text{anomalyScore} \ge \text{severityThresholds.high}$ ($\ge 0.75$) $\rightarrow \text{severity: 'high'}$, $\text{reviewRecommended: true}$ (far outside learned baseline; high review priority).

> [!IMPORTANT]
> **Resolution of `distanceThreshold`**: Earlier drafts included an unused `distanceThreshold: 2.85`. That parameter has been completely eliminated from the artifact and inference contracts. Anomaly scoring is governed entirely by the ratio $D(\mathbf{x}) / d_{95}$, which maps distance smoothly into $[0, 1]$, and policy classification is governed by `severityThresholds.review` and `severityThresholds.high`. No redundant or competing distance threshold is preserved. Every parameter in `anomaly-model.json` has a direct, active mathematical purpose.

### 5. Dynamic Diagnostic Reason Generator (Statistically Grounded)
Diagnostic explanations cite standardized deviation ($z$-scores) rather than hard-coded progress percentages:
- If $z_{\text{velocity}} > +2.5$: `"Daily progress velocity is well above the learned baseline distribution (+Z standard deviations from normal pacing)."`
- If $z_{\text{delta}} > +2.5$: `"Reported progress increment is far outside the learned normal shift distribution (+Z standard deviations)."`
- If $x_{\text{delta}} < 0 \wedge z_{\text{delta}} < -2.5$: `"Reported progress drop is statistically atypical relative to observed activity progression (-Z standard deviations from baseline)."`
- If $x_{\text{delta}} < 0 \wedge |z_{\text{delta}}| \le 1.5$: `"Minor negative progress adjustment is consistent with normal baseline survey/measurement reconciliation variance."`

---

# PHASE 16 — Export Anomaly Model Artifact

Exported to `backend/src/ml/artifacts/anomaly-model.json` (~2 KB):
```json
{
  "modelType": "standardized_distance_anomaly",
  "version": "1.0.0",
  "featureNames": [
    "progress_delta",
    "daily_velocity",
    "progress_variance",
    "reported_percent",
    "is_regression"
  ],
  "means": [6.5, 1.8, -4.2, 52.0, 0.05],
  "stds": [4.2, 1.2, 12.5, 28.0, 0.22],
  "d95": 2.31,
  "severityThresholds": {
    "review": 0.50,
    "high": 0.75
  }
}
```

### Complete Artifact Parameter Contract
Every parameter in `anomaly-model.json` has a concrete, necessary purpose across training and production inference:

| Field | Type | Offline Training Origin (`train_anomaly_model.py`) | Production TypeScript Purpose (`anomaly-model.service.ts`) |
| :--- | :--- | :--- | :--- |
| `modelType` | `string` | Fixed schema identifier (`"standardized_distance_anomaly"`) | Validated upon loading to guard against corrupt or misplaced artifacts |
| `version` | `string` | Semantic contract version (`"1.0.0"`) | Checked during backend initialization for schema compatibility |
| `featureNames` | `string[]` | 5 ordered feature identifiers | Asserts input vector length and alignment with extractor schema |
| `means` | `number[]` | Column means $\mu_i$ computed over normal baseline distribution | Feature standardization: $z_i = (x_i - \mu_i) / \sigma_i$ (must be 5 finite numeric values) |
| `stds` | `number[]` | Sample standard deviations $\sigma_i$ over normal baseline distribution | Feature standardization: $z_i = (x_i - \mu_i) / \sigma_i$ (must be 5 finite values strictly $> 0$; non-positive stds fail validation) |
| `d95` | `number` | 95th percentile distance of normal baseline: $\text{Percentile}_{95}(\{D^{(k)}\})$ | Distance normalization scale in continuous formula: $\text{score} = 1 - 1 / (1 + (D / d_{95})^2)$ *(Note: `2.31` is an illustrative placeholder only; must be finite $> 0$)* |
| `severityThresholds.review` | `number` | Calibrated review threshold ($0.50$, corresponding to $D = d_{95}$) | Categorizes updates with $\text{score} \ge 0.50$ into `'review'` severity |
| `severityThresholds.high` | `number` | Calibrated high-priority threshold ($0.75$) | Categorizes updates with $\text{score} \ge 0.75$ into `'high'` severity |

> [!NOTE]
> `distanceThreshold` is deliberately excluded. In this architecture, distance is mapped continuously through $d_{95}$, and severity policy evaluates the resulting anomaly score directly against `severityThresholds`.

---

# PHASE 17 — TypeScript Native Anomaly Inference

Implemented in `backend/src/ml/anomaly/anomaly-model.service.ts`:

```ts
export interface AnomalyModelArtifact {
  modelType: string;
  version: string;
  featureNames: string[];
  means: number[];                      // 5 finite numeric values
  stds: number[];                       // 5 finite numbers, all strictly > 0
  d95: number;                          // Finite number > 0
  severityThresholds: {
    review: number;                     // 0 < review < high < 1.0
    high: number;
  };
}

export interface AnomalyPrediction {
  anomalyScore: number;                 // [0, 1] continuous score
  severity: 'normal' | 'review' | 'high';
  reviewRecommended: boolean;
  reasons: string[];
}

export class AnomalyModelService {
  private artifact: AnomalyModelArtifact;

  constructor(artifact?: AnomalyModelArtifact) {
    this.artifact = artifact || this.loadArtifact();
    this.validateArtifact(this.artifact);
  }

  private validateArtifact(art: AnomalyModelArtifact): void {
    if (art.modelType !== 'standardized_distance_anomaly') {
      throw new Error(`[AnomalyModelService] Invalid modelType in artifact: ${art.modelType}`);
    }
    if (!art.featureNames || art.featureNames.length !== 5) {
      throw new Error(`[AnomalyModelService] Invalid featureNames vector dimensions in artifact`);
    }
    if (!art.means || art.means.length !== 5 || !art.means.every(m => typeof m === 'number' && Number.isFinite(m))) {
      throw new Error(`[AnomalyModelService] Invalid means in artifact: every mean must be a finite numeric value`);
    }
    if (!art.stds || art.stds.length !== 5 || !art.stds.every(s => typeof s === 'number' && Number.isFinite(s) && s > 0)) {
      throw new Error(`[AnomalyModelService] Invalid stds in artifact: every standard deviation must be a finite number strictly greater than 0`);
    }
    if (typeof art.d95 !== 'number' || !Number.isFinite(art.d95) || art.d95 <= 0) {
      throw new Error(`[AnomalyModelService] Invalid d95 scale in artifact: must be a finite number > 0`);
    }
    if (!art.severityThresholds || 
        typeof art.severityThresholds.review !== 'number' || !Number.isFinite(art.severityThresholds.review) ||
        typeof art.severityThresholds.high !== 'number' || !Number.isFinite(art.severityThresholds.high) ||
        art.severityThresholds.review <= 0 || art.severityThresholds.review >= art.severityThresholds.high || art.severityThresholds.high >= 1.0) {
      throw new Error(`[AnomalyModelService] Invalid severityThresholds in artifact: must satisfy 0 < review < high < 1.0`);
    }
  }

  predict(features: AnomalyFeatureVector): AnomalyPrediction {
    const rawVector = [
      features.progress_delta,
      features.daily_velocity,
      features.progress_variance,
      features.reported_percent,
      features.is_regression
    ];

    // 1. Standardize features against fitted normal baseline (exact learned parameters; no silent fallback)
    const z = rawVector.map((x, i) => (x - this.artifact.means[i]) / this.artifact.stds[i]);

    // 2. Multidimensional standardized distance D
    const distance = Math.sqrt(z.reduce((sum, zi) => sum + zi * zi, 0));

    // 3. Continuous anomaly score using exported d95 scale
    // When distance === d95, anomalyScore === 0.50 (entry into review band)
    const d95 = this.artifact.d95;
    const anomalyScore = Math.round((1 - 1 / (1 + Math.pow(distance / d95, 2))) * 100) / 100;

    // 4. Determine severity band from exported thresholds
    let severity: 'normal' | 'review' | 'high' = 'normal';
    if (anomalyScore >= this.artifact.severityThresholds.high) {
      severity = 'high';
    } else if (anomalyScore >= this.artifact.severityThresholds.review) {
      severity = 'review';
    }

    const reviewRecommended = severity !== 'normal';

    // 5. Generate statistically grounded diagnostic reasons
    const reasons = this.generateReasons(features, z, severity);

    return {
      anomalyScore,
      severity,
      reviewRecommended,
      reasons
    };
  }
}
```

> [!IMPORTANT]
> **No Silent Fallback Rule**: All learned numerical artifact parameters must be finite, and every standard deviation must be strictly positive (`stds[i] > 0`). If an artifact contains non-finite values or zero/negative standard deviations, `validateArtifact()` rejects the artifact at initialization. Production inference uses the exact fitted values directly without silently substituting `1.0` or masking bad artifact parameters.

- Fully deterministic, target latency $< 20\ \mu\text{s}$ execution time (expected performance to be verified by benchmarking).
- **Graceful Fallback**: If prior history is missing, returns `anomalyScore: 0.0`, `severity: 'normal'`, `reviewRecommended: false`.

---

# PHASE 18 — Pre-Review Ingestion Integration

Anomaly detection runs **before supervisor confirmation**, during candidate evaluation:

1. Document Ingestion extracts facts from field evidence.
2. `ActivityMatchingService.computeMatches()` matches candidate activities.
3. For each candidate with `fact.progress_percent !== null`:
   - Fetches the latest canonical observation for that activity from `activity_progress`.
   - Computes planned progress as of the report date via `ProgressSnapshotCalculator`.
   - Runs `anomalyModelService.predict()`.
   - Attaches `anomaly: AnomalyPrediction` to the candidate match result.
4. The review card displays both the candidate activity and the anomaly alert.
5. The supervisor confirms or rejects with full situational awareness.

---

# PHASE 19 — Minimalist UI Enhancements (No New ML Dashboard)

Two focused UI enhancements in existing views:

1. **Match Review Cards (`frontend/src/App.tsx` & `ActivityReviewContext.tsx`)**:
   ```tsx
   {/* ML Match Pill beside deterministic tier */}
   {m.mlConfidence !== null && m.mlConfidence !== undefined && (
     <span className="match-ml-badge">
       <Cpu size={11} />
       <span>ML Match: {Math.round(m.mlConfidence * 100)}%</span>
     </span>
   )}

   {/* Anomaly Warning Banner if reviewRecommended */}
   {m.anomalySeverity && m.anomalySeverity !== 'normal' && (
     <div className={`anomaly-warning-banner severity-${m.anomalySeverity}`}>
       <AlertTriangle size={14} className="anomaly-icon" />
       <div className="anomaly-body">
         <span className="anomaly-title">
           Progress Anomaly Detected ({Math.round((m.anomalyScore || 0) * 100)}% Anomaly)
         </span>
         <span className="anomaly-desc">{m.anomalyReasons?.join('. ')}</span>
       </div>
     </div>
   )}
   ```
2. **Activity Detail View (`ActivityCurrentState.tsx`)**:
   - If the latest observation has an elevated anomaly score, display a subtle warning pill: `"Last update flagged for supervisor verification"`.

---

# PHASE 20 — API Response Fields

Extended existing DTOs in `backend/src/services/matching/activity-matching.types.ts`:
```ts
export interface CandidateMatch {
  activityId: string;
  activityExternalId: string;
  activityName: string;
  confidenceScore: number;
  matchMethod: MatchMethod;
  matchedText: string | null;
  rationale: string;
  mlConfidence?: number | null;
  anomalyScore?: number | null;
  anomalySeverity?: 'normal' | 'review' | 'high' | null;
  anomalyReasons?: string[] | null;
}
```

---

# PHASE 21 — Advisory Database Migration (`0010_ml_advisory_fields.ts`)

### Architectural Scope & Invariant Guard
To support the asynchronous review queue (where `DocumentIngestionWorker` processes evidence in the background and the supervisor inspects results later via `GET /matches`), migration `0010_ml_advisory_fields.ts` adds nullable advisory columns to `activity_matches`:
- `ml_confidence REAL`
- `anomaly_score REAL`
- `anomaly_severity TEXT`
- `anomaly_reasons_json TEXT`

> [!IMPORTANT]
> **Strict Non-Canonical Boundary**: These columns store **ephemeral review metadata** on suggested matches. They are **never canonical progress truth**, never touch `activity_progress`, and have zero effect on schedule risk calculations.

---

# PHASE 22 — Model Status Endpoint (`GET /api/ml/status`)

Created in `backend/src/routes/ml.router.ts`:
```http
GET /api/ml/status
```
Response:
```json
{
  "status": "healthy",
  "models": {
    "matchModel": {
      "loaded": true,
      "version": "1.0.0",
      "type": "logistic_regression",
      "featureCount": 8
    },
    "anomalyModel": {
      "loaded": true,
      "version": "1.0.0",
      "type": "standardized_distance_anomaly",
      "featureCount": 5
    }
  }
}
```
Mounted in `backend/src/routes/index.ts`.

---

# PHASE 23 — Package Scripts

Updated `package.json`:
```json
{
  "scripts": {
    "ml:train:match": "python scripts/ml/train_match_model.py",
    "ml:train:anomaly": "python scripts/ml/train_anomaly_model.py",
    "ml:train": "npm run ml:train:match && npm run ml:train:anomaly",
    "ml:evaluate": "python scripts/ml/evaluate_models.py",
    "ml:verify": "tsx scripts/ml/verify-production-models.ts"
  }
}
```

---

# PHASE 24 — Automated Vitest Suites

Added to `backend/tests/`:
1. `backend/tests/ml_match_model.test.ts`:
   - Artifact loading, feature extraction, exact ID pairing ($> 0.90$), distractor pairing ($< 0.30$), Top-1 held-out accuracy.
2. `backend/tests/ml_anomaly_model.test.ts`:
   - Normal progression $\rightarrow$ normal severity.
   - Minor negative reconciliation adjustment $\rightarrow$ normal severity (NOT anomalous).
   - Moderate regression $\rightarrow$ review severity.
   - Atypical severe regression $\rightarrow$ high anomaly severity.
   - Extreme daily jump $\rightarrow$ high anomaly severity.
3. `backend/tests/ml_pipeline_integration.test.ts`:
   - Ingestion $\rightarrow$ Match Reranking $\rightarrow$ Anomaly Warning $\rightarrow$ Review $\rightarrow$ Canonical Normalization.
   - Asserts ML predictions do not mutate `activity_progress` without supervisor confirmation.
   - Asserts dual-threshold auto-confirm rule is strictly enforced.

---

# PHASE 25 — Golden Demo Walkthrough Scenarios (`REFINERY-U4`)

Demonstrated on the existing, certified `REFINERY-U4` dataset (*scores below are illustrative targets to be verified against the trained model*):

* **Scenario A — Match Model Reranking**:
  - Input: `"Pump foundation piles completed to 65% at Area B crude pump bay"`
  - Candidates: `ACT-B02` (Crude Pump Foundation Piling Works) vs `ACT-B01` (North Tank Farm Excavation).
  - Match Model ranks `ACT-B02` #1 with elevated learned confidence (illustrative target: $\sim 90-96\%$, vs $\sim 10-20\%$ for `ACT-B01`).
* **Scenario B — Anomaly Model Warning**:
  - Input: `"Crude pump foundation piling jumped to 98% complete today"`
  - Fact: `ACT-B02` reported from 65% to 98% in 1 day.
  - Anomaly Model flags:
    - Anomaly Score: Elevated (illustrative target: $\ge 0.75$, `severity: 'high'`, `reviewRecommended: true`).
    - Reason: `"Daily progress velocity is well above the learned baseline distribution (+Z standard deviations from normal pacing)."`
  - Supervisor sees the amber/rose warning banner and active blocker ("flooded trenches"), preventing premature confirmation.
* **Scenario C — Normal Progress Control**:
  - Input: `"Crude pump foundation piles advanced to 68% complete today"`
  - Increment: Small steady step.
  - Anomaly Model flags: Low score (illustrative target: $< 0.30$, `severity: 'normal'`, `reviewRecommended: false`).

---

# PHASE 26 — Production Verification Script

Created `scripts/ml/verify-production-models.ts`:
- Asserts model JSON artifacts exist and match Zod/TypeScript schema.
- Asserts weight arrays match feature vector lengths (8 for match, 5 for anomaly).
- Asserts all elements of `means` in `anomaly-model.json` are finite numeric values.
- Asserts all elements of `stds` in `anomaly-model.json` are finite numbers strictly greater than 0 (`stds[i] > 0`).
- Asserts `d95` is a positive finite number ($d_{95} > 0$) in `anomaly-model.json`.
- Asserts legacy or unused keys (such as `distanceThreshold`) are absent from `anomaly-model.json`.
- Asserts `severityThresholds.review` and `severityThresholds.high` are valid policy thresholds ($0 < review < high < 1.0$).
- Runs golden inference smoke tests on both models.
- Exit code 0 if all checks pass.

---

# PHASE 27 — Release Verification Integration

Updated `scripts/verify-release.ts`:
```ts
{
  name: '5. ML Subsystem Verification',
  command: 'npm run ml:verify',
  description: 'Validate ML model artifacts, feature dimensions, and native TypeScript inference'
}
```
`npm run verify:release` runs:
`build` + `npm test` + `demo:reset` + `demo:verify` + `ml:verify`.

---

# PHASE 28 — Render Free-Tier Deployment Guarantee

- **Runtime**: Node 22 (`runtime: node`).
- **RAM Footprint**: $< 100\ \text{KB}$ in-memory JSON artifact.
- **Latency**: Target $< 50\ \mu\text{s}$ per inference call (expected performance to be verified by benchmarking).
- **Zero Python on Render**: Python scripts are used locally/offline only.

---

# PHASE 29 — Offline Python Training Environment

- Standard Python 3 with `numpy`.
- No PyTorch, TensorFlow, or CUDA required.
- Training completes in expected $< 2\ \text{seconds}$ on standard laptop CPU (to be verified during pipeline execution).

---

# PHASE 30 — System Documentation

1. `docs/ML-ARCHITECTURE.md`: Architecture diagrams, dual-layer separation, feature contracts.
2. `docs/ML-TRAINING.md`: Dataset authoring guide, gradient descent equations, holdout methodology, retraining workflow.

---

# PHASE 31 — Canonical Truth Boundary Certification

- `activity_progress` is strictly append-only.
- Only `ProgressService.normalizeAndRecordProgress()` can write to `activity_progress`.
- ML predictions are advisory signals that enrich human decision-making.

---

# PHASE 32 — Semantic Versioning

Both artifacts specify `"version": "1.0.0"`. Feature contracts are version-checked on backend startup.

---

# PHASE 33 — Retraining Workflow

To retrain and update production models:
```bash
npm run ml:train
npm run ml:evaluate
npm run ml:verify
npm test
npm run verify:release
git add backend/src/ml/artifacts/*.json
git commit -m "feat(ml): retrain models on updated golden dataset"
```

---

# PHASE 34 — Prohibited Technologies (Confirmed Excluded)

- ❌ No vector database (Pinecone, Chroma, Qdrant, Milvus).
- ❌ No PyTorch, TensorFlow, or Keras.
- ❌ No LLM fine-tuning.
- ❌ No Python server (Flask, FastAPI) in production.
- ❌ No GPU dependencies.

---

# PHASE 35 — Definition of Done

The ML subsystem is complete when:
- [ ] `match_dataset.jsonl` and `anomaly_dataset.jsonl` exist with strict activity holdouts.
- [ ] Python training scripts train from scratch and export JSON artifacts.
- [ ] TypeScript inference services run natively without external libraries.
- [ ] Match Model acts as a reranker without rank leakage over 8 candidate-level features.
- [ ] Auto-confirm dual threshold ($s_{\text{det}} \ge 0.90 \wedge p_{\text{ml}} \ge 0.85$) is strictly enforced.
- [ ] Anomaly Model evaluates pre-review using statistical baseline distance and handles small corrections as normal.
- [ ] `anomaly-model.json` exports fitted `d95` (95th-percentile baseline distance), finite `means`, strictly positive `stds` (> 0), and policy severity thresholds (`review: 0.50`, `high: 0.75`), with `distanceThreshold` omitted.
- [ ] Artifact validation rejects non-finite means and non-positive stds at initialization without silent default substitution.
- [ ] Migration `0010` adds advisory metadata columns.
- [ ] UI displays match confidence and anomaly alert banners in existing review cards.
- [ ] `GET /api/ml/status` returns model health.
- [ ] All Vitest tests pass (`npm test`).
- [ ] `npm run verify:release` passes 100%.

---

# 10-Step Implementation Order

```text
1. Types & Feature Extractors       -> backend/src/ml/types.ts & extractors
2. Independent Datasets             -> scripts/ml/datasets/*.jsonl
3. Offline Training Scripts         -> scripts/ml/train_*.py & evaluate_models.py
4. Generate Artifacts               -> backend/src/ml/artifacts/*.json
5. Native TS Inference Services     -> backend/src/ml/match/ & backend/src/ml/anomaly/
6. Advisory Database Migration      -> backend/src/database/migrations/0010_*.ts
7. Ingestion & Reranker Integration -> ActivityMatchingService & DocumentIngestionService
8. Status Route & UI Cards          -> backend/src/routes/ml.router.ts & frontend review cards
9. Automated Test Suites            -> backend/tests/ml_*.test.ts
10. Release Integration             -> scripts/ml/verify-production-models.ts & verify-release.ts
```
