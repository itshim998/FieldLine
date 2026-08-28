import {
  ActivityExecutionStatus,
  RiskReason,
  VarianceState
} from '../../models/domain.types.js';

export const DEFAULT_RECENT_DAYS = 7;
export const DEFAULT_APPROACHING_DAYS = 14;
export const DEFAULT_RECENT_CHANGES_LIMIT = 50;
export const MAX_RECENT_CHANGES_LIMIT = 100;

export interface DelayedActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
  overdue: boolean;
  classification: 'DELAYED';
  reasons: RiskReason[];
}

export interface AtRiskActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  classification: 'AT_RISK';
  reasons: RiskReason[];
  plannedFinish: string;
  actualProgress: number;
  progressVariance: number;
}

export interface CompletedActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  progressUpdateId: string | null;
  asOfDate: string;
  actualPercent: number;
  actualFinish: string | null;
  status: ActivityExecutionStatus;
}

export interface BehindScheduleActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  plannedProgress: number;
  actualProgress: number;
  progressVariance: number;
  varianceState: VarianceState;
  status: ActivityExecutionStatus;
  plannedFinish: string;
  overdue: boolean;
}

export interface ApproachingMilestoneFact {
  activityId: string;
  externalId: string;
  name: string;
  milestoneDate: string;
  daysUntil: number;
  status: ActivityExecutionStatus;
  actualProgress: number;
}

export interface StaleActivityFact {
  activityId: string;
  externalId: string;
  name: string;
  latestUpdateDate: string | null;
  daysSinceUpdate: number | null;
  hasAnyUpdate: boolean;
}

export interface RecentChangeFact {
  eventId: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  createdAt: string;
  payload: Record<string, unknown> | null;
}

export interface ProjectIntelligence {
  projectId: string;
  asOfDate: string;
  generatedAt: string;

  delayed: DelayedActivityFact[];
  atRisk: AtRiskActivityFact[];
  completedToday: CompletedActivityFact[];
  behindSchedule: BehindScheduleActivityFact[];
  approachingMilestones: ApproachingMilestoneFact[];
  staleActivities: StaleActivityFact[];
  recentChanges: RecentChangeFact[];
}

export interface ProjectIntelligenceQueryOptions {
  asOfDate?: string;
  recentDays?: number;
  approachingDays?: number;
  limit?: number;
}

export interface ProjectIntelligenceService {
  getIntelligence(
    projectId: string,
    options?: ProjectIntelligenceQueryOptions
  ): ProjectIntelligence;
}
