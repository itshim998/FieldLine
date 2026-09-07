import {
  ProjectStatus,
  ActivityExecutionStatus,
  ActivityRiskClassification,
  VarianceState,
  ProgressUpdateSourceType,
  ProgressUpdateStatus,
  MatchStatus,
  MatchConfidenceTier,
  MatchReviewState,
  MatchMethod,
  EvidenceFileType
} from '../../models/domain.types.js';
import {
  DelayedActivityFact,
  AtRiskActivityFact,
  StaleActivityFact,
  CompletedActivityFact
} from '../intelligence/project-intelligence.types.js';

export interface ProjectSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHealthSummary {
  overallActualProgress: number;
  overallPlannedProgress: number;
  progressVariance: number;
  varianceState: VarianceState;
  overallRiskClassification: ActivityRiskClassification;
  asOfDate: string;
  generatedAt: string;
}

export interface ActivityStatusSummary {
  totalActivities: number;
  onTrack: number;
  ahead: number;
  atRisk: number;
  delayed: number;
  completed: number;
  overdueCount: number;
}

export interface DashboardMilestoneItem {
  activityId: string;
  externalId: string;
  name: string;
  milestoneDate: string;
  daysUntil: number;
  status: ActivityExecutionStatus;
  actualProgress: number;
  isCompleted: boolean;
  isOverdue: boolean;
  isLate: boolean;
}

export interface DashboardMilestoneSection {
  upcoming: DashboardMilestoneItem[];
  completed: DashboardMilestoneItem[];
  late: DashboardMilestoneItem[];
}

export interface DashboardUnresolvedMatchItem {
  matchId: string;
  progressUpdateId: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  reportDate: string;
  reporterName: string | null;
  confidenceScore: number;
  confidenceTier: MatchConfidenceTier | null;
  reviewState: MatchReviewState | null;
  matchMethod: MatchMethod;
  matchedText: string | null;
  rationale: string | null;
}

export interface DashboardActiveBlockerItem {
  id: string;
  activityId: string | null;
  activityExternalId: string | null;
  activityName: string;
  category: string;
  description: string;
  reporterName: string;
  reporterRole: string | null;
  createdAt: string;
}

export interface DashboardAttentionSummary {
  delayedCount: number;
  delayed: DelayedActivityFact[];
  atRiskCount: number;
  atRisk: AtRiskActivityFact[];
  staleCount: number;
  stale: StaleActivityFact[];
  unresolvedMatchesCount: number;
  unresolvedMatches: DashboardUnresolvedMatchItem[];
  activeBlockersCount: number;
  activeBlockers: DashboardActiveBlockerItem[];
  blockersByRootCause: Record<string, number>;
}

export interface DashboardMatchItem {
  id: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  confidenceScore: number;
  status: MatchStatus;
  confidenceTier: MatchConfidenceTier | null;
  reviewState: MatchReviewState | null;
  matchMethod: MatchMethod;
  rationale: string | null;
  evidenceId: string | null;
}

export interface DashboardProgressObservationItem {
  id: string;
  activityId: string;
  activityExternalId: string;
  activityName: string;
  actualPercent: number;
  actualStart: string | null;
  actualFinish: string | null;
  status: ActivityExecutionStatus;
  asOfDate: string;
}

export interface DashboardEvidenceItem {
  id: string;
  fileName: string;
  fileType: EvidenceFileType;
  fileSizeBytes: number | null;
  uploadedAt: string;
}

export interface DashboardRecentUpdateItem {
  id: string;
  reportDate: string;
  createdAt: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: ProgressUpdateSourceType;
  rawText: string;
  status: ProgressUpdateStatus;
  matches: DashboardMatchItem[];
  canonicalObservations: DashboardProgressObservationItem[];
  evidenceList: DashboardEvidenceItem[];
}

export interface ProjectDashboard {
  project: ProjectSummary;
  health: ProjectHealthSummary;
  activityStatus: ActivityStatusSummary;
  recentUpdates: DashboardRecentUpdateItem[];
  milestones: DashboardMilestoneSection;
  attention: DashboardAttentionSummary;
}

export interface ProjectDashboardQueryOptions {
  asOfDate?: string;
  recentLimit?: number;
  recentDays?: number;
  approachingDays?: number;
}

export interface ProjectDashboardService {
  getDashboard(
    projectId: string,
    options?: ProjectDashboardQueryOptions
  ): ProjectDashboard;
}
