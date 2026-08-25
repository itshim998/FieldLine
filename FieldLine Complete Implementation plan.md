# **FieldLine — Master Implementation Plan** 

# **0. Product and engineering constraints** 

These are hard constraints for the entire project: 

- **Product:** FieldLine 

- **SIH PS:** SIH26122 

- **Development window:** 7 days 

- **Deployment:** none 

- **Frontend:** local 

- **Backend:** local 

- **Database:** local SQLite 

- **File storage:** local filesystem 

- **AI:** external API calls are permitted where required for AI functionality 

- **Docker:** not used 

- **Supabase:** not used 

- **Cloud storage:** not used 

- **Cloud deployment:** not used 

- **Architecture:** modular monolith 

- **Primary development agent:** Gemini 3.7 Flash in Antigravity 

- **Architecture/review agent:** GPT-5.6 Luna through GitHub 

- **Every coding pass:** implement → local tests → local evaluation → commit → push → independent review 

The product should be **engineering-grade internally** , while infrastructure remains deliberately lightweight. 

# **1. FieldLine's core objective** 

FieldLine must demonstrate one complete and convincing workflow: 

Project Schedule 

↓ 

Import 

↓ 

Planned Activities 

↓ 

Field Progress Report 

↓ 

AI extracts factual information 

↓ 

FieldLine identifies matching activity 

↓ 

Actual progress is calculated 

↓ 

Planned vs Actual comparison 

↓ 

Variance / delay detection 

↓ 

Dashboard updates ↓ 

Manager asks questions ↓ 

FieldLine answers using verified project data 

This is the central product loop. 

Everything else exists to strengthen this loop. 

# **2. Technical architecture** 

Use a **single local modular monolith** . 

FieldLine/ 

│ 

├── backend/ 

│   ├── server.ts 

│   ├── routes/ 

│   ├── middleware/ 

│   ├── validation/ 

│   ├── services/ 

│   │   ├── projects/ 

│   │   ├── schedules/ 

│   │   ├── ingestion/ 

│   │   ├── matching/ 

│   │   ├── progress/ 

│   │   ├── analytics/ 

│   │   ├── evidence/ 

│   │   └── assistant/ 

│   ├── ai/ 

│   │   ├── providers/ 

│   │   ├── prompts/ 

│   │   ├── contracts/ 

│   │   └── extraction/ 

│   ├── jobs/ 

│   └── tests/ 

│ 

├── frontend/ 

│ 

├── database/ 

│   ├── migrations/ 

│   ├── seed/ 

│   └── fieldline.db 

│ 

├── uploads/ 

│ 

├── demo/ 

│   ├── schedules/ 

│   ├── reports/ 

│   └── seed-data/ 

│ 

├── scripts/ 

│ 

├── docs/ 

│ 

├── package.json 

├── tsconfig.json 

├── .env.example 

├── .gitignore 

└── README.md 

The exact structure can be adjusted after repository inspection during Pass 1, but the architecture should preserve these boundaries. 

# **3. Architectural principles** 

These are non-negotiable. 

# **Principle 1 — AI does not own project truth** 

AI may extract: 

"Foundation work in Block B is approximately 60% complete." 

Application logic decides: 

- whether the activity exists 

- which activity it refers to 

- whether the value is valid 

- how progress is stored 

- how variance is calculated 

- whether the activity is delayed. 

# **Principle 2 — deterministic calculations stay deterministic** 

Do not ask an LLM to calculate: 

60% of 500 m³ 

or: 

Actual = 60% 

Planned = 75% 

Variance = -15% 

Normal application code does this. 

# **Principle 3 — uncertain AI output is reviewable** 

The system must distinguish: 

high-confidence match 

medium-confidence suggestion 

low-confidence / unmatched 

# **Principle 4 — evidence must remain traceable** 

Every important project conclusion should be traceable back to the field evidence that produced it. 

# **Principle 5 — local simplicity** 

Do not introduce infrastructure unless it directly improves the demo or the product. 

# **4. Domain model** 

The initial domain model should contain: 

# **projects** 

