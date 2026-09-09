# FieldLine ML Subsystem Architecture

> **Document Status:** Authoritative System Architecture Specification  
> **Target Baseline:** FieldLine v0.1.0 (`main` branch, Pass 36 certified)  
> **Production Stack:** Node.js 22 + TypeScript + Express + Better-SQLite3 (Render Free Tier)  
> **Offline Training:** Python 3.11 + NumPy 2.4.3 (Zero Production Dependency)  

---

## 1. Architecture Overview

FieldLine bridges messy, unstructured field observations with rigorous master infrastructure schedules (Primavera P6, MS Project). To guarantee mathematical auditability, schedule integrity, and zero silent corruption, FieldLine enforces a strict **Dual-Layer Architecture**:

1. **Probabilistic AI & Machine Learning Layer**: Generative AI (Gemini Live / Groq / MockAI) extracts structured facts from text, photos, audio, and documents; lightweight locally trained ML models rerank candidate schedule links and compute statistical anomaly scores.
2. **Deterministic Authoritative Layer**: All mathematical percentage derivations, timeline reconciliations, schedule variances, risk classifications, and database mutations are executed deterministically in TypeScript and SQLite.

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
              │      Engine (Pass 11 & 12)       │
              └──────────────────────────────────┘
```

---

## 2. Match Model (Second-Stage Learned Reranker)

### Role & Purpose
The **FieldLine Match Model** does **not** replace the deterministic candidate generator (`scoreActivityCandidate()`). Instead, it acts as a **second-stage learned reranker and confidence scorer**.

The deterministic matcher filters the schedule down to plausible candidates ($\text{score} \ge 0.40$). The Match Model then evaluates high-dimensional candidate-level interactions to estimate the empirical probability that candidate $c$ is the true schedule activity intended by field fact $f$.

### Feature Vector (8 Canonical Features)
Features are extracted strictly in canonical order with zero rank leakage:

| Index | Feature Name | Description | Range |
|---|---|---|---|
| 0 | `name_similarity` | Trigram / word overlap between fact reference and activity name | $[0.0, 1.0]$ |
| 1 | `description_similarity` | Trigram / token overlap with activity scope description | $[0.0, 1.0]$ |
| 2 | `location_exact_match` | Exact equality between fact location and activity location | $\{0.0, 1.0\}$ |
| 3 | `location_similarity` | Fuzzy containment or area overlap | $[0.0, 1.0]$ |
| 4 | `location_contradiction` | Fact location explicitly conflicts with activity area | $\{0.0, 1.0\}$ |
| 5 | `wbs_match` | WBS code substring presence in fact reference | $\{0.0, 1.0\}$ |
| 6 | `exact_id_match` | External activity ID match in fact reference | $\{0.0, 1.0\}$ |
| 7 | `score_gap_from_second_candidate` | Deterministic score margin ($s_1 - s_2$) | $[0.0, 1.0]$ |

### Normalization & Inference
Inference runs in native TypeScript (`MatchModelService`):
1. **Z-score Standardize**: $z_j = \frac{x_j - \mu_j}{\sigma_j}$ using training-set statistics.
2. **Linear Logit**: $z = \sum_{j=0}^{7} w_j z_j + b$.
3. **Numerically Protected Sigmoid**: $p = \frac{1}{1 + \exp(-\text{clip}(z, -25, 25))}$.

### Strict Dual-Threshold Auto-Confirm Gate
For non-exact matches, automatic confirmation is strictly prohibited unless **all three** criteria hold simultaneously:
1. **Deterministic Score**: $s_{\text{det}} \ge 0.90$.
2. **Clear Separation**: Candidate separation margin $\ge 0.15$.
3. **Learned ML Confidence**: $p_{\text{ml}} \ge 0.85$.

If any criterion is unmet, the match is preserved as `status: 'suggested'` (`reviewState: 'awaiting_review'`) for mandatory supervisor confirmation. **ML confidence alone can never auto-confirm a candidate.**

Exact external-ID matches (`exact_id_match === 1.0`) retain their deterministic exact-ID path.

---

## 3. Anomaly Model (Statistical Review-Prioritization Advisory)

### Role & Positioning
The **FieldLine Anomaly Model** is a locally fitted **unsupervised statistical anomaly detector**.

> [!IMPORTANT]
> **Positioning Invariant**: The Anomaly Model is **NOT a lie detector**, fraud detection engine, or worker honesty score. It measures statistical Mahalanobis/Euclidean deviation of reported progress velocity against a learned baseline progression profile, highlighting unusual entries for supervisor review *before* confirmation.

### Feature Vector (5 Canonical Features)
Features capture transition velocity and acceleration:

| Index | Feature Name | Description |
|---|---|---|
| 0 | `progress_delta` | Absolute change in percentage ($\Delta p = p_{\text{new}} - p_{\text{prev}}$) |
| 1 | `daily_velocity` | Progress per calendar day ($\Delta p / \Delta t$) |
| 2 | `progress_variance` | Deviation from average planned daily burn rate |
| 3 | `reported_percent` | Absolute reported milestone percentage ($p_{\text{new}}$) |
| 4 | `is_regression` | Binary indicator for downward revision ($p_{\text{new}} < p_{\text{prev}}$) |

### Mathematical Formula
1. **Standardized Coordinates**: $z_j = \frac{x_j - \mu_j}{\sigma_j}$ (fitted on normal baseline observations).
2. **Standardized Euclidean Distance**:
   $$D = \sqrt{\sum_{j=0}^{4} z_j^2}$$
3. **Continuous Anomaly Score**: Scaled relative to the 95th-percentile normal baseline distance ($d_{95} = 4.2221$):
   $$\text{score} = 1 - \frac{1}{1 + (D / d_{95})^2}$$
   - $D = 0 \implies \text{score} = 0.0$ (`severity: 'normal'`)
   - $D = d_{95} \implies \text{score} = 0.50$ (`severity: 'review'`)
   - $D \gg d_{95} \implies \text{score} \to 1.0$ (`severity: 'high'`)

### Severity Thresholds & Advisory Actions
- **`normal`** ($\text{score} < 0.50$): Normal progress advance; no alert banner.
- **`review`** ($0.50 \le \text{score} < 0.75$): Elevated velocity; advisory review notice.
- **`high`** ($\text{score} \ge 0.75$): Extreme jump or sharp regression; rose warning banner displayed on review card with machine-generated explanation reasons.

### Pre-Review Timing
The Anomaly Model executes *during* ingestion and candidate matching so that warnings appear on the supervisor's screen *before* any update can become canonical truth.

### Cold-Start Behavior
When an activity has no prior progress history, the model runs against default baseline expectations ($p_{\text{prev}} = 0$), preventing unhandled crashes or undefined states.

---

## 4. Canonical Truth Boundary

```text
ML Prediction ≠ Canonical Truth
```

1. Neither model is permitted to mutate `activity_progress`, modify Primavera baseline dates, or alter schedule network topology.
2. Only `ProgressService.normalizeAndRecordProgress()` has authorization to write to `activity_progress`.
3. All writes require either deterministic exact-ID match, passing the strict auto-confirm gate, or explicit supervisor confirmation via `/api/activity-matches/:id/confirm`.
4. `activity_progress` is strictly append-only, ensuring verifiable historical auditability.

---

## 5. Model Artifact Flow

```text
Offline Python 3.11 + NumPy 2.4.3
            ↓
