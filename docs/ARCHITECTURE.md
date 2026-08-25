# FieldLine Architecture — Pass 2: SQLite & Persistence Foundation

## Overview

FieldLine is an intelligent data capture and schedule-linking platform designed for infrastructure project management (Smart India Hackathon 2026, **PS ID:** SIH26122).

The core design principle is:
> **Production-quality application logic, presentation-grade local infrastructure.**

FieldLine runs entirely locally on a developer/evaluator workstation without requiring cloud infrastructure, container daemons (Docker), or external database servers.

---

## Authoritative Architectural Pipelines

### 1. HTTP Request Execution Pipeline

```text
HTTP Route (Thin Controller)
    ↓
Validation (Zod Schema Middleware & Parsers)
    ↓
Service (Pure Application Orchestration & Business Logic)
    ↓
Repository (Persistence Abstraction & Data Access)
    ↓
SQLite (Local Storage with WAL Mode & Foreign Keys ON)
```

**Key Invariants:**
- **Routes are thin**: They handle HTTP parsing, invoke services, validate outgoing contracts, and set status codes. Routes never embed SQL or domain calculations.
- **Services are decoupled**: Services receive typed DTOs and return pure domain/application models. Services never depend on Express `Request`/`Response` objects, import SQLite drivers directly, or write raw SQL.
- **Repositories encapsulate data access**: All direct SQLite queries, statements, constraints handling, and transactions reside strictly inside the repository and database layers.

---

### 2. AI Structured Extraction Pipeline

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

## Persistence Architecture (Pass 2)

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

### 4. Indexing Strategy
- Foreign key lookup indexes: `idx_schedules_project_id`, `idx_activities_project_id`, `idx_activities_schedule_id`, `idx_evidence_project_id`, `idx_activity_matches_project_id`, `idx_activity_progress_project_activity`.
- Schedule activity lookups: `idx_activities_external_id`, `idx_activities_schedule_external`.
- Temporal & event queries: `idx_progress_updates_project_date`, `idx_project_events_project_created`, `idx_project_events_event_type`.

### 5. Transactions & Rollback
- Atomic execution is exposed via `runInTransaction(fn, dbProvider)`:
  - Automatically wraps callback within `db.transaction(fn)()`.
  - Commits all mutations if the function succeeds.
  - Automatically rolls back and leaves zero partial state if an error is thrown.

---

## Component Boundaries & Directory Layout

```text
backend/
  src/
    config/           # Validated environment configuration (env.ts) and structured logger (logger.ts)
    routes/           # Thin Express route handlers delegating directly to services
    validation/       # Runtime Zod schemas for request and response contracts
    middleware/       # Centralized error handling, request logging, and Zod validation middleware
    services/         # Pure application domain logic and workflow orchestration
    repositories/     # Direct SQLite persistence (ProjectRepository, SystemRepository)
    models/           # Strongly typed domain entity definitions and DTO contracts
    database/         # SQLite connection lifecycle, WAL pragmas, migrator, and migrations/
      migrations/     # Ordered migrations (0001_baseline_system_metadata.ts, 0002_core_domain_schema.ts, 0003_upgrade_metadata_for_pass2.ts)
      migrator.ts     # Schema migration runner with schema_migrations tracking
      db.ts           # initDatabase, getDatabase, runInTransaction, closeDatabase
      schema.ts       # Core tables list and schema constants
    errors/           # Application error hierarchy (AppError, NotFoundError, ConflictError, DatabaseError)
    ai/               # Decoupled AI provider interfaces, mock adapters, contracts, and AI services
      contracts/      # Zod schemas for AI completion and structured extraction contracts
      providers/      # Provider adapters (MockAIProvider, future Gemini/OpenAI adapters)
      services/       # AI service orchestrator enforcing Zod schema validation
    jobs/             # Local background/batch task workers (Pass 4+)
  tests/              # Vitest test suite enforcing behavioral contracts, persistence, and isolation
```

---

## Cross-Cutting Concerns

### Centralized Configuration
- All configuration values originate from environment variables parsed strictly through `backend/src/config/env.ts` using Zod.
- Direct `process.env` access across application services, repositories, and AI modules is prohibited.

### Structured Error Handling
- Errors are classified into operational `AppError` subclasses (`NotFoundError`, `ValidationError`, `ConflictError`, `AIProviderError`, `DatabaseError`).
- The centralized `errorHandler` middleware catches `ZodError`, `AppError`, and unexpected errors, outputting uniform JSON envelopes:
  ```json
  {
    "error": "Descriptive message",
    "statusCode": 400,
    "code": "ERROR_CODE",
    "details": {}
  }
  ```
- Database internal paths and SQL syntax details are never leaked to HTTP clients.

### Structured Local Logging
- `backend/src/config/logger.ts` provides a structured, lightweight logger (`debug`, `info`, `warn`, `error`) without requiring third-party cloud logging platforms.
- `requestLogger` logs method, URL, status code, and latency in milliseconds.

---

## Scope Realized Across Passes

1. **Pass 0 — Repository Bootstrap**: Node.js/TypeScript configuration, Express, Vite React shell, SQLite pragma setup, scripts.
2. **Pass 1 — Application Architecture**: Architectural boundary enforcement, thin routes, Zod validation middleware, decoupled services, AI abstraction layer, centralized `AppError` handling.
3. **Pass 2 — SQLite & Persistence Foundation**:
   - Migration engine (`schema_migrations` tracking, append-only chain `0001`, `0002`, `0003`).
   - 8 Core Domain Entities (`projects`, `schedules`, `activities`, `progress_updates`, `evidence`, `activity_matches`, `activity_progress`, `project_events`).
   - Cross-project referential integrity via composite foreign keys and consistency triggers.
   - Restored `ON DELETE SET NULL` on nullable references (`evidence.progress_update_id`, `activity_matches.evidence_id`, `activity_progress.progress_update_id`).
   - Domain check and unique constraints.
   - Relational and query indexing.
   - Transaction boundary (`runInTransaction`) with verified commit/rollback.
   - Repository layer (`ProjectRepository`, `SqliteProjectRepository`, `SystemRepository`).
   - Comprehensive Vitest persistence test suite (13 test suites, 65 passing tests).
