import {
  VarianceState,
  ActivityProgressSnapshotItem,
  ProgressSnapshotSummary,
  ProjectProgressSnapshot,
  Activity,
  ActivityProgress
} from '../../models/domain.types.js';

export type {
  VarianceState,
  ActivityProgressSnapshotItem,
  ProgressSnapshotSummary,
  ProjectProgressSnapshot
};

export interface PlannedProgressCalculation {
  plannedDurationDays: number;
  plannedProgress: number;
}

export interface VarianceCalculation {
  progressVariance: number;
  varianceState: VarianceState;
}

import { MaybePromise } from '../../database/provider.js';

export interface ProgressSnapshotInput {
  projectId: string;
  asOfDate?: string;
}

export interface ProgressSnapshotService {
  getProgressSnapshot(projectId: string, asOfDate?: string): MaybePromise<ProjectProgressSnapshot>;
}
