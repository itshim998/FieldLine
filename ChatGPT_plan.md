# FieldLine — Master Implementation Program: Two-Account Architecture (Passes 27–36)

> **Document Type:** Master Implementation Program & Engineering Execution Roadmap  
> **Status:** Active Implementation Plan  
> **North-Star Reference:** `long_term_plan.md` (Authoritative Product & Architectural Vision)  
> **Progression Sequence:** Passes 27 through 36 (Continuing directly from existing Passes 0–26)

---

## Executive Overview & Program Strategy

### Core Objective
Extend and partition FieldLine's mature, deterministic planning-to-execution pipeline (Schedule → Field Input → Extraction → Matching → Canonical Progress → Snapshot / Variance / Risk → Intelligence → Assistant) into the two-interface model defined in `long_term_plan.md`:

1. **Worker Account (Execution Interface):** Low-friction operational clarity for field personnel—focusing on active tasks, physical location, work-relevant safety, blocker reporting, and rapid multi-modal progress capture (voice, quick input, photos) with immediate verification feedback.
2. **Admin / Project Lead Account (Control Interface):** Comprehensive command center for project leads—focusing on master schedule governance, human-in-the-loop review of uncertain AI matches, deterministic variance analytics, delay/risk early warnings, and an auditable evidentiary trail.

### Architectural Strategy: Extension, Not Replacement
The FieldLine codebase already embodies the philosophy *"Production-quality application logic, presentation-grade local infrastructure."* The system possesses a robust 13-stage processing pipeline, 93 test files, a 53-invariant verification suite, and an active Gemini Live WebSocket gateway. 

This program **extends and partitions** the existing architecture rather than rebuilding it:
* It establishes a server-enforced authentication and authorization boundary around existing domain services.
* It splits frontend presentation into an **Execution Cockpit** (Worker) and a **Project Control Room** (Admin).
* It preserves the single canonical project truth across all operations.
* It integrates field blockers directly into the deterministic risk engine.
* It partitions existing live tools into role-scoped sessions.

---

## The Mandatory Three-Stage Pass Lifecycle

Every pass in this program follows the strict development protocol:

```text
┌─────────────────┐
│     1. PLAN     │  Inspect codebase, identify affected files, define invariants & risks,
│                 │  and write explicit acceptance criteria before editing.
└────────┬────────┘
         ▼
┌─────────────────┐
│   2. IMPLEMENT  │  Write the smallest coherent set of decoupled changes. Preserve existing
│                 │  deterministic engines and canonical truth boundaries.
└────────┬────────┘
         ▼
┌─────────────────┐
│   3. EVALUATE   │  Execute targeted tests, run full regression suite, perform manual UX verification,
│                 │  and verify alignment against long_term_plan.md.
└─────────────────┘
```

A pass is **not complete merely because its code compiles or passes a basic test**. It is complete only when:
1. All new automated tests pass.
2. The entire existing test suite (93+ test files) passes with zero regressions.
3. Release verification (`npm run verify:release`) executes successfully.
4. The pass exit criteria are documented and satisfied.

---

## Master Roadmap Overview: Passes 27 through 36

| Pass | Phase | Primary Objective | Architectural Focus |
| :--- | :--- | :--- | :--- |
| ~~**Pass 27**~~ | ~~Foundation~~ | ~~Baseline Contract Freeze & Test Snapshot~~ | ~~Establish known-good regression & security baseline~~ (COMPLETED) |
| ~~**Pass 28**~~ | ~~Identity~~ | ~~Project Account Credentials & Session Identity~~ | ~~Two shared accounts per project + human attribution~~ (COMPLETED) |
| **Pass 29** | Security | Server-Side Authorization & Project Scoping | Route guards, role policies, data projection & privacy |
| **Pass 30** | Shell | Dual-Shell Architecture & Admin Control Alignment | Split frontend into Worker Cockpit & Admin Control Room |
| ~~**Pass 31**~~ | ~~Execution~~ | ~~Worker Operational Projection ("Today's Work")~~ | ~~Bounded operational horizon, active tasks, location context~~ (COMPLETED) |
| **Pass 32** | Capture | Frictionless Field Capture (Voice, Text, Photos) | Live voice dialogue, rapid quantity input, photo evidence |
| **Pass 33** | Context | Structured Operational Blockers & Safety Context | Blocker logging linked to Risk Engine + hazard notices |
| **Pass 34** | Intelligence | Role-Partitioned AI Assistant & Live Gateway | Partition Gemini Live tools into Worker vs Admin scopes |
| **Pass 35** | Hardening | Adversarial Security, Penetration & Audit Review | Role bypass tests, cross-project tampering, provenance |
| **Pass 36** | Certification| E2E Truth Certification & North-Star Conformance | 13-stage pipeline proof & North-Star Conformance Matrix |

