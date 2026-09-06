# FieldLine — Pass 27 Baseline Contract Freeze & Test Snapshot

> **Document Type:** Canonical Architectural Baseline & Contract Freeze  
> **Pass:** Pass 27 (Continuing from Pass 26 Release State)  
> **Date:** September 2026  
> **Status:** FROZEN & ACTIVE BASELINE  
> **North-Star Authority:** `long_term_plan.md` & `ChatGPT_plan.md`

---

## 1. Executive Summary & Freeze Objectives

Prior to introducing the two-account identity model (Pass 28) and server-side authorization middleware (Pass 29), this document captures and freezes the complete architectural baseline of FieldLine.

This guarantees:
1. **Zero Unintended Regressions:** Every existing unauthenticated API endpoint, response schema envelope, and parameter contract is explicitly documented and tested against the live server router.
2. **Deterministic Arithmetic Preservation:** Math, variance calculations, and risk taxonomies remain pure TypeScript domain logic and will not be disrupted by subsequent session handling.
3. **Canonical Truth Boundary Preservation:** The single-source-of-truth progress model (`activity_progress` and `progress_updates`) remains strictly protected.
4. **Client Storage Clarity:** Every usage of client-side browser storage is cataloged and prepared for migration to session tokens and role-based shell state.

---

## 2. Baseline System Metrics

As of Pass 27 freeze:
* **Automated Vitest Test Files:** 101 test files (102 including baseline freeze test)
* **Automated Vitest Test Cases:** 896 unit, integration, and E2E tests (100% pass rate)
* **Golden Demo Invariant Verifications:** 53 automated checks across database, schedule, risk engine, snapshot engine, intelligence, assistant, and physical evidence files
* **Database Migrations:** 7 migrations (`0001_baseline_system_metadata` through `0007_match_review_tiers`)
* **Core Pipelines:** 13-stage deterministic pipeline (Schedule Import $\rightarrow$ Field Evidence Ingestion $\rightarrow$ Normalization $\rightarrow$ Activity Matching $\rightarrow$ Confirmation $\rightarrow$ Canonical Progress Recalculation $\rightarrow$ Snapshot Generation $\rightarrow$ Variance Calculation $\rightarrow$ Risk Classification $\rightarrow$ Intelligence Synthesis $\rightarrow$ Grounded Assistant $\rightarrow$ Live Voice Gateway $\rightarrow$ Provenance Traceability)
* **Primary AI Routers:** Multi-slot resilient `GroqKeyRouter` (20 sequential slots with sticky-success failover) and `GeminiKeyRouter` with local fallback support

---

## 3. Client-Side Storage Audit

A comprehensive codebase audit reveals all usages of browser storage (`localStorage`):

| Storage Key | Location | Purpose | Pass 28/29 Migration Direction |
| :--- | :--- | :--- | :--- |
| `fieldline_selected_project_id` | `frontend/src/App.tsx` (lines 321, 618, 632, 753, 799, 813, 821, 1074) | Persists the active `project.id` across page refreshes so the UI automatically loads the previously selected project on bootstrap. | Will be augmented/replaced by session tokens containing `{ projectId, role, sessionId }` issued upon role authentication. |

### Observed Storage Lifecycles in `App.tsx`:
1. **Initial Bootstrap:** Reads `localStorage.getItem('fieldline_selected_project_id')`. If present, verifies project existence in loaded project list; if matched, sets `selectedProjectId`. If missing or invalid, clears key with `removeItem`.
2. **Project Selection:** When user selects a project or creates a new project, executes `localStorage.setItem('fieldline_selected_project_id', project.id)`.
3. **Project Deletion / Reset:** When the active project is deleted or the demo environment is reset, executes `localStorage.removeItem('fieldline_selected_project_id')`.

---

## 4. Canonical API Route & DTO Contract Catalog

The backend exposes all routes through the `/api` prefix mounted in `backend/src/app.ts`.

