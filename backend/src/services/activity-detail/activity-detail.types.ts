import {
  VarianceState,
  ActivityExecutionStatus,
  ActivityRiskClassification,
  RiskReason,
  ProgressUpdateSourceType,
  ProgressUpdateStatus,
  MatchMethod,
  MatchStatus,
  MatchConfidenceTier,
  MatchReviewState,
  EvidenceFileType
} from '../../models/domain.types.js';

export interface ActivityDetailActivity {
  activityId: string;
  externalId: string;
  name: string;
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  scheduleId: string;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number;
}

export interface ActivityDetailCurrentState {
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  varianceState: VarianceState;
  status: ActivityExecutionStatus;
  overdue: boolean;
  riskClassification: ActivityRiskClassification;
  riskReasons: RiskReason[];
  actualStart: string | null;
  actualFinish: string | null;
  asOfDate: string;
}

export interface ActivityDetailTimelineItem {
  progressId: string;
  progressUpdateId: string | null;
  date: string;
  actualPercent: number;
  actualQuantity: number | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: ActivityExecutionStatus;
  notes: string | null;
  createdAt: string;
  source: ProgressUpdateSourceType;
}

export interface ActivityDetailProgressUpdateItem {
  progressUpdateId: string;
  reportDate: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: ProgressUpdateSourceType;
  status: ProgressUpdateStatus;
  rawText?: string;
  createdAt?: string;
}

export interface ActivityDetailMatch {
  matchId: string;
  progressUpdateId: string;
  confidenceScore: number;
  confidenceTier: MatchConfidenceTier | null;
  reviewState: MatchReviewState | null;
  status: MatchStatus;
  matchMethod: MatchMethod;
  matchedText: string | null;
  rationale: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  canonicalProgressEligible: boolean;
}

export interface ActivityDetailEvidence {
  evidenceId: string;
  fileName: string;
  fileType: EvidenceFileType;
  fileSizeBytes: number | null;
  uploadedAt: string;
  progressUpdateId: string | null;
}

export interface ActivityDetail {
  activity: ActivityDetailActivity;
  current: ActivityDetailCurrentState;
  timeline: ActivityDetailTimelineItem[];
  progressUpdates: ActivityDetailProgressUpdateItem[];
  matches: ActivityDetailMatch[];
  evidence: ActivityDetailEvidence[];
}

export interface ActivityDetailQueryOptions {
  asOfDate?: string;
}

export interface ActivityDetailService {
  getActivityDetail(
    projectId: string,
    activityId: string,
    options?: ActivityDetailQueryOptions
  ): ActivityDetail;
}
