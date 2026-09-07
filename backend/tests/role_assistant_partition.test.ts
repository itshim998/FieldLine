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
import { SqliteProjectAccountRepository } from '../src/repositories/project-account.repository.js';
import { AuthService } from '../src/services/auth.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { DefaultProgressSnapshotService } from '../src/services/snapshot/progress-snapshot.service.js';
import { DefaultProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.service.js';
import { DefaultProgressUpdateService } from '../src/services/progress-update.service.js';
import { ActivityMatchingService } from '../src/services/matching/activity-matching.service.js';
import { DefaultProgressService } from '../src/services/progress/progress.service.js';
import { FieldProgressExtractionService } from '../src/ai/services/field-progress-extraction.service.js';
import {
  LiveToolHandlers,
  LiveToolExecutionContext
} from '../src/ai/live/live-tool-handlers.js';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { GeminiLiveGateway } from '../src/ai/live/gemini-live-gateway.js';
import { GeminiKeyRouter } from '../src/ai/providers/gemini-key-router.js';
import { Project, Schedule } from '../src/models/domain.types.js';

describe('Pass 34 — Role-Partitioned AI Assistant & Live Voice Gateway', () => {
  let db: DatabaseType;
  let projectRepo: SqliteProjectRepository;
  let scheduleRepo: SqliteScheduleRepository;
  let activityRepo: SqliteActivityRepository;
  let activityMatchRepo: SqliteActivityMatchRepository;
  let activityProgressRepo: SqliteActivityProgressRepository;
  let progressUpdateRepo: SqliteProgressUpdateRepository;
  let projectEventRepo: SqliteProjectEventRepository;
  let accountRepo: SqliteProjectAccountRepository;
  let authService: AuthService;

  let activityResolver: DeterministicActivityResolver;
  let snapshotService: DefaultProgressSnapshotService;
  let intelligenceService: DefaultProjectIntelligenceService;
  let progressUpdateService: DefaultProgressUpdateService;
  let matchingService: ActivityMatchingService;
  let progressService: DefaultProgressService;
  let mockExtractionService: FieldProgressExtractionService;
  let mockAiService: AIService;
  let intentService: AssistantIntentService;
  let factBuilder: VerifiedFactBuilder;
  let assistantService: AssistantService;

  let testProject: Project;
  let testSchedule: Schedule;
  let handlers: LiveToolHandlers;

  beforeEach(() => {
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
    accountRepo = new SqliteProjectAccountRepository(() => db);
    authService = new AuthService({ accountRepository: accountRepo, projectRepository: projectRepo });

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

    mockExtractionService = {
      extractFromReport: vi.fn()
    } as unknown as FieldProgressExtractionService;

    // Create test project and schedule
    testProject = projectRepo.create({
      code: 'REFINERY-U4',
      name: 'Refinery Unit 4 Expansion',
      description: 'EPC expansion for crude distillation',
      status: 'active'
    });

    testSchedule = scheduleRepo.create({
      projectId: testProject.id,
      name: 'Baseline Schedule',
      version: '1.0',
      sourceType: 'manual',
      isBaseline: true
    });

    // Activities in different areas
    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-C01',
      name: 'Pipe Rack PR-07 Structural Erection',
      location: 'Area C',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      baselineProgress: 0
    });

    activityRepo.create({
      projectId: testProject.id,
      scheduleId: testSchedule.id,
      externalId: 'ACT-D02',
      name: 'Crude Distillation Piping Loop',
      location: 'Area D',
      plannedStart: '2026-08-10',
      plannedFinish: '2026-08-25',
      baselineProgress: 0
    });

    // Mock AI Service for Grounded Text Assistant
    mockAiService = {
      extractStructured: vi.fn()
    } as unknown as AIService;

    intentService = {
      interpret: vi.fn()
    } as unknown as AssistantIntentService;

    factBuilder = new VerifiedFactBuilder(intelligenceService, snapshotService, activityProgressRepo);

    assistantService = new AssistantService(
      mockAiService,
      intentService,
      activityResolver,
      factBuilder,
      projectRepo
    );

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
      progressService,
      assistantService
    });
  });

  describe('Criterion 1: Worker session calling record_field_progress succeeds and confirms', () => {
    it('allows worker session to record field progress and commits canonical update', async () => {
      // Mock extraction result for Pipe Rack PR-07
      (mockExtractionService.extractFromReport as any).mockResolvedValueOnce({
        items: [
          {
            reference: 'Pipe Rack PR-07 Structural Erection',
            location: 'Area C',
            progress_percent: 60,
            status: 'in_progress'
          }
        ]
      });

      const dispatchedConfirmations: string[] = [];
      const clientEvents: Record<string, any>[] = [];

      const workerContext: LiveToolExecutionContext = {
        sessionRole: 'worker',
        session: {
          dispatchVerbalConfirmation: (text: string) => dispatchedConfirmations.push(text),
          sendToClient: (payload: Record<string, any>) => clientEvents.push(payload)
        }
      };

      const result = await handlers.executeTool(
        testProject.id,
        {
          id: 'call-1',
          name: 'record_field_progress',
          args: {
            projectId: testProject.id,
            rawStatement: 'Finished 60% of pipe rack PR-07 structure today.'
          }
        },
        workerContext
      );

      expect(result.status).toBe('queued');
      expect(result.message).toContain('Progress statement captured');

      // Allow async processing to complete
      await new Promise((r) => setTimeout(r, 60));

      expect(dispatchedConfirmations.length).toBeGreaterThan(0);
      expect(dispatchedConfirmations[0]).toContain('Update verified:');
      expect(dispatchedConfirmations[0]).toContain('Pipe Rack PR-07');
      expect(clientEvents.some((e) => e.type === 'progress_verified')).toBe(true);

      // Verify canonical progress committed
      const actC01 = activityRepo.listByProjectId(testProject.id).find((a) => a.externalId === 'ACT-C01');
      expect(actC01).toBeDefined();
      const latestProgress = activityProgressRepo.getLatestByActivityId(actC01!.id);
      expect(latestProgress).toBeDefined();
      expect(latestProgress?.actualPercent).toBe(60);
    });
  });

  describe('Criterion 2: Worker session calling get_project_intelligence blocked by role policy', () => {
    it('blocks worker session from calling get_project_intelligence with graceful control room message', async () => {
      const workerContext: LiveToolExecutionContext = {
        sessionRole: 'worker'
      };

      const result = await handlers.executeTool(
        testProject.id,
        {
          id: 'call-intel-1',
          name: 'get_project_intelligence',
          args: {
            projectId: testProject.id
          }
        },
        workerContext
      );

      expect(result.status).toBe('role_restricted');
      expect(result.tool).toBe('get_project_intelligence');
      expect(result.message).toBe('This query requires project control room access.');
    });

    it('blocks worker session from calling query_project_assistant with graceful control room message', async () => {
      const workerContext: LiveToolExecutionContext = {
        sessionRole: 'worker'
      };

      const result = await handlers.executeTool(
        testProject.id,
        {
          id: 'call-query-1',
          name: 'query_project_assistant',
          args: {
            projectId: testProject.id,
            question: 'What is the systemic variance across all contractors?'
          }
        },
        workerContext
      );

      expect(result.status).toBe('role_restricted');
      expect(result.tool).toBe('query_project_assistant');
      expect(result.message).toBe('This query requires project control room access.');
    });

    it('allows admin session to execute get_project_intelligence cleanly', async () => {
      const adminContext: LiveToolExecutionContext = {
        sessionRole: 'admin'
      };

      const result = await handlers.executeTool(
        testProject.id,
        {
          id: 'call-intel-admin',
          name: 'get_project_intelligence',
          args: {
            projectId: testProject.id
          }
        },
        adminContext
      );

      expect(result.status).toBe('success');
      expect(result.projectCode).toBe('REFINERY-U4');
      expect(result.health).toBeDefined();
      expect(result.delayedActivities).toBeDefined();
    });
  });

  describe('Criterion 3: Worker asking "What is delayed across all 6 areas?" returns operational scope boundary', () => {
    it('intercepts systemic delay query across all areas and returns operational boundary response', async () => {
      (intentService.interpret as any).mockResolvedValueOnce({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      });

      const response = await assistantService.answerQuestion(
        testProject.id,
        'What is delayed across all 6 areas?',
        {
          asOfDate: '2026-08-28',
          role: 'worker'
        }
      );

      expect(response.status).toBe('scope_restricted');
      expect(response.grounded).toBe(true);
      expect(response.answer).toContain('This query requires project control room access.');
      expect(response.answer).toContain('operational tasks');
      expect(response.verifiedFacts).toEqual([]);
      expect(response.claims).toEqual([]);
    });

    it('intercepts portfolio behind-schedule query for worker role', async () => {
      (intentService.interpret as any).mockResolvedValueOnce({
        intent: 'behind_schedule',
        activityQuery: null,
        explicitDate: null
      });

      const response = await assistantService.answerQuestion(
        testProject.id,
        'Show me portfolio delay matrix and behind schedule packages',
        {
          asOfDate: '2026-08-28',
          role: 'worker'
        }
      );

      expect(response.status).toBe('scope_restricted');
      expect(response.answer).toContain('This query requires project control room access.');
    });
  });

  describe('Criterion 4: Admin session asking systemic questions returns full grounded fact synthesis', () => {
    it('synthesizes full grounded fact response for admin role', async () => {
      (intentService.interpret as any).mockResolvedValueOnce({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      });

      // Mock AI synthesis response
      (mockAiService.extractStructured as any).mockResolvedValueOnce({
        answer: '## Delayed Activities Summary\n\nActivity ACT-C01 is delayed past its planned finish date.',
        claims: [
          {
            type: 'classification',
            factRef: 'delayed:ACT-C01',
            field: 'classification',
            value: 'DELAYED',
            text: 'ACT-C01 is classified as DELAYED.'
          }
        ]
      });

      const response = await assistantService.answerQuestion(
        testProject.id,
        'What is delayed across all 6 areas?',
        {
          asOfDate: '2026-08-28',
          role: 'admin'
        }
      );

      expect(response.status).toBe('success');
      expect(response.grounded).toBe(true);
      expect(response.answer).toContain('Delayed Activities Summary');
      expect(response.claims?.length).toBe(1);
      expect(response.factRefs).toContain('delayed:ACT-C01');
      expect(response.verifiedFacts.length).toBeGreaterThan(0);
    });
  });

  describe('Criterion 5: Zero hallucination guarantee & Worker fact sanitization', () => {
    it('sanitizes systemic variance metrics (progressVariance, varianceState) when worker asks permitted task query', async () => {
      (intentService.interpret as any).mockResolvedValueOnce({
        intent: 'activity_status',
        activityQuery: 'ACT-C01',
        explicitDate: null
      });

      (mockAiService.extractStructured as any).mockResolvedValueOnce({
        answer: 'Pipe Rack PR-07 (ACT-C01) is located in Area C and is not started.',
        claims: [
          {
            type: 'status',
            factRef: 'activity_status:ACT-C01',
            field: 'status',
            value: 'not_started',
            text: 'ACT-C01 execution status is not_started.'
          }
        ]
      });

      const response = await assistantService.answerQuestion(
        testProject.id,
        'What is the status of ACT-C01?',
        {
          asOfDate: '2026-08-28',
          role: 'worker'
        }
      );

      expect(response.status).toBe('success');
      expect(response.grounded).toBe(true);
      expect(response.claims?.length).toBe(1);

      // Verify that verifiedFacts provided to worker omit progressVariance and varianceState
      for (const fact of response.verifiedFacts) {
        expect((fact.data as any).progressVariance).toBeUndefined();
        expect((fact.data as any).varianceState).toBeUndefined();
        expect(fact.summary).not.toContain('progress variance:');
        expect(fact.summary).not.toContain('variance state:');
      }
    });

    it('rejects hallucinated fact reference in admin claims with AIProviderError', async () => {
      (intentService.interpret as any).mockResolvedValueOnce({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      });

      // AI hallucinates a non-existent fact ref
      (mockAiService.extractStructured as any).mockResolvedValueOnce({
        answer: 'Phantom activity is delayed.',
        claims: [
          {
            type: 'classification',
            factRef: 'delayed:NON_EXISTENT_ACTIVITY',
            field: 'classification',
            value: 'DELAYED',
            text: 'Non-existent activity is delayed.'
          }
        ]
      });

      await expect(
        assistantService.answerQuestion(testProject.id, 'What is delayed?', {
          asOfDate: '2026-08-28',
          role: 'admin'
        })
      ).rejects.toThrow('response cited unverified fact reference');
    });
  });

  describe('Scoped search_project_activities and WebSocket session role attribution', () => {
    it('scopes search_project_activities for worker, removing plannedProgress and overdue', async () => {
      const workerResult = await handlers.executeTool(
        testProject.id,
        {
          id: 'search-1',
          name: 'search_project_activities',
          args: { projectId: testProject.id, query: 'Area C' }
        },
        { sessionRole: 'worker' }
      );

      expect(workerResult.status).toBe('success');
      expect(workerResult.activities.length).toBeGreaterThan(0);
      const workerItem = workerResult.activities[0];
      expect(workerItem.code).toBe('ACT-C01');
      expect(workerItem.location).toBe('Area C');
      expect(workerItem.actualProgress).toBeDefined();
      expect((workerItem as any).plannedProgress).toBeUndefined();
      expect((workerItem as any).overdue).toBeUndefined();

      const adminResult = await handlers.executeTool(
        testProject.id,
        {
          id: 'search-2',
          name: 'search_project_activities',
          args: { projectId: testProject.id, query: 'Area C' }
        },
        { sessionRole: 'admin' }
      );

      const adminItem = adminResult.activities[0];
      expect(adminItem.plannedProgress).toBeDefined();
      expect(adminItem.overdue).toBeDefined();
    });

    it('verifies GeminiLiveGateway inspects session token and attributes correct sessionRole', () => {
      const keyRouter = new GeminiKeyRouter({
        apiKeys: ['mock-key-1', 'mock-key-2']
      });

      const gateway = new GeminiLiveGateway({
        keyRouter,
        projectResolver: projectRepo
      });

      // Create worker token
      const workerToken = authService.createSessionToken({
        projectId: testProject.id,
        accountType: 'worker',
        displayName: 'Site Crew'
      });

      const adminToken = authService.createSessionToken({
        projectId: testProject.id,
        accountType: 'admin',
        displayName: 'EPC Manager'
      });

      // Verify token extraction in simulated WebSocket connection
      const fakeWs = {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn()
      } as any;

      const reqWorker = {
        url: `/ws/live-session?projectId=${testProject.id}&token=${workerToken}`
      } as any;

      gateway.handleClientConnection(fakeWs, reqWorker);
      expect(gateway.getActiveSessionsCount()).toBe(1);

      const sessions = gateway.getSessionsForProject(testProject.id);
      expect(sessions[0].sessionRole).toBe('worker');

      gateway.closeAllSessions();

      const reqAdmin = {
        url: `/ws/live-session?projectId=${testProject.id}&token=${adminToken}`
      } as any;

      gateway.handleClientConnection(fakeWs, reqAdmin);
      const adminSessions = gateway.getSessionsForProject(testProject.id);
      expect(adminSessions[0].sessionRole).toBe('admin');

      gateway.closeAllSessions();
    });
  });
});
