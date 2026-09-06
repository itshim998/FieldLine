# FieldLine Long-Term Product & Architectural Vision: The Two-Account Model

> **Document Type:** Authoritative Long-Term Product & Architectural Vision  
> **Status:** Active North Star  
> **Core Purpose:** Bridging planned infrastructure project schedules and real-world field execution through trustworthy progress capture, evidence, schedule linking, and project intelligence.

---

## 1. Executive Summary & Vision

FieldLine is designed as an intelligent data capture and schedule-linking platform for capital infrastructure projects. Its foundational purpose is to solve the universal **planning-to-execution disconnect**: master project schedules (Primavera P6, Microsoft Project, Excel WBS) live in planning offices detached from site reality, while ground-truth execution updates (daily logs, field notes, inspection reports, contractor claims, and site photos) live in fragmented field silos.

To bridge this divide across the lifecycle of an infrastructure project, FieldLine separates user interaction into two project-level account types:

1. **Worker Account (Execution Interface):** A shared, low-friction interface for field workers, trade crews, and field supervisors to understand immediate operational tasks, review relevant site safety requirements, report physical progress, log blockers, and capture field evidence without cognitive or administrative overhead.
2. **Admin / Project Lead Account (Control Interface):** A centralized command center for project managers, planners, construction managers, and superintendents to govern schedules, review uncertain AI schedule linkages, inspect progress variances, evaluate delay and risk signals, query grounded project intelligence, and maintain an auditable evidentiary trail.

### Framework: Current vs. Future vs. Invariant

To ensure this document serves as an enduring architectural north star rather than an ephemeral snapshot, all concepts are framed across three distinct categories:

* **Current Implementation:** Capabilities and structures that exist in the FieldLine repository today (as of Pass 25).
* **Long-Term Desired Capability:** Product and technical capabilities that represent the target end state but are not yet fully realized as first-class domain models.
* **Architectural & Product Invariant:** Core design principles that must remain true across all implementations, regardless of technology choices or database platforms.

---

## 2. Fundamental Product Thesis: Execution vs. Control

The separation between Worker and Admin is **not** a traditional enterprise permission hierarchy where "workers are merely less-privileged admins who see fewer buttons." 