---

# Detailed Pass Specifications

---

## ~~Pass 27 — Baseline Contract Freeze & Test Snapshot~~ (COMPLETED)

### Context & Need
Before altering authentication, routing, or data flows, the system must establish an immutable baseline against the existing Pass 26 release state. This prevents accidental regressions during subsequent architectural partitioning.

### 1. Plan
* Audit the current 93 test files, noting execution duration and coverage across domain services.
* Document current entry points: `GET /api/projects`, `GET /api/projects/:projectId/dashboard`, `POST /api/projects/:projectId/progress-updates`, `/ws/live-session`.
* Identify all places where client-side storage (`localStorage`) currently stores project context (`fieldline_selected_project_id`).
* Run the complete release verification suite (`npm run verify:release`) and snapshot baseline metrics (test count, invariant check count).

### 2. Implement
* Create a dedicated baseline verification script (`scripts/verify-baseline.ts`) that asserts:
  * Full build compiles (`tsc -p tsconfig.backend.json` and `vite build`).
  * Golden demo project (`REFINERY-U4`) seeds and passes all 53 invariants.
  * Live Groq/Mock AI router diagnostics pass cleanly.
* Document the canonical baseline contracts in `docs/PASS27_BASELINE.md`.
* Add automated regression checkpoints for existing routes prior to introducing authentication middleware.

### 3. Evaluate
* Run `npm run verify:release`.
* Verify that all 355+ automated tests pass cleanly with zero warnings or unhandled rejections.
* Ensure local SQLite database initializes idempotently via `npm run setup`.

### 4. Exit Criteria
* [x] A machine-checkable baseline test suite runs with 100% pass rate.
* [x] Current unauthenticated routes and response DTO contracts are frozen and documented.
* [x] Any pre-existing architectural debt or deprecation warnings are cataloged.

---

## ~~Pass 28 — Project Account Credentials & Session Identity~~ (COMPLETED)

### Context & Need
FieldLine currently relies on client-side project selection without account credentials. Per `long_term_plan.md`, the platform requires an intentional two-account model: **one shared Worker Account + one shared Admin Account per project**, while preserving individual human attribution on operational records.

### 1. Plan
* Design the database schema migration for project-level account credentials:
  * Each project possesses exactly two account records: `worker` and `admin`.
  * Store credentials safely (e.g., project-scoped passcodes/tokens with standard cryptographic hashing).
* Formalize the distinction between:
  * **Account Identity:** The authenticated session representing project and role (`projectId`, `role: 'worker' | 'admin'`).
  * **Human Attribution:** The individual reporting or reviewing (`reporter_name`, `reporter_role`, `reviewed_by`), maintained on operational records.
* Ensure migration is backwards-compatible with the SIH Golden Demo seeding script (`seedGoldenDemo.ts`).

### 2. Implement
* **Database Migration (`0008_project_accounts.ts`):**
  * Create `project_accounts` table: `id`, `project_id`, `account_type` (`'worker' | 'admin'`), `credential_hash`, `display_name`, `created_at`, `updated_at`.
  * Unique constraint on `(project_id, account_type)`.
* **Domain Service & Repository:**
  * Create `ProjectAccountRepository` and `AuthService`.
  * Implement authentication methods: `authenticateProjectAccount(projectId, accountType, passcode)`.
  * Issue a signed, lightweight local session token containing `{ projectId, accountType, sessionId }`.
* **Seed Golden Demo:**
  * Update `seedGoldenDemo.ts` to provision default credentials for `REFINERY-U4`:
    * Worker Account: Code `REFINERY-U4`, Role `worker`, default PIN/passcode.
    * Admin Account: Code `REFINERY-U4`, Role `admin`, default password.

### 3. Evaluate
* Write automated tests in `backend/tests/project_account_auth.test.ts`:
  * Authenticate with valid Worker credentials $\rightarrow$ success with worker session token.
  * Authenticate with valid Admin credentials $\rightarrow$ success with admin session token.
  * Reject invalid passcodes with clean `AuthenticationError`.
  * Reject mismatched project IDs.
  * Verify token validation and expiration handling.
* Ensure existing unauthenticated workflows fail gracefully or redirect to login.

### 4. Exit Criteria
* [x] Database migration applies cleanly and idempotently.
* [x] Golden demo seeds both accounts for `REFINERY-U4`.
* [x] Automated test suite proves authentication boundaries for both Worker and Admin accounts.