### 4.1 System Health & Diagnostics
* **`GET /api/health`**
  * **Description:** Health check for container orchestration and uptime monitors.
  * **Response (200 OK):**
    ```json
    {
      "status": "ok",
      "timestamp": "2026-09-06T14:30:00.000Z",
      "uptime": 124.5,
      "service": "FieldLine Backend",
      "database": "connected",
      "migrationsApplied": 7
    }
    ```

### 4.2 Error Envelopes (Standard AppError Format)
When an error occurs, the global error handler (`errorHandler.ts`) guarantees a consistent envelope:
```json
{
  "error": "Endpoint Not Found",
  "statusCode": 404,
  "code": "NOT_FOUND"
}
```
Validation errors return `code: "VALIDATION_ERROR"` with a `details` array containing Zod validation issues.

### 4.3 Project Management
* **`GET /api/projects`**
  * **Query Parameters:** `autoSeed?: 'true' | 'false'`
  * **Response (200 OK):** `{ "projects": [ ProjectDTO ] }`

* **`POST /api/projects`**
  * **Body:** `{ "code": string, "name": string, "description"?: string }`
  * **Response (201 Created):** `{ "project": ProjectDTO }`

* **`GET /api/projects/:projectId`**
  * **Response (200 OK):** `{ "project": ProjectDTO }`

* **`PATCH /api/projects/:projectId`**
  * **Body:** `{ "name"?: string, "description"?: string, "status"?: 'active' | 'archived' | 'completed' }`
  * **Response (200 OK):** `{ "project": ProjectDTO }`

* **`DELETE /api/projects/:projectId`**
  * **Response (200 OK):** `{ "success": true, "message": "Project deleted successfully" }`

### 4.4 Schedule Governance & Activities
* **`POST /api/projects/:projectId/schedules/import`**
  * **Multipart Form:** `file: CSV | XLSX`
  * **Response (201 Created):**
    ```json
    {
      "schedule": ScheduleDTO,
      "activitiesCount": 30,
      "rowCount": 30,
      "sourceType": "csv" | "xlsx",
      "originalFilename": string
    }
    ```

* **`GET /api/projects/:projectId/schedules`**
  * **Response (200 OK):** `{ "schedules": ScheduleDTO[] }`

* **`GET /api/projects/:projectId/schedules/:scheduleId`**
  * **Response (200 OK):** `{ "schedule": ScheduleDTO }`

* **`GET /api/projects/:projectId/schedules/:scheduleId/activities`**
  * **Response (200 OK):** `{ "activities": ActivityDTO[] }`

* **`GET /api/projects/:projectId/activities/:activityId`**
  * **Query Parameters:** `asOfDate?: string`
  * **Response (200 OK):** Complete read-only `ActivityDetailDTO` (activity, schedule, progress, risk, evidence links).

### 4.5 Field Progress Updates
* **`POST /api/projects/:projectId/progress-updates`**
  * **Body:**
    ```json
    {
      "reportDate": "2026-08-28",
      "rawText": "Poured 120 m3 of concrete on Pier 2 foundations.",
      "reporterName": "Site Supervisor",
      "reporterRole": "Concrete Lead"
    }
    ```
  * **Response (201 Created):** `{ "progressUpdate": ProgressUpdateDTO }`

* **`GET /api/projects/:projectId/progress-updates`**
  * **Response (200 OK):** `{ "progressUpdates": ProgressUpdateDTO[] }`

* **`GET /api/projects/:projectId/progress-updates/:updateId`**
  * **Response (200 OK):** `{ "progressUpdate": ProgressUpdateDTO }`

### 4.6 AI Extraction
* **`POST /api/ai/field-progress/extract`**
  * **Body:** `{ "rawText": string }`
  * **Response (200 OK):** `{ "extraction": FieldProgressExtractionDTO }`

### 4.7 Activity Matching & Review
* **`POST /api/projects/:projectId/progress-updates/:updateId/matches`**
  * **Body:** `{ "extraction": FieldProgressExtractionDTO }`
  * **Response (200 OK):** `{ "matches": ActivityMatchDTO[] }`

* **`GET /api/projects/:projectId/progress-updates/:updateId/matches`**
  * **Response (200 OK):** `{ "matches": ActivityMatchDTO[] }`