Rather, it reflects two fundamentally distinct operational realities on an infrastructure job site:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          FIELDLINE ARCHITECTURE                        │
├───────────────────────────────────┬────────────────────────────────────┤
│         WORKER ACCOUNT            │         ADMIN / LEAD ACCOUNT       │
│      "Execution Interface"        │         "Control Interface"        │
├───────────────────────────────────┼────────────────────────────────────┤
│  • What are we building today?    │  • Is the project deviating?       │
│  • Where is the work located?     │  • What is our planned vs actual?  │
│  • What is stopping our crew?     │  • What activities are at risk?    │
│  • What safety hazards apply?     │  • Which matches require review?   │
│  • Report reality in seconds      │  • Govern schedules & evidence     │
├───────────────────────────────────┴────────────────────────────────────┤
│                      SHARED CANONICAL PROJECT TRUTH                    │
│        (One Schedule, One Progress History, One Evidence Archive)      │
└────────────────────────────────────────────────────────────────────────┘
```

### The Worker Experience: Optimized for Execution
* **Operational Horizon:** Workers need information framed around their immediate work horizon—the current shift, active tasks in their work area, immediate predecessor dependencies, and upcoming milestones necessary for near-term preparation.
* **Frictionless Capture:** Reporting progress must fit into real field conditions (noisy machinery, bright sunlight, heavy dust, workers wearing gloves and protective gear). Capture mechanisms must minimize interaction time.
* **Contextual Safety:** Workers require direct access to safety notices, hazard warnings, and precaution briefings that directly affect their immediate physical work.
* **Freedom from Administrative Machinery:** Workers should never be exposed to matching algorithm confidence scores, internal entity resolution disambiguators, variance formulas, or complex project-control workflows.

### The Project Lead Experience: Optimized for Control
* **Systemic Visibility:** Project leads require full schedule governance, WBS-level activity tracking, critical milestone tracking, and cross-area variance analytics.
* **Delay & Risk Governance:** Project leads need deterministic, early-warning signals identifying delayed activities, activities at risk of missing deadlines, and stale work packages lacking recent updates.
* **Human-in-the-Loop Truth Protection:** Project leads are the gatekeepers of canonical truth. When automated systems encounter ambiguity in linking field reports to scheduled tasks, project leads evaluate, confirm, reject, or reassign those linkages.
* **Auditability & Provenance:** Project leads must defend schedule claims, contractor billings, and owner reporting using verifiable evidence linked directly to schedule activities.

---

## 3. Shared Canonical Project Truth

A central architectural invariant of FieldLine is that both accounts operate over the **exact same canonical project truth**.

* **No Split Realities:** FieldLine never maintains an "internal office schedule" alongside an "approximated field schedule." There is one master schedule baseline, one verified progress timeline, and one evidence repository.
* **Identical State, Different Projections:**
  * The **Worker** receives an *operational projection*: actionable task descriptions, physical locations, target quantities, active blocker indicators, and simple status summaries.
  * The **Project Lead** receives an *analytical projection*: planned versus actual percentage curves, variance metrics, risk classification reason codes, confidence tiers, and full audit timelines.
* **Operational Consistency:** When a project lead confirms a progress report in the control room, the updated status is immediately reflected in the worker's operational view. When a worker logs a field update, it enters the shared pipeline for processing and verification.

---

## 4. The Data & Truth Lifecycle: Source to Decision Support

FieldLine organizes data processing into six clearly demarcated stages. This separation is an architectural invariant that prevents machine learning, heuristics, or user assumptions from silently corrupting project truth:

```text
┌─────────────────┐
│   1. SOURCE     │  Raw field input (voice audio, text update, site photo, PDF daily log)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. INTERPRET    │  Extraction of structured facts (quantities, references, reported states)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. ASSOCIATE    │  Scoring candidate matches to schedule activities; tiering confidence
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. CANONICAL    │  Human review gatekeeping; deterministic progress normalization
│    OBSERVATION  │  committed to append-only historical record
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. DERIVED      │  Deterministic calculation of planned progress, variance, delay,
│    STATE        │  and risk classifications
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6. DECISION     │  Operational guidance for workers; intelligence & analytics for leads
│    SUPPORT      │
└─────────────────┘
```

1. **Source:** What was captured or uploaded in the physical world (e.g., a voice statement, manual text log, contractor daily sheet, or inspection photograph).
2. **Interpretation:** Structured facts extracted from the source (e.g., explicit mention of 45 $m^3$ concrete poured at Foundation B). *Invariant: Extraction does not define project truth.*
3. **Association:** Evaluating candidate schedule activities that correspond to the extracted facts, computing similarity scores, and categorizing confidence.
4. **Canonical Observation:** Recording verified progress into the append-only activity progress store. *Invariant: Only unambiguous high-confidence matches or human-confirmed matches become canonical observations.*
5. **Derived State:** Deterministic computation of planned progress, progress variance, overdue status, and risk categories based on canonical observations relative to an evaluation date.
6. **Decision Support:** Transforming derived state into role-appropriate presentation (simple actionable alerts for workers; comprehensive health metrics and intelligence queries for project leads).

---

## 5. Core Architectural & Product Invariants

The following principles represent durable architectural invariants that must be preserved across all future implementations:

### Invariant 1: AI Does Not Own Project Truth
Artificial Intelligence serves strictly as an untrusted interpretation and phrasing layer. AI may parse messy speech into text, extract candidates from documents, or synthesize natural language answers from pre-computed facts. AI must **never** write directly to canonical progress records, calculate mathematical percentages, or override deterministic schedule logic.

### Invariant 2: Mathematical Determinism in Progress, Variance, and Risk
All progress calculations (such as deriving percentages from actual versus planned quantities), schedule variances ($actual - planned$), overdue determinations ($asOfDate > plannedFinish \land actual < 100\%$), and schedule risk categorizations must be computed deterministically in application code. They must never rely on LLM estimates, probabilistic guessing, or opaque database heuristics.

### Invariant 3: Canonical Progress Truth Protection
A field report can only update canonical activity progress if its linkage to a schedule activity is verified. Unambiguous, high-confidence linkages may be auto-confirmed according to validated policy; ambiguous or low-confidence linkages must be held in an unresolved state until an authorized project lead reviews them.

### Invariant 4: Historical Provenance and Auditability
Historical execution records must not be silently overwritten. Progress is an append-only timeline of observations ordered chronologically by observation date. If an error is corrected or an update is superseded, the system must preserve the provenance of what changed, when, and who authorized it.

### Invariant 5: Traceable & Integrity-Verifiable Evidence
Every recorded progress observation must maintain a traceable path back to its originating field report and associated evidence files. Evidence files must have verifiable integrity (e.g., cryptographic content digests) to ensure that records referenced in project disputes or client audits remain tamper-evident.

### Invariant 6: Strict Project Isolation
Every schedule, activity, progress update, evidence file, and audit event belongs strictly to a specific project. Cross-project data leakage must be impossible at both the API and database boundary.

---

## 6. Worker Experience: The Execution Cockpit

### Context & Field Reality
Construction and infrastructure field workers face demanding physical conditions: high ambient equipment noise, heavy dust, direct sunlight, protective gear (work gloves, hard hats, safety glasses), and continuous physical focus. Interaction with digital tools must be frictionless, immediate, and forgiving.

### What Workers Need to Know
* **Current Operational Scope:** What activities are active, scheduled, or prioritized for their trade or work area in the current operational horizon.
* **Physical Location Context:** Where the work is located (WBS area, structure, grid line, or elevation).
* **Target Quantities & Current Status:** What work scope is planned (e.g., target volume, length, or count) and what progress has been recorded to date.
* **Relevant Operational Constraints:** Knowledge of known constraints affecting their work (e.g., crane maintenance windows, delayed material deliveries, or access restrictions).
* **Work-Relevant Safety Information:** Critical hazards, required precautions, and safety notices that directly apply to their active tasks and work zones.

### What Workers Need to Do
* **Frictionless Progress Capture:** Report what happened in the field with minimal interaction overhead:
  * *Voice Reporting:* Natural spoken descriptions captured and acknowledged with clear, low-friction confirmation.
  * *Rapid Form Input:* Simple numeric quantity or status updates without navigating deep multi-level menus.
  * *Visual Evidence Upload:* Capture and attach site photos, delivery slips, or inspection sheets directly from field devices.
* **Surface Operational Blockers:** Immediately flag conditions preventing progress (e.g., missing materials, broken equipment, blocked access, or pending inspections).
* **Report Site Hazards:** Quickly log safety hazards, near misses, or changed physical conditions observed in the work area.
* **Ask Operational Questions:** Inquire about their immediate work context (e.g., *"What is scheduled for Area B today?"*, *"Has the rebar inspection cleared?"*, *"What was our last recorded pour volume?"*).

### What Workers Must NOT Be Burdened With
* Managing or altering master schedule baselines.
* Resolving ambiguous AI activity matches or interpreting confidence scores.
* Viewing or analyzing macro project variance curves, critical path networks, or financial metrics.
* Administering the overall project evidence archive or deleting historical records.
* Managing project configurations, user roles, or system settings.

---

## 7. Admin / Project Lead Experience: The Project Control Room

### Context & Management Responsibilities
Project leads, project controls managers, and superintendents are responsible for delivering complex projects on schedule and within budget. Their daily workflow centers on variance detection, milestone accountability, contractor coordination, quality compliance, and dispute avoidance.

### What Project Leads Need to Know
* **Macro Schedule Health & Variance:** Objective comparison of planned versus actual execution progress across all work packages, disciplines, and WBS areas.
* **Early-Warning Delay & Risk Signals:** Deterministic identification of overdue activities, activities falling behind plan near completion windows, and stale activities lacking recent field updates.
* **Critical Milestones:** Proximity and status of zero-duration contractual delivery milestones, client handoffs, and interface tie-ins.
* **Evidence Traceability & Audit Trails:** The ability to inspect the physical proof behind any reported progress figure, verifying source documents, timestamps, and reporter attribution.
* **Systemic Blocker Patterns:** Aggregated visibility into operational constraints across work areas to identify systemic bottlenecks (such as chronic equipment shortages or recurring inspection delays).

### What Project Leads Need to Do
* **Govern Project Schedules:** Ingest, validate, and manage master project schedules (CSV, XLSX, Primavera P6), designate baseline schedules, and inspect schedule hierarchy.
* **Gatekeep Canonical Progress (Human Review):** Act as the authoritative human reviewer for ambiguous or medium-confidence activity matches, confirming, rejecting, or reassigning schedule linkages.
* **Manage Document Ingestion & Processing:** Oversee asynchronous processing jobs for bulk daily reports, multi-page PDFs, and tabular subcontractor logs.
* **Query Grounded Project Intelligence:** Query project health and historical execution using natural language, receiving syntheses strictly grounded in verified facts.
* **Administer Project Lifecycle:** Manage project configuration, status transitions (`planning`, `active`, `paused`, `completed`, `archived`), and overall data governance.

---

## 8. Shared-Account Model: Project Identity vs. Human Attribution

FieldLine deliberately centers its access model around two shared project accounts:

> **One Project $\rightarrow$ One Shared Worker Account + One Shared Admin / Lead Account**

```text
                        PROJECT CREDENTIAL BOUNDARY
                                     │
                   ┌─────────────────┴─────────────────┐
                   │                                   │
         SHARED WORKER ACCOUNT                SHARED ADMIN ACCOUNT
          (Execution Access)                    (Governance Access)
                   │                                   │
                   ▼                                   ▼
          OPERATIONAL RECORDS                 GOVERNANCE DECISIONS
          • Progress Updates                  • Schedule Ingestion
          • Evidence Uploads                  • Match Review Confirmations
          • Blocker Notes                     • Project Status Changes
                   │                                   │
                   └─────────────────┬─────────────────┘
                                     │
                                     ▼
                        HUMAN ATTRIBUTION CAPTURE
                 (e.g., reporter_name, reporter_role, reviewed_by)