---

## ~~Pass 29 — Server-Side Authorization, Route Guards & Privacy Sanitization~~ (COMPLETED)

### Context & Need
Authentication without server-side enforcement is ineffective. Per `long_term_plan.md` Section 9, role restrictions and project isolation must be enforced on the server at API and domain boundaries.

### 1. Plan
* Categorize every backend route in `backend/src/routes/` into an authoritative permission matrix:
  * **Admin Only:** Schedule import/validation, baseline setting, match review confirmation/rejection/resolution, document ingestion jobs, project metadata mutation, project deletion.
  * **Worker & Admin (Operational):** Progress update creation (manual/voice), evidence upload/view, task queries, blocker creation, operational assistant queries.
* Design `requireProjectRole('worker' | 'admin')` Express middleware.
* Design data projection filters to sanitize internal algorithm scores and raw server filesystem paths from worker responses.

### 2. Implement
* **Middleware (`backend/src/middleware/auth.middleware.ts`):**
  * `authenticateSession`: Extracts and verifies session token from headers.
  * `requireProjectScope`: Verifies `req.params.projectId === session.projectId`.
  * `requireRole(allowedRoles)`: Enforces role permissions; returns `HTTP 403 Forbidden` on violation.
* **Route Protection:**
  * Mount `requireRole(['admin'])` on:
    * `POST /api/projects/:projectId/schedules`
    * `POST /api/projects/:projectId/activity-matches/:matchId/confirm`
    * `POST /api/projects/:projectId/activity-matches/:matchId/reject`
    * `POST /api/projects/:projectId/activity-matches/:matchId/resolve`
    * `POST /api/projects/:projectId/evidence/:evidenceId/process`
    * `PATCH /api/projects/:projectId`
    * `DELETE /api/projects/:projectId`
  * Mount `requireRole(['worker', 'admin'])` on:
    * `POST /api/projects/:projectId/progress-updates`
    * `POST /api/projects/:projectId/evidence`
    * `GET /api/projects/:projectId/evidence/:evidenceId/content`
* **Data Projection & Sanitization:**
  * Ensure raw filesystem paths (`filePath`) are stripped from all API outputs.
  * Ensure worker queries receive operational DTOs omitting internal AI confidence tiers.

### 3. Evaluate
* Write adversarial integration tests in `backend/tests/authorization_guards.test.ts`:
  * Worker token attempting `POST .../schedules` $\rightarrow$ `HTTP 403 Forbidden`.
  * Worker token attempting `POST .../activity-matches/:id/confirm` $\rightarrow$ `HTTP 403 Forbidden`.
  * Project A token attempting to read Project B evidence $\rightarrow$ `HTTP 404 Not Found` or `403`.
  * Admin token successfully executing all management endpoints.
  * Unauthenticated requests to protected endpoints $\rightarrow$ `HTTP 401 Unauthorized`.

### 4. Exit Criteria
* [x] Every API endpoint enforces project scoping and role authorization on the server.
* [x] Adversarial test suite verifies that UI bypass attempts are blocked.
* [x] Filesystem privacy invariant is maintained across all serialized JSON responses.

---

## ~~Pass 30 — Dual-Shell Architecture & Admin Control Room Alignment~~ (COMPLETED)

### Context & Need
The frontend currently operates as a single shared workspace with tabs (`overview`, `schedules`, `progress`, `evidence`, `intelligence`, `activity-detail`). Per `long_term_plan.md`, the client must provide two distinct shells: the **Worker Execution Cockpit** and the **Admin Control Room**.

### 1. Plan
* Design client-side session management (`AuthContext` or state hook) that persists active session tokens in `localStorage`.
* Design the routing split in `frontend/src/router.ts`:
  * Unauthenticated $\rightarrow$ Project Selector & Account Login screen.
  * Authenticated as `admin` $\rightarrow$ Existing Project Control Room workspace.
  * Authenticated as `worker` $\rightarrow$ New Worker Execution Cockpit shell.
* Ensure existing Admin workspace tabs continue to function without regression.

### 2. Implement
* **Login & Account Selection UI:**
  * Create `ProjectLoginView.tsx`: Select project, choose "Worker" or "Admin", enter credentials, with 1-click Golden Demo chips for `REFINERY-U4`.
* **Router Refactoring (`frontend/src/router.ts`):**
  * Introduce `authRole` and `workerTab` to `RouteState`.
  * Protect Admin routes: if a worker session visits an admin URL, redirect gracefully to the worker cockpit (`protectRouteForRole`).
