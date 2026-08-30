import { describe, it, expect, vi } from 'vitest';
import { normalizeMarkdownContent } from '../../frontend/src/components/assistant/AssistantMarkdown.js';
import { AssistantService } from '../src/services/assistant/assistant.service.js';
import { MockAIProvider } from '../src/ai/providers/mock-ai.provider.js';
import { DefaultAIService } from '../src/ai/services/ai.service.js';
import { DeterministicActivityResolver } from '../src/services/assistant/activity-resolver.js';
import { VerifiedFactBuilder } from '../src/services/assistant/verified-fact-builder.js';
import { ProjectRepository } from '../src/repositories/project.repository.js';
import { AssistantIntentService } from '../src/services/assistant/assistant-intent.service.js';

describe('Assistant Markdown Presentation & Normalization (Pass 28)', () => {
  describe('normalizeMarkdownContent utility', () => {
    it('normalizes empty or null content safely', () => {
      expect(normalizeMarkdownContent('')).toBe('');
      expect(normalizeMarkdownContent('   ')).toBe('');
      // @ts-expect-error test non-string input
      expect(normalizeMarkdownContent(null)).toBe('');
    });

    it('preserves plain markdown paragraphs and headings', () => {
      const input = '## Delayed Activities\n\nThere are **5 delayed activities** as of today.';
      expect(normalizeMarkdownContent(input)).toBe(input);
    });

    it('strips accidental outer code fences wrapping entire markdown response', () => {
      const input = '```markdown\n## Delayed Activities\n\nContent here\n```';
      expect(normalizeMarkdownContent(input)).toBe('## Delayed Activities\n\nContent here');
    });

    it('normalizes literal "\\n" character sequences in prose to actual newlines', () => {
      const input = '## Delayed Activities\\n\\nThere are 5 delayed activities.\\n1. Act A\\n2. Act B';
      const output = normalizeMarkdownContent(input);
      expect(output).toBe('## Delayed Activities\n\nThere are 5 delayed activities.\n1. Act A\n2. Act B');
    });

    it('preserves backslashes inside code blocks while normalizing prose', () => {
      const input = 'Here is code:\\n```\nconst x = "\\n";\n```\\nDone.';
      const output = normalizeMarkdownContent(input);
      expect(output).toContain('Here is code:\n```\nconst x = "\\n";\n```\nDone.');
    });

    it('handles GFM tables with escaped pipes properly', () => {
      const input = '| Activity | Note |\n|---|---|\n| Crude Pump | Completed \\| verified |';
      const output = normalizeMarkdownContent(input);
      expect(output).toBe(input);
    });
  });

  describe('AssistantService Markdown Integration & Grounding Integrity', () => {
    const projectId = '22222222-2222-2222-2222-222222222222';
    const mockProject = {
      id: projectId,
      name: 'Refinery Expansion — Unit 4',
      description: 'Golden Demo Project',
      code: 'REFINERY-U4',
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

    const fakeIntelligenceService = {
      getIntelligence: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        generatedAt: '2026-08-28T00:00:00.000Z',
        delayed: [
          {
            activityId: 'act-b02',
            externalId: 'ACT-B02',
            name: 'Crude Pump Foundation Piling Works',
            plannedFinish: '2026-08-15',
            actualProgress: 65,
            plannedProgress: 100,
            progressVariance: -35,
            classification: 'DELAYED',
            reasons: [{ code: 'UNAPPROVED_WORK', message: 'pending inspection' }]
          },
          {
            activityId: 'act-a02',
            externalId: 'ACT-A02',
            name: 'Unit 4 Site Rough Grading',
            plannedFinish: '2026-08-10',
            actualProgress: 65,
            plannedProgress: 100,
            progressVariance: -35,
            classification: 'DELAYED',
            reasons: [{ code: 'WEATHER_HOLD', message: 'monsoon rain' }]
          }
        ],
        atRisk: [
          {
            activityId: 'act-c01',
            externalId: 'ACT-C01',
            name: 'Process Pipe Rack Carbon Steel Spooling',
            plannedFinish: '2026-09-10',
            actualProgress: 55,
            plannedProgress: 75,
            progressVariance: -20,
            classification: 'AT_RISK',
            reasons: [{ code: 'NEGATIVE_PROGRESS_VARIANCE', message: 'behind planned progress' }]
          },
          {
            activityId: 'act-b03',
            externalId: 'ACT-B03',
            name: 'Pipe Rack PR-07 Structural Steel Erection',
            plannedFinish: '2026-09-05',
            actualProgress: 50,
            plannedProgress: 72,
            progressVariance: -22,
            classification: 'AT_RISK',
            reasons: [{ code: 'NEGATIVE_PROGRESS_VARIANCE', message: 'fabrication delay' }]
          }
        ],
        completedToday: [],
        behindSchedule: [],
        approachingMilestones: [
          {
            activityId: 'act-b05',
            externalId: 'ACT-B05',
            name: 'Piling Handover Milestone',
            milestoneDate: '2026-08-30',
            daysUntil: 2
          }
        ],
        staleActivities: [],
        recentChanges: []
      })
    };

    const fakeActivityRepo = {
      listByProjectId: vi.fn().mockReturnValue([
        {
          id: 'act-b02',
          projectId,
          scheduleId: 'sch-1',
          externalId: 'ACT-B02',
          name: 'Crude Pump Foundation Piling Works',
          description: null,
          wbsCode: '1.2.1',
          location: 'Area B',
          plannedStart: '2026-08-01',
          plannedFinish: '2026-08-15',
          plannedQuantity: 100,
          unit: 'piles',
          baselineProgress: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        },
        {
          id: 'act-a02',
          projectId,
          scheduleId: 'sch-1',
          externalId: 'ACT-A02',
          name: 'Unit 4 Site Rough Grading',
          description: null,
          wbsCode: '1.1.2',
          location: 'Area A',
          plannedStart: '2026-08-01',
          plannedFinish: '2026-08-10',
          plannedQuantity: 1000,
          unit: 'm2',
          baselineProgress: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        }
      ])
    };

    const fakeSnapshotService = {
      getProgressSnapshot: vi.fn().mockReturnValue({
        projectId,
        asOfDate: '2026-08-28',
        activities: [
          {
            activityId: 'act-b02',
            externalId: 'ACT-B02',
            name: 'Crude Pump Foundation Piling Works',
            status: 'in_progress',
            plannedProgress: 100,
            actualProgress: 65,
            progressVariance: -35,
            varianceState: 'behind',
            plannedFinish: '2026-08-15',
            overdue: true
          }
        ]
      })
    };

    function createService(): AssistantService {
      const mockProvider = new MockAIProvider();
      const aiService = new DefaultAIService(mockProvider);
      const factBuilder = new VerifiedFactBuilder(
        fakeIntelligenceService as any,
        fakeSnapshotService as any
      );
      const resolver = new DeterministicActivityResolver(fakeActivityRepo as any);
      const intentService = new AssistantIntentService(aiService);

      return new AssistantService(
        aiService,
        intentService,
        resolver,
        factBuilder,
        fakeProjectRepo
      );
    }

    it('1. What is delayed? returns structured Markdown table with verified claims', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'What is delayed?');

      expect(res.grounded).toBe(true);
      expect(res.status).toBe('success');
      expect(res.intent.intent).toBe('delayed');
      expect(res.claims).toBeDefined();
      expect(res.claims!.length).toBeGreaterThan(0);
      expect(res.factRefs.length).toBeGreaterThan(0);

      // Markdown answer structure checks
      expect(res.answer).toContain('## Delayed Activities');
      expect(res.answer).toContain('| Activity | Actual Progress | Status |');
      expect(res.answer).toContain('Crude Pump Foundation Piling Works');
      expect(res.answer).toContain('Unit 4 Site Rough Grading');
      expect(res.answer).toContain('### Key Takeaways');
    });

    it('2. Which activities are at risk? returns structured Markdown table', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'Which activities are at risk?');

      expect(res.grounded).toBe(true);
      expect(res.intent.intent).toBe('at_risk');
      expect(res.answer).toContain('## At-Risk Activities');
      expect(res.answer).toContain('| Activity | Actual Progress | Risk State |');
      expect(res.answer).toContain('Process Pipe Rack Carbon Steel Spooling');
    });

    it('3. Tell me about ACT-B02 resolves entity and returns verified fact status', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'Tell me about the crude pump foundation');

      expect(res.grounded).toBe(true);
      expect(res.resolvedActivity).toBeDefined();
      expect(res.resolvedActivity?.externalId).toBe('ACT-B02');
      expect(res.claims!.some((c) => c.factRef.includes('ACT-B02'))).toBe(true);
      expect(res.answer).toContain('Crude Pump Foundation Piling Works');
      expect(res.answer).toContain('65%');
    });

    it('4. How to speed up the work? returns multi-section GFM advisory markdown', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'How to speed up the work?');

      expect(res.grounded).toBe(false);
      expect(res.intent.intent).toBe('general');
      expect(res.answer).toContain('## Ways to Recover Schedule');
      expect(res.answer).toContain('**critical path**');
      expect(res.answer).toContain('### 1. Fast-track Parallel Activities');
      expect(res.answer).toContain('### 2. Resource Crashing');
      expect(res.answer).toContain('### 3. Eliminate Bottlenecks');
      expect(res.answer).toContain('### 4. Monitor Daily');
    });

    it('5. Conversational greeting returns clean, warm string without over-formatting', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'Hello!');

      expect(res.grounded).toBe(false);
      expect(res.intent.intent).toBe('general');
      expect(res.answer).toContain('Hello! I am your FieldLine Project Assistant');
      expect(res.answer).not.toContain('## ');
      expect(res.answer).not.toContain('| Activity |');
    });

    it('6. Give me a project summary returns structured general advisory answer', async () => {
      const service = createService();
      const res = await service.answerQuestion(projectId, 'Give me a project summary.');

      expect(res.status).toBe('success');
      expect(res.answer.length).toBeGreaterThan(20);
    });

    it('7. Malicious HTML script tags are normalized and safely treated as plain markdown text', () => {
      const malicious = '<script>alert("xss")</script>\n<img src=x onerror=alert(1)>\n## Safe Heading';
      const normalized = normalizeMarkdownContent(malicious);

      expect(normalized).toContain('<script>alert("xss")</script>');
      expect(normalized).toContain('## Safe Heading');
    });

    it('8. Wide and long markdown tables preserve syntax for responsive wrapping', () => {
      const longTable = [
        '| Activity WBS | Activity Name | Baseline Start | Baseline Finish | Actual Progress | Planned Progress | Variance | Location | Execution Status |',
        '|---|---|---|---|---:|---:|---:|---|:---:|',
        '| 1.2.1 | Crude Pump Foundation Piling Works | 2026-08-01 | 2026-08-15 | 65% | 100% | -35% | Area B | DELAYED |',
        '| 1.1.2 | Unit 4 Site Rough Grading | 2026-08-01 | 2026-08-10 | 65% | 100% | -35% | Area A | DELAYED |',
        '| 1.3.1 | Process Pipe Rack Carbon Steel Spooling | 2026-08-10 | 2026-09-10 | 55% | 75% | -20% | Area C | AT_RISK |'
      ].join('\n');

      const normalized = normalizeMarkdownContent(longTable);
      expect(normalized).toContain('| Activity WBS | Activity Name |');
      expect(normalized.split('\n').length).toBe(5);
    });
  });
});
