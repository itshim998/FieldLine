import { AssistantIntent, AssistantIntentType, AssistantClaim } from '../../ai/contracts/assistant.contract.js';

export interface VerifiedFact {
  ref: string;
  category: AssistantIntentType | 'general';
  summary: string;
  activityId?: string | null;
  externalId?: string | null;
  activityName?: string | null;
  progressUpdateId?: string | null;
  evidenceId?: string | null;
  data: Record<string, unknown>;
}

export interface ResolvedActivityInfo {
  id: string;
  externalId: string;
  name: string;
  location: string | null;
}

export type ActivityResolutionStatus = 'resolved' | 'not_found' | 'ambiguous';

export interface ActivityResolutionResult {
  status: ActivityResolutionStatus;
  activity: ResolvedActivityInfo | null;
  candidates: ResolvedActivityInfo[];
}

export interface AssistantQueryOptions {
  asOfDate?: string;
  role?: 'worker' | 'admin';
  userName?: string;
  userRole?: string;
}

export type AssistantResponseStatus =
  | 'success'
  | 'activity_not_found'
  | 'ambiguous_activity'
  | 'insufficient_data'
  | 'unsupported'
  | 'scope_restricted';

export interface AssistantQueryResponse {
  question: string;
  intent: AssistantIntent;
  resolvedActivity: ResolvedActivityInfo | null;
  ambiguousCandidates: ResolvedActivityInfo[] | null;
  answer: string;
  claims?: AssistantClaim[];
  factRefs: string[];
  grounded: boolean;
  status: AssistantResponseStatus;
  asOfDate: string;
  verifiedFacts: VerifiedFact[];
}

export const MAX_QUESTION_LENGTH = 1000;
export const MAX_VERIFIED_FACTS_LIMIT = 50;