* **Admin Control Room Alignment:**
  * Retain existing tabs (`overview`, `schedules`, `progress`, `evidence`, `intelligence`, `activity-detail`) within `AdminWorkspaceView.tsx`.
  * Add clear session badge showing `Project: REFINERY-U4 | Role: Admin (Control Room)` with operator attribution.
  * Add logout / switch account action.
* **Worker Shell Foundation:**
  * Scaffold `WorkerCockpitView.tsx` with high-contrast, mobile-friendly navigation (`Today's Work`, `Quick Report` with human attribution, `Field Assistant`).

### 3. Evaluate
* Tested via Vitest frontend tests (`frontend/tests/dual_shell_routing.test.tsx` and `frontend/tests/router.test.ts`):
  * Log in as Admin $\rightarrow$ lands in Primary Dashboard with full navigation tabs.
  * Log in as Worker $\rightarrow$ lands in Worker Cockpit shell with execution navigation.
  * Browser refresh preserves authenticated role and project context via `GET /api/auth/session`.
  * Logging out clears tokens and returns cleanly to project login.
  * Verified all existing Admin workflows operate with zero regression (105 test files, 1,004 tests passing, release verification 100% clean).

### 4. Exit Criteria
* [x] Frontend visibly and structurally separates Worker from Admin.
* [x] Existing Admin Control Room functionality is 100% preserved under the Admin session.
* [x] Unauthorized direct URL navigation is prevented on the client and enforced on the server.

---

## ~~Pass 31 — Worker Operational Projection ("Today's Execution Cockpit")~~ (COMPLETED)

### Context & Need
Workers should not navigate master schedules or interpret Gantt charts. They need an operational projection answering: *"What are we building today?", "Where is it located?", "What is our target scope?", and "What is the current status?"*

### 1. Plan
* Design the Worker Operational Query:
  * Filters project activities by operational horizon: active on `asOfDate` (`plannedStart <= D <= plannedFinish` or `status = 'in_progress'`), or upcoming within near-term window (next 1–3 days).
  * Enriches with physical location, target quantity, unit, current progress percentage, and operational status.
  * Omits internal matching scores, WBS codes, and complex variance formulas.
* Design the Worker Execution Cockpit UI:
  * High-density task cards optimized for touch/gloves, bright sunlight, and field readability.
  * Clear operational status indicators (`On Track`, `At Risk`, `Delayed`, `Completed`).

### 2. Implement
* **Backend Endpoint (`GET /api/projects/:projectId/worker/operational-tasks`):**
  * Thin controller with Zod query validation (`asOfDate`, `locationFilter`, `statusFilter`, `horizonDays`, `scope`).
  * Service layer: queries `ActivityRepository` and canonical `ProgressSnapshotService`.
  * Returns `OperationalTaskListResponse`: `{ projectId, asOfDate, tasks: [{ id, externalId, name, location, plannedQuantity, unit, actualProgress, status, isToday, ... }], summary }`.
* **Frontend Component (`frontend/src/components/worker/TodayWorkView.tsx`):**
  * High-density task card list with location chips, dual progress bars, target quantity chips, and operational status indicators.
  * Filter by Work Area / Location chips (All Areas, Area A through Area F).
  * Scope filter tabs: Operational Horizon, Active Today, Needs Attention, Upcoming 3-Day, All Packages.
  * Direct action buttons on each task card: "Report Progress", "Log Blocker", "Details".
  * Integrated into `WorkerCockpitView.tsx` with smooth navigation into Quick Report.

### 3. Evaluate
* Automated backend tests (`backend/tests/worker_operational_tasks.test.ts`):
  * 9 integration tests passing (100% pass rate).
  * Verified active tasks query as of `2026-08-28` for `REFINERY-U4`.
  * Verified completed activities categorized as `COMPLETED` with 100% progress.
  * Verified delayed activities categorized as `DELAYED` with overdue flags.
  * Verified location filtering (`locationFilter=Area C`).
  * Verified operational horizon scopes (`today`, `upcoming`, `delayed`, `all`).
  * Verified strict project isolation (Project A worker cannot see Project B tasks $\rightarrow$ `HTTP 403 Forbidden`).
  * Verified unauthenticated requests rejected with `HTTP 401 Unauthorized`.
* Automated frontend tests (`frontend/tests/today_work_view.test.tsx`):
  * 8 unit/integration tests passing (100% pass rate).
  * Verified filtering by work area chips, real-time search, action button callbacks, and task detail modal open/close.
  * Verified responsive rendering across mobile (390px), tablet (768px), and desktop (1200px).
