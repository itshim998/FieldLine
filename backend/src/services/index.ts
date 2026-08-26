export {
  DefaultHealthService,
  healthService
} from './health.service.js';
export type { HealthService } from './health.service.js';

export {
  DefaultProjectService,
  projectService
} from './project.service.js';
export type { ProjectService } from './project.service.js';

export {
  DefaultScheduleImportService,
  scheduleImportService
} from './schedule-import.service.js';
export type { ScheduleImportService } from './schedule-import.service.js';

export {
  DefaultProgressUpdateService,
  progressUpdateService
} from './progress-update.service.js';
export type { ProgressUpdateService, CreateManualUpdateInput } from './progress-update.service.js';

export {
  ActivityMatchingService,
  activityMatchingService
} from './matching/activity-matching.service.js';
export type {
  CandidateMatch,
  FieldFactMatchResult,
  MatchReportResult,
  MatchingOptions
} from './matching/activity-matching.types.js';
export { scoreActivityCandidate } from './matching/activity-match-scoring.js';
export { computeTextSimilarity } from './matching/text-similarity.js';

export * from './normalization/index.js';
export * from './validation/index.js';



