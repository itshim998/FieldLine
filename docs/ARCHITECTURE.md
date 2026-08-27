# FieldLine Architecture — Pass 3: Project Management

## Overview

FieldLine is an intelligent data capture and schedule-linking platform designed for infrastructure project management (Smart India Hackathon 2026, **PS ID:** SIH26122).

The core design principle is:
> **Production-quality application logic, presentation-grade local infrastructure.**

FieldLine runs entirely locally on a developer/evaluator workstation without requiring cloud infrastructure, container daemons (Docker), or external database servers.

---

## Authoritative Architectural Pipelines

### 1. HTTP Request Execution Pipeline

```text
Project UI (React State + LocalStorage Project Context)
    ↓
HTTP Route (Thin Controller: /api/projects, /api/health)
    ↓
Validation (Zod Schemas & Middleware)
    ↓
Service (Pure Application Orchestration: ProjectService, HealthService)
    ↓
Repository (Persistence Abstraction: ProjectRepository, SystemRepository)
    ↓
SQLite (Local Storage with WAL Mode & Foreign Keys ON: database/fieldline.db)
```

**Key Invariants:**
- **Routes are thin**: They handle HTTP parsing, invoke services, validate outgoing contracts, and set status codes. Routes never embed SQL or domain calculations.
- **Services are decoupled**: Services receive typed DTOs and return pure domain/application models. Services never depend on Express `Request`/`Response` objects, import SQLite drivers directly, or write raw SQL.
- **Repositories encapsulate data access**: All direct SQLite queries, statements, constraints handling, and transactions reside strictly inside the repository and database layers.
- **Frontend relies exclusively on HTTP API**: The frontend never queries SQLite or stores hardcoded database state; persistence is mediated through clean REST endpoints.

---

### 2. Project Lifecycle & Context Persistence Architecture (Pass 3)

```text
┌────────────────────────────────────────────────────────┐
│                   React Frontend                       │
│  - Empty State View ("No projects yet")               │
│  - Project Selector View (Cards, Search & Filter)     │
│  - Project Workspace View (Active context & Sub-tabs)  │
│  - Selected Project ID (localStorage persistence)      │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP REST
                           ▼
┌────────────────────────────────────────────────────────┐
│                   API Router                           │
│  GET    /api/projects          → List all projects     │
│  POST   /api/projects          → Create project        │
│  GET    /api/projects/:id      → Retrieve project      │
│  PATCH  /api/projects/:id      → Update metadata       │
│  DELETE /api/projects/:id      → Cascade delete        │
└──────────────────────────┬─────────────────────────────┘
                           │ Validated DTOs
                           ▼
┌────────────────────────────────────────────────────────┐
│              Zod Validation Middleware                 │
│  - createProjectSchema, updateProjectSchema            │
│  - projectIdParamSchema                                │
└──────────────────────────┬─────────────────────────────┘
                           │ Clean Input
                           ▼
┌────────────────────────────────────────────────────────┐
│                 ProjectService                         │
│  - createProject(input)       → Input normalization    │
│  - listProjects()             → Domain entities        │
│  - getProject(id)             → Throws NotFoundError   │
│  - updateProject(id, input)   → Throws NotFound/Conflict│
│  - deleteProject(id)          → Cascades & removes     │
└──────────────────────────┬─────────────────────────────┘
                           │ Repository Contract
                           ▼
┌────────────────────────────────────────────────────────┐
│               ProjectRepository                        │
│  - SqliteProjectRepository (Prepared Statements)       │
└──────────────────────────┬─────────────────────────────┘
                           │ SQL with Constraints & Pragmas
                           ▼
┌────────────────────────────────────────────────────────┐
│                  SQLite Engine                         │
│  - projects Table (Indexed, Unique Code, WAL Mode)     │
└────────────────────────────────────────────────────────┘
```

