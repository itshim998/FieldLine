export {
  aiRequestOptionsSchema,
  aiCompletionResponseSchema,
  aiExtractedEntitySchema,
  aiExtractionContractSchema
} from './contracts/ai.contract.js';

export type {
  AIRequestOptions,
  AICompletionResponse,
  AIExtractedEntity,
  AIExtractionContract
} from './contracts/ai.contract.js';

export {
  fieldProgressStatusEnum,
  fieldProgressItemSchema,
  fieldProgressExtractionSchema
} from './contracts/field-progress-extraction.contract.js';

export type {
  FieldProgressStatus,
  FieldProgressItem,
  FieldProgressExtraction
} from './contracts/field-progress-extraction.contract.js';

export {
  assistantIntentTypeEnum,
  assistantIntentSchema,
  assistantClaimTypeEnum,
  assistantClaimSchema,
  assistantAnswerSchema
} from './contracts/assistant.contract.js';

export type {
  AssistantIntentType,
  AssistantIntent,
  AssistantClaimType,
  AssistantClaim,
  AssistantAnswer
} from './contracts/assistant.contract.js';

export type { AIProvider } from './providers/ai-provider.interface.js';
export { MockAIProvider } from './providers/mock-ai.provider.js';
export { GeminiAIProvider } from './providers/gemini-ai.provider.js';

export { DefaultAIService, createDefaultAIProvider, aiService } from './services/ai.service.js';
export type { AIService } from './services/ai.service.js';

export {
  FieldProgressExtractionService,
  fieldProgressExtractionService,
  buildFieldProgressExtractionPrompt,
  MAX_RAW_TEXT_LENGTH
} from './services/field-progress-extraction.service.js';