```

### Rationale for Shared Accounts
1. **Elimination of Site Onboarding Friction:** Field crews frequently consist of transient trade personnel and subcontractors. Requiring individual corporate enterprise logins or SSO accounts for every worker creates immediate barrier to adoption.
2. **Shared Field Devices:** Ruggedized site tablets and job-trailer workstations are routinely shared across shifts and crew members. A shared project account matches how field stations operate.
3. **Inherent Project Isolation:** Account credentials establish clean boundaries around the project. A worker account on Project A cannot access or see Project B.

### The Fundamental Distinction: Account Identity vs. Human Attribution
* **Account Identity (Authentication & Role Authorization):** The shared credential authenticates the client session and enforces whether the user is authorized to perform Worker actions or Admin actions within that project.
* **Human Attribution (Auditability & Context):** Individual submissions and decisions within the application retain human attribution:
  * *Field Progress Reports:* Progress update records capture attribution (e.g., who reported the update and their trade or role), either stated verbally or entered directly.
  * *Human Review Decisions:* When a candidate match is confirmed, rejected, or resolved, the system records who performed the review and when.
  * *Audit Events:* Significant project lifecycle events record the acting user context alongside timestamps.

*Note on Implementation:* The current repository already supports `reporter_name` and `reporter_role` on progress update records, and `reviewed_by` on activity matches. The product vision requires this attribution principle to be maintained without prescribing rigid user-management frameworks.

---

## 9. Role Boundaries & Authorization Principles

### Durable Security Principle: Defense in Depth
User interface adaptation—such as hiding management controls from the Worker view—is purely an ergonomic convenience. **Security and role enforcement must be strictly validated on the server at domain and API boundaries.**

* **Server-Side Role Enforcement:** Every request is evaluated against the authenticated project context and account type. If a Worker Account attempts an Admin-only action (such as modifying schedules or confirming match reviews), the system must reject the operation at the authorization boundary.
* **Strict Project Scoping:** All data access operations must be strictly bound to the authenticated project identifier. Accessing or modifying entities belonging to a different project must be prevented.
* **Role-Appropriate Data Projection:**
  * *Worker Views:* Return operational data attributes (task names, locations, planned dates, current progress, operational blockers) while omitting internal analytical scores, algorithm confidence tiers, and systemic variance matrices.
  * *Filesystem Privacy:* Direct server filesystem paths must never be exposed to clients in either account. File access must be mediated through authorized, project-scoped streaming mechanisms.

---

## 10. Future Domain Concepts

To avoid describing nonexistent features as currently implemented, this section explicitly identifies capabilities that are **desired target concepts for FieldLine**, distinguished from today's implementation:

```text
┌──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│       CONCEPT AREA           │    CURRENT IMPLEMENTATION    │     LONG-TERM DESIRED        │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Operational Blockers         │ Captured within free-text    │ First-class entity linked to │
│ & Constraints                │ progress update notes        │ activities and schedules     │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Work-Relevant Safety         │ General text notes within    │ Structured shift briefings & │
│                              │ progress updates             │ work-area hazard notices     │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Dedicated Worker UI          │ Single shared workspace with │ Tailored Execution Cockpit   │
│                              │ responsive layout            │ optimized for mobile/tablet  │
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Authentication System        │ Local project selection &    │ Project-level account auth   │
│                              │ client-side storage context  │ (Worker vs Admin credentials)│
├──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Field Connectivity           │ Local machine operation      │ Resilient offline-first      │
│                              │                              │ mobile caching and queueing  │
└──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