#### Selection & Persistence Mechanism
1. When a user creates or selects a project in the UI, the active `project.id` is saved to `localStorage` under the key `fieldline_selected_project_id`.
2. On browser refresh, the frontend queries `GET /api/projects` and restores the selected project workspace context automatically.
3. If the stored project ID is no longer present in the database (e.g. after a database reset or deletion), the frontend gracefully clears the invalid ID from `localStorage` and returns to the project selection list with a notification.

---

### 3. AI Structured Extraction Pipeline (Pass 8)

```text
Raw field report (Unstructured text)
      ↓
FieldProgressExtractionService (Input validation & Prompt builder)
      ↓
AIService (Provider coordination & Safety)
      ↓
AIProvider (MockAIProvider / Gemini / LLM Adapter)
      ↓
Raw Structured Response (Untrusted provider output)
      ↓
Zod FieldProgressExtraction contract (Strict validation, bounded items)
      ↓
Validated structured facts ({ items: [{ reference, location, progress_percent, status }] })
```

> [!IMPORTANT]
> **AI Isolation & Scope Boundary Principle**:
> Pass 8 extracts textual field facts only. It does not identify scheduled activities, mutate activity progress, or define project truth.
> The AI layer must never query SQLite, import repository modules, or write directly to the database. Activity identity and schedule linking belong strictly to **Pass 9 — Activity Matching Engine**.

---

### 4. Activity Matching Engine Pipeline (Pass 9)

```text
Validated Field Facts ({ items: [{ reference, location, progress_percent, status }] })
      ↓
POST /api/projects/:projectId/progress-updates/:updateId/matches
      ↓
ActivityMatchingService (Project verification & ProgressUpdate scoping)
      ↓
ActivityRepository (Fetch all activities for project)
      ↓
Deterministic Matching Engine
  ├── Layer 1: Exact ID Normalization & Matching (externalId -> exact_id, score ~1.0)
  ├── Layer 2: Deterministic Text Similarity (Tokenization, Jaccard, Containment, Phrase -> text_similarity)
  ├── Layer 3: Location & WBS Metadata Alignment (Location boost +0.18 / contradiction penalty -0.25 -> wbs_location)
  ├── Layer 4: Semantic Matcher Interface & Seam (SemanticActivityMatcher decoupled abstraction)
  └── Layer 5: Optional LLM-Assisted Disambiguator Seam (LLMActivityDisambiguator for close candidate subsets)
      ↓
Candidate Ranking & Classification
  ├── Best Candidate (confidence >= minConfidenceThreshold 0.40)
  ├── Alternative Candidates (top runners-up within ranking margin)
  └── Low Confidence (null bestMatch when score < 0.40, no phantom activities invented)
      ↓
ActivityMatchRepository (Persistence of suggested matches with status='suggested')
      ↓
SQLite (activity_matches table with status='suggested')
      ↓
Transparent API Response ({ matches: [{ fact, bestMatch, alternatives }] })
```

> [!IMPORTANT]
> **Pass 9 Scope Boundary & Invariant**:
> Pass 9 resolves identity candidates and persists suggestions with `status = 'suggested'`.
> It **never** marks matches as `'confirmed'` automatically, and **never** mutates `activity_progress` or calculates actual progress, variance, delay, or risk (which belong strictly to **Pass 10+**).

---

### 5. Progress Normalization Pipeline (Pass 10)

