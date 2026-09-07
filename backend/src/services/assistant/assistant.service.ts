import { AIService, aiService as defaultAiService } from '../../ai/services/ai.service.js';
import {
  assistantAnswerSchema,
  generalAssistantAnswerSchema,
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

export const ALLOWED_AUTHORITATIVE_FIELDS = new Set<string>([
  'activityId',
  'externalId',
  'activityName',
  'name',
  'location',
  'plannedStart',
  'plannedFinish',
  'actualProgress',
  'plannedProgress',
  'actualPercent',
  'progressVariance',
  'varianceState',
  'overdue',
  'classification',
  'status',
  'actualFinish',
  'milestoneDate',
  'daysUntil',
  'latestUpdateDate',
  'daysSinceUpdate',
  'hasAnyUpdate',
  'reason.code',
  'reason.message',
  'reasons',
  'eventType',
  'eventId',
  'createdAt',
  'progressUpdateId',
  'asOfDate',
  'summary',
  'payload'
]);

const FIELD_ALIAS_MAP: Record<string, string> = {
  activityid: 'activityId',
  activity_id: 'activityId',
  externalid: 'externalId',
  external_id: 'externalId',
  activityname: 'name',
  activity_name: 'name',
  name: 'name',
  location: 'location',
  plannedstart: 'plannedStart',
  planned_start: 'plannedStart',
  plannedfinish: 'plannedFinish',
  planned_finish: 'plannedFinish',
  actualprogress: 'actualProgress',
  actual_progress: 'actualProgress',
  plannedprogress: 'plannedProgress',
  planned_progress: 'plannedProgress',
  actualpercent: 'actualPercent',
  actual_percent: 'actualPercent',
  progressvariance: 'progressVariance',
  progress_variance: 'progressVariance',
  variance: 'progressVariance',
  variancestate: 'varianceState',
  variance_state: 'varianceState',
  overdue: 'overdue',
  classification: 'classification',
  status: 'status',
  executionstatus: 'status',
  execution_status: 'status',
  actualfinish: 'actualFinish',
  actual_finish: 'actualFinish',
  milestonedate: 'milestoneDate',
  milestone_date: 'milestoneDate',
  latestupdatedate: 'latestUpdateDate',
  latest_update_date: 'latestUpdateDate',
  latestobservationdate: 'latestUpdateDate',
  latest_observation_date: 'latestUpdateDate',
  observationdate: 'latestUpdateDate',
  observation_date: 'latestUpdateDate',
  lastupdatedate: 'latestUpdateDate',
  last_update_date: 'latestUpdateDate',
  lastobservationdate: 'latestUpdateDate',
  last_observation_date: 'latestUpdateDate',
  dayssinceupdate: 'daysSinceUpdate',
  days_since_update: 'daysSinceUpdate',
  dayselapsed: 'daysSinceUpdate',
  days_elapsed: 'daysSinceUpdate',
  dayselapsedsinceprogressentry: 'daysSinceUpdate',
  days_elapsed_since_progress_entry: 'daysSinceUpdate',
  dayssinceprogressentry: 'daysSinceUpdate',
  days_since_progress_entry: 'daysSinceUpdate',
  dayssinceprogressupdate: 'daysSinceUpdate',
  days_since_progress_update: 'daysSinceUpdate',
  daysuntil: 'daysUntil',
  days_until: 'daysUntil',
  daysremaining: 'daysUntil',
  days_remaining: 'daysUntil',
  daysleft: 'daysUntil',
  days_left: 'daysUntil',
  hasanyupdate: 'hasAnyUpdate',
  has_any_update: 'hasAnyUpdate',
  'reason.code': 'reason.code',
  'reason.message': 'reason.message',
  reasons: 'reasons',
  reason: 'reasons',
  eventtype: 'eventType',
  event_type: 'eventType',
  eventid: 'eventId',
  event_id: 'eventId',
  createdat: 'createdAt',
  created_at: 'createdAt',
  progressupdateid: 'progressUpdateId',
  progress_update_id: 'progressUpdateId',
  asofdate: 'asOfDate',
  as_of_date: 'asOfDate',
  summary: 'summary',
  payload: 'payload'
};

export function normalizeFieldName(rawField: string): string | null {
  if (!rawField || typeof rawField !== 'string') return null;
  const cleaned = rawField.trim().toLowerCase().replace(/[\s\-]+/g, '_');
  return FIELD_ALIAS_MAP[cleaned] ?? (ALLOWED_AUTHORITATIVE_FIELDS.has(rawField) ? rawField : null);
}

export function getAuthoritativeFactValue(fact: VerifiedFact, rawField: string): unknown {
  const field = normalizeFieldName(rawField) || rawField;
  if (!ALLOWED_AUTHORITATIVE_FIELDS.has(field)) {
    return undefined;
  }

  const data = (fact.data || {}) as Record<string, any>;
  const snap = (data.snapshot || {}) as Record<string, any>;
  const payload = (data.payload || {}) as Record<string, any>;

  switch (field) {
    case 'activityId':
      return fact.activityId ?? data.activityId;
    case 'externalId':
      return fact.externalId ?? data.externalId;
    case 'activityName':
    case 'name':
      return fact.activityName ?? data.name ?? data.activityName;
    case 'location':
      return data.location;
    case 'progressUpdateId':
      return fact.progressUpdateId ?? data.progressUpdateId;
    case 'actualProgress':
      return data.actualProgress ?? data.actualPercent ?? snap.actualProgress ?? payload.actualPercent ?? payload.percent ?? payload.actualProgress;
    case 'actualPercent':
      return data.actualPercent ?? data.actualProgress ?? snap.actualProgress ?? payload.actualPercent ?? payload.percent ?? payload.actualProgress;
    case 'plannedProgress':
      return data.plannedProgress ?? snap.plannedProgress;
    case 'progressVariance':
      return data.progressVariance ?? snap.progressVariance;
    case 'varianceState':
      return data.varianceState ?? snap.varianceState;
    case 'classification':
      return data.classification ?? (data.overdue ? 'DELAYED' : (data.varianceState === 'behind' ? 'AT_RISK' : 'ON_TRACK'));
    case 'status': {
      const st = data.status ?? snap.status ?? payload.status;
      const candidates: string[] = [];
      if (st) candidates.push(String(st));
      if (data.classification) candidates.push(String(data.classification));
      if (data.overdue) candidates.push('delayed', 'overdue', 'delayed/overdue', 'DELAYED/OVERDUE');
      if (candidates.length > 0) return candidates.length === 1 ? candidates[0] : candidates;
      return undefined;
    }
    case 'overdue':
      return data.overdue ?? snap.overdue;
    case 'plannedStart':
      return data.plannedStart ?? snap.plannedStart;
    case 'plannedFinish':
      return data.plannedFinish ?? snap.plannedFinish;
    case 'actualFinish':
      return data.actualFinish;
    case 'milestoneDate':
      return data.milestoneDate;
    case 'daysUntil':
      return data.daysUntil;
    case 'latestUpdateDate':
      return data.latestUpdateDate ?? ['None recorded', 'None', 'none', 'Never updated', 'N/A', null];
    case 'daysSinceUpdate': {
      const elapsedDays = data.daysSinceUpdate;
      return typeof elapsedDays === 'number'
        ? elapsedDays
        : ['Never updated', 'None recorded', 'None', 'none', 'N/A', null];
    }
    case 'hasAnyUpdate':
      return data.hasAnyUpdate;
    case 'asOfDate':
      return data.asOfDate;
    case 'eventId':
      return data.eventId;
    case 'eventType':
      return data.eventType;
    case 'createdAt':
      return data.createdAt;
    case 'summary':
      return fact.summary ?? data.summary;
    case 'payload':
      return data.payload;
    case 'reason.code':
      if (Array.isArray(data.reasons)) {
        return data.reasons.map((r: any) => (typeof r === 'object' ? r.code : String(r)));
      }
      return undefined;
    case 'reason.message':
    case 'reasons':
      if (Array.isArray(data.reasons)) {
        return data.reasons.map((r: any) => (typeof r === 'object' ? r.message : String(r)));
      }
      return undefined;
    default:
      return undefined;
  }
}

export function verifyClaimValueMatch(
  claimValue: string | number | boolean,
  authoritativeValue: unknown
): boolean {
  if (authoritativeValue === undefined || authoritativeValue === null) {
    const s = String(claimValue).trim().toLowerCase();
    if (['none', 'none recorded', 'never', 'never updated', 'null', 'n/a', 'undefined', ''].includes(s)) {
      return true;
    }
    return false;
  }

  // Array of reason codes / messages
  if (Array.isArray(authoritativeValue)) {
    return authoritativeValue.some((item) => {
      if (typeof item === 'object' && item !== null) {
        const codeMatch =
          String((item as any).code || '').toLowerCase() ===
          String(claimValue).trim().toLowerCase();
        const msgMatch =
          String((item as any).message || '').toLowerCase() ===
          String(claimValue).trim().toLowerCase();
        return codeMatch || msgMatch;
      }
      return String(item).trim().toLowerCase() === String(claimValue).trim().toLowerCase();
    });
  }

  // Exact number comparison
  if (typeof authoritativeValue === 'number') {
    const claimNum = typeof claimValue === 'number' ? claimValue : Number(claimValue);
    if (!isNaN(claimNum)) {
      return Math.abs(authoritativeValue - claimNum) < 0.01;
    }
  }

  // Boolean comparison
  if (typeof authoritativeValue === 'boolean') {
    if (typeof claimValue === 'boolean') {
      return authoritativeValue === claimValue;
    }
    const s = String(claimValue).trim().toLowerCase();
    if (['true', 'yes', 'delayed', 'overdue'].includes(s) && authoritativeValue === true) return true;
    if (['false', 'no', 'not overdue', 'on_time'].includes(s) && authoritativeValue === false) return true;
    return false;
  }

  // String comparison (trimmed, case-insensitive)
  const normAuth = String(authoritativeValue).trim().toLowerCase();
  const normClaim = String(claimValue).trim().toLowerCase();
  return normAuth === normClaim || normAuth.includes(normClaim) || normClaim.includes(normAuth);
}

export function buildGroundedAnswerPrompt(
  question: string,
  intent: AssistantIntent,
  asOfDate: string,
  facts: VerifiedFact[],
  role?: 'worker' | 'admin'
): string {
  const factLines = facts.map(
    (f, idx) => `[FACT ${idx + 1}] (Ref: ${f.ref})\n${f.summary}`
  );

  const persona =
    role === 'worker'
      ? 'You are the FieldLine Operational Assistant, providing concise, execution-focused answers to field workers and site crews. Focus strictly on operational task context (status, location, actual progress, planned dates, blockers, and safety precautions). Do NOT cite or use internal variance percentages, variance states, or management portfolio analytics.'
      : 'You are the FieldLine Project Assistant, providing strictly grounded answers to infrastructure project managers.';

  return [
    persona,
    '',
    'GROUNDING RULES & CONSTRAINTS:',
    '1. You are NOT the source of truth. The VERIFIED FACTS below are the ONLY project facts available.',
    '2. You may ONLY make factual claims using fields explicitly supplied by the verified facts.',
    '3. For every factual claim in your response:',
    '   a. Specify "factRef" (copied exactly from a supplied VERIFIED FACT reference string, e.g. "delayed:ACT-A02").',
    '   b. Specify "type" ("metric" | "classification" | "status" | "date" | "variance" | "reason" | "activity_identity").',
    '   c. Specify "field" (an authoritative camelCase field name, e.g. "actualProgress", "plannedProgress", "progressVariance", "status", "plannedFinish", "overdue", "classification", "name", "reasons", "milestoneDate", "daysSinceUpdate").',
    '   d. Specify "value" (the exact authoritative value copied from the fact, e.g. 65, "in_progress", true, "2026-08-25").',
    '   e. Write "text" (concise, natural-language text expressing that verified claim).',
    '4. Never invent a value. Never infer a value that is not explicitly represented in the facts.',
    '5. Never create a new date, percentage, status, cause, forecast, duration, priority, identity, or event.',
    '6. If the verified facts do not contain the requested information, state clearly that available project data is insufficient.',
    '7. Never cite a fact that does not support the claim.',
    '',
    'PRESENTATION & GITHUB-FLAVORED MARKDOWN CONTRACT FOR "answer":',
    '- Provide a polished, executive-ready GitHub-Flavored Markdown summary in the "answer" field.',
    '- Use a clear section heading (## Title) when the response contains multiple sections.',
    '- Use short, scannable paragraphs rather than dense blocks of text.',
    '- When presenting 3+ activities, milestones, or metrics, format them as a Markdown table (e.g. | Activity | Actual Progress | Planned | Variance |). Keep table columns concise.',
    '- Use bullet or numbered lists where appropriate for multiple items.',
    '- Use bold (**term**) to emphasize key conclusions and critical path items, not every sentence.',
    '- Include blank lines between paragraphs, headings, lists, and tables.',
    '- Do NOT output raw HTML tags (e.g. <table\>, <div\>, <br\>). Use only standard Markdown.',
    '- Do NOT wrap the JSON response in a Markdown code block (```json). Return ONLY valid parseable JSON.',
    '- Do NOT emit literal "\\n" character sequences in rendered text.',
    '- All data in the Markdown answer must strictly match the verified facts provided below.',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "answer": "## Summary\\n\\nMarkdown presentation with tables, headings, and bold key points...",',
    '  "claims": [',
    '    {',
    '      "type": "metric",',
    '      "factRef": "at_risk:FOUNDATION-B",',
    '      "field": "actualProgress",',
    '      "value": 62,',
    '      "text": "Foundation B is 62% complete."',
    '    }',
    '  ]',
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

export function buildGeneralAnswerPrompt(
  question: string,
  projectName?: string
): string {
  return [
    'You are FieldLine AI Assistant, an expert, helpful, and professional AI engineering and project intelligence companion.',
    'You assist project managers, EPC executives, planning engineers, and field personnel with infrastructure project queries, general conversational greetings, engineering best practices, and construction management advice.',
    '',
    projectName ? `Current active project context: "${projectName}".` : '',
    '',
    'PRESENTATION & GITHUB-FLAVORED MARKDOWN CONTRACT:',
    '1. Return the natural-language answer formatted in clean GitHub-Flavored Markdown (GFM).',
    '2. For greetings and simple conversational replies (e.g. "hello", "how are you"), keep the response concise, warm, and natural (do not over-format simple greetings).',
    '3. For advisory, engineering, or project management questions (e.g. "How to speed up the work?"):',
    '   - Use a clear section heading (## Title) when the response contains distinct sections.',
    '   - Use short, readable paragraphs rather than monolithic blocks of text.',
    '   - Use bullet points or numbered subheadings (### 1. Fast-track) for multi-step strategies.',
    '   - Use bold emphasis for key terms and conclusions (e.g. **critical path**).',
    '   - Insert blank lines between paragraphs, headings, and list items.',
    '4. Do NOT output raw HTML tags (e.g. <div>, <span>, <br>).',
    '5. Do NOT wrap the JSON response inside a markdown code fence (```json). Return ONLY a valid, parseable JSON object.',
    '6. Do NOT emit literal "\\n" character sequences in the rendered text.',
    '',
    'Return ONLY a JSON object with this schema:',
    '{',
    '  "answer": "## Heading\\n\\nFormatted GitHub-Flavored Markdown response..."',
    '}',
    '',
    '--- USER QUESTION ---',
    question,
    '--- END USER QUESTION ---'
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
   * Grounded in deterministic Project Intelligence facts for project queries,
   * with natural conversational synthesis for general inquiries.
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

    // 5. Handle general / conversational / advisory questions naturally
    if (intent.intent === 'general' || intent.intent === 'unsupported') {
      try {
        const generalPrompt = buildGeneralAnswerPrompt(trimmedQuestion, project.name);
        const res = await this.aiService.extractStructured<{ answer: string }>(
          generalPrompt,
          generalAssistantAnswerSchema
        );

        return {
          question: trimmedQuestion,
          intent,
          resolvedActivity: null,
          ambiguousCandidates: null,
          answer: res.answer || 'Hello! How can I assist you with your project today?',
          claims: [],
          factRefs: [],
          grounded: false,
          status: 'success',
          asOfDate: canonicalDate,
          verifiedFacts: []
        };
      } catch (err) {
        logger.warn(`AssistantService: General answer generation fallback: ${(err as Error).message}`);
        let fallbackAnswer = 'Hello! I am your FieldLine Project Assistant, ready to help you with schedule tracking, risk intelligence, activity status, or construction management.';
        if (/how are you/i.test(trimmedQuestion)) {
          fallbackAnswer = 'I am doing well, thank you! I am ready to assist you with FieldLine. How can I help you today?';
        } else if (/hie|hello|hey|hi/i.test(trimmedQuestion)) {
          fallbackAnswer = 'Hello! I am your FieldLine Project Assistant. How can I assist you today?';
        }
        return {
          question: trimmedQuestion,
          intent,
          resolvedActivity: null,
          ambiguousCandidates: null,
          answer: fallbackAnswer,
          claims: [],
          factRefs: [],
          grounded: false,
          status: 'success',
          asOfDate: canonicalDate,
          verifiedFacts: []
        };
      }
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

    // Role-based scope partitioning: Worker vs Admin
    if (options?.role === 'worker') {
      const isSystemicQuery =
        (!intent.activityQuery && (
          intent.intent === 'behind_schedule' ||
          intent.intent === 'approaching_milestones' ||
          (intent.intent === 'delayed' && (/all\s*(6|six|\w+)?\s*areas|portfolio|across all|project-wide|every area|whole project|company-wide/i.test(trimmedQuestion) || !intent.activityQuery))
        )) ||
        /portfolio|variance matrix|confidence tier|all (\d+|six) areas|across all|executive|systemic delay/i.test(trimmedQuestion);

      if (isSystemicQuery) {
        return {
          question: trimmedQuestion,
          intent,
          resolvedActivity: null,
          ambiguousCandidates: null,
          answer:
            'This query requires project control room access. As a field worker, your scope is focused on active operational tasks, task progress, locations, and blockers for your work area.',
          claims: [],
          factRefs: [],
          grounded: true,
          status: 'scope_restricted',
          asOfDate: canonicalDate,
          verifiedFacts: []
        };
      }
    }

    // 7. Compile verified facts from Project Intelligence layer
    const facts = this.factBuilder.buildFacts(projectId, intent, canonicalDate, resolvedActivity);

    // Sanitize facts for worker role (omit systemic variance metrics)
    if (options?.role === 'worker') {
      for (const f of facts) {
        if (f.data) {
          delete (f.data as any).progressVariance;
          delete (f.data as any).varianceState;
          delete (f.data as any).plannedProgress;
          if ((f.data as any).snapshot) {
            delete (f.data as any).snapshot.progressVariance;
            delete (f.data as any).snapshot.varianceState;
            delete (f.data as any).snapshot.plannedProgress;
          }
        }
        if (f.summary) {
          f.summary = f.summary
            .replace(/, progress variance is [-\d.]+%/gi, '')
            .replace(/with progress variance of [-\d.]+%/gi, '')
            .replace(/progress variance of [-\d.]+%/gi, '')
            .replace(/progress variance: [-\d.]+%/gi, '')
            .replace(/variance state: \w+/gi, '')
            .replace(/Planned progress: \d+%, /gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        }
      }
    }

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
    const prompt = buildGroundedAnswerPrompt(trimmedQuestion, intent, canonicalDate, facts, options?.role);
    logger.debug(`AssistantService: Generating grounded answer with ${facts.length} verified facts`);

    const rawAnswer: AssistantAnswer = await this.aiService.extractStructured(
      prompt,
      assistantAnswerSchema
    );

    // 10. Strict Field-Level Claim Validation (Pass 18 Final Grounding Correction)
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

      // Resolve factRef
      const targetFactRef = claim.factRef || (claim.factRefs && claim.factRefs[0]);
      if (!targetFactRef || typeof targetFactRef !== 'string' || targetFactRef.trim().length === 0) {
        throw new AIProviderError(
          `Grounded answer validation failed: factual claim "${claim.text}" has no fact reference`
        );
      }

      const fact = validFactsMap.get(targetFactRef);
      if (!fact) {
        logger.warn(`Assistant answer cited unknown fact reference: ${targetFactRef}`);
        throw new AIProviderError(
          `Grounded answer validation failed: response cited unverified fact reference: ${targetFactRef}`
        );
      }

      citedFactRefsSet.add(targetFactRef);
      if (claim.factRefs && Array.isArray(claim.factRefs)) {
        for (const ref of claim.factRefs) {
          if (!validFactsMap.has(ref)) {
            throw new AIProviderError(
              `Grounded answer validation failed: response cited unverified fact reference: ${ref}`
            );
          }
          citedFactRefsSet.add(ref);
        }
      }

      // Normalize and check field is in allowed authoritative field set
      const normalizedField = normalizeFieldName(claim.field);
      if (!normalizedField || !ALLOWED_AUTHORITATIVE_FIELDS.has(normalizedField)) {
        logger.warn(`Assistant claim references unallowed field: ${claim.field}`);
        throw new AIProviderError(
          `Grounded answer validation failed: claim references unallowed or nonexistent field "${claim.field}"`
        );
      }
      claim.field = normalizedField;

      // Extract authoritative value from fact
      const authoritativeValue = getAuthoritativeFactValue(fact, claim.field);
      if (authoritativeValue === undefined) {
        logger.warn(
          `Authoritative field "${claim.field}" does not exist in fact "${targetFactRef}"`
        );
        throw new AIProviderError(
          `Grounded answer validation failed: field "${claim.field}" does not exist in authoritative fact "${targetFactRef}"`
        );
      }

      // Verify claim.value matches authoritative fact value
      const isMatch = verifyClaimValueMatch(claim.value, authoritativeValue);
      if (!isMatch) {
        logger.warn(
          `Claim value "${claim.value}" does not match fact value "${JSON.stringify(authoritativeValue)}" for field "${claim.field}"`
        );
        throw new AIProviderError(
          `Grounded answer validation failed: claim value "${claim.value}" does not match authoritative fact value "${JSON.stringify(authoritativeValue)}" for field "${claim.field}" on fact "${targetFactRef}"`
        );
      }
    }

    const finalFactRefs = Array.from(citedFactRefsSet);
    if (finalFactRefs.length === 0) {
      throw new AIProviderError(
        'Grounded answer validation failed: zero valid fact references cited'
      );
    }

    // 11. Final Answer Assembly: Use rich Markdown answer if provided by model, or fallback to validated claims
    const finalAnswer =
      typeof rawAnswer.answer === 'string' && rawAnswer.answer.trim().length > 0
        ? rawAnswer.answer.trim()
        : rawAnswer.claims.map((c) => c.text.trim()).join(' ');

    return {
      question: trimmedQuestion,
      intent,
      resolvedActivity,
      ambiguousCandidates: null,
      answer: finalAnswer,
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
