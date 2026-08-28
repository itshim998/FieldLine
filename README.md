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
| `npm test` | Runs the automated Vitest test suite across API endpoints, Zod validation, and SQLite. |
| `npm run build` | Compiles TypeScript backend to `dist/backend` and builds Vite frontend to `dist/frontend`. |
| `npm run setup` | Prepares a fresh checkout by validating configuration, creating directories, and initializing SQLite. |
| `npm run demo:reset` | Resets local SQLite database and uploads storage to a clean pristine state. |

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
  "timestamp": "2026-08-25T11:00:00.000Z",
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
    "pass": "Pass 2: SQLite and Persistence Foundation"
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
- [ ] **PASS 21 — Activity Detail View**
- [ ] **PASS 22 — Voice Input**
- [ ] **PASS 23 — Test and Evaluation Suite**
- [ ] **PASS 24 — Golden Demo Environment**
- [ ] **PASS 25 — Final Integration and Presentation Polish**

---

## 🔒 Security & Local Data Policy

FieldLine stores all data locally in `database/fieldline.db` and files in `uploads/`. No sensitive data or API keys are committed to Git. All runtime data is ignored via `.gitignore`.