```text
Pass 8 Structured Fact ({ reference, location, progress_percent, status })
        +
Pass 9 Matched Activity Identity (Activity: plannedQuantity, unit, plannedStart, plannedFinish)
        +
Caller Context (optional actualQuantity, quantityUnit, asOfDate, matchId)
        ↓
POST /api/projects/:projectId/progress-updates/:updateId/progress
        ↓
ProgressService (Verification: project, update, matchId, matchStatus, matched activity)
        ↓
Pure Progress Normalization (progress-normalization.ts)
  ├── 1. Unit Compatibility Verification (conservative normalizeUnit comparison)
  ├── 2. Quantity-Derived Arithmetic (actualQuantity / plannedQuantity * 100, round 2 decimals)
  ├── 3. Percentage Precedence (Quantity math > Reported % > Completed status fallback > Unavailable)
  ├── 4. Capping Rule (min(100, calculatedPercent) + note provenance preserving actual quantity)
  ├── 5. Deterministic Status Mapping (not_started, started, in_progress, completed, delayed)
  └── 6. Start/Finish Date Derivation (actualStart on started/in_progress, actualFinish on completed)
        ↓
Historical Reconciliation & Idempotency Check
  ├── Earliest actualStart preserved across chronological observations
  └── Existing identical observation returned if re-submitted
        ↓
SqliteActivityProgressRepository (Atomic Transaction)
  ├── 1. INSERT INTO activity_progress
  └── 2. INSERT INTO project_events (event_type = 'progress_updated')
        ↓
Canonical ActivityProgress Observation (Persisted to SQLite)
```

> [!IMPORTANT]
> **Pass 10 Core Architectural Invariants**:
> 1. **Quantity-Derived Percentage in Code**: Quantity arithmetic (`actualQuantity / plannedQuantity * 100`) is calculated deterministically in TypeScript. LLM output is never trusted for mathematical progress calculations.
> 2. **Authoritative Quantity Precedence**: Valid quantity arithmetic strictly overrides contradictory reported percentages.
> 3. **No Arbitrary Percentages**: If no deterministic percentage can be derived (e.g., text like "excavation continued" with no quantity and no percentage), persistence is rejected with a clear validation error. Zero/arbitrary progress is never fabricated.
> 4. **Observational Chronology**: `activity_progress` rows are append-only observations ordered chronologically by `as_of_date` rather than processing timestamp. Earlier historical start dates are never overwritten by later reports.
> 5. **Match Status Policy**: By default, only `confirmed` matches are normalized into `activity_progress`. `rejected` matches are always blocked. `suggested` matches require an explicit `allowSuggested: true` parameter.
> 6. **Zero Pass 11+ Leakage**: Pass 10 establishes canonical actual observations only. Planned-vs-actual variance calculations, delay detection, and forecasting belong strictly to subsequent passes.

---

### 6. Planned vs Actual Engine Pipeline (Pass 11)

```text
Baseline Activity Schedule (plannedStart, plannedFinish, plannedQuantity, unit)
        +
Historical ActivityProgress (actualPercent, actualQuantity, actualStart, actualFinish, status)
        ↓
GET /api/projects/:projectId/progress-snapshot?asOfDate=YYYY-MM-DD
        ↓
ProgressSnapshotService (Verify project, resolve canonical asOfDate, project-scoped data fetch)
        ↓
Pure Progress Snapshot Calculator (progress-snapshot.calculator.ts)
  ├── 1. As-Of Actual Selection (Latest observation WHERE as_of_date <= snapshotDate; derived 0% / not_started if none)
  ├── 2. Planned Progress Calculation (Linear elapsed-duration model: elapsed / duration * 100, clamped [0, 100])
  │      - Before start: 0%
  │      - On/after finish: 100%
  │      - Zero-duration milestones: 0% before date, 100% on/after date
  ├── 3. Progress Variance Calculation (progressVariance = actualProgress - plannedProgress, rounded to 2 decimals)
  ├── 4. Variance State Categorization (ahead if > 0.01, behind if < -0.01, on_plan otherwise)
  ├── 5. Overdue Flag Evaluation (overdue = snapshotDate > plannedFinish AND actualProgress < 100)
  ├── 6. Activity Snapshot Compilation ({ activityId, externalId, planned/actual progress, variance, status, overdue })
  └── 7. Project-Level Summary Aggregation (totalActivities, notStarted, started, inProgress, completed, delayed, overdue, ahead, onPlan, behind)
        ↓
Read-Only Project Progress Snapshot ({ projectId, asOfDate, generatedAt, activities, summary })
```