### 1. Structured Operational Blockers & Constraints
* *Current State:* Field personnel can mention reasons for delay (e.g., crane breakdown, rain) inside the free-text `raw_text` of progress updates.
* *Desired Future State:* FieldLine should eventually elevate operational constraints and blockers to first-class domain information, tracking constraint categories (material, equipment, access, inspection, weather), active versus resolved states, and direct schedule impacts.

### 2. Work-Relevant Execution Safety Information
* *Current State:* Safety observations can only be noted as unstructured text in field reports.
* *Desired Future State:* FieldLine should surface relevant work-area safety briefings, active hazard notices, and required precautions directly on the worker's operational view, and provide a dedicated mechanism for logging field hazard observations. FieldLine does *not* aim to become a full site safety compliance platform (e.g., enterprise permit-to-work or incident investigation software).

### 3. Dedicated Worker Execution View
* *Current State:* The application provides a comprehensive tabbed workspace (Overview Dashboard, Schedules, Progress, Evidence, Intelligence, Activity Detail).
* *Desired Future State:* A dedicated "Today's Execution" interface tailored for mobile and tablet field devices, prioritizing active tasks, low-friction reporting, and immediate feedback, distinct from the desktop control room.

### 4. Account Authentication Boundary
* *Current State:* Projects are selected via the UI, with the active project identifier maintained in client storage without account-level password or token authentication.
* *Desired Future State:* Formal project-level authentication implementing the two-account model (Worker credentials vs. Admin credentials), enforcing access boundaries at the server layer.