Basic project information. 

# **schedules** 

An imported project schedule/version. 

# **activities** 

Individual planned activities. Typical fields: 

id 

project_id external_id name 

description wbs_code location 

planned_start planned_finish planned_quantity 

unit 

baseline_progress 

# **progress_updates** 

A reported real-world update. 

# **evidence** 

The original source of a progress update. 

Examples: 

- text 

- XLSX 

- PDF 

- image 

- transcript. 

# **activity_matches** 

Relationship between extracted evidence and candidate activities. 

# **activity_progress** 

Current/derived actual project state. 

# **project_events** 

Important state transitions and audit events. 

# **Supporting entities** 

Add only where implementation requires them: 

- users 

- processing_jobs 

- milestones 

- progress_snapshots. 

# **5. PASS 0 — Repository bootstrap** 

# **Objective** 

Create the basic FieldLine repository and make it executable locally. 

# **Work** 

Set up: 

- Node.js 

- TypeScript 

- package configuration 

- Express 

- frontend shell 

- SQLite 

- Zod 

- testing framework 

- .env.example 

- .gitignore 

- README 

- basic scripts. 

Create: 

npm run dev 

npm test 

npm run build 

npm run setup 

npm run demo:reset 

# **Exit criteria** 

A clean checkout can be initialized and run locally. 

# **6. PASS 1 — Application architecture** 

# **Objective** 

Create clean module boundaries before feature development. 

Implement: 

HTTP route 

↓ 

validation 

↓ 

service 

↓ 

repository 

↓ 

SQLite AI: 

service 

↓ 

AI adapter 

↓ 

structured response 

↓ 

validation 

↓ 

service 

AI code must not directly manipulate the database. 

Create: 

- application configuration 

- error handling 

- request validation 

- logging 

- repository abstraction 

- service boundaries. 

# **Exit criteria** 

Health endpoint works and the architecture skeleton is testable. 

# **7. PASS 2 — SQLite and persistence foundation** 

# **Objective** 

Create the local database. 

Implement migrations/schema for: 

projects 

schedules 

activities progress_updates evidence activity_matches activity_progress 

project_events 

# Add: 

- repository functions 

- transactions 

- indexes 

- foreign keys 

- basic constraints. 

# **Exit criteria** 

A project can be created, persisted and retrieved entirely from SQLite. 

# **8. PASS 3 — Project management** 

# **Objective** 

Create the minimum project lifecycle. 

Implement: 

- create project 

- list projects 

- open project 

- project metadata 

- project deletion/reset where appropriate. 

# **Exit criteria** 

A user can open FieldLine and select a project. 

# **9. PASS 4 — Schedule importer** 

# **Objective** 

Import real schedule data. 

# **Initial formats** 

# **CSV + XLSX.** 

Implement: 

file 

↓ 

file validation 

↓ 

parser 

↓ 

normalized rows 

↓ 

validation ↓ 

database 

Support common columns such as: Activity ID Activity Name 

Description 

WBS 

Location 

Start 

Finish 

Quantity 

Unit 

# **Exit criteria** 

A real schedule file produces usable FieldLine activities. 

# **10. PASS 5 — Schedule normalization** 

# **Objective** 

Create the canonical internal activity representation. 

Normalize things like: 

Task ID 

Activity ID 

Activity Code 

→ 

external_id and: 

Start Date Planned Start Baseline Start 

→ 

planned_start 

Normalize: 

- dates 

- numbers 

- percentages 

- units 

- whitespace 

- missing values. 

# **Exit criteria** 

All schedule sources produce the same internal activity format. 

# **11. PASS 6 — Schedule validation** 

# **Objective** 

Prevent bad schedule data from entering the project model. 

Validate: 

- unique activity identifiers 

- valid dates 

- start ≤ finish 

- valid percentages 

- valid quantities 

- missing critical fields 

- duplicate activities. 

Produce useful import errors. 

# **Exit criteria** 

Invalid schedule data is rejected cleanly without corrupting the database. 

# **12. PASS 7 — Manual progress reporting** 

# **Objective** 

