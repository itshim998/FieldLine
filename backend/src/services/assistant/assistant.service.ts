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

interface SpeculativePattern {
  name: string;
  pattern: RegExp;
  keywords: string[];
}

const UNSUPPORTED_SPECULATIVE_PATTERNS: SpeculativePattern[] = [
  {
    name: 'workforce / labor / staffing',
    pattern: /\b(understaff(?:ed|ing)?|shortage of (?:workers|staff|labor|manpower)|labor shortage|staff shortage|insufficient (?:workers|staff|labor|manpower)|lack of (?:workers|staff|labor|manpower)|manpower shortage|strike|strikes|worker dispute)\b/i,
    keywords: ['staff', 'worker', 'labor', 'manpower', 'strike', 'workforce', 'understaff']
  },
  {
    name: 'materials / supply chain',
    pattern: /\b(material shortage|lack of materials|supply chain (?:issue|delay|disruption|problem)|delayed (?:shipment|delivery)|supplier (?:delay|issue|problem)|out of stock|steel shortage|concrete shortage)\b/i,
    keywords: ['material', 'supply chain', 'supplier', 'shipment', 'delivery', 'concrete shortage', 'steel shortage']
  },
  {
    name: 'weather / environmental',
    pattern: /\b(severe weather|bad weather|heavy rain(?:storm)?|storm|flooding|flood|extreme (?:heat|cold|temperature)|snowstorm|typhoon|hurricane|inclement weather)\b/i,
    keywords: ['weather', 'rain', 'storm', 'flood', 'snow', 'wind', 'typhoon', 'hurricane']
  },
  {
    name: 'equipment / machinery failure',
    pattern: /\b(equipment failure|equipment breakdown|machinery (?:failure|breakdown)|machine (?:failure|breakdown)|crane (?:failure|breakdown)|mechanical (?:failure|breakdown)|broken (?:equipment|machinery))\b/i,
    keywords: ['equipment', 'machinery', 'breakdown', 'crane', 'mechanical failure']
  },
  {
    name: 'legal / disputes / financial',
    pattern: /\b(contractor dispute|legal dispute|lawsuit|permit delay|permits pending|budget cut|funding (?:delay|shortage|issue)|bankruptcy|insolvency|contractor negligence|contractor (?:problem|issue)s?)\b/i,
    keywords: ['dispute', 'lawsuit', 'permit', 'budget', 'funding', 'bankruptcy', 'negligence']
  }
];

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
    '3. Return a list of factual claims. Every factual claim MUST cite one or more supplied fact references in its "factRefs" array.',
    '4. Preserve numeric values (percentages, variances, days) exactly as given in the facts.',
    '5. Preserve calendar dates exactly as given in the facts.',
    '6. Preserve activity names and external IDs exactly as given.',
    '7. Never create or invent a fact reference. Only cite references copied directly from the supplied VERIFIED FACTS.',
    '8. Never cite a fact that does not support the claim.',
    '9. You must NOT invent project facts, percentages, dates, causes, or activity identities.',
    '10. You must NOT infer unsupported contractor, labor/staffing shortages, weather, material shortages, or equipment failure causes unless explicitly stated in the verified facts.',
    '11. If the VERIFIED FACTS do not establish a requested explanation (such as root causes), explicitly state that available project data does not establish the cause.',
    '12. You must NOT perform new project calculations or recalculate variances.',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "claims": [',
    '    {',
    '      "text": "Specific factual claim directly supported by cited facts",',
    '      "factRefs": ["ref1", "ref2"]',
    '    }',
    '  ],',
    '  "answer": "Concise, professional grounded answer assembled exclusively from the validated claims"',
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
        claims: [],
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
          claims: [],
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
          claims: [],
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

    // 8. Safe deterministic insufficient data response if fact set is empty
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
        claims: [],
        factRefs: [],
        grounded: false,
        status: 'insufficient_data',
        asOfDate: canonicalDate,
        verifiedFacts: []
      };
    }

    // 9. Generate Grounded Structured Claims from Verified Facts
    const prompt = buildGroundedAnswerPrompt(trimmedQuestion, intent, canonicalDate, facts);
    logger.debug(`AssistantService: Generating grounded answer with ${facts.length} verified facts`);

    const rawAnswer: AssistantAnswer = await this.aiService.extractStructured(
      prompt,
      assistantAnswerSchema
    );

    // 10. Strict Claim-Level Fact Reference & Grounding Validation (Pass 18 Corrective)
    if (!rawAnswer.claims || !Array.isArray(rawAnswer.claims) || rawAnswer.claims.length === 0) {
      throw new AIProviderError(
        'Grounded answer validation failed: model produced zero factual claims'
      );
    }

    const validFactsMap = new Map<string, VerifiedFact>();
    for (const f of facts) {
      validFactsMap.set(f.ref, f);
    }

    const citedFactRefsSet = new Set<string>();

    for (const claim of rawAnswer.claims) {
      if (!claim.text || typeof claim.text !== 'string' || claim.text.trim().length === 0) {
        throw new AIProviderError(
          'Grounded answer validation failed: factual claim text must not be empty'
        );
      }

      if (!claim.factRefs || !Array.isArray(claim.factRefs) || claim.factRefs.length === 0) {
        throw new AIProviderError(
          `Grounded answer validation failed: factual claim "${claim.text}" has no fact references`
        );
      }

      const citedFactsForClaim: VerifiedFact[] = [];
      for (const ref of claim.factRefs) {
        const fact = validFactsMap.get(ref);
        if (!fact) {
          logger.warn(`Assistant answer cited unknown fact reference: ${ref}`);
          throw new AIProviderError(
            `Grounded answer validation failed: response cited unverified fact references: ${ref}`
          );
        }
        citedFactsForClaim.push(fact);
        citedFactRefsSet.add(ref);
      }

      // Check for unsupported speculative causes (e.g. understaffed, weather, equipment, material)
      const factualCorpus = citedFactsForClaim
        .map((f) => `${f.summary} ${f.activityName || ''} ${f.category} ${JSON.stringify(f.data)}`)
        .join(' ')
        .toLowerCase();

      for (const spec of UNSUPPORTED_SPECULATIVE_PATTERNS) {
        if (spec.pattern.test(claim.text)) {
          const isCorpusSupported = spec.keywords.some((kw) =>
            factualCorpus.includes(kw.toLowerCase())
          );
          if (!isCorpusSupported) {
            logger.warn(
              `Assistant claim asserts unsupported ${spec.name} speculation without fact backing: "${claim.text}"`
            );
            throw new AIProviderError(
              `Grounded answer validation failed: claim asserts unsupported ${spec.name} causes not present in cited verified facts: "${claim.text}"`
            );
          }
        }
      }
    }

    const finalFactRefs = Array.from(citedFactRefsSet);
    if (finalFactRefs.length === 0) {
      throw new AIProviderError(
        'Grounded answer validation failed: zero valid fact references cited'
      );
    }

    // 11. Final Answer Assembly: Construct exclusively from validated claims
    const constructedAnswer = rawAnswer.claims.map((c) => c.text.trim()).join(' ');

    return {
      question: trimmedQuestion,
      intent,
      resolvedActivity,
      ambiguousCandidates: null,
      answer: constructedAnswer,
      claims: rawAnswer.claims,
      factRefs: finalFactRefs,
      grounded: true,
      status: 'success',
      asOfDate: canonicalDate,
      verifiedFacts: facts
    };
  }
}

export const assistantService = new AssistantService();