---

## 11. Evidence, Provenance & The Trust Model

### Defensible Language: What FieldLine Does and Does Not Claim
FieldLine avoids unrealistic claims that software alone can establish "objective physical truth" or make records "tamper-proof." An authentic digital photograph of a pipe spool does not prove that the underlying weld passed volumetric testing.

FieldLine provides:
* **Traceable Evidence Provenance:** Establishing an unbroken chain between physical files, extracted facts, candidate matches, and canonical progress records.
* **Cryptographic Integrity Verification:** Using content hashing (such as SHA-256 digests) to verify that stored evidence files have not been altered, replaced, or duplicated.
* **Auditable Review History:** Recording exactly when an observation was accepted, whether it was auto-confirmed by policy or resolved by a human reviewer, and preserving historical context.
* **Non-Destructive Revision Tracking:** Ensuring that historical observations are not silently overwritten. Corrected or superseded observations preserve the record of what changed and why.

### Role-Appropriate Evidence Access
* **Worker Evidence Scope:** Workers can upload evidence (photos, delivery tickets, field slips) and access evidence files directly associated with their immediate operational tasks.
* **Project Lead Evidence Scope:** Project leads maintain comprehensive access to the entire project evidence archive, file ingestion queues, deduplication metadata, and historical document provenance.

---

## 12. AI Boundaries & Scope Enforcement

FieldLine enforces clear, strict boundaries on artificial intelligence:

```text
┌──────────────────────────────────────┬──────────────────────────────────────┐
│           WHAT AI MAY DO             │          WHAT AI MUST NEVER DO       │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Transcribe spoken field audio      │ • Directly mutate canonical progress │
│ • Extract structured field facts     │ • Fabricate schedule activity IDs    │
│ • Suggest candidate activity matches │ • Calculate mathematical percentages │
│ • Synthesize grounded prose answers  │ • Overrule deterministic risk engines│
│ • Disambiguate close text candidates │ • Answer queries using unverified data│
└──────────────────────────────────────┴──────────────────────────────────────┘
```

