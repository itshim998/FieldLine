# FieldLine — Smart India Hackathon 2026 Golden Demo Guide

**Problem Statement ID:** `SIH26122`  
**Application:** FieldLine — Intelligent Data Capture & Schedule-Linking Layer for Infrastructure Project Management  
**Canonical Baseline:** Pass 25 (Release Hardening & Final Integration)

---

## 1. Demo Purpose & Core Value Proposition

Infrastructure projects (refineries, metros, highways, power plants) suffer from massive schedule and cost overruns because progress reports from the field (daily shift logs, subcontractor memos, PDF tickets, inspection photos) are disconnected from master project schedules (Primavera P6, MS Project).

**FieldLine solves this by delivering:**
1. **Intelligent Ingestion & Extraction**: Automatically parsing unstructured site reports, Excel logs, and PDFs into structured observations.
2. **Deterministic Activity Matching & Human Review**: Scoring candidate matches with strict human-in-the-loop confirmation before anything touches project truth.
3. **Canonical Progress & Variance Engine**: Mathematically computing planned vs. actual progress, delays, and critical risks from verified evidence.
4. **Grounded AI Assistant**: Answering executive questions strictly from verified project intelligence facts with cited provenance and zero hallucinations.

---

## 2. Golden Demo Environment

The Golden Demo environment provides a deterministic, machine-verifiable EPC dataset representing a real-world refining expansion package.

| Property | Value | Description |
| :--- | :--- | :--- |
| **Project Name** | `Refinery Expansion — Unit 4` | Downstream EPC Refining Expansion Package |
| **Project Code** | `REFINERY-U4` | Canonical Project Identifier |
| **Activities** | **30 Activities** | Distributed across 6 EPC Work Areas (Civil, Foundation, Structural, Piping, Electrical, Commissioning) |
| **Snapshot Date** | `2026-09-13` | As-of Reference Date |
| **Delayed Activities** | **1 Activity** | `ACT-D02` |
| **At-Risk Activities** | **2 Activities** | `ACT-B02`, `ACT-C01` |
| **Completed Activities** | **4 Activities** | `ACT-A01`, `ACT-B01`, `ACT-D01`, `ACT-E01` |
| **On-Track / Ahead** | **23 Activities** | Pacing on or ahead of planned baseline schedule (18 on-track, 5 ahead) |
| **Approaching Milestones**| **2 Milestones** | Zero-duration milestones due within 14 days (`ACT-A05`, `ACT-B05`) |
| **Physical Evidence** | **6 Files** | Real multi-format evidence fixtures on disk (`.txt`, `.csv`) |

---

## 3. Quick Start & Setup Commands

To run FieldLine from a clean workstation:

```bash
# 1. Install dependencies
npm install

# 2. Initialize local environment (creates .env and database directory)
npm run setup

# 3. Reset and seed deterministic Golden Demo environment
npm run demo:reset

# 4. Verify all 61 machine-checkable invariants
npm run demo:verify

# 5. Launch the application (Backend: port 3001, Frontend: port 3000)
npm run dev
```

> [!NOTE]
> On startup, opening `http://localhost:3000` automatically opens into the Golden Demo project (`Refinery Expansion — Unit 4`).

---

## 4. Master Release Verification

To run the complete automated release verification suite in one command:

```bash
npm run verify:release
```

This orchestrates:
1. **Production Build** (`npm run build`) — Compiles TypeScript backend and builds Vite frontend bundle.
2. **Full Regression Suite** (`npm test`) — Executes full test suite.
3. **Demo Reset** (`npm run demo:reset`) — Wipes runtime SQLite database & uploads, re-applies migrations, and seeds the golden dataset.
4. **Demo Verification** (`npm run demo:verify`) — Verifies all 61 invariant checks across risk status, intelligence queries, assistant grounding, and physical evidence files.

---

## 5. Recommended 5-Minute SIH Presentation Walkthrough

### Step 1: Primary Operational Dashboard (1 min)
1. Navigate to **Overview** tab (default).
2. **Highlight Overall Health**:
   - **Actual Progress**: `45.8%` vs **Planned Progress**: `49.8%` (`-4.0 pts` variance, state `BEHIND`).
   - Deterministic risk classification: `DELAYED`.
