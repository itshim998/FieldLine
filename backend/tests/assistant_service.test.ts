import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { ActivityRepository } from '../src/repositories/activity.repository.js';
import { ProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.types.js';

describe('AssistantService End-to-End Test Suite (Pass 18)', () => {
  const projectId = 'aaaa1111-1111-1111-1111-111111111111';

  const mockProject = {
    id: projectId,
    name: 'Coastal Expressway Project',
    description: 'High-speed coastal transit corridor',
    code: 'CEP-01',
    status: 'active' as const,
    startDate: '2026-01-01',
    targetEndDate: '2026-12-31',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };

  const mockActivities = [
    {
      id: 'act-1',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'ACT-001',
      name: 'Foundation B Pouring',
      description: null,
      wbsCode: '1.1',
      location: 'Pier 4',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-15',
      plannedQuantity: 100,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'act-2',
      projectId,
      scheduleId: 'sch-1',
      externalId: 'ACT-002',
      name: 'Pier 12 Excavation',
      description: null,
      wbsCode: '1.2',
      location: 'Pier 12',
      plannedStart: '2026-08-01',
      plannedFinish: '2026-08-25',
      plannedQuantity: 200,
      unit: 'm3',
      baselineProgress: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
  ];

  const fakeProjectRepo: ProjectRepository = {
    create: vi.fn(),
    getById: vi.fn().mockImplementation((id: string) => (id === projectId ? mockProject : null)),
    getByCode: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn()
  };

  const fakeActivityRepo: ActivityRepository = {
    create: vi.fn(),
    createMany: vi.fn(),
    getById: vi.fn(),
    getByIdAndProjectId: vi.fn(),
    listByScheduleId: vi.fn(),
    listByProjectId: vi.fn().mockReturnValue(mockActivities),
    countByScheduleId: vi.fn(),
    countByProjectId: vi.fn()
  };

  const fakeIntelligenceData = {
    projectId,
    asOfDate: '2026-08-28',
    generatedAt: '2026-08-28T00:00:00.000Z',
    delayed: [
      {
        activityId: 'act-1',
        externalId: 'ACT-001',
        name: 'Foundation B Pouring',
        plannedFinish: '2026-08-15',
        actualProgress: 60,
        progressVariance: -40,
        overdue: true,
        classification: 'DELAYED' as const,
        reasons: [{ code: 'OBJECTIVE_OVERDUE' as const, message: 'Planned finish 2026-08-15 has elapsed' }]
      }
    ],
    atRisk: [
      {
        activityId: 'act-1',
        externalId: 'ACT-001',
        name: 'Foundation B Pouring',
        classification: 'AT_RISK' as const,
        reasons: [{ code: 'STRONG_NEGATIVE_VARIANCE' as const, message: 'Progress variance is -40%' }],
        plannedFinish: '2026-08-15',
        actualProgress: 60,
        progressVariance: -40
      }
    ],
    completedToday: [
      {
        activityId: 'act-2',
        externalId: 'ACT-002',
        name: 'Pier 12 Excavation',
        progressUpdateId: 'upd-99',
        asOfDate: '2026-08-28',
        actualPercent: 100,
        actualFinish: '2026-08-28',
        status: 'completed' as const
      }
    ],
    behindSchedule: [
      {
        activityId: 'act-1',
        externalId: 'ACT-001',
        name: 'Foundation B Pouring',
        plannedProgress: 100,
        actualProgress: 60,
        progressVariance: -40,
        varianceState: 'BEHIND' as const,
        status: 'in_progress' as const,
        plannedFinish: '2026-08-15',
        overdue: true
      }
    ],
    approachingMilestones: [
      {
        activityId: 'act-m1',
        externalId: 'MS-001',
        name: 'Foundation Phase Completion',
        milestoneDate: '2026-09-05',
        daysUntil: 8,
        status: 'not_started' as const,
        actualProgress: 0
      }
    ],
    staleActivities: [
      {
        activityId: 'act-2',
        externalId: 'ACT-002',
        name: 'Pier 12 Excavation',
        latestUpdateDate: '2026-08-10',
        daysSinceUpdate: 18,
        hasAnyUpdate: true
      }
    ],
    recentChanges: [
      {
        eventId: 'evt-1',
        eventType: 'PROGRESS_RECORDED',
        entityType: 'activity_progress',
        entityId: 'act-1',
        summary: 'Progress recorded for Foundation B Pouring: 60%',
        createdAt: '2026-08-28T08:00:00.000Z',
        payload: { percent: 60 }
      }
    ]
  };

  const fakeIntelligenceService: ProjectIntelligenceService = {
    getIntelligence: vi.fn().mockReturnValue(fakeIntelligenceData)
  };

  const resolver = new DeterministicActivityResolver(fakeActivityRepo);
  const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);

  it('Query 1: "What is delayed?" -> returns delayed activities with verified factRefs', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B Pouring (ACT-001) is currently delayed with 60% completion against planned finish 2026-08-15.',
            factRefs: ['delayed:ACT-001']
          }
        ]
      })
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What is delayed?');
    expect(res.intent.intent).toBe('delayed');
    expect(res.grounded).toBe(true);
    expect(res.factRefs).toContain('delayed:ACT-001');
    expect(res.verifiedFacts.length).toBe(1);
    expect(res.verifiedFacts[0].ref).toBe('delayed:ACT-001');
  });

  it('Query 2: "Why is Foundation B at risk?" -> resolves activity deterministically and returns risk reasons', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'at_risk',
        activityQuery: 'Foundation B',
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B Pouring (ACT-001) is at risk due to a strong negative variance of -40% (planned finish was 2026-08-15).',
            factRefs: ['at_risk:ACT-001']
          }
        ]
      })
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'Why is Foundation B at risk?');
    expect(res.intent.intent).toBe('at_risk');
    expect(res.resolvedActivity?.externalId).toBe('ACT-001');
    expect(res.grounded).toBe(true);
    expect(res.factRefs).toContain('at_risk:ACT-001');
  });

  it('Query 3: "What changed today?" -> returns recent change event facts', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'recent_changes',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Today, progress of 60% was recorded for Foundation B Pouring.',
            factRefs: ['event:evt-1']
          }
        ]
      })
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What changed today?');
    expect(res.intent.intent).toBe('recent_changes');
    expect(res.grounded).toBe(true);
    expect(res.factRefs).toContain('event:evt-1');
  });

  it('Query 4: "Which activities are most behind schedule?" -> preserves deterministic variance ranking', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'behind_schedule',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B Pouring (ACT-001) is most behind schedule with a progress variance of -40%.',
            factRefs: ['behind_schedule:ACT-001']
          }
        ]
      })
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'Which activities are most behind schedule?');
    expect(res.intent.intent).toBe('behind_schedule');
    expect(res.grounded).toBe(true);
    expect(res.verifiedFacts[0].ref).toBe('behind_schedule:ACT-001');
  });

  it('Query 5: "Tell me about imaginary activity X" -> returns activity_not_found without hallucination', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'activity_status',
        activityQuery: 'Imaginary Activity X',
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn()
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'Tell me about imaginary activity X');
    expect(res.status).toBe('activity_not_found');
    expect(res.grounded).toBe(false);
    expect(res.answer).toContain('No activity matching "Imaginary Activity X" was found');
    expect(fakeAIService.extractStructured).not.toHaveBeenCalled();
  });

  it('Query 6: "What is the weather?" -> returns unsupported query without querying project data', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'unsupported',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn()
    };

    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      resolver,
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What is the weather?');
    expect(res.status).toBe('unsupported');
    expect(res.grounded).toBe(false);
    expect(res.answer).toContain('This question cannot be answered from project tracking data');
    expect(fakeAIService.extractStructured).not.toHaveBeenCalled();
  });
});