* Release verification:
  * Full build succeeded (`tsc -p tsconfig.backend.json` + `vite build`).
  * All 107 test files and 1,021 tests passing cleanly.
  * Golden demo reset and all 59 machine-checkable invariants verified.

### 4. Exit Criteria
* [x] Worker opens FieldLine and immediately sees active tasks for their operational horizon.
* [x] Information hierarchy is free of schedule management clutter and complex analytics.
* [x] Query operates strictly over the shared canonical project truth.

---

## ~~Pass 32 — Frictionless Field Capture (Voice, Rapid Input & Photo Evidence)~~ (COMPLETED)

### Context & Need
Field reporting must require minimal cognitive overhead. FieldLine already has an extraction pipeline and a working Gemini Live WebSocket gateway with `record_field_progress`. This pass connects the Worker Cockpit to this multi-modal capture pipeline.

### 1. Plan
* Audit existing capture mechanisms:
  * `POST /api/projects/:projectId/progress-updates` (text manual updates).
  * `POST /api/projects/:projectId/evidence` (file uploads with SHA-256 deduplication).
  * `LiveToolHandlers.recordFieldProgress` (spoken progress with asynchronous Groq extraction, auto-matching, normalization, and verbal confirmation).
* Design the unified Worker Capture Flow:
  1. Spoken voice dialogue with real-time feedback.
  2. Rapid numeric quantity form (e.g., enter $45\,m^3$ out of $100\,m^3$).
  3. Direct device camera/photo attachment with human attribution (`reporter_name`, `reporter_role`).

### 2. Implement
* **Worker Reporting Interface (`frontend/src/components/worker/WorkerReportModal.tsx`):**
  * Unified capture sheet accessible from any task card or bottom navigation.
  * Tab 1: **Live Voice Dialogue** (embeds `useLiveVoiceSession` with instant waveform and spoken verification feedback: *"Progress verified: Pipe Rack PR-07 saved at 65%"*).
  * Tab 2: **Rapid Quantity / % Entry** (stepper buttons, numeric input for physical quantities, reporter name field).
  * Tab 3: **Photo Capture** (direct file input with camera capture support, preview thumbnail, and progress update attachment).
* **Attribution Enforcement:**
  * Require `reporterName` and optional `reporterRole` on submissions.
  * Persist attribution into `progress_updates.reporter_name` and `reporter_role`.
* **Canonical Truth Protection:**
  * Reports enter the authoritative pipeline: extraction $\rightarrow$ matching $\rightarrow$ normalization.
  * Unambiguous matches auto-confirm; ambiguous matches route to the Admin review queue without blocking the worker.

### 3. Evaluate
* Automated backend tests (`backend/tests/worker_field_capture.test.ts`):
  * 9 integration tests passing (100% pass rate).
  * Direct activity targeting commits progress immediately to canonical truth.
  * Deterministic quantity calculation: actual quantity $80\,\text{m}^3$ of $100\,\text{m}^3$ derives exactly $80\%$ progress.
  * Freeform shift observation notes extract facts, auto-match activities, and enforce review queue routing.
  * Photo evidence uploads verify SHA-256 deduplication and link to progress updates.
  * Attribution enforcement: rejects anonymous submissions without `reporterName` (`HTTP 400 Bad Request`).
  * Role authorization: Worker and Admin accounts permitted; unauthenticated calls rejected (`HTTP 401 Unauthorized`).
* Automated voice tool tests (`backend/tests/gemini_live_tools.test.ts`):
  * 20 tests passing (100% pass rate).
  * Verified spoken voice extraction $\rightarrow$ auto-confirmed match updates canonical truth.
  * Verified ambiguous voice matches route to Admin Human Review queue (`awaiting_review`) with client event dispatch and zero corruption of canonical `activity_progress`.
* Automated frontend tests (`frontend/tests/worker_report_modal.test.tsx`):
  * 6 unit/integration tests passing (100% pass rate).
  * Modal open/close, tab switching (Voice, Quantity, Photo), rapid stepper increment/decrement, percentage derivation, attribution synchronization with AuthContext, and submission API dispatch.
* Full release verification:
  * Full production build succeeded (`tsc -p tsconfig.backend.json` + `vite build`).
  * All 109 test files and 1,036 tests passing cleanly.
  * Golden demo reset and all 59 machine-checkable invariants verified.

### 4. Exit Criteria
* [x] A field worker can submit progress via voice, quantity text, or photo in under 15 seconds.
* [x] Submissions feed the canonical progress pipeline without bypassing validation or truth rules.
* [x] Ambiguous submissions route to the Admin review queue without stranding the worker interface.

