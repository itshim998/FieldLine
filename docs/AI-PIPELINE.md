# FieldLine AI & Canonical Truth Pipeline

**Smart India Hackathon 2026** — Problem Statement `SIH26122`  
**System Architecture:** Intelligent Ingestion, Activity Matching, Progress Normalization, Deterministic Intelligence, and Grounded Assistant

---

## 1. Pipeline Overview

FieldLine implements a strict **Dual-Layer Architecture** that separates **probabilistic AI extraction** from **authoritative project truth**. 

AI models (Gemini or MockAI) are used exclusively for text understanding, entity extraction, and natural-language synthesis. All mathematical progress calculations, schedule variance assessments, risk classifications, and database mutations are executed deterministically in TypeScript and SQLite.

```text
       ┌────────────────────────────────────────────────────────┐
       │                  Field Evidence Input                  │
       │       Daily Site Logs, PDF Reports, CSV / Excel        │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │                  Text Normalization                    │
       │       Encoding, Layout Cleaning, Sanitization          │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │              AI Structured Extraction Layer            │
       │          Prompt Engine + Gemini / MockAI Provider      │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │               Strict Zod Contract Validation           │
       │    FieldProgressExtractionSchema, Safe Parse, Reject   │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │               Activity Matching Engine                 │
       │ Exact ID (1.0) → Text Similarity → Location Alignment │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │               Confidence & Review Policy               │
       │  High (>0.85) / Medium (0.60-0.85) / Low (<0.60)      │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
  ════════════════════════════════════════════════════════════════════
  🛡️ CANONICAL TRUTH BOUNDARY (Human-in-the-Loop Confirmation)
  ════════════════════════════════════════════════════════════════════
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │              Canonical Activity Progress               │
       │    Pure Quantity Arithmetic, Overlap Reconciliation    │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │             Deterministic Project Intelligence         │
       │  Snapshot Target vs Actual, Variance, Risk Engine      │
       └───────────────────────────┬────────────────────────────┘
                                   │
                                   ▼
       ┌────────────────────────────────────────────────────────┐
       │                Grounded Assistant Layer                │
       │   Intent Parsing → Fact Assembly → Grounded Answer     │
       └────────────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Pipeline Walkthrough

### Step 1: Field Evidence Ingestion & Normalization
- Unstructured site notes, subcontractor shift logs, Excel workbooks, or PDF inspection reports are uploaded.
- Text content is extracted using dedicated format parsers (`pdf_extractor`, `xlsx_extractor`, `csv_extractor`, `ocr_extractor`).
- Raw texts are preserved immutably in `progress_updates` for complete auditability and provenance.

### Step 2: AI Structured Extraction
- The unstructured text is processed by `FieldProgressExtractionService`.
- The AI layer identifies field progress assertions: work items mentioned, referenced quantities, percentages, work locations, and observation notes.

### Step 3: Strict Zod Contract Validation
- Raw AI output is validated against `FieldProgressExtractionSchema` using Zod.
- Malformed payloads, invalid numbers, or out-of-range percentages are rejected at the boundary.
- Zero untrusted LLM output enters application memory without schema conformance.

### Step 4: Multi-Tier Activity Matching Engine
Candidate matches between extracted field facts and scheduled activities are scored across 3 deterministic tiers:
1. **Exact ID Match** (`score: 1.00`): Matches WBS code or external ID (e.g. `ACT-B02`).
2. **Text Similarity Match** (`score: 0.60 - 0.95`): Tokenized n-gram and Jaccard similarity across activity names.
3. **Location & WBS Alignment** (`boost: +0.18`, `penalty: -0.25`): Boosts scores when the reported work area (e.g. `Area B`) matches schedule metadata.

### Step 5: Confidence & Review Policy
- Matches are assigned a confidence tier:
  - **High** ($\ge 0.85$): Candidate strongly aligns with schedule activity.
  - **Medium** ($0.60 - 0.84$): Plausible candidate requiring supervisor verification.
  - **Low** ($< 0.60$): Weak match; flagged as unresolved.

### Step 6: Human Confirmation (Canonical Truth Boundary)
> [!IMPORTANT]
> **Core Invariant**: AI suggestions **never** become canonical project truth automatically.
> Only when a project supervisor **confirms** a match does it become eligible to update the official progress record (`activity_progress`).

### Step 7: Canonical Progress Normalization
- When a match is confirmed, `ProgressService` calculates actual progress using pure TypeScript arithmetic:
  $$\text{Actual Progress \%} = \min\left(100, \frac{\text{Actual Quantity}}{\text{Planned Quantity}} \times 100\right)$$
- If only percentage is reported, percentage math is applied with range validation.
- Earliest actual start dates are preserved chronologically; subsequent updates append observation nodes.

### Step 8: Deterministic Project Intelligence & Risk Engine
- `ProgressSnapshotService` calculates scheduled planned progress as-of any target date using linear baseline interpolation.
- `RiskClassificationService` computes variance:
  $$\text{Variance} = \text{Actual Progress \%} - \text{Planned Progress \%}$$
- Activities are classified into deterministic risk categories:
  - **`COMPLETED`**: Actual Progress $= 100\%$.
  - **`DELAYED`**: Actual Progress $< 100\%$ and $\text{Planned Finish} < \text{As-Of Date}$.
  - **`AT_RISK`**: $\text{Variance} \le -10\%$ or finish date within approaching critical window.
  - **`ON_TRACK` / `AHEAD`**: Pacing with or leading baseline schedule.

### Step 9: Grounded Assistant & Fact Citations
- When a user asks questions in natural language:
  1. `AssistantIntentService` parses query intent (`delayed_activities`, `activity_status`, `at_risk_activities`, `milestones`, `recent_changes`).
  2. `ActivityResolver` matches referenced activities (e.g., `"crude pump"` &rarr; `ACT-B02`).
  3. `AssistantService` gathers **authoritative facts** from the deterministic intelligence engine (`[FACT-1]`, `[FACT-2]`, etc.).
  4. The AI synthesizes a conversational answer **constrained strictly to the gathered facts**.
  5. The assistant returns structured claims with exact fact citations (`claims: [{ factRef: 'FACT-1', field: 'actualProgress', value: 65 }]`).

---

## 3. What AI Does vs What AI Does NOT Do

| Capability | AI Responsibility | Deterministic Core Responsibility |
| :--- | :--- | :--- |
| **Document Ingestion** | Extract entities & mentions from raw text | Immutably store raw evidence files and compute SHA-256 hashes |
| **Activity Matching** | Suggest candidate matches and rationales | Score candidates, enforce review thresholds, and manage review state |
| **Progress Calculation** | *Never* computes canonical numbers | Calculates quantity arithmetic, caps, and chronological ordering |
| **Variance & Risk** | *Never* evaluates project risk | Computes planned vs. actual progress and overdue flags mathematically |
| **Project Assistant** | Synthesizes conversational phrasing | Gathers verified facts, validates claims, and provides cited provenance |

---

## 4. Provider Abstraction: MockAI, Gemini, and Groq

FieldLine supports pluggable AI providers behind the `AIProvider` interface:

```typescript
export interface AIProvider {
  readonly name: string;
  generateText(prompt: string, options?: AIRequestOptions): Promise<string>;
  generateStructured<T>(prompt: string, schema: z.ZodType<T>, options?: AIRequestOptions): Promise<unknown>;
}
```

### `MockAIProvider` (Default / Local / Offline)
- Runs completely offline without API keys or internet connection.
- Implements deterministic regex and keyword heuristics to extract field facts and answer assistant queries.
- Guarantees 100% test reproducibility and instant local evaluation for golden demo verification.

### `GeminiAIProvider` (Google Gen AI)
- Uses `@google/genai` with `gemini-3.7-flash`.
- Generates structured JSON schema completions.
- Automatically redacts API keys and authorization headers from all logs and error messages.
- Activated by setting `AI_PROVIDER=gemini` and configuring `GEMINI_API_KEY` in `.env`.

### `GroqAIProvider` (High-Throughput Real-AI with 20-Key Failover Router)
- Uses Groq's high-speed OpenAI-compatible endpoint with model `openai/gpt-oss-20b`.
- Backed by an in-memory **20-Key Sticky Sequential Failover Router** (`GroqKeyRouter`).
- Activated by setting `AI_PROVIDER=groq` and configuring `GROQ_API_KEY_01` through `GROQ_API_KEY_20` in `.env`.

---

## 5. Groq 20-Key Sticky Sequential Failover Architecture (Pass 26)

```text
                         AIService
                            │
                            ▼
                       AIProvider
                            │
                    ┌───────┴────────┐
                    │                │
                 MockAI             GroqAI
                                      │
                                      ▼
                                GroqKeyRouter
                                      │
               ┌──────────┬──────────┼──────────┬──────────┐
               ▼          ▼          ▼          ▼          ▼
             Key 01     Key 02     Key 03     ...       Key 20
               │          │          │                    │
               └──────────┴──────────┴────────────────────┘
```

### Key Router Semantics & Invariants:
1. **Sticky Current Key**: The router maintains `currentKeyIndex` (initially Slot `01`). While requests succeed, FieldLine stays on the current key.
2. **Immediate Failover**: On qualifying failures (HTTP 429 rate limit, 401/403 auth error, 5xx server errors, timeouts, network drops), the router immediately advances to the next configured slot (`(current + 1) % N`) without delay.
3. **Never Incorrectly Reset**: If Key 07 fails and Key 10 succeeds, subsequent requests start at Key 10. The ring state follows the successful key.
4. **Single-Pass Exhaustion Guard**: A single request attempts each configured key at most once in ring order. If all keys fail, one aggregated `AIProviderError` is returned with sanitized diagnostic metadata.
5. **Key Health & Cooldown**: Repeated 429/5xx errors trigger exponential cooldown (or parse `Retry-After` headers); 401/403 errors mark the key permanently invalid to prevent future requests from starting on dead keys.
6. **Zero Credential Exposure**: API keys and authorization headers are strictly redacted. Logging and health snapshots expose only key slots (e.g. `Slot 01`, `Slot 07`).
7. **Acceptance Smoke Test**: Run `npm run ai:smoke` to validate real Groq connectivity and model responses without altering deterministic test suites.

