import { describe, it, expect, vi } from 'vitest';
import {
  AssistantIntentService,
  buildIntentInterpretationPrompt
} from '../src/services/assistant/assistant-intent.service.js';
import { AIService } from '../src/ai/services/ai.service.js';
import { ValidationError, AIProviderError } from '../src/errors/AppError.js';
import { AssistantIntent } from '../src/ai/contracts/assistant.contract.js';

describe('AssistantIntentService & Intent Interpretation (Pass 18)', () => {
  function createFakeAIService(mockReturn: unknown): AIService {
    return {
      generateText: vi.fn(),
      extractStructured: vi.fn().mockImplementation(async (_prompt, schema) => {
        const parsed = schema.safeParse(mockReturn);
        if (!parsed.success) {
          throw new AIProviderError('Mock AI response failed schema validation', parsed.error.issues);
        }
        return parsed.data;
      })
    };
  }

  it('should interpret "What is delayed?" as delayed intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'delayed',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('What is delayed?');
    expect(result.intent).toBe('delayed');
    expect(result.activityQuery).toBeNull();
    expect(result.explicitDate).toBeNull();
  });

  it('should interpret "Why is Foundation B at risk?" as at_risk intent with activityQuery', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'at_risk',
      activityQuery: 'Foundation B',
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('Why is Foundation B at risk?');
    expect(result.intent).toBe('at_risk');
    expect(result.activityQuery).toBe('Foundation B');
  });

  it('should interpret "What completed today?" as completed_today intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'completed_today',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('What completed today?');
    expect(result.intent).toBe('completed_today');
  });

  it('should interpret "Which activities are most behind schedule?" as behind_schedule intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'behind_schedule',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('Which activities are most behind schedule?');
    expect(result.intent).toBe('behind_schedule');
  });

  it('should interpret "Which milestones are approaching?" as approaching_milestones intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'approaching_milestones',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('Which milestones are approaching?');
    expect(result.intent).toBe('approaching_milestones');
  });

  it('should interpret "Which activities have no recent updates?" as stale_activities intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'stale_activities',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('Which activities have no recent updates?');
    expect(result.intent).toBe('stale_activities');
  });

  it('should interpret "What changed on 2026-08-25?" as recent_changes with explicitDate', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'recent_changes',
      activityQuery: null,
      explicitDate: '2026-08-25'
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('What changed on 2026-08-25?');
    expect(result.intent).toBe('recent_changes');
    expect(result.explicitDate).toBe('2026-08-25');
  });

  it('should interpret "What is the status of Pier 12?" as activity_status intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'activity_status',
      activityQuery: 'Pier 12',
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('What is the status of Pier 12?');
    expect(result.intent).toBe('activity_status');
    expect(result.activityQuery).toBe('Pier 12');
  });

  it('should interpret "What is the weather outside?" as unsupported intent', async () => {
    const fakeIntent: AssistantIntent = {
      intent: 'unsupported',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(fakeIntent));

    const result = await service.interpret('What is the weather outside?');
    expect(result.intent).toBe('unsupported');
  });

  it('should reject invalid intent types from AI provider', async () => {
    const invalidPayload = {
      intent: 'invalid_invented_intent',
      activityQuery: null,
      explicitDate: null
    };
    const service = new AssistantIntentService(createFakeAIService(invalidPayload));

    await expect(service.interpret('Some query')).rejects.toThrow(AIProviderError);
  });

  it('should validate non-empty question and character limits', async () => {
    const service = new AssistantIntentService(createFakeAIService({}));

    await expect(service.interpret('')).rejects.toThrow(ValidationError);
    await expect(service.interpret('   ')).rejects.toThrow(ValidationError);
    await expect(service.interpret('a'.repeat(1001))).rejects.toThrow(ValidationError);
  });

  it('should build a prompt that forbids answering or calculating project truth', () => {
    const prompt = buildIntentInterpretationPrompt('Why is Pier 12 at risk?');
    expect(prompt).toContain('CRITICAL BOUNDARIES');
    expect(prompt).toContain('Do NOT answer the question');
    expect(prompt).toContain('Do NOT invent or output schedule activity IDs');
    expect(prompt).toContain('Pier 12');
  });
});