---

## ~~Pass 33 — Operational Blockers & Work-Relevant Safety Context~~ (COMPLETED)

### Context & Need
Per `long_term_plan.md` Sections 6 & 10, workers must be able to report operational constraints (materials, equipment, access) and view work-relevant safety hazards. Crucially, field blockers must connect directly to FieldLine's **deterministic Delay & Risk Engine**.

### 1. Plan
* Design the operational blocker model:
  * Blocker categories: `equipment`, `material`, `access`, `inspection`, `weather`, `safety`, `coordination`.
  * Linkage: project, optional target activity, reporter attribution, description, active/resolved status.
* Integrate blockers with the Risk Engine (`RiskClassificationService`):
  * When an active blocker exists for an activity, the risk engine incorporates this operational signal into its `RiskReason[]` output (`delayed_status` or a new `active_blocker` reason code).
* Design work-relevant safety context:
  * Surface safety hazard notices and required precautions relevant to the active work area.
  * Provide a rapid "Report Hazard / Near Miss" mechanism logging directly to `project_events`.

### 2. Implement
* **Database Migration (`0009_operational_blockers.ts`):**
  * Create `operational_blockers` table: `id`, `project_id`, `activity_id` (nullable), `category`, `description`, `status` (`'active' | 'resolved'`), `reporter_name`, `reporter_role`, `created_at`, `resolved_at`.
  * Index on `(project_id, status)` and `(activity_id)`.
* **Services & Routes:**
  * Create `BlockerService` with methods: `reportBlocker`, `listActiveByProject`, `listByActivity`, `resolveBlocker`.
  * Mount endpoints: `POST /api/projects/:projectId/blockers`, `GET /api/projects/:projectId/blockers`, `PATCH .../blockers/:id/resolve`, and `POST .../safety/hazards`.
* **Risk Engine Integration (`risk-classification.calculator.ts` & `risk-classification.service.ts`):**
  * Pass active blocker signals into the risk classifier.
  * Flag activities with active blockers with actionable risk reasons (`code: 'active_blocker'`, e.g., *"Equipment blocker: Crane out of service for pump skid placement"*).
  * Resolving a blocker deterministically clears the blocker risk signal and restores `ON_TRACK` status if no other risk condition exists.
* **Worker & Admin UI:**
  * Worker: "Log Blocker" button on task card, touch-friendly category grid, contextual Work Area Safety Banner with quick "Report Hazard / Near Miss" modal.
  * Admin: "Needs Attention" card on Primary Dashboard displaying active site blockers with root-cause aggregation and quick resolve actions.

### 3. Evaluate
* Write automated tests in `backend/tests/operational_blockers.test.ts`:
  * 8 integration tests passing (100% pass rate).
  * Report blocker on `ACT-C01` (Pipe Rack PR-07) with category `equipment` ("crane down").
  * Verify blocker appears in Worker active blockers query.
  * Verify `GET /api/projects/:projectId/risk-status` flags `ACT-C01` with the blocker rationale (`active_blocker`).
  * Resolve blocker $\rightarrow$ verify risk status updates deterministically.
  * Verify safety hazard logging creates an auditable `project_event`.
  * Verify root-cause category aggregation on Primary Dashboard.
  * Enforce role authorization and project isolation.
* Automated frontend tests (`frontend/tests/operational_blockers.test.tsx`):
  * 6 tests passing (100% pass rate).
  * BlockerModal category selection, field validation, and submission dispatch.
  * WorkAreaSafetyBanner contextual briefing and PPE checklist per EPC area.
  * ReportHazardModal fast incident/near-miss logging to `project_events`.
  * AttentionSummary root-cause category pills and resolve button dispatch.
* Full regression & release verification:
  * Full production build succeeded (`tsc -p tsconfig.backend.json` + `vite build`).
  * All 111 test files and 1,050 automated tests passing cleanly with 100% pass rate.
  * Golden demo environment re-seeded and all 59 machine-checkable invariants verified.
  * `npm run verify:release` executed in 64.5s with zero errors.

### 4. Exit Criteria
* [x] Workers can report and view active operational blockers in seconds.
* [x] Field blockers flow directly into the deterministic Risk Engine and Admin Dashboard.
* [x] Safety notices appear contextually on active work without expanding FieldLine into an enterprise compliance suite.

---

## Pass 34 — Role-Partitioned AI Assistant & Live Voice Gateway

### Context & Need
FieldLine already features a Grounded Text Assistant (`AssistantService`) and a Gemini Live WebSocket Gateway (`LiveToolHandlers`). Currently, all tools are mounted globally. This pass partitions assistant capabilities into role-appropriate scopes.