Build the simplest working field-update workflow before adding AI. 

A supervisor can enter: 

"Foundation work at Block B is 60% complete. Concrete pouring started today." 

Store: 

- raw update 

- timestamp 

- reporter 

- project 

- source type. 

# **Exit criteria** 

A manually entered progress update is persisted and displayed. 

# **13. PASS 8 — AI extraction layer** 

# **Objective** 

Convert messy language into structured facts. 

Input: 

Foundation work at Block B is 60% complete. 

Concrete pouring started today. 

Output conceptually: 

{ 

"items": [ 

{ 

"reference": "foundation work", 

"location": "Block B", "progress_percent": 60, 

"status": "in_progress" 

} 

] 

} 

Use: 

- explicit prompt 

- strict JSON/schema 

- Zod validation 

- bounded output 

- provider abstraction 

- clear failure states. 

AI extracts **facts** , not activity identity. 

# **Exit criteria** 

Valid AI output enters the application as structured data; invalid output is rejected safely. 

# **14. PASS 9 — Activity matching engine** 

# **Objective** 

Connect extracted progress information to the schedule. 

Use a layered strategy: 

1. Exact activity/external ID 

2. Strong text match 

3. WBS/location metadata 

4. semantic similarity 

5. LLM-assisted disambiguation 

Produce: 

matched activity 

confidence 

candidate alternatives 

matching rationale 

Do not automatically commit low-confidence matches. 

# **Exit criteria** 

Real field reports consistently resolve to the correct scheduled activity in the demo dataset. 

# **15. PASS 10 — Progress normalization** 

# **Objective** 

Convert reports into canonical actual progress. 

Support: 

# **Percentage** 

"60% complete" 

# **Quantity** 

"300 m³ completed" 

# **Status** 

started 

in progress 

completed 

Where possible, derive the canonical percentage from quantity rather than trusting an LLM calculation. 

Example: 

planned = 500 m³ 

actual = 300 m³ 

actual_progress = 60% 

# **Exit criteria** 

Activities have deterministic actual-progress values. 

# **16. PASS 11 — Planned vs actual engine** 

# **Objective** 

Calculate project variance. 

For each activity calculate: 

planned progress 

actual progress 

progress variance planned duration 

actual/current state 

Handle: 

- not started 

- started 

- in progress 

- completed 

- overdue. 

# **Exit criteria** 

The backend can produce a complete project progress snapshot. 

# **17. PASS 12 — Delay and risk engine** 

# **Objective** 

Turn variance into useful project status. 

Initial deterministic states: 

ON_TRACK 

AHEAD 

AT_RISK 

DELAYED 

COMPLETED 

Use factors such as: 

- schedule dates 

- progress variance 

- overdue status 

- milestone proximity 

- completion status 

- dependency information where available. 

Keep the logic explicit and testable. 

# **Exit criteria** 

FieldLine can identify delayed/at-risk activities without AI. 

# **18. PASS 13 — Evidence system** 

# **Objective** 

Make every important result traceable. 

Store: 

evidence metadata 

# + 

source file 

# + 

raw update 

# + 

extracted facts 

+ 

activity match 

+ 

resulting progress 

Local storage: 

uploads/ 

<project-id>/ 

Use safe/generated filenames rather than trusting user-provided paths. 

# **Exit criteria** 

From any activity result, the user can navigate back to the originating evidence. 

# **19. PASS 14 — Document ingestion** 

# **Objective** 

Expand progress capture beyond manual text. 

Implement in priority order: 

1. XLSX/CSV 

2. PDF text extraction 

3. scanned PDF/image OCR 

Pipeline: 

file 

↓ 

validation 

↓ 

extraction 

↓ 

normalized text/data 

↓ 

AI progress extraction 

↓ 

matching 

↓ 

progress update 

Reuse proven SentIQ patterns where practical for: 

- Excel parsing 

- PDF parsing 

- OCR 

- upload handling. 

# **Exit criteria** 

At least one realistic PDF/XLSX field report can move through the complete workflow. 

# **20. PASS 15 — In-process processing jobs** 

