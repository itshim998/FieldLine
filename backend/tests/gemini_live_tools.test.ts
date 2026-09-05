import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { runMigrations } from '../src/database/migrator.js';
import { SqliteProjectRepository } from '../src/repositories/project.repository.js';
import { SqliteScheduleRepository } from '../src/repositories/schedule.repository.js';
import { SqliteActivityRepository } from '../src/repositories/activity.repository.js';
import { SqliteActivityMatchRepository } from '../src/repositories/activity-match.repository.js';
import { SqliteActivityProgressRepository } from '../src/repositories/activity-progress.repository.js';
import { SqliteProgressUpdateRepository } from '../src/repositories/progress-update.repository.js';
import { SqliteProjectEventRepository } from '../src/repositories/project-event.repository.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.service.js';
import { DefaultProgressUpdateService } from '../src/services/progress-update.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import {
  LiveToolHandlers,
  createLiveToolExecutor,
  LiveToolExecutionContext
} from '../src/ai/live/live-tool-handlers.js';
import {
  buildLiveSystemInstruction,
  PARDON_ME_PROTOCOL
} from '../src/ai/live/live-context-builder.js';
import {
  DEFAULT_GEMINI_LIVE_TOOLS,
  LiveFunctionCall
} from '../src/ai/live/upstream-gemini-socket.js';
import { Project, Schedule } from '../src/models/domain.types.js';

