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

### 3. AI Structured Extraction Pipeline

```text
AI Service (Orchestration & Workflow Coordination)
    ↓
AI Adapter / Provider (External API or Local Mock)
    ↓
Raw Structured Response (Untrusted Provider Output)
    ↓
Validation (Strict Zod Schema Enforcement)
    ↓
Service (Consumes Validated & Typed Contract)
```

> [!IMPORTANT]
> **AI Isolation Principle: AI code must not directly manipulate the database.**
> The AI layer must never query SQLite, import repository modules, or write directly to the database. AI is strictly used for extraction, summarization, and structured interpretation. Application services decide truth, validation, and persistence.

---

## Persistence Architecture

```text
Service Layer (Domain Orchestration)
    ↓
Repository Interfaces (ProjectRepository, SystemRepository)
    ↓
SQLite Repositories (SqliteProjectRepository, SqliteSystemRepository)
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

## Component Boundaries & Directory Layout

```text
backend/
  src/
    config/           # Validated environment configuration (env.ts) and structured logger (logger.ts)
    routes/           # Thin Express route handlers (health.router.ts, project.router.ts)
    validation/       # Runtime Zod schemas for request/response contracts (health.schema.ts, project.schema.ts)
    middleware/       # Centralized error handling, request logging, and Zod validation middleware
    services/         # Pure application domain logic (health.service.ts, project.service.ts)
    repositories/     # Direct SQLite persistence (ProjectRepository, SystemRepository)
    models/           # Strongly typed domain entity definitions and DTO contracts
    database/         # SQLite connection lifecycle, WAL pragmas, migrator, and migrations/
      migrations/     # Ordered migrations (0001, 0002, 0003, 0004)
      migrator.ts     # Schema migration runner with schema_migrations tracking
      db.ts           # initDatabase, getDatabase, runInTransaction, closeDatabase
      schema.ts       # Core tables list and schema constants
    errors/           # Application error hierarchy (AppError, NotFoundError, ConflictError, DatabaseError)
    ai/               # Decoupled AI provider interfaces, mock adapters, contracts, and AI services
    jobs/             # Local background/batch task workers (Pass 4+)
  tests/              # Vitest test suite enforcing contracts, persistence, and isolation (15 suites, 90 tests)
frontend/
  src/
    App.tsx           # FieldLine Project Management UI & Workspace Shell
    index.css         # Visual design system tokens, cards, modals, and responsive layout
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
   - Project lifecycle UI: Empty state, project list/card selector with search filter, active project workspace, metadata overview, and sub-navigation with future pass indicators.
   - Active project context persistence in `localStorage` across page reloads with graceful missing project fallback.
   - Edit metadata modal and safe destructive delete confirmation modal.
5. **Pass 4 — Schedule Importer**:
   - Multi-format schedule import pipeline supporting `.csv` and `.xlsx` files.
   - Format-agnostic parser architecture (`ScheduleParser`, `CsvScheduleParser`, `XlsxScheduleParser`, `getScheduleParser`).
   - Header aliasing engine recognizing standard industry variants (Activity ID, Task Name, Start/Finish Dates, WBS, Location, Planned Quantity, Unit).
   - Atomic persistence via `ScheduleRepository.createWithActivities`: creates schedule, batch inserts activities, logs `schedule_imported` project event, and executes in single SQLite transaction with complete rollback on error.
   - Intra-file duplicate activity ID detection and structural integrity checks.
   - Schedule REST API (`POST /api/projects/:projectId/schedules/import`, `GET /api/projects/:projectId/schedules`, `GET /api/projects/:projectId/schedules/:scheduleId`, `GET /api/projects/:projectId/schedules/:scheduleId/activities`).
   - Frontend Schedule Importer and Activity Verification Table with drag-and-drop file upload, upload state indicators, import summary metrics, schedule selector pills, and responsive data grid.
   - 21 Vitest test suites (131 tests passing).
