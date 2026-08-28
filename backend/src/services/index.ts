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

export {
  DefaultProgressService,
  progressService
} from './progress/progress.service.js';
export type {
  ProgressService,
  NormalizeAndRecordProgressInput
} from './progress/progress.service.js';

export {
  normalizeProgress,
  areUnitsCompatible,
  mapExtractionStatus
} from './progress/progress-normalization.js';
export type {
  NormalizeProgressInput,
  ProgressNormalizationResult,
  PercentDerivationSource
} from './progress/progress-normalization.types.js';

export {
  DefaultProgressSnapshotService,
  progressSnapshotService,
  validateSnapshotDate,
  getTodayDateString
} from './snapshot/progress-snapshot.service.js';
export type { ProgressSnapshotService } from './snapshot/progress-snapshot.types.js';

export {
  diffInCalendarDays,
  calculatePlannedProgress,
  calculateVariance,
  isOverdue,
  calculateActivitySnapshot,
  calculateSnapshotSummary,
  calculateProjectSnapshot
} from './snapshot/progress-snapshot.calculator.js';
export type {
  PlannedProgressCalculation,
  VarianceCalculation,
  ProgressSnapshotInput
} from './snapshot/progress-snapshot.types.js';

export {
  DefaultRiskClassificationService,
  riskClassificationService
} from './risk/risk-classification.service.js';
export type { RiskClassificationService } from './risk/risk-classification.types.js';

export {
  classifyActivityRisk,
  calculateProjectRiskSummary,
  calculateProjectRiskStatus,
  STRONG_NEGATIVE_VARIANCE_THRESHOLD,
  NEAR_FINISH_WINDOW_DAYS
} from './risk/risk-classification.calculator.js';
export type {
  ActivityRiskClassification,
  RiskReasonCode,
  RiskReason,
  DependencyRiskSignal,
  ActivityRiskStatusItem,
  ProjectRiskSummary,
  ProjectRiskStatus,
  RiskStatusInput
} from './risk/risk-classification.types.js';

export {
  DefaultEvidenceService,
  evidenceService,
  detectEvidenceFileType
} from './evidence/evidence.service.js';
export type {
  EvidenceService,
  UploadedFilePayload,
  UploadEvidenceOptions,
  EvidenceFileContentResult
} from './evidence/evidence.types.js';

export {
  DefaultDocumentIngestionService,
  documentIngestionService
} from './ingestion/document-ingestion.service.js';
export {
  CsvExtractor,
  csvExtractor
} from './ingestion/extractors/csv.extractor.js';
export {
  XlsxExtractor,
  xlsxExtractor
} from './ingestion/extractors/xlsx.extractor.js';
export {
  PdfExtractor,
  pdfExtractor
} from './ingestion/extractors/pdf.extractor.js';
export {
  OcrExtractor,
  ocrExtractor,
  DefaultTesseractOcrEngine
} from './ingestion/extractors/ocr.extractor.js';
export type { OcrEngine } from './ingestion/extractors/ocr.extractor.js';
export {
  TextExtractor,
  textExtractor
} from './ingestion/extractors/text.extractor.js';
export type {
  DocumentIngestionService,
  NormalizedDocument,
  DocumentExtractor,
  ExtractDocumentInput,
  ProcessEvidenceResult
} from './ingestion/document-ingestion.types.js';

export {
  DefaultProjectIntelligenceService,
  projectIntelligenceService,
  addDaysToDate
} from './intelligence/project-intelligence.service.js';
export type {
  DelayedActivityFact,
  AtRiskActivityFact,
  CompletedActivityFact,
  BehindScheduleActivityFact,
  ApproachingMilestoneFact,
  StaleActivityFact,
  RecentChangeFact,
  ProjectIntelligence,
  ProjectIntelligenceQueryOptions,
  ProjectIntelligenceService
} from './intelligence/project-intelligence.types.js';
export {
  DEFAULT_RECENT_DAYS,
  DEFAULT_APPROACHING_DAYS,
  DEFAULT_RECENT_CHANGES_LIMIT,
  MAX_RECENT_CHANGES_LIMIT
} from './intelligence/project-intelligence.types.js';

export * from './assistant/index.js';