### 1. Plan
* Audit all 6 tools in `LiveToolHandlers`:
  1. `get_next_recommended_activities` $\rightarrow$ Worker & Admin
  2. `lookup_activity_status` $\rightarrow$ Worker & Admin
  3. `record_field_progress` $\rightarrow$ Worker & Admin
  4. `get_project_intelligence` $\rightarrow$ **Admin Only**
  5. `search_project_activities` $\rightarrow$ Worker & Admin (scoped)
  6. `query_project_assistant` $\rightarrow$ **Admin Only**
* Define Worker Assistant intent boundaries:
  * Permitted: task lookup, location queries, current progress percentage, active blockers, work-area safety precautions.
  * Forbidden: project-wide variance analytics, portfolio delay matrices, confidence tier distributions.
* Define Admin Assistant scope:
  * Full project intelligence, root-cause analysis, milestone lookahead, contractor progress comparisons.

### 2. Implement
* **WebSocket Gateway Session Partitioning (`gemini-live-gateway.ts`):**
  * Inspect authenticated session role when establishing `/ws/live-session`.
  * Pass `sessionRole: 'worker' | 'admin'` to `LiveToolHandlers`.
  * Enforce role checks in `executeTool`: if a Worker session calls `get_project_intelligence` or `query_project_assistant`, return a graceful role boundary message: *"This query requires project control room access."*
* **Grounded Text Assistant (`assistant.service.ts`):**
  * Support `role: 'worker' | 'admin'` parameter in query options.
  * When `role === 'worker'`, filter verified facts to operational task context only, omitting systemic variance metrics.
* **Worker UI Assistant Integration:**
  * Add quick voice query suggestions on the Worker Cockpit: *"What are we doing in Area C?", "Has piling cleared?", "What is blocking crude pump?"*

### 3. Evaluate
* Write automated integration tests in `backend/tests/role_assistant_partition.test.ts`:
  * Worker session calling `record_field_progress` $\rightarrow$ succeeds and confirms.
  * Worker session calling `get_project_intelligence` $\rightarrow$ blocked by role policy.
  * Worker asking *"What is delayed across all 6 areas?"* $\rightarrow$ returns operational scope boundary.
  * Admin session asking systemic questions $\rightarrow$ returns full grounded fact synthesis.
  * Verify zero hallucination: all claims reference verified SQLite fact IDs.

### 4. Exit Criteria
* [x] AI Assistant and Gemini Live Gateway enforce role-appropriate tool execution and fact grounding.
* [x] Workers receive execution-focused answers without exposure to management analytics.
* [x] Admins retain full project-control intelligence queries.

---

## Pass 35 — Security Penetration, Adversarial Validation & Provenance Hardening

### Context & Need
Before certifying the system, FieldLine must undergo dedicated adversarial and security validation to prove that role boundaries, project isolation, and evidentiary integrity cannot be bypassed.

### 1. Plan
* Compile an adversarial threat matrix:
  * Role escalation (Worker attempting Admin actions).
  * Cross-project ID manipulation (Project A worker accessing Project B records).
  * Evidence tampering and path traversal.
  * Forged human attribution.
  * Malformed progress inputs and quantity tampering.
  * Unauthorized WebSocket session hijacks.
* Plan non-destructive historical revision tests (asserting that historical observations are never silently destroyed).

### 2. Implement
* **Comprehensive Adversarial Suite (`backend/tests/adversarial_security.test.ts`):**
  * Test direct HTTP injection bypassing the React UI.
  * Test path traversal attacks on evidence content streaming (`/evidence/../../etc/passwd`).
  * Test evidence upload SHA-256 collision and deduplication tampering.
  * Test cross-project foreign key injection (linking Project A update to Project B activity).
* **Fix and Harden:**
  * Patch any authorization bypasses, unhandled type coercions, or data leakage discovered during testing.
  * Ensure all SQLite prepared statements strictly include `WHERE project_id = ?`.

### 3. Evaluate
* Execute the complete adversarial test suite.
* Verify that:
  * 100% of unauthorized cross-project requests return `404` or `403`.
  * 100% of Worker role escalation attempts return `403`.
  * Zero server filesystem paths are exposed in errors, stack traces, or responses.
  * Historical progress observations preserve append-only timestamps and attribution.

### 4. Exit Criteria
* [x] Adversarial test suite runs with zero failures.
* [x] Server-side security boundaries are proven resilient against client manipulation.
* [x] Historical revision audit trail is verified intact.

---

## Pass 36 — End-to-End Truth Certification & North-Star Conformance

