import { AIService, aiService as defaultAiService } from '../../ai/services/ai.service.js';
import {
  assistantIntentSchema,
  AssistantIntent
} from '../../ai/contracts/assistant.contract.js';
import { ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';
import { MAX_QUESTION_LENGTH } from './assistant.types.js';

export function buildIntentInterpretationPrompt(question: string): string {
  return [
    'You are the Intent Interpreter for FieldLine Infrastructure Assistant.',
    'Your role is ONLY to classify the manager question into a structured intent and extract relevant query parameters.',
    '',
    'SUPPORTED INTENTS:',
    '1. "delayed": Questions asking what is delayed or overdue (e.g. "What is delayed?", "Which tasks are overdue?").',
    '2. "at_risk": Questions asking about risk status or why an activity/project is at risk (e.g. "Why is Foundation B at risk?", "What is at risk?").',
    '3. "completed_today": Questions asking what finished or completed on a specific day/today (e.g. "What completed today?", "What finished on Monday?").',
    '4. "behind_schedule": Questions asking which activities are most behind schedule or have highest negative variance (e.g. "Which activities are most behind schedule?", "Show tasks behind schedule").',
    '5. "approaching_milestones": Questions asking about upcoming or approaching milestones (e.g. "Which milestones are approaching?", "Upcoming milestones?").',
    '6. "stale_activities": Questions asking about activities with no recent updates or stale progress (e.g. "Which activities have no recent updates?", "What activities are stale?").',
    '7. "recent_changes": Questions asking about recent events or changes on a specific date or window (e.g. "What changed today?", "What changed on 2026-08-25?").',
    '8. "activity_status": Questions asking about the status/progress/details of a specific activity (e.g. "What is the status of Foundation B?", "How is Pier 12 doing?").',
    '9. "general": Greetings ("Hie", "Hello", "How are you?"), conversational chat, advisory/recommendations ("How to speed up the work?", "How to mitigate delay?"), general construction engineering questions, or general knowledge.',
    '10. "unsupported": Legacy fallback for unclassifiable non-text input.',
    '',
    'CRITICAL BOUNDARIES:',
    '- Do NOT answer the question.',
    '- Do NOT calculate or infer project numbers or schedule dates.',
    '- Do NOT invent or output schedule activity IDs (e.g. "ACT-001"). "activityQuery" must only be the verbatim human entity name mentioned (e.g. "Foundation B", "Pier 12"), or null.',
    '- "explicitDate" must be an explicit calendar date string (e.g. "2026-08-25") if mentioned by the user. If relative terms like "today", "yesterday", or "now" are used, return null because canonical date is resolved by application code.',
    '',
    'Return ONLY a valid JSON object matching this schema:',
    '{',
    '  "intent": "delayed | at_risk | completed_today | behind_schedule | approaching_milestones | stale_activities | recent_changes | activity_status | general | unsupported",',
    '  "activityQuery": "string (human name) or null",',
    '  "explicitDate": "YYYY-MM-DD or null"',
    '}',
    '',
    '--- MANAGER QUESTION ---',
    question,
    '--- END MANAGER QUESTION ---'
  ].join('\n');
}

export class AssistantIntentService {
  private aiService: AIService;

  constructor(aiServiceInstance: AIService = defaultAiService) {
    this.aiService = aiServiceInstance;
  }

  async interpret(question: string): Promise<AssistantIntent> {
    if (typeof question !== 'string') {
      throw new ValidationError('Question must be a string');
    }

    const trimmed = question.trim();
    if (trimmed.length === 0) {
      throw new ValidationError('Question cannot be empty or whitespace only');
    }

    if (trimmed.length > MAX_QUESTION_LENGTH) {
      throw new ValidationError(
        `Question must not exceed ${MAX_QUESTION_LENGTH.toLocaleString()} characters`
      );
    }

    logger.debug(`AssistantIntentService: Interpreting question "${trimmed.slice(0, 40)}..."`);
    const prompt = buildIntentInterpretationPrompt(trimmed);

    return await this.aiService.extractStructured(prompt, assistantIntentSchema);
  }
}

export const assistantIntentService = new AssistantIntentService();
