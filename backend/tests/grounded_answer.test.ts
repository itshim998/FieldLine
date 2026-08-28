import { describe, it, expect, vi } from 'vitest';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { ProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.types.js';

describe('Field-Level Deterministic Grounding Validation (Pass 18 Final Correction)', () => {
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
          plannedProgress: 80,
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

  it('valid metric claim accepted (actualProgress = 62)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'actualProgress',
            value: 62,
            text: 'Foundation B is 62% complete.'
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

    const res = await service.answerQuestion(projectId, 'What is the status of Foundation B?');
    expect(res.grounded).toBe(true);
    expect(res.status).toBe('success');
    expect(res.factRefs).toEqual(['at_risk:FOUNDATION-B']);
    expect(res.claims?.length).toBe(1);
    expect(res.answer).toBe('Foundation B is 62% complete.');
  });

  it('valid variance claim accepted (progressVariance = -18)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'variance',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'progressVariance',
            value: -18,
            text: 'Foundation B is 18 percentage points behind plan.'
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

    const res = await service.answerQuestion(projectId, 'What is the variance of Foundation B?');
    expect(res.grounded).toBe(true);
    expect(res.answer).toBe('Foundation B is 18 percentage points behind plan.');
  });

  it('valid classification claim accepted (classification = AT_RISK)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'classification',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'classification',
            value: 'AT_RISK',
            text: 'Foundation B is at risk.'
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

    const res = await service.answerQuestion(projectId, 'Why is Foundation B classified at risk?');
    expect(res.grounded).toBe(true);
    expect(res.answer).toBe('Foundation B is at risk.');
  });

  it('valid date claim accepted (plannedFinish = 2026-08-20)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'date',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'plannedFinish',
            value: '2026-08-20',
            text: "Foundation B's planned finish is August 20."
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

    const res = await service.answerQuestion(projectId, 'When was Foundation B planned to finish?');
    expect(res.grounded).toBe(true);
    expect(res.answer).toBe("Foundation B's planned finish is August 20.");
  });

  it('valid reason claim accepted (reason.code = NEGATIVE_PROGRESS_VARIANCE)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'reason',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'reason.code',
            value: 'NEGATIVE_PROGRESS_VARIANCE',
            text: 'Foundation B is at risk because it is behind planned progress.'
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
    expect(res.answer).toBe('Foundation B is at risk because it is behind planned progress.');
  });

  it('wrong value rejected (actualProgress = 75 vs authoritative 62)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'actualProgress',
            value: 75,
            text: 'Foundation B is 75% complete.'
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

    await expect(service.answerQuestion(projectId, 'What is the progress?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'What is the progress?')).rejects.toThrow(
      /does not match authoritative fact value/i
    );
  });

  it('nonexistent / invented forecast field rejected (field: forecastFinish)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'date',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'forecastFinish',
            value: '2026-09-10',
            text: 'Foundation B will finish on September 10.'
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

    await expect(service.answerQuestion(projectId, 'When will Foundation B finish?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'When will Foundation B finish?')).rejects.toThrow(
      /unallowed or nonexistent field/i
    );
  });

  it('invented duration rejected (field: delayedWeeks)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'delayedWeeks',
            value: 3,
            text: 'Foundation B has been delayed for three weeks.'
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

    await expect(service.answerQuestion(projectId, 'How long is Foundation B delayed?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('invented priority rejected (field: priority)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'status',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'priority',
            value: 'highest',
            text: 'Foundation B is the highest-priority project issue.'
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

    await expect(service.answerQuestion(projectId, 'Is Foundation B highest priority?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('wrong activity identity rejected (activityName = Foundation C vs Foundation B)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'activity_identity',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'activityName',
            value: 'Foundation C',
            text: 'Foundation C is at risk.'
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

    await expect(service.answerQuestion(projectId, 'What is at risk?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('unsupported cause rejected (reason.code = UNDERSTAFFED vs NEGATIVE_PROGRESS_VARIANCE)', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'reason',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'reason.code',
            value: 'UNDERSTAFFED',
            text: 'The contractor is understaffed.'
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

  it('unknown factRef rejected', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'fake-ref-999',
            field: 'actualProgress',
            value: 62,
            text: 'Foundation B is 62% complete.'
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

    await expect(service.answerQuestion(projectId, 'What is the status?')).rejects.toThrow(
      AIProviderError
    );
    await expect(service.answerQuestion(projectId, 'What is the status?')).rejects.toThrow(
      /unverified fact reference/i
    );
  });

  it('missing factRef rejected', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: '',
            field: 'actualProgress',
            value: 62,
            text: 'Foundation B is 62% complete.'
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

    await expect(service.answerQuestion(projectId, 'What is the status?')).rejects.toThrow();
  });

  it('multiple valid claims accepted and concatenated into final answer', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'actualProgress',
            value: 62,
            text: 'Foundation B is 62% complete.'
          },
          {
            type: 'variance',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'progressVariance',
            value: -18,
            text: 'It is 18 percentage points behind plan.'
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
    expect(res.answer).toBe('Foundation B is 62% complete. It is 18 percentage points behind plan.');
  });

  it('Section 17: Complete answer grounding test with valid claim + invalid forecast claim MUST reject entire response', async () => {
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        claims: [
          {
            type: 'metric',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'actualProgress',
            value: 62,
            text: 'Foundation B is 62% complete.'
          },
          {
            type: 'date',
            factRef: 'at_risk:FOUNDATION-B',
            field: 'forecastFinish',
            value: '2026-09-10',
            text: 'Foundation B will finish on September 10.'
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

    await expect(service.answerQuestion(projectId, 'When will Foundation B finish?')).rejects.toThrow(
      AIProviderError
    );
  });

  it('empty verified fact set test (bypasses LLM, returns deterministic response)', async () => {
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