describe('Gemini Live Tools, Grounding & Verbal Confirmation (Pass 3)', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let projectEventRepo: SqliteProjectEventRepository;

  let activityResolver: DeterministicActivityResolver;
  let snapshotService: DefaultProgressSnapshotService;
  let intelligenceService: DefaultProjectIntelligenceService;
  let progressUpdateService: DefaultProgressUpdateService;
  let matchingService: ActivityMatchingService;
  let progressService: DefaultProgressService;
  let mockExtractionService: FieldProgressExtractionService;

  let testProject: Project;
  let testSchedule: Schedule;
  let handlers: LiveToolHandlers;

  beforeEach(() => {
    // 1. In-memory SQLite database setup
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    projectRepo = new SqliteProjectRepository(() => db);
    scheduleRepo = new SqliteScheduleRepository(() => db);
    activityRepo = new SqliteActivityRepository(() => db);
    activityMatchRepo = new SqliteActivityMatchRepository(() => db);
    activityProgressRepo = new SqliteActivityProgressRepository(() => db);
    progressUpdateRepo = new SqliteProgressUpdateRepository(() => db);
    projectEventRepo = new SqliteProjectEventRepository(() => db);

    activityResolver = new DeterministicActivityResolver(activityRepo);
    snapshotService = new DefaultProgressSnapshotService({
      projectRepo,
      activityRepo,
      activityProgressRepo
    });
    intelligenceService = new DefaultProjectIntelligenceService({
      projectRepo,
      activityRepo,
      activityProgressRepo,
      progressSnapshotService: snapshotService
    });
    progressUpdateService = new DefaultProgressUpdateService(
      progressUpdateRepo,
      projectRepo
    );
    matchingService = new ActivityMatchingService({
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      activityMatchRepo,
      projectEventRepo
    });
    progressService = new DefaultProgressService({
      projectRepo,
      progressUpdateRepo,
      activityRepo,
      activityMatchRepo,
      activityProgressRepo
    });

    // Mock Groq FieldProgressExtractionService
    mockExtractionService = {
      extractFromReport: vi.fn()
    } as unknown as FieldProgressExtractionService;

    // Create test project & baseline schedule
    testProject = projectRepo.create({
      code: 'PRJ-MUMBAI-METRO',
      name: 'Mumbai Coastal Road & Metro Line 3',
      description: 'Pier construction and underground segmental tunneling',
      status: 'active'
    });

    testSchedule = scheduleRepo.create({
      projectId: testProject.id,
      name: 'Master Baseline Schedule',
      version: '1.0',
      sourceType: 'manual',
      isBaseline: true
    });

    // Populate realistic test activities
    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-PIER-12',
      name: 'Pier 12 excavation and soil stabilization',
      location: 'Pier 12',
      plannedStart: '2026-09-01',
      plannedFinish: '2026-09-10',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-PIER-12-REBAR',
      name: 'Pier 12 rebar reinforcement caging',
      location: 'Pier 12',
      plannedStart: '2026-09-11',
      plannedFinish: '2026-09-20',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-BLOCK-B-FOUND',
      name: 'Block B foundation footing concrete casting',
      location: 'Block B',
      plannedStart: '2026-09-05',
      plannedFinish: '2026-09-15',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-BLOCK-B-EARTH',
      name: 'Block B site leveling and earthwork',
      location: 'Block B',
      plannedStart: '2026-08-15',
      plannedFinish: '2026-08-30',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-NORTH-DRAIN',
      name: 'North storm drainage culvert',
      location: 'Sector North',
      plannedStart: '2026-09-08',
      plannedFinish: '2026-09-25',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-SOUTH-RETAIN',
      name: 'South perimeter retaining wall',
      location: 'Sector South',
      plannedStart: '2026-09-12',
      plannedFinish: '2026-09-30',
      baselineProgress: 0
    });

    // Mark ACT-BLOCK-B-EARTH as completed (100%) so we test that get_next_recommended_activities filters it out
    const completedUpdate = progressUpdateRepo.create({
      projectId: testProject.id,
      reportDate: '2026-08-31',
      rawText: 'Block B earthwork 100% completed',
      sourceType: 'manual',
      status: 'received'
    });
    const earthAct = activityRepo.listByProjectId(testProject.id).find((a) => a.externalId === 'ACT-BLOCK-B-EARTH')!;
    const earthMatch = activityMatchRepo.create({
      projectId: testProject.id,
      progressUpdateId: completedUpdate.id,
      activityId: earthAct.id,
      confidenceScore: 1.0,
      matchMethod: 'exact_id',
      status: 'confirmed'
    });
    progressService.normalizeAndRecordProgress({
      projectId: testProject.id,
      updateId: completedUpdate.id,
      matchId: earthMatch.id,
      fact: {
        reference: 'Block B site leveling and earthwork',
        location: 'Block B',
        progress_percent: 100,
        status: 'completed'
      },
      allowSuggested: true
    });

    // Initialize LiveToolHandlers with clean dependencies
    handlers = new LiveToolHandlers({
      activityRepo,
      projectRepo,
      activityMatchRepo,
      activityResolver,
      snapshotService,
      intelligenceService,
      extractionService: mockExtractionService,
      progressUpdateService,
      matchingService,
      progressService
    });
  });

  describe('1. Gemini Live Tool Declarations Schema Verification', () => {
    it('declares all required functions matching Gemini Multimodal Live Bidi schema', () => {
      expect(DEFAULT_GEMINI_LIVE_TOOLS).toHaveLength(1);
      const decls = DEFAULT_GEMINI_LIVE_TOOLS[0].functionDeclarations;
      expect(decls.length).toBeGreaterThanOrEqual(6);

      const names = decls.map((d) => d.name);
      expect(names).toContain('get_project_intelligence');
      expect(names).toContain('get_next_recommended_activities');
      expect(names).toContain('lookup_activity_status');
      expect(names).toContain('search_project_activities');
      expect(names).toContain('record_field_progress');
      expect(names).toContain('query_project_assistant');
    });

    it('verifies get_next_recommended_activities schema parameters', () => {
      const decl = DEFAULT_GEMINI_LIVE_TOOLS[0].functionDeclarations.find(
        (d) => d.name === 'get_next_recommended_activities'
      )!;
      expect(decl.parameters.type).toBe('OBJECT');
      expect(decl.parameters.properties.projectId).toBeDefined();
      expect(decl.parameters.properties.location).toBeDefined();
      expect(decl.parameters.required).toContain('projectId');
    });

    it('verifies lookup_activity_status schema parameters', () => {
      const decl = DEFAULT_GEMINI_LIVE_TOOLS[0].functionDeclarations.find(
        (d) => d.name === 'lookup_activity_status'
      )!;
      expect(decl.parameters.type).toBe('OBJECT');
      expect(decl.parameters.properties.projectId).toBeDefined();
      expect(decl.parameters.properties.query).toBeDefined();
      expect(decl.parameters.required).toEqual(['projectId', 'query']);
    });

    it('verifies record_field_progress schema parameters', () => {
      const decl = DEFAULT_GEMINI_LIVE_TOOLS[0].functionDeclarations.find(
        (d) => d.name === 'record_field_progress'
      )!;
      expect(decl.parameters.type).toBe('OBJECT');
      expect(decl.parameters.properties.projectId).toBeDefined();
      expect(decl.parameters.properties.rawStatement).toBeDefined();
      expect(decl.parameters.required).toEqual(['projectId', 'rawStatement']);
    });
  });

  describe('2. Context Snapshot Builder & "Pardon Me" Protocol', () => {
    it('builds concise static snapshot with project code, status, milestones, and high-level progress', () => {
      const instruction = buildLiveSystemInstruction(testProject, {
        snapshotService,
        intelligenceService,
        todayDate: '2026-09-03'
      });

      expect(instruction).toContain(testProject.code);
      expect(instruction).toContain(testProject.name);
      expect(instruction).toContain("Today's Date: 2026-09-03");
      expect(instruction).toContain('Schedule Performance:');
      expect(instruction).toContain('Total Tracked Activities:');
    });

    it('formats strict "Pardon Me" protocol rules to prevent hallucination under noise or accents', () => {
      const instruction = buildLiveSystemInstruction(testProject);

      expect(instruction).toContain('Pardon Me');
      expect(instruction).toContain(PARDON_ME_PROTOCOL);
      expect(instruction).toContain(
        'If any activity code, location, or quantity is phonetically unclear, muffled, or ambiguous, ask back for pardon: "Pardon me, did you mean Section B or D?" Never guess or hallucinate unconfirmed progress.'
      );
    });
  });

  describe('3. Database Queries: get_next_recommended_activities', () => {
    it('queries SQLite database and returns top prioritized tasks with not_started or in_progress status', async () => {
      const result = await handlers.getNextRecommendedActivities(testProject.id);

      expect(result.status).toBe('success');
      expect(result.returnedCount).toBeLessThanOrEqual(5);
      expect(result.activities).toBeInstanceOf(Array);

      // Verify ACT-BLOCK-B-EARTH (which is completed) is NOT included in recommendations
      const codes = result.activities.map((a: any) => a.code);
      expect(codes).not.toContain('ACT-BLOCK-B-EARTH');

      // Verify tasks are ordered by plannedStart ascending
      for (let i = 1; i < result.activities.length; i++) {
        expect(result.activities[i].plannedStart >= result.activities[i - 1].plannedStart).toBe(true);
      }

      // Verify required task details are present
      const first = result.activities[0];
      expect(first).toHaveProperty('code');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('location');
      expect(first).toHaveProperty('plannedDates');
      expect(first).toHaveProperty('status');
    });

    it('filters activities correctly by location query (case-insensitive substring)', async () => {
      const result = await handlers.getNextRecommendedActivities(testProject.id, 'Pier 12');

      expect(result.status).toBe('success');
      expect(result.returnedCount).toBe(2);

      const codes = result.activities.map((a: any) => a.code);
      expect(codes).toContain('ACT-PIER-12');
      expect(codes).toContain('ACT-PIER-12-REBAR');
      expect(codes).not.toContain('ACT-BLOCK-B-FOUND');
    });

    it('returns empty list gracefully when no activities match location', async () => {
      const result = await handlers.getNextRecommendedActivities(testProject.id, 'Nonexistent Sector Z');

      expect(result.status).toBe('success');
      expect(result.returnedCount).toBe(0);
      expect(result.activities).toHaveLength(0);
      expect(result.summary).toContain('No uncompleted activities found');
    });
  });

  describe('4. Database Queries: lookup_activity_status', () => {
    it('resolves activity status by external code (ACT-PIER-12)', async () => {
      const result = await handlers.lookupActivityStatus(testProject.id, 'ACT-PIER-12');

      expect(result.status).toBe('resolved');
      expect(result.code).toBe('ACT-PIER-12');
      expect(result.name).toBe('Pier 12 excavation and soil stabilization');
      expect(result.location).toBe('Pier 12');
      expect(result.plannedProgress).toBeDefined();
      expect(result.actualProgress).toBeDefined();
      expect(result.varianceState).toBeDefined();
      expect(result.delays).toBeDefined();
      expect(result.summary).toContain('Pier 12');
    });

    it('resolves activity status by descriptive name', async () => {
      const result = await handlers.lookupActivityStatus(
        testProject.id,
        'Pier 12 rebar reinforcement caging'
      );

      expect(result.status).toBe('resolved');
      expect(result.code).toBe('ACT-PIER-12-REBAR');
      expect(result.name).toBe('Pier 12 rebar reinforcement caging');
    });

    it('returns not_found when activity does not exist', async () => {
      const result = await handlers.lookupActivityStatus(testProject.id, 'Ghost Activity 999');

      expect(result.status).toBe('not_found');
      expect(result.message).toContain('No activity found matching "Ghost Activity 999"');
    });

    it('returns ambiguous with candidate options when query matches multiple activities', async () => {
      // Both ACT-PIER-12 and ACT-PIER-12-REBAR contain "Pier 12"
      const result = await handlers.lookupActivityStatus(testProject.id, 'Pier 12');

      expect(result.status).toBe('ambiguous');
      expect(result.candidates).toBeInstanceOf(Array);
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
      expect(result.message).toContain('Please clarify');
    });
  });

  describe('5. End-to-End Simulation: record_field_progress -> Groq -> SQLite -> Verbal Confirmation', () => {
    it('returns immediate queued response and asynchronously executes Groq extraction and commits to SQLite', async () => {
      const rawStatement = 'We finished casting the concrete slab on Pier 12 excavation, 100% complete';

      // 1. Mock Groq extraction response
      (mockExtractionService.extractFromReport as any).mockResolvedValue({
        items: [
          {
            reference: 'Pier 12 excavation and soil stabilization',
            location: 'Pier 12',
            progress_percent: 100,
            status: 'completed'
          }
        ]
      });

      // 2. Mock session context to capture verbal confirmation dispatch
      const verbalConfirmations: string[] = [];
      const clientEvents: any[] = [];
      const mockContext: LiveToolExecutionContext = {
        session: {
          dispatchVerbalConfirmation: (text: string) => {
            verbalConfirmations.push(text);
          },
          sendToClient: (payload: Record<string, any>) => {
            clientEvents.push(payload);
          }
        }
      };

      // 3. Immediately returns intake result to Gemini Live
      const intakeResponse = await handlers.recordFieldProgress(
        testProject.id,
        rawStatement,
        mockContext
      );

      expect(intakeResponse.status).toBe('queued');
      expect(intakeResponse.message).toContain('Progress statement captured');

      // 4. Wait for background asynchronous processing to settle
      await new Promise((r) => setTimeout(r, 60));

      // 5. Verify Groq extraction was called with rawStatement
      expect(mockExtractionService.extractFromReport).toHaveBeenCalledWith(rawStatement);

      // 6. Verify progress update was created with sourceType = 'voice'
      const updates = progressUpdateRepo.listByProjectId(testProject.id);
      const voiceUpdate = updates.find((u) => u.sourceType === 'voice');
      expect(voiceUpdate).toBeDefined();
      expect(voiceUpdate!.rawText).toBe(rawStatement);

      // 7. Verify activity_matches row was created and linked
      const matches = activityMatchRepo.listByProgressUpdateId(voiceUpdate!.id, testProject.id);
      expect(matches.length).toBeGreaterThan(0);
      const targetAct = activityRepo.listByProjectId(testProject.id).find((a) => a.externalId === 'ACT-PIER-12')!;
      expect(matches[0].activityId).toBe(targetAct.id);

      // 8. Verify activity_progress row was committed with 100% progress
      const latestProgress = activityProgressRepo.getLatestByActivityId(targetAct.id);
      expect(latestProgress).toBeDefined();
      expect(latestProgress!.actualPercent).toBe(100);
      expect(latestProgress!.status).toBe('completed');

      // 9. Verify Verbal Confirmation Trigger:
      // Dispatches high-priority system turn to Gemini Live
      expect(verbalConfirmations).toHaveLength(1);
      expect(verbalConfirmations[0]).toContain(
        "Update verified: Pier 12 excavation and soil stabilization is saved at 100%."
      );
      expect(verbalConfirmations[0]).toContain('System Event: Progress update committed successfully');

      // 10. Verify client event sent for UI display card
      expect(clientEvents).toHaveLength(1);
      expect(clientEvents[0].type).toBe('progress_verified');
      expect(clientEvents[0].activityCode).toBe('ACT-PIER-12');
      expect(clientEvents[0].progressPercent).toBe(100);
    });

    it('supports fallback deterministic resolution when extraction reference needs exact ID linking', async () => {
      const rawStatement = 'ACT-PIER-12-REBAR is now at 75%';

      (mockExtractionService.extractFromReport as any).mockResolvedValueOnce({
        items: [
          {
            reference: 'ACT-PIER-12-REBAR',
            location: 'Pier 12',
            progress_percent: 75,
            status: 'in_progress'
          }
        ]
      });

      const verbalConfirmations: string[] = [];
      const mockContext: LiveToolExecutionContext = {
        session: {
          dispatchVerbalConfirmation: (text: string) => {
            verbalConfirmations.push(text);
          },
          sendToClient: vi.fn()
        }
      };

      await handlers.processProgressStatementAsync(
        testProject.id,
        rawStatement,
        testProject,
        mockContext
      );

      const targetAct = activityRepo.listByProjectId(testProject.id).find((a) => a.externalId === 'ACT-PIER-12-REBAR')!;
      const latestProgress = activityProgressRepo.getLatestByActivityId(targetAct.id);
      expect(latestProgress).toBeDefined();
      expect(latestProgress!.actualPercent).toBe(75);
      expect(latestProgress!.status).toBe('in_progress');

      expect(verbalConfirmations[0]).toContain(
        "Update verified: Pier 12 rebar reinforcement caging is saved at 75%."
      );
    });
  });

  describe('6. Router & Factory executeTool Integration', () => {
    it('dispatches calls correctly via createLiveToolExecutor', async () => {
      const executor = createLiveToolExecutor({
        activityRepo,
        projectRepo,
        activityMatchRepo,
        activityResolver,
        snapshotService,
        intelligenceService,
        extractionService: mockExtractionService,
        progressUpdateService,
        matchingService,
        progressService
      });

      const call1: LiveFunctionCall = {
        id: 'call-1',
        name: 'get_next_recommended_activities',
        args: { projectId: testProject.id, location: 'Block B' }
      };

      const res1 = await executor(testProject.id, call1);
      expect(res1.status).toBe('success');
      expect(res1.activities).toBeDefined();

      const call2: LiveFunctionCall = {
        id: 'call-2',
        name: 'lookup_activity_status',
        args: { projectId: testProject.id, query: 'ACT-PIER-12' }
      };

      const res2 = await executor(testProject.id, call2);
      expect(res2.status).toBe('resolved');
      expect(res2.code).toBe('ACT-PIER-12');

      const callUnknown: LiveFunctionCall = {
        id: 'call-unknown',
        name: 'invalid_tool_name',
        args: {}
      };

      const resUnknown = await executor(testProject.id, callUnknown);
      expect(resUnknown.status).toBe('error');
    });
  });

  describe('7. Project ID Resolution & Comprehensive Database Access', () => {
    it('successfully queries database when projectId is passed as project CODE (e.g. testProject.code)', async () => {
      // 1. get_next_recommended_activities with code
      const recRes = await handlers.getNextRecommendedActivities(testProject.code);
      expect(recRes.status).toBe('success');
      expect(recRes.projectId).toBe(testProject.id);
      expect(recRes.projectCode).toBe(testProject.code);
      expect(recRes.activities).toBeDefined();

      // 2. lookup_activity_status with code
      const lookupRes = await handlers.lookupActivityStatus(testProject.code, 'ACT-PIER-12');
      expect(lookupRes.status).toBe('resolved');
      expect(lookupRes.projectId).toBe(testProject.id);
      expect(lookupRes.code).toBe('ACT-PIER-12');
    });

    it('successfully queries database when projectId is omitted (defaults to session project)', async () => {
      const recRes = await handlers.getNextRecommendedActivities(undefined, undefined, testProject.id);
      expect(recRes.status).toBe('success');
      expect(recRes.projectId).toBe(testProject.id);

      const lookupRes = await handlers.lookupActivityStatus(undefined, 'ACT-PIER-12', testProject.id);
      expect(lookupRes.status).toBe('resolved');
      expect(lookupRes.projectId).toBe(testProject.id);
    });

    it('returns comprehensive project intelligence from the SQLite database via get_project_intelligence', async () => {
      const intellRes = await handlers.getProjectIntelligence(testProject.code);
      expect(intellRes.status).toBe('success');
      expect(intellRes.projectId).toBe(testProject.id);
      expect(intellRes.projectCode).toBe(testProject.code);
      expect(intellRes.health).toBeDefined();
      expect(intellRes.health.totalActivities).toBeGreaterThanOrEqual(2);
      expect(intellRes.counts).toBeDefined();
      expect(intellRes.delayedActivities).toBeDefined();
      expect(intellRes.atRiskActivities).toBeDefined();
      expect(intellRes.approachingMilestones).toBeDefined();
    });

    it('searches and filters database activities via search_project_activities', async () => {
      const searchRes = await handlers.searchProjectActivities(testProject.code, 'Pier 12');
      expect(searchRes.status).toBe('success');
      expect(searchRes.projectId).toBe(testProject.id);
      expect(searchRes.activities.length).toBeGreaterThanOrEqual(1);
      expect(searchRes.activities[0].code).toBe('ACT-PIER-12');

      const allRes = await handlers.searchProjectActivities(testProject.id, undefined, 'all', undefined, 20);
      expect(allRes.status).toBe('success');
      expect(allRes.activities.length).toBeGreaterThanOrEqual(2);
    });
  });
});