* **`POST /api/projects/:projectId/matches/:matchId/confirm`**
  * **Body:** `{ "reviewedBy": string, "notes"?: string }`
  * **Response (200 OK):** `{ "match": ActivityMatchDTO }`

* **`POST /api/projects/:projectId/matches/:matchId/reject`**
  * **Body:** `{ "reviewedBy": string, "reason": string }`
  * **Response (200 OK):** `{ "match": ActivityMatchDTO }`

* **`POST /api/projects/:projectId/matches/:matchId/resolve`**
  * **Body:** `{ "reviewedBy": string, "targetActivityId": string, "notes"?: string }`
  * **Response (200 OK):** `{ "match": ActivityMatchDTO }`

### 4.8 Canonical Progress
* **`POST /api/projects/:projectId/progress-updates/:updateId/progress`**
  * **Body:** `{ "matchId": string, "fact": FactDTO, "actualQuantity"?: number, "quantityUnit"?: string, "asOfDate"?: string, "allowSuggested"?: boolean }`
  * **Response (200 OK):** `{ "progress": ActivityProgressDTO }`

* **`GET /api/projects/:projectId/activities/:activityId/progress`**
  * **Response (200 OK):** `{ "progress": ActivityProgressDTO[] }`

* **`GET /api/projects/:projectId/activities/:activityId/progress/latest`**
  * **Response (200 OK):** `{ "progress": ActivityProgressDTO }`

### 4.9 Progress Snapshots
* **`GET /api/projects/:projectId/progress-snapshot`**
  * **Query Parameters:** `asOfDate?: string`
  * **Response (200 OK):** SnapshotDTO (planned vs actual progress as of snapshot date).

### 4.10 Risk Classification Engine
* **`GET /api/projects/:projectId/risk-status`**
  * **Query Parameters:** `asOfDate?: string`
  * **Response (200 OK):**
    ```json
    {
      "projectId": "uuid-v4",
      "asOfDate": "2026-08-28",
      "delayedCount": 4,
      "atRiskCount": 4,
      "onTrackCount": 14,
      "aheadCount": 4,
      "completedCount": 4,
      "activities": [ ... ]
    }
    ```

### 4.11 Evidence Vault & File Storage
* **`POST /api/projects/:projectId/evidence`**
  * **Multipart Form:** `file`, `title`, `sourceType`, `capturedAt`
  * **Response (201 Created):** `{ "evidence": EvidenceDTO }`

* **`GET /api/projects/:projectId/evidence`**
  * **Response (200 OK):** `{ "evidence": EvidenceDTO[] }`

* **`GET /api/projects/:projectId/evidence/:evidenceId`**
  * **Response (200 OK):** `{ "evidence": EvidenceDTO }`

* **`GET /api/projects/:projectId/evidence/:evidenceId/file`**
  * **Response (200 OK):** Binary stream with appropriate Content-Type.

* **`GET /api/projects/:projectId/evidence/by-hash/:contentHash`**
  * **Response (200 OK):** `{ "evidence": EvidenceDTO }`

* **`GET /api/projects/:projectId/evidence/check-duplicate`**
  * **Query Parameters:** `contentHash: string`
  * **Response (200 OK):** `{ "isDuplicate": boolean, "existingEvidence"?: EvidenceDTO }`

* **`DELETE /api/projects/:projectId/evidence/:evidenceId`**
  * **Response (200 OK):** `{ "success": true }`

* **`POST /api/projects/:projectId/evidence/:evidenceId/reprocess`**
  * **Response (202 Accepted):** `{ "job": JobDTO }`

### 4.12 Asynchronous Processing Jobs
* **`GET /api/projects/:projectId/jobs`**
  * **Query Parameters:** `type?: 'document_ingestion'`
  * **Response (200 OK):** `{ "jobs": JobDTO[] }`

* **`GET /api/projects/:projectId/jobs/:jobId`**
  * **Response (200 OK):** `{ "job": JobDTO }`