# **Objective** 

Prevent expensive file processing from blocking normal API operations. 

Implement a lightweight local job mechanism: 

job created 

↓ 

SQLite queue 

↓ 

same Node process worker 

↓ 

processing 

↓ 

completed / failed 

No separate deployment service is required. 

Job states: 

queued 

processing 

completed 

failed 

# **Exit criteria** 

Document processing can run asynchronously and recover cleanly from ordinary failures. 

# **21. PASS 16 — Failure isolation and idempotency** 

# **Objective** 

Protect project truth. 

Implement: 

- duplicate evidence detection 

- content hashes 

- idempotent processing 

- explicit failure states 

- transaction boundaries 

- no partial progress update on failed processing. 

Example invariant: 

If AI extraction fails, the previous valid activity state remains untouched. 

# **Exit criteria** 

Repeated uploads and failed AI calls do not create duplicate or corrupted progress. 

# **22. PASS 17 — Project intelligence queries** 

# **Objective** 

Build the deterministic information layer the assistant will use. 

Queries: 

What is delayed? 

What is at risk? 

What was completed today? 

Which activities are behind schedule? 

Which milestones are approaching? 

Which activities have no recent updates? 

What changed recently? 

These should initially return **structured facts** , not generated prose. 

# **Exit criteria** 

Every major dashboard/assistant question can be answered from deterministic project data. 

# **23. PASS 18 — FieldLine Assistant** 

# **Objective** 

Add natural-language interaction. 

Flow: 

manager question 

↓ 

intent/query interpretation 

↓ 

structured project query 

↓ 

verified result set 

↓ 

LLM explanation 

↓ 

answer 

Examples: 

"What is delayed?" 

"Why is Foundation B at risk?" 

"What changed today?" 

"Which activities are most behind schedule?" 

The assistant must not invent project data. 

# **Exit criteria** 

A manager can ask natural-language questions and receive answers grounded in the actual database state. 

# **24. PASS 19 — Human review workflow** 

# **Objective** 

Handle uncertain AI matches safely. 

Implement: 

HIGH confidence 

→ automatic match 

MEDIUM confidence 

→ suggested match 

→ human confirms 

LOW confidence 

→ unresolved 

→ human chooses 

The UI should clearly communicate uncertainty. 

# **Exit criteria** 

No ambiguous AI match silently becomes project truth. 

# **25. PASS 20 — Dashboard** 

# **Objective** 

Build the primary presentation interface. 

Main dashboard should show: 

# **Project health** 

Overall progress 

Planned progress 

Variance 

# **Activity status** 

On Track 

Ahead At Risk Delayed Completed 

# **Recent updates** 

time 

activity reported progress 

source 

# **Milestones** 

upcoming completed late 

at risk 

# **Evidence** 

The user should be able to open the evidence behind a result. 

# **Exit criteria** 

A judge can understand the project's state within seconds of opening the dashboard. 

# **26. PASS 21 — Activity detail view** 

# **Objective** 

Give each activity a complete history. 

Example: 

Foundation — Block B 

Planned: 75% Actual: 60% Variance: -15% 

Status: AT RISK 

Timeline 

──────────── 

Aug 20 — started 

Aug 22 — 35% Aug 24 — 60% 

Evidence 

──────── 

Report-001.pdf Report-004.txt 

This makes the product feel like a real project-management system rather than an AI demo. 

# **27. PASS 22 — Voice input** 

# **Objective** 

Add voice only after the core product is stable. 

Workflow: 

voice 

↓ 

speech-to-text 

↓ 

progress extraction 

↓ 

activity matching 

↓ 

project state 

If voice proves unreliable locally, it must remain optional and must not block the final demo. 

# **Exit criteria** 

Voice can produce at least one reliable end-to-end field update. 

# **28. PASS 23 — Test and evaluation suite** 

# **Objective** 

Create a comprehensive local regression suite. 

# **Unit tests** 

- normalization 

- progress calculations 

- matching 

- variance 

- delay classification 

# **Contract tests** 

- AI output 

- APIs 

- validation 

# **Integration tests** 

