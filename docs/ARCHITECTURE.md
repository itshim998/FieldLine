# FieldLine Architecture — Pass 1: Application Architecture

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
SQLite (Local Storage with WAL Mode)
```

**Key Invariants:**
- **Routes are thin**: They handle HTTP parsing, invoke services, validate outgoing contracts, and set status codes. Routes never embed SQL or domain calculations.
- **Services are decoupled**: Services receive typed DTOs and return pure domain/application models. Services never depend on Express `Request`/`Response` objects or write raw SQL.
- **Repositories encapsulate data access**: All direct SQLite queries, statements, and transactions reside strictly inside the repository layer.

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

## Component Boundaries & Directory Layout

```text
backend/
  src/
    config/           # Validated environment configuration (env.ts) and structured logger (logger.ts)
    routes/           # Thin Express route handlers delegating directly to services
    validation/       # Runtime Zod schemas for request and response contracts
    middleware/       # Centralized error handling, request logging, and Zod validation middleware
    services/         # Pure application domain logic and workflow orchestration
    repositories/     # Direct SQLite persistence and data access queries
    database/         # SQLite connection lifecycle, WAL mode pragmas, and base schema initialization
    errors/           # Application error hierarchy (AppError, NotFoundError, AIProviderError, etc.)
    ai/               # Decoupled AI provider interfaces, mock adapters, contracts, and AI services
      contracts/      # Zod schemas for AI completion and structured extraction contracts
      providers/      # Provider adapters (MockAIProvider, future Gemini/OpenAI adapters)
      services/       # AI service orchestrator enforcing Zod schema validation
    jobs/             # Local background/batch task workers (Pass 4+)
  tests/              # Vitest test suite enforcing behavioral contracts and architectural isolation
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

## Scope Realized in Pass 1

1. **Configuration Boundary**: Centralized `EnvConfig` with Zod validation.
2. **Repository Abstraction**: `SystemRepository` and `SqliteSystemRepository` isolating SQLite queries.
3. **Service Layer**: `HealthService` and `DefaultHealthService` isolating health aggregation from HTTP and SQL.
4. **Thin Route Layer**: `health.router.ts` delegating to `HealthService`.
5. **AI Architecture Skeleton**: `AIProvider` interface, `MockAIProvider`, `AIService`, and strict Zod validation of structured extraction contracts.
6. **Error Boundary**: `AppError` hierarchy and centralized `errorHandler` middleware.
7. **Architectural Verification**: Vitest test suite with 8 test files and 31 unit, integration, and architecture enforcement tests.
