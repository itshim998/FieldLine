# FieldLine

> **Smart India Hackathon 2026** &bull; **PS ID:** SIH26122  
> **Title:** Intelligent Data Capture & Schedule-Linking Layer for Infrastructure Project Management: Real-Time Actual Progress Tracking (Planning-to-Execution Bridge)

---

## 📌 About FieldLine

**FieldLine** is an intelligent data capture and schedule-linking layer designed to bridge the gap between high-level infrastructure project schedules (Primavera P6, MS Project, Excel) and ground-truth execution updates (daily progress reports, site photos, inspection logs, quantities executed).

FieldLine is designed as a **local-only modular monolith** for the Smart India Hackathon presentation environment. It embodies the engineering philosophy:

> **"Production-quality application logic, presentation-grade local infrastructure."**

It requires **no cloud dependencies, no Docker containers, and no external database servers**—everything runs deterministically on a local machine.

---

## 🏗️ Architecture

```text
HTTP Route (Thin Controller)
    ↓
Validation (Zod Schemas)
    ↓
Service (Application Orchestration)
    ↓
Repository (Persistence Layer)
    ↓
SQLite (Local database/fieldline.db)
```

### Project Intelligence & FieldLine Assistant Layer (Pass 17 & 18)

```text
Raw project state (Schedules, Activities, ActivityProgress, ProjectEvents)
    ↓
Deterministic Snapshot & Risk Classification Engines (Pass 11 & 12)
    ↓
Project Intelligence Query Layer (Pass 17: GET /api/projects/:projectId/intelligence)
    ↓
Structured Deterministic Facts (Delayed, At Risk, Completed, Behind, Milestones, Stale, Events)
    ↓
FieldLine Assistant Engine (Pass 18: POST /api/projects/:projectId/assistant/query)
    ↓
Grounded Manager Answer + Verified Fact References
```

### Activity Matching & Human Review Workflow (Pass 19)

```text
Candidate Match Generation (Pass 10)
    ↓
Deterministic Confidence Classification (Pass 19: High ≥ 0.90, Medium ≥ 0.60, Low < 0.60)
    ↓
┌──────────────────────────────────────┬────────────────────────────────────────┐
│ High Unambiguous (Separation ≥ 0.15) │ Ambiguous / Medium / Low Confidence   │
├──────────────────────────────────────┼────────────────────────────────────────┤
│ Status: 'confirmed'                  │ Status: 'suggested'                   │
│ Review State: 'resolved'             │ Review State: 'awaiting_review' /      │
│ Reviewed By: 'system'                │               'unresolved'             │
│ Audit: 'match_auto_confirmed'        │ Audit: 'match_suggested'              │
└──────────────────┬───────────────────┴───────────────────┬────────────────────┘
                   │                                       │
                   │                                       ▼
                   │                           Human Review Action
                   │                     ┌─────────────────┼──────────────────┐
                   │                     ▼                 ▼                  ▼
                   │                  /confirm          /reject            /resolve
                   │                     │                 │                  │
                   │                     ▼                 ▼                  ▼
                   │             Status: confirmed  Status: rejected  Status: confirmed
                   │             State: resolved    State: resolved   Method: manual
                   │                     │                                    │
                   └─────────────────────┼────────────────────────────────────┘
                                         ▼
                 Canonical Progress Truth (ProgressService)
                 > Non-negotiable: Only CONFIRMED matches produce canonical ActivityProgress.
### Primary Project Dashboard Layer (Pass 20)

```text
GET /api/projects/:projectId/dashboard (Thin Aggregator Controller)
    ↓
ProjectDashboardService (Deterministic Read-Only Composition)
    ├── Project Health          → ProgressSnapshotService + RiskClassificationService
    ├── Activity Status Breakdown → ProgressSnapshotService + RiskClassificationService
    ├── Items Requiring Attention → ProjectIntelligenceService + ActivityMatchRepository (Unresolved)
    ├── Key Milestones            → Schedule Repository (zero-duration activities: plannedStart === plannedFinish)
    └── Recent Updates Feed       → ProgressUpdateRepository + ActivityProgress + Evidence
    ↓
Single Typed Response DTO (ProjectDashboard)
    ↓
React Frontend Dashboard Components (<ProjectHealth />, <ActivityStatusSummary />, <AttentionSummary />, <MilestoneSummary />, <RecentUpdates />)
### Activity Detail View Layer (Pass 21)

