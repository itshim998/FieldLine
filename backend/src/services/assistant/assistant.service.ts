import { AIService, aiService as defaultAiService } from '../../ai/services/ai.service.js';
import {
  assistantAnswerSchema,
  AssistantAnswer,
  AssistantIntent
} from '../../ai/contracts/assistant.contract.js';
import {
  AssistantIntentService,
  assistantIntentService as defaultIntentService
} from './assistant-intent.service.js';
import {
  DeterministicActivityResolver,
  deterministicActivityResolver as defaultResolver
} from './activity-resolver.js';
import {
  VerifiedFactBuilder,
  verifiedFactBuilder as defaultFactBuilder
} from './verified-fact-builder.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  normalizeDate
} from '../normalization/date-normalizer.js';
import {
  validateSnapshotDate,
  getTodayDateString
} from '../snapshot/progress-snapshot.service.js';
import {
  AssistantQueryOptions,
  AssistantQueryResponse,
  ResolvedActivityInfo,
  VerifiedFact,
  MAX_QUESTION_LENGTH
} from './assistant.types.js';
import { NotFoundError, ValidationError, AIProviderError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export function buildGroundedAnswerPrompt(
  question: string,
  intent: AssistantIntent,
  asOfDate: string,
  facts: VerifiedFact[]
): string {
  const factLines = facts.map(
    (f, idx) => `[FACT ${idx + 1}] (Ref: ${f.ref})\n${f.summary}`
  );

  return [
    'You are the FieldLine Project Assistant, providing strictly grounded answers to infrastructure project managers.',
    '',
    'GROUNDING RULES & CONSTRAINTS:',
    '1. You are NOT the source of truth. The VERIFIED FACTS below are the ONLY project facts available.',
    '2. You MUST answer ONLY from the supplied VERIFIED FACTS.',
    '3. Preserve numeric values (percentages, variances, days) exactly as given in the facts.',
    '4. Preserve calendar dates exactly as given in the facts.',
    '5. Preserve activity names and external IDs exactly as given.',
    '6. Cite all factual statements in your answer by including the corresponding fact reference strings in the "factRefs" array.',
    '7. You must NOT invent project facts, percentages, dates, causes, or activity identities.',
    '8. You must NOT infer unsupported contractor, labor, weather, or supply chain causes unless explicitly stated in the facts.',
    '9. You must NOT perform new project calculations or recalculate variances.',
    '10. If the VERIFIED FACTS are insufficient to answer the question, state clearly that available project data is insufficient.',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "answer": "Concise, professional grounded answer grounded exclusively in the facts",',
    '  "factRefs": ["ref1", "ref2"]',
    '}',
    '',
    '--- MANAGER QUESTION ---',
    question,
    '',
    `--- INTENT CLASSIFICATION ---`,
    `Intent: ${intent.intent}`,
    `As of Date: ${asOfDate}`,
    '',
    '--- VERIFIED FACTS ---',
    factLines.join('\n\n'),
    '--- END VERIFIED FACTS ---'
  ].join('\n');
}

export class AssistantService {
  private aiService: AIService;
  private intentService: AssistantIntentService;
  private resolver: DeterministicActivityResolver;
  private factBuilder: VerifiedFactBuilder;
  private projectRepo: ProjectRepository;

  constructor(
    aiServiceInstance: AIService = defaultAiService,
    intentServiceInstance: AssistantIntentService = defaultIntentService,
    resolverInstance: DeterministicActivityResolver = defaultResolver,
    factBuilderInstance: VerifiedFactBuilder = defaultFactBuilder,
    projectRepoInstance: ProjectRepository = defaultProjectRepo
  ) {
    this.aiService = aiServiceInstance;
    this.intentService = intentServiceInstance;
    this.resolver = resolverInstance;
    this.factBuilder = factBuilderInstance;
    this.projectRepo = projectRepoInstance;
  }

  /**
   * Answers a natural language query for a specific project.
   * Completely grounded in deterministic Project Intelligence facts.
   */
  async answerQuestion(
    projectId: string,
    question: string,
    options?: AssistantQueryOptions
  ): Promise<AssistantQueryResponse> {
    // 1. Validate question input
    if (typeof question !== 'string') {
      throw new ValidationError('Question must be a string');
    }
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length === 0) {
      throw new ValidationError('Question cannot be empty or whitespace only');
    }
    if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
      throw new ValidationError(
        `Question must not exceed ${MAX_QUESTION_LENGTH.toLocaleString()} characters`
      );
    }

    // 2. Verify project exists (enforce project isolation)
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 3. Structured Intent Interpretation via AI
    logger.debug(`AssistantService: Interpreting question for project [${projectId}]`);
    const intent = await this.intentService.interpret(trimmedQuestion);

    // 4. Determine canonical asOfDate
    let canonicalDate: string;
    if (options?.asOfDate) {
      const normalized = normalizeDate(options.asOfDate, 'asOfDate');
      canonicalDate = validateSnapshotDate(normalized);
    } else if (intent.explicitDate) {
      try {
        const normalized = normalizeDate(intent.explicitDate, 'explicitDate');
        canonicalDate = validateSnapshotDate(normalized);
      } catch {
        canonicalDate = getTodayDateString();
      }
    } else {
      canonicalDate = getTodayDateString();
    }

    // 5. Handle unsupported questions safely
    if (intent.intent === 'unsupported') {
      return {
        question: trimmedQuestion,
        intent,
        resolvedActivity: null,
        ambiguousCandidates: null,
        answer:
          'This question cannot be answered from project tracking data. Supported queries include delayed activities, at-risk activities, completed tasks, behind-schedule activities, upcoming milestones, stale activities, recent changes, and activity status.',
        factRefs: [],
        grounded: false,
        status: 'unsupported',
        asOfDate: canonicalDate,
        verifiedFacts: []
      };
    }

    // 6. Deterministic Activity Resolution (if query contains entity reference)
    let resolvedActivity: ResolvedActivityInfo | null = null;
    if (intent.activityQuery) {
      const resolution = this.resolver.resolve(projectId, intent.activityQuery);

      if (resolution.status === 'not_found') {
        return {
          question: trimmedQuestion,
          intent,
          resolvedActivity: null,
          ambiguousCandidates: null,
          answer: `No activity matching "${intent.activityQuery}" was found in project "${project.name}".`,
          factRefs: [],
          grounded: false,
          status: 'activity_not_found',
          asOfDate: canonicalDate,
          verifiedFacts: []
        };
      }

      if (resolution.status === 'ambiguous') {
        const candidateNames = resolution.candidates
          .map((c) => `"${c.name}" (${c.externalId})`)
          .join(', ');
        return {
          question: trimmedQuestion,
          intent,
          resolvedActivity: null,
          ambiguousCandidates: resolution.candidates,
          answer: `Multiple activities matched "${intent.activityQuery}": ${candidateNames}. Please specify the exact activity ID or complete activity name.`,
          factRefs: [],
          grounded: false,
          status: 'ambiguous_activity',
          asOfDate: canonicalDate,
          verifiedFacts: []
        };
      }

      resolvedActivity = resolution.activity;
    }

    // 7. Compile verified facts from Project Intelligence layer
    const facts = this.factBuilder.buildFacts(projectId, intent, canonicalDate, resolvedActivity);

    // 8. Safe insufficient data response if fact set is empty
    if (facts.length === 0) {
      let emptyMsg = `The available project data contains no recorded facts for this query as of ${canonicalDate}.`;
      if (intent.intent === 'delayed') {
        emptyMsg = `No delayed or overdue activities were found in project "${project.name}" as of ${canonicalDate}.`;
      } else if (intent.intent === 'at_risk') {
        emptyMsg = `No at-risk activities were detected in project "${project.name}" as of ${canonicalDate}.`;
      } else if (intent.intent === 'completed_today') {
        emptyMsg = `No activities recorded completion observations on ${canonicalDate}.`;
      } else if (intent.intent === 'behind_schedule') {
        emptyMsg = `No activities are currently behind schedule in project "${project.name}" as of ${canonicalDate}.`;
      } else if (intent.intent === 'approaching_milestones') {
        emptyMsg = `No milestones are approaching in the upcoming window as of ${canonicalDate}.`;
      } else if (intent.intent === 'stale_activities') {
        emptyMsg = `All activities have recent progress updates as of ${canonicalDate}.`;
      } else if (intent.intent === 'recent_changes') {
        emptyMsg = `No project events were recorded in the recent window prior to ${canonicalDate}.`;
      }

      return {
        question: trimmedQuestion,
        intent,
        resolvedActivity,
        ambiguousCandidates: null,
        answer: emptyMsg,
        factRefs: [],
        grounded: false,
        status: 'insufficient_data',
        asOfDate: canonicalDate,
        verifiedFacts: []
      };
    }

    // 9. Generate Grounded Answer from Verified Facts
    const prompt = buildGroundedAnswerPrompt(trimmedQuestion, intent, canonicalDate, facts);
    logger.debug(`AssistantService: Generating grounded answer with ${facts.length} verified facts`);

    const rawAnswer: AssistantAnswer = await this.aiService.extractStructured(
      prompt,
      assistantAnswerSchema
    );

    // 10. Strict Fact-Reference Validation (Section 15)
    const validRefIds = new Set(facts.map((f) => f.ref));
    const citedRefs = rawAnswer.factRefs || [];
    const unknownRefs = citedRefs.filter((ref) => !validRefIds.has(ref));

    if (unknownRefs.length > 0) {
      logger.warn(`Assistant answer cited unknown fact references: ${unknownRefs.join(', ')}`);
      throw new AIProviderError(
        `Grounded answer validation failed: response cited unverified fact references: ${unknownRefs.join(', ')}`
      );
    }

    // Ensure valid cited factRefs or map all available factRefs if none cited
    const finalFactRefs = citedRefs.length > 0 ? citedRefs : facts.map((f) => f.ref);

    return {
      question: trimmedQuestion,
      intent,
      resolvedActivity,
      ambiguousCandidates: null,
      answer: rawAnswer.answer,
      factRefs: finalFactRefs,
      grounded: true,
      status: 'success',
      asOfDate: canonicalDate,
      verifiedFacts: facts
    };
  }
}

export const assistantService = new AssistantService();
