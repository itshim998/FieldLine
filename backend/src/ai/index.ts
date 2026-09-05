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
export { GroqAIProvider } from './providers/groq-ai.provider.js';
export type { GroqAIProviderOptions } from './providers/groq-ai.provider.js';
export { GroqKeyRouter } from './providers/groq-key-router.js';
export type { GroqKeyRouterOptions, KeyHealthState, KeyHealthSnapshot, ProviderAttemptError } from './providers/groq-key-router.js';

export { DefaultAIService, createDefaultAIProvider, aiService } from './services/ai.service.js';
export type { AIService } from './services/ai.service.js';

export {
  FieldProgressExtractionService,
  fieldProgressExtractionService,
  buildFieldProgressExtractionPrompt,
  MAX_RAW_TEXT_LENGTH
} from './services/field-progress-extraction.service.js';

export { GeminiKeyRouter } from './providers/gemini-key-router.js';
export type {
  GeminiKeyRouterOptions,
  KeyHealthState as GeminiKeyHealthState,
  KeyHealthSnapshot as GeminiKeyHealthSnapshot,
  ActiveSessionKey,
  ProviderAttemptError as GeminiProviderAttemptError
} from './providers/gemini-key-router.js';

export {
  RollingConversationBuffer
} from './live/rolling-conversation-buffer.js';
export type {
  ConversationTurn,
  InFlightProgressReport,
  RollingConversationBufferOptions
} from './live/rolling-conversation-buffer.js';

export {
  UpstreamGeminiSocket,
  DEFAULT_GEMINI_LIVE_TOOLS,
  DEFAULT_LIVE_SYSTEM_INSTRUCTION
} from './live/upstream-gemini-socket.js';
export type {
  LiveFunctionCall,
  LiveFunctionResponse,
  UpstreamGeminiSocketOptions
} from './live/upstream-gemini-socket.js';

export {
  GeminiLiveGateway,
  LiveGatewaySession
} from './live/gemini-live-gateway.js';
export type {
  GeminiLiveGatewayOptions
} from './live/gemini-live-gateway.js';