schedule → database 

report → extraction extraction → match 

match → progress 

progress → variance 

# **Failure tests** 

- bad XLSX 

- bad PDF 

- missing activity 

- ambiguous activity 

- malformed AI output 

- duplicate evidence 

- contradictory report 

- invalid dates 

- missing quantity. 

# **E2E test** 

schedule 

↓ 

report 

↓ 

AI 

↓ 

match 

↓ 

progress 

↓ 

variance 

↓ 

dashboard 

↓ 

assistant 

# **Exit criteria** 

The entire critical workflow passes locally. 

# **29. PASS 24 — Golden demo environment** 

# **Objective** 

Create the exact dataset and conditions for the SIH presentation. 

Create a synthetic infrastructure project such as: 

# **Refinery Expansion — Unit 4** 

Populate: 

- ~30 activities 

- multiple work areas 

- planned dates 

- planned quantities 

- on-track activities 

- delayed activities 

- at-risk activities 

- milestones 

- realistic field reports. 

Create deliberately messy reports such as: 

"Block B excavation roughly 65% done..." 

"Excavation at B is practically finished..." 

"Section B earthwork completed..." 

These should demonstrate that different descriptions can be mapped to the same scheduled activity. 

Create: 

npm run demo:reset 

which restores the exact starting state. 

# **Exit criteria** 

You can reset the entire demo and reproduce the same presentation state. 

# **30. PASS 25 — Final integration and presentation polish** 

# **Product polish** 

- loading states 

- empty states 

- errors 

- responsive local UI 

- activity visualizations 

- clear status indicators 

- evidence links 

- assistant UX. 

# **Engineering polish** 

- remove dead code 

- remove debug logging 

- validate environment 

- verify clean installation 

- verify clean database initialization 

- verify reset script 

- run complete test suite. 

# **Documentation** 

Create: 

README.md 

docs/ARCHITECTURE.md 

docs/DEMO.md 

docs/AI-PIPELINE.md 

Architecture diagram: 

Schedule 

↓ 

Importer 

↓ 

Activities ↓ 

Field Evidence 

↓ 

AI Extraction ↓ Activity Matching ↓ 

Progress Engine ↓ 

Variance / Risk Engine 

↓ 

Dashboard / Assistant 

# **Exit criteria** 

A fresh local environment can start FieldLine, load/reset the demo, execute the entire workflow, and present the system without cloud infrastructure. 

# **Final FieldLine architecture** 

The resulting system should look roughly like this: 

┌──────────────────────┐ │      Local Browser   │ └──────────┬───────────┘ │ ▼ ┌──────────────────────┐ 

│   FieldLine Frontend │ └──────────┬───────────┘ │ 



<!-- Start of picture text -->
▼<br>                         ┌──────────────────────┐<br>                         │ Node / Express API   │<br>                         └──────────┬───────────┘<br>                                                    │<br>              ┌─────────────────────┼──────────────────────┐<br>              │                                │                                 │<br>▼ ▼ ▼<br>        Domain Services                     AI Layer                                    Job Worker<br>              │                                │                                                 │<br>              │                                               ▼                                                │<br>              │                                    AI Provider API                                     │<br>              │           │<br>              └───────────────────┬────────────────────────┘<br>                    │<br>                                                ▼<br>                         ┌──────────────────────┐<br>                         │       SQLite                    │<br>                         └──────────────────────┘<br>      │<br>┴<br>                           ┌───────────── ─────────────┐<br>▼ ▼<br>         Project State                    Evidence Files<br>    local filesystem<br><!-- End of picture text -->

# **The critical execution order** 

The seven-day implementation should therefore follow this dependency chain: 

**Foundation → persistence → schedule → progress → AI extraction → matching → actuals → variance → evidence → documents → intelligence → assistant → dashboard → review → reliability → demo.** 

And the should come much earlier than the end: **first demo-worthy milestone** 

**Import schedule → submit one messy field report → correctly identify its activity → update actual progress → show variance.** 

Once that works, the rest of FieldLine is progressively making that core loop richer, safer, and more impressive. 