```text
GET /api/projects/:projectId/activities/:activityId?asOfDate=YYYY-MM-DD
    ↓
ActivityDetailService (Deterministic Read-Only Composition)
    ├── Activity Identity   → ActivityRepository (strictly project-scoped)
    ├── Current State       → ProgressSnapshotService + RiskClassificationService (canonical evaluation as of D)
    ├── Timeline            → ActivityProgressRepository (bounded by obs.asOfDate <= D, sorted chronologically)
    ├── Progress Reports    → Batch lookup ProgressUpdateRepository via unique update IDs
    ├── Match & Review      → ActivityMatchRepository (confirmed = canonical eligible, suggested/rejected = non-canonical)
    └── Originating Evidence → EvidenceRepository (deduplicated, sanitized: zero server file paths exposed)
    ↓
Single Typed Response DTO (ActivityDetail)
    ↓
React Frontend Activity Components (<ActivityHeader />, <ActivityCurrentState />, <ActivityTimeline />, <ActivityProgressSources />, <ActivityReviewContext />, <ActivityEvidence />)
```

> **Fundamental Principle:** The Activity Detail View is a read-only composition layer providing a single pane of glass into the complete, trustworthy execution history of every schedule activity without duplicating domain logic or creating new truth engines.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full architectural details and layer boundaries.

---

## 📋 Prerequisites

- **Node.js**: `v20.x` or `v22.x` (tested on Node v22.19.0)
- **npm**: `v10.x` or higher
- **Operating System**: Windows, macOS, or Linux

---

## 🚀 Quick Start & Setup

### 1. Clone the repository
```bash
git clone https://github.com/itshim998/FieldLine.git
cd FieldLine
```

### 2. Install dependencies
```bash
npm install
```

### 3. Initialize the environment
```bash
npm run setup
```
This command:
- Creates `.env` from `.env.example` if not present.
- Validates the environment schema using Zod.
- Ensures required directories (`database/`, `uploads/`, `demo/`, `dist/`) exist.
- Initializes the local SQLite database (`database/fieldline.db`) with base system metadata.

---

## 💻 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts backend (port 3001) and frontend (port 3000) concurrently in development watch mode. |
| `npm test` | Runs the automated Vitest test suite across API endpoints, Zod validation, SQLite, and evaluation benchmarks. |
| `npm run build` | Compiles TypeScript backend to `dist/backend` and builds Vite frontend to `dist/frontend`. |
| `npm run setup` | Prepares a fresh checkout by validating configuration, creating directories, and initializing SQLite. |
| `npm run demo:reset` | Resets runtime database and uploads, seeds the complete flagship SIH Golden Demo project (`Refinery Expansion — Unit 4`), and runs automated invariant verification. |
| `npm run demo:verify` | Executes machine-checkable invariant verification against the live SQLite golden project (risk distribution, intelligence facts, grounded assistant queries, evidence storage). |

---

## 🏆 Smart India Hackathon 2026 Golden Demo Environment (Pass 24)

FieldLine provides a 100% deterministic, offline-ready presentation environment tailored for the Smart India Hackathon demonstration.

### Instant Reproduction Pipeline:
```bash
npm install
npm run setup
npm run demo:reset
npm run demo:verify
npm run dev
```

### Golden Project: `Refinery Expansion — Unit 4` (`REFINERY-U4`)
- **30 Realistic EPC Activities** across 6 work areas:
  - **Area A — Civil / Earthworks** (Site Clearing, Rough Grading, Stormwater Basin, Perimeter Road, Civil Acceptance Milestone)
  - **Area B — Foundation** (North Tank Excavation, Crude Pump Piling, Substation Foundation, Compressor Piers, Piling Inspection Milestone)
  - **Area C — Structural** (Pipe Rack PR-07, Main Pipe Bridge, Compressor Shelter, Substation Cable Support, Structural Completion Milestone)
  - **Area D — Piping** (Cooling Water Header, Process Pipe Rack Spooling, HP Steam Tie-in, Crude Feedstock Flanges, Flare Header Welding)
  - **Area E — Electrical / Instrumentation** (Substation Civil/Trenching, MCC Cable Trays, HV Feeder Pulling, Instrument Air Tubing, Marshalling Cabinets)
  - **Area F — Commissioning & Utilities** (Cooling Water Flush & Hydrotest, Hydrotest Package A, ESD Loop Verification, Instrument Air Leak Test, RFSU Milestone)