### 4.13 Project Intelligence
* **`GET /api/projects/:projectId/intelligence`**
  * **Query Parameters:** `asOfDate?: string, recentDays?: number, approachingDays?: number, limit?: number`
  * **Response (200 OK):**
    ```json
    {
      "projectId": "uuid-v4",
      "asOfDate": "2026-08-28",
      "delayedActivities": [ ... ],
      "atRiskActivities": [ ... ],
      "approachingMilestones": [ ... ],
      "varianceSummary": { ... },
      "executiveBrief": string
    }
    ```

### 4.14 Grounded Assistant Query Engine
* **`POST /api/projects/:projectId/assistant/query`**
  * **Body:** `{ "question": string, "asOfDate"?: string }`
  * **Response (200 OK):**
    ```json
    {
      "question": string,
      "answer": string,
      "grounded": boolean,
      "confidence": number,
      "claims": string[],
      "referencedActivities": string[]
    }
    ```

### 4.15 Primary Project Dashboard
* **`GET /api/projects/:projectId/dashboard`**
  * **Query Parameters:** `asOfDate?: string, recentLimit?: number, recentDays?: number, approachingDays?: number`
  * **Response (200 OK):**
    ```json
    {
      "project": ProjectDTO,
      "summary": {
        "totalActivities": 30,
        "completed": 4,
        "delayed": 4,
        "atRisk": 4,
        "onTrack": 18
      },
      "recentEvidence": EvidenceDTO[],
      "recentUpdates": ProgressUpdateDTO[],
      "pendingMatchesCount": number,
      "criticalPathAlerts": AlertDTO[]
    }
    ```

### 4.16 Demo Management
* **`GET /api/demo/status`**
  * **Response (200 OK):** `{ "isSeeded": boolean, "project"?: ProjectDTO, "activityCount": number }`

* **`POST /api/demo/seed`**
  * **Response (200 OK):** `{ "status": "seeded", "project": ProjectDTO, "activitiesCount": 30, "evidenceCount": 6 }`

* **`POST /api/demo/reset`**
  * **Response (200 OK):** `{ "status": "reset", "message": "Demo reset and re-seeded successfully" }`

### 4.17 Live Session WebSocket
* **`GET /ws/live-session` (WebSocket Upgrade)**
  * **Query Parameters:** `projectId: string`
  * **Supported Client Messages:** `session_start`, `audio_chunk`, `text_prompt`, `tool_response`
  * **Supported Server Messages:** `session_started`, `audio_chunk`, `text_chunk`, `tool_call`, `error`

---

## 5. Pre-Existing Architectural Debt & Boundaries for Passes 28–36

1. **Unauthenticated Project Routes:**
   * Currently, any client knowing a `projectId` can query or update progress.
   * *Pass 28/29 Migration:* Introduce project account credentials and bearer session tokens (`x-fieldline-token` or `Authorization: Bearer <token>`), preserving human attribution metadata (`reporterName`, `reporterRole`, `reviewedBy`).
2. **Project Context in Browser Storage:**
   * Only `fieldline_selected_project_id` exists in `localStorage`.
   * *Pass 30 Migration:* Maintain authenticated session persistence per project/role in browser storage without exposing plaintext credentials.
3. **Live Gateway Tool Partitioning:**
   * Currently, `live-tool-handlers.ts` registers all 4 tools (`query_project_status`, `lookup_activity_details`, `search_field_evidence`, `log_field_observation`) globally for any caller.
   * *Pass 34 Migration:* Partition tool exposure according to authenticated session role (Worker: operational lookup & quick capture; Admin: full schedule governance and variance review).
4. **Pure TypeScript Determinism:**
   * All risk classifications, milestone proximity evaluations, and snapshot calculations are deterministic pure TypeScript functions. This determinism must remain strictly insulated from LLM outputs.

---

## 6. Baseline Attestation

This baseline has been verified through:
* `npm run verify:release`: 100% PASS (Production build, 101 test files, 896 tests, golden demo reset, 53 invariants).
* Machine-checkable test runner: `vitest run backend/tests/baseline_contract_freeze.test.ts`.
* Dedicated verification orchestrator: `npm run verify:baseline`.
