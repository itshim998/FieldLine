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
Local Browser (Port 3000)
       ↓
Local Frontend (Vite + React)
       ↓
Local Node/Express Backend (Port 3001)
       ↓
Local Domain Services & Zod Validation
       ↓
Local SQLite (database/fieldline.db)
       ↓
Local Filesystem (uploads/)
```

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
    "schema_version": "0.1.0",
    "app_name": "FieldLine",
    "sih_ps_id": "SIH26122",
    "pass": "Pass 0: Repository Bootstrap"
  }
}
```

---

## 📊 Current Implementation Status

- [x] **Pass 0: Repository Bootstrap (Completed)**
  - Monorepo package structure with TypeScript strict mode
  - Express backend with structured logging, CORS, error handling
  - SQLite persistence layer with WAL mode
  - React + Vite frontend shell with live status indicators and dark aesthetic
  - Zod runtime schema validation
  - Vitest test suite for API routes, database, and configuration
  - Deterministic `npm run setup` and `npm run demo:reset` scripts
- [ ] **Pass 1: Golden Demo Dataset & Seed System** *(Upcoming)*
- [ ] **Pass 2: Core Domain Schema & Project / Schedule Import Engine** *(Upcoming)*
- [ ] **Pass 3: AI Document Ingestion & Activity Matching Layer** *(Upcoming)*
- [ ] **Pass 4: Actual Progress Calculation & Variance Engine** *(Upcoming)*
- [ ] **Pass 5: Risk Assessment & Assistant Interface** *(Upcoming)*
- [ ] **Pass 6: Executive Dashboard & Demo Polish** *(Upcoming)*

---

## 🔒 Security & Local Data Policy

FieldLine stores all data locally in `database/fieldline.db` and files in `uploads/`. No sensitive data or API keys are committed to Git. All runtime data is ignored via `.gitignore`.