> [!IMPORTANT]
> **Pass 11 Core Architectural Invariants**:
> 1. **Read-Only / Analytical Layer**: Pass 11 computes a view of existing project truth. It does not persist snapshots, does not create new tables or migrations, and never mutates `activity_progress`.
> 2. **Snapshot Date is Fundamental**: All planned and actual calculations for a request reference a single canonical snapshot date (`asOfDate`).
> 3. **As-Of Actual Selection**: Only historical observations where `as_of_date <= snapshotDate` are selected. Future-dated observations relative to the snapshot are strictly ignored.
> 4. **No Fabricated Observations**: Activities without historical observations default to a derived `not_started` / `0%` state in the snapshot response without inserting synthetic rows into SQLite.
> 5. **Deterministic Linear Planned Progress**: Uses calendar-day elapsed duration arithmetic on `YYYY-MM-DD` strings without timezone discrepancies.
> 6. **Explicit Overdue Invariant**: An activity is overdue if and only if `snapshotDate > plannedFinish AND actualProgress < 100`. Being behind schedule before the planned finish date does not classify an activity as overdue.
> 7. **Strict Project Isolation**: Every activity and progress observation included in the snapshot is strictly project-scoped.
> 8. **Zero AI / No Pass 12+ Leakage**: Pass 11 relies strictly on deterministic mathematics and does not implement predictive forecasting, risk scoring, or delay root-cause analysis.

---

### 7. Delay and Risk Engine Pipeline (Pass 12)

```text
Pass 11 ProjectProgressSnapshot (plannedProgress, actualProgress, progressVariance, varianceState, status, overdue)
        ↓
GET /api/projects/:projectId/risk-status?asOfDate=YYYY-MM-DD
        ↓
RiskClassificationService (Fetch validated Pass 11 snapshot)
        ↓
Pure Risk & Delay Calculator (risk-classification.calculator.ts)
  ├── 1. Rule Precedence Evaluation (COMPLETED > DELAYED > AT_RISK > AHEAD > ON_TRACK)
  ├── 2. COMPLETED Classification (status === 'completed' OR actualProgress >= 100)
  ├── 3. DELAYED Classification (snapshotDate > plannedFinish AND actualProgress < 100 / overdue = true)
  ├── 4. AT_RISK Classification
  │      - Signal A: Strong negative variance (progressVariance <= -10.0)
  │      - Signal B+C: Approaching finish (0 <= daysUntilPlannedFinish <= 3) AND behind plan (varianceState === 'behind')
  │      - Signal D: Delayed execution status (status === 'delayed' before finish date)
  ├── 5. AHEAD Classification (progressVariance > 0.01 / varianceState === 'ahead')
  ├── 6. ON_TRACK Classification (Default exhaustive within-plan state)
  ├── 7. Machine-Readable Rationale Generation (completed, overdue, strong_negative_variance, near_finish_and_behind, delayed_status, positive_variance, within_plan)
  └── 8. Project-Level Risk Summary Aggregation (totalActivities, completed, delayed, atRisk, ahead, onTrack, overdueCount)
        ↓
Read-Only Project Risk Status ({ projectId, asOfDate, generatedAt, activities, summary })
```