3. **Scannable Execution Breakdown**:
   - 1 Delayed, 2 At-Risk, 4 Completed, 23 On-Track/Ahead.
4. **Attention Items**:
   - Point out delayed activity `ACT-D02` (Pipe Spool Fabrication & Welding) and at-risk activities `ACT-B02` (Crude Pump Foundation Piling Works) and `ACT-C01` (PR-07 Pipe Rack Structural Steel Erection).
   - Point out unresolved AI match candidate awaiting review.
5. **Key Milestones**:
   - Point out 2 approaching zero-duration milestones (`ACT-A05`, `ACT-B05`).

---

### Step 2: Activity Detail Deep-Dive (1.5 min)
1. On the dashboard, click on **`ACT-B02`** (Crude Pump Foundation Piling Works).
2. The UI smoothly transitions to the **Activity Detail View**:
   - **Header & Current State**: Demonstrates identity (`ACT-B02`), WBS (`WBS-B.02`), Location (`Area B — Foundation`), Planned vs Actual progress (`65.0%` vs `75.56%`, `-10.56%` variance, `AT_RISK` with active weather blocker).
   - **Historical Progress Trajectory**: Shows chronological observation trendline across multiple dates (`08-14`: 20% &rarr; `08-18`: 38% &rarr; `08-21`: 52% &rarr; `08-27`: 65%).
   - **Originating Progress Reports**: Displays the daily site logs and shift updates that contributed to this activity.
   - **Match & Review Context**: Proves the **Canonical Truth Protection** boundary—only confirmed matches produced progress observations.
   - **Originating Evidence**: Click **View** next to `piping_and_electrical_log_2026-08-27.txt` to inspect the raw evidence file.
3. Click **Back to Workspace** to return to the Dashboard.

---

### Step 3: Human Review & Matching Workflow (1 min)
1. Switch to the **Progress Updates** tab.
2. Scroll to a shift report with suggested activity matches.
3. Click **Review Activity Matches**:
   - Explain the confidence scoring (Exact ID: 1.0, Text Similarity: ~0.85, Location Alignment boost: +0.18).
   - Demonstrate confirming a suggested match: click **Confirm Match**.
   - Show how the confirmation instantly creates a verified canonical progress observation and updates project events.

---

### Step 4: Grounded FieldLine Assistant (1.5 min)
1. Switch to the **Project Intelligence** tab.
2. Under **Ask FieldLine Assistant**, use one of the quick suggested chips or type a question:

#### Question A: `"What is delayed?"`
- **Markdown Presentation (Pass 28)**: Renders a clean GFM response with section headings (`## Delayed Activities`), responsive tabular comparison (`| Activity | Actual Progress | Status |`), and bold takeaways.
- **Verified Factual Claims**: Highlights structured claim tags with exact percentage variance and reasons (identifying `ACT-D02` overdue spool fabrication).
- **Verified Facts Accordion**: Expand to show the cited deterministic fact records.

#### Question B: `"Tell me about the crude pump foundation"`
- **Synthesis**: Identifies `ACT-B02` (Crude Pump Foundation Piling Works) in Area B, notes current progress is 65% against planned 75.6% (-10.56 pts variance, at risk with active weather blocker).
- **Target Badge**: Click the `Target: ACT-B02` badge to immediately open its full Activity Detail view!

#### Question C: `"Which activities are at risk?"`
- **Synthesis**: Explains `ACT-B02` and `ACT-C01` formatted in structured Markdown with specific variance warnings, active blocker context, and approaching finish deadlines.

#### Question D: `"How to speed up the work?"`
- **Executive Advisory Markdown**: Demonstrates structured general advice formatted in numbered sections (fast-tracking, resource crashing, bottleneck elimination, daily coordination standups) without raw text dumps.

---

## 6. Recovery & Troubleshooting

If you need to reset the environment during live presentation testing:

```bash
# Instant recovery to clean golden state
npm run demo:reset
```

If port `3001` or `3000` is already in use:
- Adjust `PORT` or `VITE_PORT` in `.env`.
- Run `npm run setup` and relaunch with `npm run dev`.
