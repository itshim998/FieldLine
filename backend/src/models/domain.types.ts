/**
 * Domain entity types and DTOs for FieldLine.
 *
 * Core Foundational Entities (Pass 2):
 * 1. Project
 * 2. Schedule
 * 3. Activity
 * 4. ProgressUpdate
 * 5. Evidence
 * 6. ActivityMatch
 * 7. ActivityProgress
 * 8. ProjectEvent
 */

// ==========================================
// 1. Projects
// ==========================================
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  code: string;
  status: ProjectStatus;
  startDate: string | null;
  targetEndDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  description?: string | null;
  code: string;
  status?: ProjectStatus;
  startDate?: string | null;
  targetEndDate?: string | null;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  code?: string;
  status?: ProjectStatus;
  startDate?: string | null;
  targetEndDate?: string | null;
}

// ==========================================
// 2. Schedules
// ==========================================
export type ScheduleSourceType = 'csv' | 'xlsx' | 'p6' | 'manual';

export interface Schedule {
  id: string;
  projectId: string;
  name: string;
  version: string;
  sourceType: ScheduleSourceType;
  sourceFilename: string | null;
  isBaseline: boolean;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  id?: string;
  projectId: string;
  name: string;
  version?: string;
  sourceType: ScheduleSourceType;
  sourceFilename?: string | null;
  isBaseline?: boolean;
}

export interface CanonicalScheduleImportRow {
  externalId: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  description?: string | null;
  wbsCode?: string | null;
  location?: string | null;
  plannedQuantity?: number | string | null;
  unit?: string | null;
  baselineProgress?: number | string | null;
}

export interface NormalizedScheduleActivity {
  externalId: string;
  name: string;
  plannedStart: string;
  plannedFinish: string;
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number;
}

export interface ScheduleImportSummary {
  schedule: Schedule;
  activitiesImported: number;
  rowCount: number;
  sourceType: ScheduleSourceType;
  originalFilename: string;
}


// ==========================================
// 3. Activities
// ==========================================
export interface Activity {
  id: string;
  projectId: string;
  scheduleId: string;
  externalId: string;
  name: string;
  description: string | null;
  wbsCode: string | null;
  location: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity: number | null;
  unit: string | null;
  baselineProgress: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActivityInput {
  id?: string;
  projectId: string;
  scheduleId: string;
  externalId: string;
  name: string;
  description?: string | null;
  wbsCode?: string | null;
  location?: string | null;
  plannedStart: string;
  plannedFinish: string;
  plannedQuantity?: number | null;
  unit?: string | null;
  baselineProgress?: number;
}

// ==========================================
// 4. Progress Updates
// ==========================================
export type ProgressUpdateSourceType = 'manual' | 'voice' | 'pdf' | 'xlsx' | 'image' | 'text';
export type ProgressUpdateStatus = 'received' | 'processed' | 'reviewed';

export interface ProgressUpdate {
  id: string;
  projectId: string;
  reportDate: string;
  reporterName: string | null;
  reporterRole: string | null;
  sourceType: ProgressUpdateSourceType;
  rawText: string;
  status: ProgressUpdateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProgressUpdateInput {
  id?: string;
  projectId: string;
  reportDate: string;
  reporterName?: string | null;
  reporterRole?: string | null;
  sourceType: ProgressUpdateSourceType;
  rawText: string;
  status?: ProgressUpdateStatus;
}

// ==========================================
// 5. Evidence
// ==========================================
export type EvidenceFileType = 'text' | 'xlsx' | 'pdf' | 'image' | 'transcript' | 'other';

export interface Evidence {
  id: string;
  projectId: string;
  progressUpdateId: string | null;
  fileName: string;
  filePath: string;
  fileType: EvidenceFileType;
  fileSizeBytes: number | null;
  mimeType: string | null;
  metadataJson: string | null;
  uploadedAt: string;
  createdAt: string;
}

export interface CreateEvidenceInput {
  id?: string;
  projectId: string;
  progressUpdateId?: string | null;
  fileName: string;
  filePath: string;
  fileType: EvidenceFileType;
  fileSizeBytes?: number | null;
  mimeType?: string | null;
  metadataJson?: string | null;
}

// ==========================================
// 6. Activity Matches
// ==========================================
export type MatchMethod = 'exact_id' | 'text_similarity' | 'wbs_location' | 'llm_assisted' | 'manual';
export type MatchStatus = 'suggested' | 'confirmed' | 'rejected';

export interface ActivityMatch {
  id: string;
  projectId: string;
  progressUpdateId: string;
  evidenceId: string | null;
  activityId: string;
  confidenceScore: number;
  matchMethod: MatchMethod;
  matchedText: string | null;
  rationale: string | null;
  status: MatchStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActivityMatchInput {
  id?: string;
  projectId: string;
  progressUpdateId: string;
  evidenceId?: string | null;
  activityId: string;
  confidenceScore: number;
  matchMethod: MatchMethod;
  matchedText?: string | null;
  rationale?: string | null;
  status?: MatchStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

// ==========================================
// 7. Activity Progress
// ==========================================
export type ActivityExecutionStatus = 'not_started' | 'started' | 'in_progress' | 'completed' | 'delayed';

export interface ActivityProgress {
  id: string;
  projectId: string;
  activityId: string;
  progressUpdateId: string | null;
  actualPercent: number;
  actualQuantity: number | null;
  actualStart: string | null;
  actualFinish: string | null;
  status: ActivityExecutionStatus;
  asOfDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActivityProgressInput {
  id?: string;
  projectId: string;
  activityId: string;
  progressUpdateId?: string | null;
  actualPercent: number;
  actualQuantity?: number | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  status?: ActivityExecutionStatus;
  asOfDate: string;
  notes?: string | null;
}

// ==========================================
// 8. Project Events
// ==========================================
export type ProjectEventType =
  | 'project_created'
  | 'project_updated'
  | 'schedule_imported'
  | 'progress_reported'
  | 'match_suggested'
  | 'match_confirmed'
  | 'progress_updated'
  | 'delay_detected'
  | 'variance_alert'
  | 'evidence_uploaded';

export interface ProjectEvent {
  id: string;
  projectId: string;
  eventType: ProjectEventType | string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  payloadJson: string | null;
  createdAt: string;
}

export interface CreateProjectEventInput {
  id?: string;
  projectId: string;
  eventType: ProjectEventType | string;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  payloadJson?: string | null;
}