1. **Extraction Boundary:** AI models extract facts (e.g., quantities, locations, progress claims) from unstructured text and speech. The extracted facts remain unconfirmed hypotheses until matched and validated.
2. **Matching Boundary:** AI may suggest linkages between extracted facts and schedule activities or assist in ranking ambiguous candidates. High-confidence unambiguous candidates may be auto-confirmed based on deterministic policies; ambiguous candidates require human review.
3. **Query & Intelligence Boundary:** The AI Assistant answers management and field questions strictly by referencing pre-computed, verified deterministic facts. If an entity is not found or facts are insufficient, the assistant returns explicit structured fallbacks rather than hallucinating answers.

---

## 13. Product Boundary: What FieldLine Deliberately Is NOT

Preserving FieldLine's long-term value requires vigilance against feature creep. FieldLine is designed to be the **planning-to-execution progress and intelligence bridge**. It is explicitly **not** a generic construction management platform.

```text
        ┌─────────────────────────────────────────────────────────────┐
        │                 FIELDLINE'S CORE MISSION                    │
        │                                                             │
        │    Master Schedules  ◄────────────────►  Field Ground Truth │
        │    (P6, MS Project)                      (Voice, Photos)    │
        │           │                                     │           │
        │           ▼                                     ▼           │
        │    Planned Progress  ◄────────────────►  Actual Progress    │
        │           │                                     │           │
        │           └───────────────┬─────────────────────┘           │
        │                           ▼                                 │
        │                 Variance & Risk Engine                      │
        │                           │                                 │
        │                           ▼                                 │
        │                Project Intelligence & Audit                 │
        └─────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ REJECTED SCOPE
                                    │
        ┌───────────────────────────┴─────────────────────────────────┐
        │               GENERIC SUITE FEATURE CREEP                   │
        │  • Payroll, Timecards & Labor Hour Accounting               │
        │  • Subcontractor Bidding, Estimating & Procurement          │
        │  • Commercial Invoicing, Pay Apps & Lien Releases           │
        │  • Heavy 3D BIM Authoring & CAD Rendering Engines           │
        │  • Enterprise Safety Compliance & Permit-to-Work Suites     │
        │  • Complex Multi-Tier Enterprise RBAC (50+ Permissions)     │
        └─────────────────────────────────────────────────────────────┘
```

FieldLine explicitly rejects expanding into:
* **Payroll & Labor Accounting:** FieldLine tracks physical work completed and execution blockers, not worker timecards, wage calculations, or shift attendance.
* **Procurement & Bidding:** FieldLine links schedule activities to field evidence; it does not manage vendor bidding, purchase orders, or material requisitions.
* **Commercial Billing & Invoicing:** FieldLine produces verified progress records that can substantiate pay applications, but it does not generate AIA billing documents, tax forms, or lien waivers.
* **Full BIM / CAD Authoring:** FieldLine references WBS codes and physical locations; it does not attempt to be a 3D geometry engine or CAD drafting tool.
* **Enterprise Safety Management:** FieldLine surfaces work-relevant hazard notices and accepts field hazard reports; it does not attempt to be an enterprise incident-management or permit-to-work compliance system.
* **Granular Enterprise Permission Matrices:** FieldLine maintains its clear, intentional focus on two primary project-level interaction modes: **Worker** and **Admin/Lead**. It avoids complex multi-role permission configurators with dozens of granular toggles.

---

## 14. Architectural Portability: Local-First to Hosted Environments

### Today's Architectural Foundation: Local-First Monolith
FieldLine is currently built as a **local-first modular monolith**:
* **Runtime:** Node.js with Express thin controllers and Zod runtime validation.
* **Database:** Local SQLite (`database/fieldline.db`) running with WAL mode, foreign keys enforced unconditionally, and isolated transactions.
* **Storage:** Local filesystem storage partitioned by project identifier.
* **Job Processing:** In-process asynchronous task runner for document ingestion jobs.
* **Evaluation Readiness:** 100% offline reproducible demo and invariant verification.

### Future Architectural Portability
The long-term vision requires that FieldLine's core domain logic remains sufficiently decoupled from local infrastructure that it can support hosted, multi-tenant, or cloud deployments without rewriting business logic:
* **Decoupled Persistence:** Application services interact with persistence exclusively through repository interfaces. Transitioning to hosted relational databases (such as PostgreSQL or Supabase) involves providing repository implementations while leaving progress normalization, risk calculation, and intelligence logic untouched.
* **Storage Abstraction:** File handling services encapsulate storage operations, enabling transparent migration from local directories to cloud object stores with content hashing preserved.
* **Portable Security Architecture:** The two-account project model maps cleanly to standard identity tokens and row-level authorization boundaries in distributed environments.
* **Resilient Field Operation:** In hosted environments, the Worker experience should eventually incorporate offline-first local caching and queueing, enabling uninterrupted field reporting during job-site connectivity blackouts.