> [!IMPORTANT]
> **Pass 12 Core Architectural Invariants**:
> 1. **Read-Only / Pure Analytical Layer**: Pass 12 consumes Pass 11 snapshots directly. It performs no database mutations, creates no migrations/tables (`risk_records`, `delay_records`, `risk_snapshots`, `alerts`, `notifications` are strictly NOT persisted).
> 2. **Explicit Deterministic Precedence Hierarchy**:
>    - `COMPLETED` (#1): `status === 'completed' || actualProgress >= 100`. Completed status strictly overrides overdue, positive variance, or behind states.
>    - `DELAYED` (#2): `snapshotDate > plannedFinish && actualProgress < 100` (`overdue === true`). Overdue strictly overrides `AT_RISK` and `AHEAD`.
>    - `AT_RISK` (#3): `strongNegativeVariance (<= -10.0)` OR `nearFinish (0 <= days <= 3) && behindPlan` OR `status === 'delayed'`.
>    - `AHEAD` (#4): `progressVariance > 0.01`.
>    - `ON_TRACK` (#5): Default when no higher-precedence state applies. Never returns undefined.
> 3. **Semantic Distinction between Behind and Delayed**: An activity with negative variance is NOT automatically delayed. Delay is strictly defined by the objective overdue condition (past planned finish while incomplete). An activity behind plan within its schedule window is evaluated as `AT_RISK` or `ON_TRACK`.
> 4. **Milestone Proximity & Finish Windows**: Zero-duration milestones (`plannedStart === plannedFinish`) inherit Pass 11 baseline progress (0% before milestone, 100% on/after). Near-finish proximity (3 calendar days) requires `behind` variance to trigger risk; proximity alone never causes risk.
> 5. **Explainable Machine-Readable Reasons**: Every activity classification includes deterministic machine-readable reasons (`RiskReason[]`) explaining the exact mathematical and operational rationale.
> 6. **Dependency Boundary**: The repository currently has no dependency model. Pass 12 defines an optional, unused interface seam (`DependencyRiskSignal`) without persisting tables or faking mock dependency graphs.
> 7. **Zero AI / No Pass 13+ Leakage**: Pass 12 contains no LLM calls, no risk severity tiers (`LOW`/`HIGH`), no root-cause analysis, no forecasting, and no mitigation suggestions.


## Persistence Architecture

```text
Service Layer (Domain Orchestration)
    ↓
Repository Interfaces (ProjectRepository, SystemRepository, ActivityMatchRepository)
    ↓
SQLite Repositories (SqliteProjectRepository, SqliteSystemRepository, SqliteActivityMatchRepository)
    ↓
Database Module (initDatabase, runInTransaction, pragmas)
    ↓
SQLite Driver (better-sqlite3)
    ↓
database/fieldline.db (Local File or :memory:)
```

### 1. Migration System & Tracking
- Migrations are tracked deterministically in SQLite via the `schema_migrations` table:
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```
- Each migration executes within an isolated, atomic transaction.
- Pending migrations are detected and applied sequentially at initialization.
- Repeated executions (`npm run setup`) are idempotent and safe.
- `npm run demo:reset` utilizes the authoritative migration runner after removing SQLite files to recreate pristine state.

### 2. Core Domain Schema (8 Foundational Entities)

```text
projects (1) ──────────< (N) schedules ──────────< (N) activities
   │                                                     │
   │                                                     │
   ├──────────< (N) progress_updates ───────────┐         │
   │                    │                       │         │
   │                    ├────< (N) evidence     │         │
   │                    │                       │         │
   │                    └────< (N) activity_matches ──────┤
   │                                                      │
   ├─────────────────────────< (N) activity_progress ─────┘
   │
   └──────────< (N) project_events
```

1. **`projects`**: Top-level infrastructure project identity, lifecycle status, code (unique), and planned date boundaries.
2. **`schedules`**: Imported baseline or revised master schedules (CSV/XLSX/P6 source metadata).
3. **`activities`**: Planned schedule tasks with WBS code, location, date range, quantities, units, and baseline progress. Unique on `(schedule_id, external_id)`.
4. **`progress_updates`**: Field reports from supervisors (manual text, voice transcripts, inspection logs).
5. **`evidence`**: Ingested raw media/document records (PDF, XLSX, images, transcripts) supporting field reports.
6. **`activity_matches`**: Links candidate schedule activities with extracted update/evidence mentions with confidence scores and matching rationale.
7. **`activity_progress`**: Canonical derived execution status and progress tracking per activity as-of-date.
8. **`project_events`**: Audit log of milestone transitions, variance detections, and domain lifecycle events.

### 3. Database Pragmas and Foreign Keys
- **Foreign Keys**: `PRAGMA foreign_keys = ON` is enforced unconditionally on all database connections. Foreign key violations throw immediate SQLite constraint errors.
- **WAL Mode**: `PRAGMA journal_mode = WAL` is enabled for file-backed storage to allow concurrent reader processes alongside writers.
- **Cascading Invariants**: Deleting a project cascades to schedules, activities, progress updates, and events. Deleting a progress update safely sets child evidence references to `NULL`.

---

### 5. Manual Progress Reporting Pipeline (Pass 7)

```text
Manual Progress UI (Field Report Form & Chronological Timeline)
    ↓
Progress Update API (POST /api/projects/:projectId/progress-updates, GET /api/projects/:projectId/progress-updates)
    ↓
Validation (createProgressUpdateSchema, progressUpdateParamsSchema)
    ↓
ProgressUpdateService (verify project, enforce sourceType='manual' & status='received', preserve rawText)
    ↓
ProgressUpdateRepository (atomic transaction: progress_updates record + progress_reported project_event)
    ↓
SQLite (database/fieldline.db: progress_updates table)
```

> [!NOTE]
> **Pass 7 Scope Boundary**: Manual reports are stored as raw text in Pass 7. No AI extraction, activity matching, actual percent calculations, or activity progress mutations occur yet. Raw text integrity is strictly preserved for subsequent AI processing passes.

---

## Component Boundaries & Directory Layout

```text
backend/
  src/
    config/           # Validated environment configuration (env.ts) and structured logger (logger.ts)
    routes/           # Thin Express route handlers (health, project, schedule, progress-update, ai, activity-matching, progress)
    validation/       # Runtime Zod schemas for request/response contracts
    middleware/       # Centralized error handling, request logging, and Zod validation middleware
    services/         # Pure application domain logic (health, project, schedule-import, progress-update)
      progress/       # Progress normalization domain (progress-normalization, progress.service, types)
      matching/       # Activity matching engine (activity-matching.service, activity-match-scoring, text-similarity, semantic-matcher, llm-disambiguator)
      normalization/  # Date, number, unit, text, and schedule activity normalizers
      validation/     # Multi-rule schedule validator engine
    repositories/     # Direct SQLite persistence (Project, System, Schedule, Activity, ProgressUpdate, ActivityMatch, ActivityProgress)
    models/           # Strongly typed domain entity definitions and DTO contracts
    database/         # SQLite connection lifecycle, WAL pragmas, migrator, and migrations/
      migrations/     # Ordered migrations (0001, 0002, 0003, 0004)
      migrator.ts     # Schema migration runner with schema_migrations tracking
      db.ts           # initDatabase, getDatabase, runInTransaction, closeDatabase
      schema.ts       # Core tables list and schema constants
    errors/           # Application error hierarchy (AppError, NotFoundError, ConflictError, DatabaseError, NormalizationError, ScheduleValidationError)
    ai/               # Decoupled AI provider interfaces, mock adapters, contracts (FieldProgressExtraction), and services
    jobs/             # Local background/batch task workers
  tests/              # Vitest test suite enforcing contracts, persistence, and isolation (44 suites, 355 tests)
frontend/
  src/
    App.tsx           # FieldLine Project Management, Schedule Viewer & Manual Progress UI
    index.css         # Visual design system tokens, cards, modals, timeline feeds, and responsive layout
    main.tsx          # React application root
```

---

## Scope Realized Across Passes

1. **Pass 0 — Repository Bootstrap**: Node.js/TypeScript configuration, Express, Vite React shell, SQLite pragma setup, scripts.
2. **Pass 1 — Application Architecture**: Architectural boundary enforcement, thin routes, Zod validation middleware, decoupled services, AI abstraction layer, centralized `AppError` handling.
3. **Pass 2 — SQLite & Persistence Foundation**:
   - Migration engine (`schema_migrations` tracking, append-only chain `0001` → `0004`).
   - 8 Core Domain Entities with composite foreign keys, cascading deletes, and consistency triggers.
   - Transaction boundary (`runInTransaction`) with rollback.
   - `ProjectRepository` and `SystemRepository` persistence layer.
4. **Pass 3 — Project Management**:
   - Complete Project Management REST API (`GET /api/projects`, `POST /api/projects`, `GET /api/projects/:projectId`, `PATCH /api/projects/:projectId`, `DELETE /api/projects/:projectId`).
   - `ProjectService` application domain layer with clean input normalization and boundary enforcement.
   - Runtime Zod input and output validation (`createProjectSchema`, `updateProjectSchema`, `projectIdParamSchema`).
   - Project lifecycle UI: Empty state, project list/card selector with search filter, active project workspace, metadata overview, and sub-navigation.
   - Active project context persistence in `localStorage` across page reloads.
5. **Pass 4 — Schedule Importer**:
   - Multi-format schedule import pipeline supporting `.csv` and `.xlsx` files.
   - Format-agnostic parser architecture (`ScheduleParser`, `CsvScheduleParser`, `XlsxScheduleParser`).
   - Header aliasing engine recognizing standard industry variants.
   - Atomic persistence via `ScheduleRepository.createWithActivities`.
6. **Pass 5 — Schedule Normalization**:
   - Canonical normalization for dates, numbers, units, text, and schedule rows.
   - Comprehensive cross-format equivalence testing.
7. **Pass 6 — Schedule Validation**:
   - Structural and domain validation engine detecting scheduling errors (inverted dates, negative durations, invalid quantities).
   - Validation issue payloads and user-friendly error banners.
8. **Pass 7 — Manual Progress Reporting**:
   - Dedicated `SqliteProgressUpdateRepository` with atomic `progress_reported` project event logging.
   - `ProgressUpdateService` with strict project scoping, project existence validation, and cross-project isolation.
   - Zod validation (`createProgressUpdateSchema`, `reportDateSchema`, `progressUpdateParamsSchema`).
   - Project-scoped REST API (`POST /api/projects/:projectId/progress-updates`, `GET /api/projects/:projectId/progress-updates`, `GET /api/projects/:projectId/progress-updates/:updateId`).
   - Verbatim preservation of user `rawText` without aggressive rewriting or mutation of activity progress.
   - Presentation-grade frontend Progress Updates workspace tab: Manual field report input form, validation error/success indicators, and chronological update timeline ordered newest-first.
9. **Pass 8 — AI Extraction Layer**:
   - Dedicated `FieldProgressExtractionService` that validates inputs and transforms raw field-report text into structured field facts.
   - Strict Zod contract (`fieldProgressExtractionSchema`, `fieldProgressItemSchema`, `fieldProgressStatusEnum`) with bounded outputs (max 20 items, max 200 character strings, strict status enum).
   - Conservative interpretation: numeric `progress_percent` extracted only when explicitly stated; `location` and `progress_percent` strictly `null` when absent; no fabricated activity IDs.
   - Dedicated REST endpoint `POST /api/ai/field-progress/extract` with input and output Zod validation.
   - Deterministic test fixtures for Cases A–D (explicit percentage, no percentage, ambiguous progress, completed work).
   - Pure interpretation pipeline: zero database mutations, no activity matching (reserved for Pass 9), no project truth calculation.
10. **Pass 9 — Activity Matching Engine**:
    - Multi-layer deterministic scoring pipeline (`exact_id`, `text_similarity`, `wbs_location`, `llm_assisted`) resolving extracted field facts to candidate activities.
    - Preserves candidate ranking with `bestMatch` and runner-up `alternatives`.
    - Dedicated `SqliteActivityMatchRepository` enforcing strict project scoping and composite foreign keys.
    - Idempotent re-matching and persistence of match candidates strictly with `status = 'suggested'`.
    - Strict boundary preservation: zero mutations to `activity_progress` or actual progress calculations (reserved for Pass 10).
    - REST endpoints `POST /api/projects/:projectId/progress-updates/:updateId/matches` and `GET /api/projects/:projectId/progress-updates/:updateId/matches`.
11. **Pass 10 — Progress Normalization**:
    - Pure deterministic progress normalization engine (`normalizeProgress`) computing canonical execution status, quantity math, and derived percentages.
    - Quantity arithmetic executed exclusively in application code (`actualQuantity / plannedQuantity * 100`) with 2-decimal rounding.
    - Strict percentage precedence: Quantity-derived > Reported percentage > Completed fallback (100%) > Unavailable (`null`).
    - Conservative unit compatibility enforcement via `normalizeUnit` (`m3` === `m³`, `m3` !== `tonnes`).
    - Quantity overrun capping rule at 100% while preserving physical actual quantity and provenance notes.
    - Observational chronology: append-only `activity_progress` history ordered by `as_of_date`, preserving earliest historical `actualStart` dates.
    - Match-status safety policy: only `confirmed` matches normalized by default; `rejected` blocked; `suggested` requires explicit `allowSuggested: true`.
    - Dedicated `SqliteActivityProgressRepository` with atomic `activity_progress` + `progress_updated` event insertion.
    - REST endpoints `POST /api/projects/:projectId/progress-updates/:updateId/progress`, `GET /api/projects/:projectId/activities/:activityId/progress`, `GET /api/projects/:projectId/activities/:activityId/progress/latest`.
12. **Pass 11 — Planned vs Actual Engine**:
    - Pure, deterministic Planned vs Actual progress snapshot calculator (`progress-snapshot.calculator.ts`) computing planned progress, progress variance, execution status, and overdue flags.
    - Canonical `asOfDate` resolution: default to current local date if omitted; calendar-day arithmetic avoiding timezone and daylight-savings drift.
    - Chronological as-of historical observation selection via `getLatestByActivityIdAsOfDate`, strictly ignoring observations dated after the snapshot date.
    - Derived `not_started` (0% actual) default for activities without observations, with zero database fabrication.
    - Variance computation (`actualProgress - plannedProgress`) with neutral state classification (`ahead`, `on_plan`, `behind`).
    - Explicit date-based overdue classification (`snapshotDate > plannedFinish && actualProgress < 100`).
    - Aggregated project summary counts across all activities.
    - Read-only REST endpoint `GET /api/projects/:projectId/progress-snapshot` with Zod validation (`progressSnapshotParamsSchema`, `progressSnapshotQuerySchema`, `projectProgressSnapshotSchema`).
    - Strict project isolation and zero persistence/mutations.
13. **Pass 12 — Delay and Risk Engine**:
    - Pure, deterministic Delay and Risk analytical classification engine (`risk-classification.calculator.ts`) transforming Pass 11 progress snapshots into standard schedule risk classifications.
    - Unambiguous classification taxonomy: `ON_TRACK`, `AHEAD`, `AT_RISK`, `DELAYED`, `COMPLETED`.
    - Explicit precedence hierarchy: `COMPLETED` (#1) > `DELAYED` (#2) > `AT_RISK` (#3) > `AHEAD` (#4) > `ON_TRACK` (#5).
    - Objective delay invariant: `DELAYED` requires past planned finish while incomplete (`asOfDate > plannedFinish && actualProgress < 100`).
    - Multi-signal risk detection: strong negative variance (`progressVariance <= -10.0%`), finish-window proximity (`daysUntilPlannedFinish <= 3`) combined with behind-plan state, or `delayed` execution status.
    - Pure proximity safety: finish proximity alone on/ahead of plan never triggers risk.
    - Milestone semantics: zero-duration activities (`plannedStart === plannedFinish`) inherit Pass 11 baseline progress without synthetic schema models.
    - Transparent machine-readable explainability: `reasons` array with standard reason codes (`completed`, `overdue`, `strong_negative_variance`, `near_finish_and_behind`, `delayed_status`, `positive_variance`, `within_plan`).
    - Project-level risk summary: simple counts (`totalActivities`, `completed`, `delayed`, `atRisk`, `ahead`, `onTrack`, `overdueCount`) without synthetic weighted risk scores.
    - Clean dependency boundary: defines optional `DependencyRiskSignal[]` input seam without persisting unused dependency models.
    - Read-only REST endpoint `GET /api/projects/:projectId/risk-status` with Zod schema validation.
    - Zero AI / zero database persistence.