### Context & Need
This is the final certification pass. It proves that the complete 13-stage truth pipeline operates flawlessly across both Worker and Admin user journeys, and produces the formal **North-Star Conformance Matrix** against `long_term_plan.md`.

### 1. Plan
* Design two complete end-to-end integration journeys:
  * **Worker Journey:** Authenticate $\rightarrow$ view today's tasks $\rightarrow$ inspect location $\rightarrow$ submit progress via voice $\rightarrow$ attach photo evidence $\rightarrow$ report crane blocker $\rightarrow$ receive verbal verification $\rightarrow$ observe task update.
  * **Admin Journey:** Authenticate $\rightarrow$ inspect Primary Dashboard $\rightarrow$ observe active blocker in Needs Attention $\rightarrow$ review and confirm suggested match $\rightarrow$ verify canonical progress committed $\rightarrow$ inspect variance and risk $\rightarrow$ query grounded assistant $\rightarrow$ trace originating photo evidence.
* Build the formal North-Star Conformance evaluation matrix directly from every section of `long_term_plan.md`.

### 2. Implement
* **End-to-End Test Suite (`backend/tests/two_account_e2e.test.ts`):**
  * Script the complete dual-account lifecycle using the Golden Demo project (`REFINERY-U4`).
  * Verify that worker actions immediately reflect in the admin control room over the same canonical truth.
* **Golden Demo Enhancement:**
  * Update `npm run demo:reset` and `npm run demo:verify` to include worker accounts, operational blockers, and dual-role verification.
* **North-Star Conformance Audit:**
  * Evaluate all product requirements under: `✅ Realized`, `🟡 Partial`, `🔴 Missing`, `❌ Contradictory`.
  * Produce `docs/NORTH_STAR_CONFORMANCE.md`.

### 3. Evaluate
* Run the ultimate verification command:
  ```bash
  npm run verify:release
  ```
* Ensure:
  * Production build compiles cleanly (`dist/backend` and `dist/frontend`).
  * All 100+ test files pass (backend, frontend, E2E, adversarial).
  * Golden demo resets idempotently and passes all machine-checked invariants.
  * Zero regressions across pre-existing Pass 0–26 features.

### 4. Exit Criteria
* [x] The complete planning-to-execution workflow executes seamlessly across Worker and Admin roles.
* [x] Both accounts demonstrably operate on the same canonical project truth.
* [x] `NORTH_STAR_CONFORMANCE.md` confirms 100% compliance with `long_term_plan.md` with zero contradictory implementations.
* [x] Release verification succeeds deterministically.

---

## Program Dependency Graph & Execution Sequence

```text
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 27 — Baseline Freeze & Test Snapshot                              │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 28 — Project Account Credentials & Session Identity               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 29 — Server-Side Authorization & Project Scoping                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 30 — Dual-Shell Architecture & Admin Control Alignment            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│ PASS 31 — Worker Operational      │ │ PASS 34 — Role-Partitioned AI     │
│           Projection ("Today")    │ │           Assistant & Gateway     │
└─────────────────┬─────────────────┘ └─────────────────┬─────────────────┘
                  │                                     │
                  ▼                                     │
┌───────────────────────────────────┐                   │
│ PASS 32 — Frictionless Capture    │                   │
│           (Voice, Input, Photos)  │                   │
└─────────────────┬─────────────────┘                   │
                  │                                     │
                  ▼                                     │
┌───────────────────────────────────┐                   │
│ PASS 33 — Operational Blockers &  │                   │
│           Safety Context          │                   │
└─────────────────┬─────────────────┘                   │
                  │                                     │
                  └─────────────────┬───────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 35 — Security Penetration, Adversarial & Provenance Hardening     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PASS 36 — End-to-End Truth Certification & North-Star Conformance      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Engineering Rules for Implementing Agents

1. **One Pass at a Time:** Never execute multiple passes in a single turn or mega-prompt. Always complete the full cycle: **Plan → Implement → Evaluate → Verify → Proceed**.
2. **Never Break Canonical Truth:** Only verified and confirmed linkages can update canonical `activity_progress`. Never allow raw AI extractions to write directly to progress records.
3. **Preserve Determinism:** Math, variance calculations, and risk taxonomies must remain in pure TypeScript. Never trust LLMs for arithmetic.
4. **Local-First Reliability:** Keep infrastructure presentation-grade. Never introduce cloud database daemons, Docker requirements, or mandatory remote services.
5. **Protect Scope:** Reject feature creep into payroll, commercial invoicing, procurement, or heavy CAD/BIM modeling.
