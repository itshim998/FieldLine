import {
  ActivityRiskClassification,
  RiskReasonCode,
  RiskReason,
  DependencyRiskSignal,
  ActivityRiskStatusItem,
  ProjectRiskSummary,
  ProjectRiskStatus,
  ProjectProgressSnapshot,
  ActivityProgressSnapshotItem,
  VarianceState,
  ActivityExecutionStatus
} from '../../models/domain.types.js';

export type {
  ActivityRiskClassification,
  RiskReasonCode,
  RiskReason,
  DependencyRiskSignal,
  ActivityRiskStatusItem,
  ProjectRiskSummary,
  ProjectRiskStatus,
  ProjectProgressSnapshot,
  ActivityProgressSnapshotItem,
  VarianceState,
  ActivityExecutionStatus
};

import { MaybePromise } from '../../database/provider.js';

export interface RiskStatusInput {
  projectId: string;
  asOfDate?: string;
}

export interface RiskClassificationService {
  getProjectRiskStatus(projectId: string, asOfDate?: string): MaybePromise<ProjectRiskStatus>;
}
