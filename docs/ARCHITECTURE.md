# FieldLine Architecture — Pass 0 Foundation

## Overview

FieldLine is an intelligent data capture and schedule-linking platform designed for infrastructure project management (Smart India Hackathon 2026, **PS ID:** SIH26122).

The core design principle is:
> **Production-quality application logic, presentation-grade local infrastructure.**

FieldLine runs entirely locally on a developer/evaluator workstation without requiring cloud infrastructure, container daemons (Docker), or external database servers.

---

## Architectural Topology

```text
┌────────────────────────────────────────────────────────┐
│                   Local Web Browser                    │
└───────────────────────────┬────────────────────────────┘
                            │ (HTTP / React UI)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Frontend Shell (Vite + React)            │
│               Port 3000 (proxies /api to backend)      │
└───────────────────────────┬────────────────────────────┘
                            │ (JSON REST API)
                            ▼
┌────────────────────────────────────────────────────────┐
│               Express Monolith API Layer               │
│               Port 3001                                │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Routes     │  │  Validation  │  │  Middleware  │  │
│  │  /api/health │  │ (Zod Schemas)│  │ (CORS, Error)│  │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  │
│         │                                              │
│         ▼                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Services   │  │ Repositories │  │ AI Adapters  │  │
│  │  (Domain/App)│  │ (Data Access)│  │(Structured)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
└─────────┼─────────────────┼────────────────────────────┘
          │                 │
          ▼                 ▼
┌──────────────────┐ ┌───────────────────────────────────┐
│ Local Filesystem │ │       Local SQLite Database       │
│ uploads/evidence │ │       database/fieldline.db       │
└──────────────────┘ └───────────────────────────────────┘
```

---

## Modular Boundaries & Future Passes

- **`backend/src/routes/`**: Handles HTTP request parsing, status codes, and routing.
- **`backend/src/validation/`**: Defines runtime schemas using Zod for strict type checking and contract enforcement.
- **`backend/src/middleware/`**: Cross-cutting HTTP middleware (logging, error formatting, CORS).
- **`backend/src/services/`**: Pure application domain logic and workflow orchestration (Pass 2+).
- **`backend/src/repositories/`**: Direct SQLite persistence queries and transactions (Pass 2+).
- **`backend/src/ai/`**: External AI client adapters returning strictly typed schemas (Pass 3+).
- **`backend/src/jobs/`**: Local background/batch task workers (Pass 4+).
- **`database/`**: Deterministic SQLite storage with WAL mode enabled.
- **`uploads/`**: Local document and evidence storage.
- **`demo/`**: Deterministic sample datasets and reset scripts.

---

## Pass 0 Scope

Pass 0 establishes:
1. Complete TypeScript + Node.js toolchain.
2. Express backend server with health check endpoint (`/api/health`).
3. Local SQLite initialization and deterministic migration/table verification.
4. React + Vite frontend shell showing system status and API health.
5. Automated Vitest suite testing routes, environment parsing, and SQLite.
6. Setup and demo reset scripts (`scripts/setup.ts`, `scripts/demo-reset.ts`).