### Dynamic Dashboard State (as of `2026-08-28`):
- **Delayed / Overdue (4):** `ACT-A02` (Site Rough Grading), `ACT-B02` (Crude Pump Piling), `ACT-D02` (Process Rack Spooling), `ACT-F01` (Cooling Water Header Test)
- **At Risk (4):** `ACT-A03` (Stormwater Basin), `ACT-B03` (Substation Foundation), `ACT-C01` (Pipe Rack PR-07), `ACT-D03` (HP Steam Header)
- **Completed (4):** `ACT-A01`, `ACT-B01`, `ACT-D01`, `ACT-E01`
- **On Track / Ahead (18):** Active construction packages + 4 approaching zero-duration milestones (`ACT-A05`, `ACT-B05`, `ACT-C05`, `ACT-F05`)

### Messy Language & Human Review Scenarios:
- **Heterogeneous Phrasing:** Heterogeneous field descriptions (e.g. *"Piling works at crude pump bay reached 38%"*, *"Pump foundation piles completed to 65%"*, *"Excavation at North Tank completed 100%"*) accurately mapped to canonical schedule activities.
- **Review Policy Demonstrations:** Contains **Auto-confirmed** high confidence matches, **Suggested** medium confidence matches awaiting review, **Rejected** out-of-scope candidate matches, and **Manually resolved** ambiguous candidates.

### Sample Grounded Assistant Queries:
The FieldLine Assistant answers queries strictly grounded in the live seeded project state:
- *"What is delayed?"* &rarr; Identifies the 4 overdue activities with exact variance percentages.
- *"Which activities are at risk?"* &rarr; Highlights activities with strong negative variance near completion.
- *"Which milestones are approaching?"* &rarr; Lists upcoming zero-duration milestones within 14 days.
- *"Tell me about the crude pump foundation"* &rarr; Reports complete timeline from 20% to 65% progress.

---

## 🩺 Verifying Backend Health

When running in development or production mode, the health check endpoint is available at:

```http
GET http://localhost:3001/api/health
```

Example response:
```json
{
  "status": "ok",
  "service": "FieldLine Backend",
  "version": "0.1.0",
  "timestamp": "2026-08-28T12:00:00.000Z",
  "uptime": 12.34,
  "environment": "development",
  "database": {
    "status": "connected",
    "type": "sqlite",
    "path": "./database/fieldline.db"
  },
  "metadata": {
    "schema_version": "0.2.0",
    "app_name": "FieldLine",
    "sih_ps_id": "SIH26122",
    "pass": "Pass 24: Golden Demo Environment"
  }
}
```

---

## 📊 Master Implementation Plan

- [x] **PASS 0 — Repository Bootstrap** *(Completed)*
- [x] **PASS 1 — Application Architecture** *(Completed)*
- [x] **PASS 2 — SQLite and Persistence Foundation** *(Completed)*
- [x] **PASS 3 — Project Management** *(Completed)*
- [x] **PASS 4 — Schedule Importer** *(Completed)*
- [x] **PASS 5 — Schedule Normalization** *(Completed)*
- [x] **PASS 6 — Schedule Validation** *(Completed)*
- [x] **PASS 7 — Manual Progress Reporting** *(Completed)*
- [x] **PASS 8 — AI Extraction Layer** *(Completed)*
- [x] **PASS 9 — Activity Matching Engine** *(Completed)*
- [x] **PASS 10 — Progress Normalization** *(Completed)*
- [x] **PASS 11 — Planned vs Actual Engine** *(Completed)*
- [x] **PASS 12 — Delay and Risk Engine** *(Completed)*
- [x] **PASS 13 — Evidence System** *(Completed)*
- [x] **PASS 14 — Document Ingestion** *(Completed)*
- [x] **PASS 15 — In-process Processing Jobs** *(Completed)*
- [x] **PASS 16 — Failure Isolation and Idempotency** *(Completed)*
- [x] **PASS 17 — Project Intelligence Queries** *(Completed)*
- [x] **PASS 18 — FieldLine Assistant** *(Completed)*
- [x] **PASS 19 — Human Review Workflow** *(Completed)*
- [x] **PASS 20 — Dashboard** *(Completed)*
- [x] **PASS 21 — Activity Detail View** *(Completed)*
- [ ] **PASS 22 — Voice Input**
- [x] **PASS 23 — Test and Evaluation Suite** *(Completed)*
- [x] **PASS 24 — Golden Demo Environment** *(Completed)*
- [ ] **PASS 25 — Final Integration and Presentation Polish**

---

## 🔒 Security & Local Data Policy

FieldLine stores all data locally in `database/fieldline.db` and files in `uploads/`. No sensitive data or API keys are committed to Git. All runtime data is ignored via `.gitignore`.

