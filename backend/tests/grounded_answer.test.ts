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
      delayed: [],
      atRisk: [
        {
          activityId: 'act-101',
          externalId: 'FOUNDATION-B',
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

  const fakeActivityRepo = {
    listByProjectId: vi.fn().mockReturnValue([
      {
        id: 'act-101',
        projectId,
        scheduleId: 'sch-1',
        externalId: 'FOUNDATION-B',
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

  const fakeIntentService = {
    interpret: vi.fn().mockResolvedValue({
      intent: 'at_risk',
      activityQuery: 'Foundation B',
      explicitDate: null
    })
  } as unknown as AssistantIntentService;

  it('Section 10: Unsupported causal claim test (MUST NOT be accepted)', async () => {
    // Fact contains variance info but no staffing info. Model returns unsupported "contractor is understaffed" claim.
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is at risk because the contractor is understaffed.',
            factRefs: ['at_risk:FOUNDATION-B']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'Why is Foundation B at risk?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'Why is Foundation B at risk?')).rejects.toThrow(
      /unsupported workforce \/ labor \/ staffing causes/i
    );
  });

  it('Section 11: Valid grounded claim test (MUST be accepted)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is 62% complete against 80% planned.',
            factRefs: ['at_risk:FOUNDATION-B']
          },
          {
            text: 'It is therefore 18 percentage points behind plan.',
            factRefs: ['at_risk:FOUNDATION-B']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'Why is Foundation B at risk?');
    expect(res.grounded).toBe(true);
    expect(res.status).toBe('success');
    expect(res.factRefs).toEqual(['at_risk:FOUNDATION-B']);
    expect(res.claims?.length).toBe(2);
    expect(res.answer).toContain('Foundation B is 62% complete against 80% planned.');
    expect(res.answer).toContain('18 percentage points behind plan.');
  });

  it('Section 12: Missing-reference test (MUST be rejected without auto-fill)', async () => {
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
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'Why is Foundation B at risk?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('Section 13: Unknown-reference test (MUST be rejected)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is 62% complete.',
            factRefs: ['fake-ref']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    await expect(service.answerQuestion(projectId, 'Why is Foundation B at risk?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'Why is Foundation B at risk?')).rejects.toThrow(
      /unverified fact references/i
    );
  });

  it('Section 14: Multiple claims test (MUST be accepted)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            text: 'Foundation B is 62% complete.',
            factRefs: ['at_risk:FOUNDATION-B']
          },
          {
            text: 'Planned progress is 80%.',
            factRefs: ['at_risk:FOUNDATION-B']
          }
        ]
      })
    };

    const factBuilder = new VerifiedFactBuilder(fakeIntelligenceService);
    const service = new AssistantService(
      fakeAIService,
      fakeIntentService,
      new DeterministicActivityResolver(fakeActivityRepo as any),
      factBuilder,
      fakeProjectRepo
    );

    const res = await service.answerQuestion(projectId, 'Why is Foundation B at risk?');
    expect(res.grounded).toBe(true);
    expect(res.claims?.length).toBe(2);
    expect(res.factRefs).toEqual(['at_risk:FOUNDATION-B']);
  });

  it('Section 15: Empty verified fact set test (bypasses LLM, returns deterministic response)', async () => {
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

    const emptyIntentService = {
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
      emptyIntentService,
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
