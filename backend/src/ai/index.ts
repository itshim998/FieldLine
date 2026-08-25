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

export type { AIProvider } from './providers/ai-provider.interface.js';
export { MockAIProvider } from './providers/mock-ai.provider.js';

export { DefaultAIService, aiService } from './services/ai.service.js';
export type { AIService } from './services/ai.service.js';