Train / Fit from scratch
            ↓
Export validated JSON (< 1.5 KB total)
  ├── backend/src/ml/artifacts/match-model.json (776 bytes)
  └── backend/src/ml/artifacts/anomaly-model.json (480 bytes)
            ↓
Copied during build to dist/backend/src/ml/artifacts/
            ↓
Native TypeScript Loaders (Zod / Invariant validated)
            ↓
Zero-Dependency Native In-Memory Inference (Render Free Tier)
```

**Why Python is Excluded from Production:**
- Zero Python process or child process overhead in production Node.js.
- Zero heavyweight runtime dependencies (no PyTorch, TensorFlow, Keras, scikit-learn, CUDA, or vector databases).
- Instant startup, minimal RAM footprint ($< 2\text{ KB}$ artifact memory), and sub-microsecond inference.

---

## 6. Persistence & API Surface

### Advisory Database Columns (Migration `0010`)
Added to table `activity_matches`:
- `ml_confidence` (REAL, nullable): Match Model score in $[0.0, 1.0]$.
- `anomaly_score` (REAL, nullable): Anomaly Model score in $[0.0, 1.0]$.
- `anomaly_severity` (TEXT, nullable): `'normal' | 'review' | 'high'`.
- `anomaly_reasons` (TEXT, nullable): JSON string array of plain-English explanation reasons.

### Public Health Endpoint
`GET /api/ml/status` provides live runtime model status:
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

### Role-Partitioned UI Presentation
- **Admin / Supervisor**: Full review context displaying learned match confidence percentage, anomaly alert banners with breakdown tags, and one-click confirm/reject buttons.
- **Worker**: Clean, focused operational cockpit showing Today's execution tasks without cognitive overload from statistical metrics.

---

## 7. Verification & Release Integration

Release readiness is enforced across 5 progressive stages in `scripts/verify-release.ts`:
1. `npm run build`: Backend TypeScript compilation + Frontend Vite bundling.
2. `npm test`: Full 126-file Vitest regression & evaluation suite (1233 tests).
3. `npm run demo:reset`: Database clean, migrations, and golden scenario seeding.
4. `npm run demo:verify`: 68 machine-checkable demo invariants.
5. `npm run ml:verify`: Validation of model JSON artifacts, feature contracts, parameter finiteness, and native inference smoke tests.

Any failure in Step 5 aborts release verification immediately with a non-zero exit code.