---

## 15. Product Capability Matrix

The following matrix defines the desired operational boundaries between the Worker and Admin experiences:

| Functional Area | Capability | Worker Experience (Execution) | Admin / Lead Experience (Control) | Underlying Truth Principle |
| :--- | :--- | :--- | :--- | :--- |
| **Project Context** | Project Access | Access assigned project workspace | Manage, configure, and monitor projects | Bounded strictly by project identifier |
| | Project Configuration | View basic project identity | Full authority over metadata, status, & dates | Canonical project record |
| **Schedules & WBS** | Schedule Ingestion | None (excluded from role) | Import, parse, and validate CSV, XLSX, P6 | Canonical schedule repository |
| | Baseline Governance | None (excluded from role) | Designate and lock baseline schedules | Single baseline truth per project |
| | Schedule Visibility | Operational horizon (active & near-term tasks) | Complete master schedule hierarchy & WBS | Filtered projection vs. full master WBS |
| **Progress Reporting** | Manual Field Reporting | Rapid text input of work completed | Review, report, and audit field updates | Verbatim raw text in progress updates |
| | Voice Progress Capture | Spoken field dialogue with instant confirmation | Accessible; primarily targeted at field | Transcribed and parsed via AI pipeline |
| | Quantity Reporting | Input physical quantities executed | Review quantity math vs. planned quantities | Quantity-derived progress arithmetic |
| **Blockers & Safety** | Constraint Reporting | Report operational blockers stopping progress | Analyze systemic blocker patterns across site | Tracked reasons for delay |
| | Safety Information | View shift briefings & work-area hazards | Oversee site safety trends & hazard reports | Work-relevant safety context |
| **Evidence** | Field Capture | Upload photos and field delivery slips | Full archive management and file review | Cryptographic integrity verification |
| | Traceability Access | Access evidence relevant to active tasks | Full bidirectional activity-to-evidence links | Deduplicated, project-scoped archive |
| | Bulk Document Jobs | None (excluded from role) | Ingest complex contractor sheets & PDFs | Asynchronous processing queue |
| **Activity Matching** | AI Candidate Scoring | Automated background execution | Automated background execution | Multi-layer similarity scoring |
| | Match Review Queue | None (excluded from role) | Authoritative review: confirm, reject, resolve | Only confirmed matches become canonical |
| **Progress & Truth** | Progress Normalization | Automated background execution | Automated background execution | Pure deterministic application logic |
| | Historical Trajectory | Operational task progress | Complete chronological observation timeline | Append-only observation history |
| **Analytics & Risk** | Progress Variance | Operational status indicators | Detailed variance metrics ($actual - planned$) | Deterministic calendar-day math |
| | Risk Classification | Actionable risk indicators (e.g., at-risk/delayed)| Full risk taxonomy & explainable reason codes | Deterministic risk precedence hierarchy |
| | Milestones | View immediate upcoming milestones | Comprehensive milestone monitoring & alerts | Zero-duration activity tracking |
| **User Interface** | Primary View | Dedicated Execution Cockpit | Primary Project Dashboard & Forensic Views | Tailored operational projections |
| **AI Assistant** | Inquiries & Voice | Operational queries (tasks, status, blockers) | Grounded management queries (health, risks) | Strictly grounded in verified facts |

---

## 16. Summary: The End-State North Star

When fully realized, the two-account model unites FieldLine into a balanced, coherent platform:

* **For the Field Worker:** FieldLine is an unobtrusive operational companion that fits naturally into the physical rhythm of site execution. It answers *"What are we doing today?"*, *"Is our work area safe?"*, and *"What is blocking us?"*, while capturing ground truth in seconds through voice, photo, or quick input with immediate verification.
* **For the Project Lead:** FieldLine is a high-fidelity control room. It validates master schedules, safeguards canonical progress through human review, computes variances and risks deterministically, maintains an immutable evidence trail, and provides grounded project intelligence for corrective decision-making.
* **For the Infrastructure Project:** FieldLine delivers on its foundational promise: establishing a single, verifiable bridge where planned project schedules and real-world execution finally align.
