import { describe, it, expect, vi } from 'vitest';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { ProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.types.js';

describe('Grounded Answer Generation & Fact Reference Validation (Pass 18 Corrective)', () => {
  const projectId = '11111111-1111-1111-1111-111111111111';

  const mockProject = {
    id: projectId,
    name: 'Metro Line 3',
    description: 'Test Project',
    code: 'ML3',
    status: 'active' as const,
    startDate: '2026-01-01',
    targetEndDate: '2026-12-31',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };

  const fakeProjectRepo: ProjectRepository = {
    create: vi.fn(),
    getById: vi.fn().mockImplementation((id: string) => (id === projectId ? mockProject : null)),
    getByCode: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn()
  };

  const fakeIntelligenceService: ProjectIntelligenceService = {
    getIntelligence: vi.fn().mockReturnValue({
      projectId,
      asOfDate: '2026-08-28',
      generatedAt: '2026-08-28T00:00:00.000Z',
      delayed: [
        {
          activityId: 'act-101',
          externalId: 'ACT-101',
          name: 'Foundation B Pouring',
          plannedFinish: '2026-08-20',
          actualProgress: 60,
          progressVariance: -40,
          overdue: true,
          classification: 'DELAYED',
          reasons: [{ code: 'OBJECTIVE_OVERDUE', message: 'Planned finish has passed' }]
        },
        {
          activityId: 'act-102',
          externalId: 'ACT-102',
          name: 'Pier 4 Reinforcement',
          plannedFinish: '2026-08-22',
          actualProgress: 30,
          progressVariance: -70,
          overdue: true,
          classification: 'DELAYED',
          reasons: [{ code: 'OBJECTIVE_OVERDUE', message: 'Overdue finish' }]
        }
      ],
      atRisk: [],
      completedToday: [],
      behindSchedule: [],
      approachingMilestones: [],
      staleActivities: [],
      recentChanges: []
    })
  };

  it('Section 15.1: should accept valid grounded answer with structured claims citing valid factRefs', async () => {
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
            text: 'Foundation B Pouring (ACT-101) is delayed by 40% variance since planned finish was 2026-08-20.',
            factRefs: ['delayed:ACT-101']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What is delayed?');
    expect(res.grounded).toBe(true);
    expect(res.factRefs).toEqual(['delayed:ACT-101']);
    expect(res.claims?.length).toBe(1);
    expect(res.answer).toContain('Foundation B Pouring');
  });

  it('Section 15.2: should reject answer when LLM cites unknown or hallucinated factRefs', async () => {
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
            text: 'Some hallucinated task is delayed.',
            factRefs: ['fake-reference']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'What is delayed?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'What is delayed?')).rejects.toThrow(
      /unverified fact references/i
    );
  });

  it('Section 15.3: should reject answer when claim has missing references (factRefs: [])', async () => {
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
            text: 'Foundation B is 62% complete.',
            factRefs: []
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'What is delayed?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('Section 15.4: should reject unsupported causal claim even when citing a valid fact reference', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    // Fact 'delayed:ACT-101' contains schedule/variance info, but NO workforce or staffing information.
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is delayed because the contractor has insufficient workers.',
            factRefs: ['delayed:ACT-101']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'What is delayed?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'What is delayed?')).rejects.toThrow(
      /unsupported workforce \/ labor \/ staffing causes/i
    );
  });

  it('Section 15.5: should accept multiple claims citing distinct valid references', async () => {
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
            text: 'Foundation B Pouring (ACT-101) is overdue with 60% progress.',
            factRefs: ['delayed:ACT-101']
          },
          {
            text: 'Pier 4 Reinforcement (ACT-102) is also delayed with 30% actual progress.',
            factRefs: ['delayed:ACT-102']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What is delayed?');
    expect(res.grounded).toBe(true);
    expect(res.factRefs).toEqual(['delayed:ACT-101', 'delayed:ACT-102']);
    expect(res.claims?.length).toBe(2);
    expect(res.answer).toContain('Foundation B Pouring');
    expect(res.answer).toContain('Pier 4 Reinforcement');
  });

  it('Section 16: End-to-end grounding test for "Why is Foundation B at risk?"', async () => {
    const foundationBIntelligenceService: ProjectIntelligenceService = {
      getIntelligence: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T00:00:00.000Z',
        delayed: [],
        atRisk: [
          {
            activityId: 'act-101',
            externalId: 'ACT-101',
            name: 'Foundation B',
            plannedFinish: '2026-08-20',
            actualProgress: 62,
            progressVariance: -18,
            classification: 'AT_RISK',
            reasons: [{ code: 'NEGATIVE_PROGRESS_VARIANCE', message: 'behind planned progress' }]
          }
        ],
        completedToday: [],
        behindSchedule: [],
        approachingMilestones: [],
        staleActivities: [],
        recentChanges: []
      })
    };

    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'at_risk',
        activityQuery: 'Foundation B',
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeActivityRepo = {
      listByProjectId: vi.fn().mockReturnValue([
        {
          id: 'act-101',
          projectId,
          scheduleId: 'sch-1',
          externalId: 'ACT-101',
          name: 'Foundation B',
          description: null,
          wbsCode: '1.1',
          location: null,
          plannedStart: '2026-08-01',
          plannedFinish: '2026-08-20',
          plannedQuantity: 100,
          unit: 'm3',
          baselineProgress: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        }
      ])
    };

    // 1. Simulate model hallucinating "understaffed" cause
    const hallucinatingAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is at risk because the contractor is understaffed.',
            factRefs: ['at_risk:ACT-101']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(foundationBIntelligenceService);
    const serviceWithHallucination = new AssistantService(
      hallucinatingAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(
      serviceWithHallucination.answerQuestion(projectId, 'Why is Foundation B at risk?')
    ).rejects.toThrow(AIProviderError);

    // 2. Simulate model providing accurate grounded claim from verified facts
    const groundedAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is at risk because actual progress is 62% against 80% planned, a -18 percentage-point variance.',
            factRefs: ['at_risk:ACT-101']
          }
        ]
      })
    };

    const serviceGrounded = new AssistantService(
      groundedAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await serviceGrounded.answerQuestion(projectId, 'Why is Foundation B at risk?');
    expect(res.grounded).toBe(true);
    expect(res.status).toBe('success');
    expect(res.factRefs).toEqual(['at_risk:ACT-101']);
    expect(res.answer).toContain('62%');
    expect(res.answer).toContain('-18');
  });

  it('Section 15.6: should return safe insufficient_data response when verified facts set is empty', async () => {
    const emptyIntelligenceService: ProjectIntelligenceService = {
      getIntelligence: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T00:00:00.000Z',
        delayed: [],
        atRisk: [],
        completedToday: [],
        behindSchedule: [],
        approachingMilestones: [],
        staleActivities: [],
        recentChanges: []
      })
    };

    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn()
    };

    const factBuilder = new VerifiedFactBuilder(emptyIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver({ listByProjectId: () => [] } as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'What is delayed?');
    expect(res.grounded).toBe(false);
    expect(res.status).toBe('insufficient_data');
    expect(res.claims).toEqual([]);
    expect(res.factRefs).toEqual([]);
    expect(res.verifiedFacts).toEqual([]);
    expect(res.answer).toContain('No delayed or overdue activities were found');
    expect(fakeAIService.extractStructured).not.toHaveBeenCalled();
  });
});
