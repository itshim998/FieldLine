import { describe, it, expect, vi } from 'vitest';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { AIProviderError } from '../src/errors/AppError.js';
import { ProjectIntelligenceService } from '../src/services/intelligence/project-intelligence.types.js';

describe('Grounded Answer Generation & Fact Reference Validation (Pass 18)', () => {
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
    list: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
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

  it('should accept answer when all cited factRefs exist in the verified fact set', async () => {
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
        answer: 'Foundation B Pouring (ACT-101) is delayed by 40% variance since planned finish was 2026-08-20.',
        factRefs: ['delayed:ACT-101']
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
    expect(res.answer).toContain('Foundation B Pouring');
  });

  it('should reject answer when LLM cites unknown or hallucinated factRefs', async () => {
    const fakeIntentService = {
      interpret: vi.fn().mockResolvedValue({
        intent: 'delayed',
        activityQuery: null,
        explicitDate: null
      })
    } as unknown as AssistantIntentService;

    // LLM attempts to hallucinate an unknown factRef 'delayed:ACT-999'
    const fakeAIService: AIService = {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockResolvedValue({
        answer: 'Some hallucinated task is delayed.',
        factRefs: ['delayed:ACT-999']
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

  it('should return safe insufficient_data response when verified facts set is empty', async () => {
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
    expect(res.factRefs).toEqual([]);
    expect(res.verifiedFacts).toEqual([]);
    expect(res.answer).toContain('No delayed or overdue activities were found');
    // AI extractStructured should not even be called when fact set is empty
    expect(fakeAIService.extractStructured).not.toHaveBeenCalled();
  });
});
