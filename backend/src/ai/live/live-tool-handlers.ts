import { logger } from '../../config/logger.js';
import {
  Project,
  ActivityProgressSnapshotItem,
  ActivityExecutionStatus
} from '../../models/domain.types.js';
import {
  ActivityRepository,
  ProjectRepository,
  ActivityMatchRepository,
  defaultLiveToolAdapterDeps
} from '../../services/assistant/live-tool-adapter.js';
import {
  DeterministicActivityResolver,
  deterministicActivityResolver as defaultResolver
} from '../../services/assistant/activity-resolver.js';
import {
  ProgressSnapshotService,
  progressSnapshotService as defaultSnapshotService,
  getTodayDateString
} from '../../services/snapshot/progress-snapshot.service.js';
import {
  ProjectIntelligenceService,
  projectIntelligenceService as defaultIntelligenceService
} from '../../services/intelligence/project-intelligence.service.js';
import {
  FieldProgressExtractionService,
  fieldProgressExtractionService as defaultExtractionService
} from '../services/field-progress-extraction.service.js';
import {
  ProgressUpdateService,
  progressUpdateService as defaultProgressUpdateService
} from '../../services/progress-update.service.js';
import {
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from '../../services/matching/activity-matching.service.js';
import {
  ProgressService,
  progressService as defaultProgressService
} from '../../services/progress/progress.service.js';
import {
  AssistantService,
  assistantService as defaultAssistantService
} from '../../services/assistant/assistant.service.js';
import { LiveFunctionCall } from './upstream-gemini-socket.js';

export interface LiveToolExecutionContext {
  session?: {
    dispatchVerbalConfirmation: (text: string) => void;
    sendToClient: (payload: Record<string, any>) => void;
  };
  gateway?: {
    getSessionsForProject: (projectId: string) => Array<{
      dispatchVerbalConfirmation: (text: string) => void;
      sendToClient: (payload: Record<string, any>) => void;
    }>;
  };
}

export interface LiveToolHandlerDependencies {
  activityRepo?: ActivityRepository;
  projectRepo?: ProjectRepository;
  activityMatchRepo?: ActivityMatchRepository;
  activityResolver?: DeterministicActivityResolver;
  snapshotService?: ProgressSnapshotService;
  intelligenceService?: ProjectIntelligenceService;
  extractionService?: FieldProgressExtractionService;
  progressUpdateService?: ProgressUpdateService;
  matchingService?: ActivityMatchingService;
  progressService?: ProgressService;
  assistantService?: AssistantService;
}

export class LiveToolHandlers {
  private activityRepo: ActivityRepository;
  private projectRepo: ProjectRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private activityResolver: DeterministicActivityResolver;
  private snapshotService: ProgressSnapshotService;
  private intelligenceService: ProjectIntelligenceService;
  private extractionService: FieldProgressExtractionService;
  private progressUpdateService: ProgressUpdateService;
  private matchingService: ActivityMatchingService;
  private progressService: ProgressService;
  private assistantService: AssistantService;

  constructor(deps: LiveToolHandlerDependencies = {}) {
    this.activityRepo = deps.activityRepo || defaultLiveToolAdapterDeps.activityRepo;
    this.projectRepo = deps.projectRepo || defaultLiveToolAdapterDeps.projectRepo;
    this.activityMatchRepo = deps.activityMatchRepo || defaultLiveToolAdapterDeps.activityMatchRepo;
    this.activityResolver = deps.activityResolver || defaultResolver;
    this.snapshotService = deps.snapshotService || defaultSnapshotService;
    this.intelligenceService = deps.intelligenceService || defaultIntelligenceService;
    this.extractionService = deps.extractionService || defaultExtractionService;
    this.progressUpdateService = deps.progressUpdateService || defaultProgressUpdateService;
    this.matchingService = deps.matchingService || defaultMatchingService;
    this.progressService = deps.progressService || defaultProgressService;
    this.assistantService = deps.assistantService || defaultAssistantService;
  }

  /**
   * Resolves a project by ID or code, falling back to session project ID or the single active project.
   * Ensures all database queries always use the canonical database UUID.
   */
  public resolveProject(projectIdOrCode?: string, sessionProjectId?: string): Project | null {
    const candidates = [projectIdOrCode, sessionProjectId].filter(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    );

    for (const cand of candidates) {
      const trimmed = cand.trim();
      // 1. Try by UUID
      const byId = this.projectRepo.getById(trimmed);
      if (byId) return byId;

      // 2. Try by code (case-insensitive)
      const byCode = this.projectRepo.getByCode(trimmed);
      if (byCode) return byCode;
    }

    if (sessionProjectId && sessionProjectId.trim().length > 0) {
      const trimmed = sessionProjectId.trim();
      const byId = this.projectRepo.getById(trimmed);
      if (byId) return byId;
      const byCode = this.projectRepo.getByCode(trimmed);
      if (byCode) return byCode;
    }

    // Fallback: If only one project exists in the system, default to it
    const all = this.projectRepo.listAll();
    if (all.length === 1) {
      return all[0];
    }
    return null;
  }

  /**
   * Tool 1: get_next_recommended_activities(projectId, location)
   * Queries activityRepository & snapshot for activities with status 'not_started' or 'in_progress'.
   * Optionally filters by location. Returns top 5 prioritized tasks with code, name, location, and planned dates.
   */
  async getNextRecommendedActivities(
    projectId?: string,
    location?: string,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(`LiveTool [get_next_recommended_activities]: Project [${projectId || 'default'}], Location: "${location || 'any'}"`);

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;
    const today = getTodayDateString();
    let snapshotActivities: ActivityProgressSnapshotItem[] = [];

    try {
      const snapshot = this.snapshotService.getProgressSnapshot(canonicalProjectId, today);
      if (snapshot && Array.isArray(snapshot.activities)) {
        snapshotActivities = snapshot.activities;
      }
    } catch (snapErr: any) {
      logger.warn(`LiveTool [get_next_recommended_activities]: Could not get snapshot, falling back to base activities: ${snapErr.message}`);
      const rawActivities = this.activityRepo.listByProjectId(canonicalProjectId);
      snapshotActivities = rawActivities.map((a) => ({
        activityId: a.id,
        externalId: a.externalId,
        name: a.name,
        wbsCode: a.wbsCode,
        location: a.location || null,
        status: 'not_started' as ActivityExecutionStatus,
        plannedStart: a.plannedStart,
        plannedFinish: a.plannedFinish,
        plannedDurationDays: 0,
        actualStart: null,
        actualFinish: null,
        plannedProgress: 0,
        actualProgress: 0,
        progressVariance: 0,
        varianceState: 'on_plan',
        overdue: false
      }));
    }

    // 1. Filter out completed activities (keep not_started, started, or in_progress)
    let eligible = snapshotActivities.filter(
      (a) => a.status === 'not_started' || a.status === 'in_progress' || a.status === 'started'
    );

    // 2. Optionally filter by site location (case-insensitive substring match)
    if (location && location.trim().length > 0) {
      const locQuery = location.trim().toLowerCase();
      eligible = eligible.filter(
        (a) => a.location && a.location.toLowerCase().includes(locQuery)
      );
    }

    // 3. Prioritize tasks: earliest plannedStart first, then earliest plannedFinish
    eligible.sort((a, b) => {
      if (a.plannedStart !== b.plannedStart) {
        return a.plannedStart.localeCompare(b.plannedStart);
      }
      return a.plannedFinish.localeCompare(b.plannedFinish);
    });

    // 4. Return top 5 prioritized tasks
    const top5 = eligible.slice(0, 5).map((a) => ({
      code: a.externalId,
      name: a.name,
      location: a.location || 'N/A',
      status: a.status,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
      plannedDates: `${a.plannedStart} to ${a.plannedFinish}`,
      plannedProgress: `${a.plannedProgress}%`,
      actualProgress: `${a.actualProgress}%`,
      overdue: a.overdue
    }));

    return {
      status: 'success',
      projectId: canonicalProjectId,
      projectCode: project.code,
      totalEligible: eligible.length,
      returnedCount: top5.length,
      locationFilter: location || null,
      activities: top5,
      summary:
        top5.length > 0
          ? `Found ${top5.length} recommended active/upcoming task(s)${location ? ` at ${location}` : ''}: ${top5.map((t) => `${t.code} (${t.name}) scheduled ${t.plannedDates}`).join('; ')}.`
          : `No uncompleted activities found matching the specified criteria${location ? ` at ${location}` : ''}.`
    };
  }

  /**
   * Tool 2: lookup_activity_status(projectId, query)
   * Uses DeterministicActivityResolver to resolve the activity by code or name.
   * Returns verified planned/actual progress, variance state, and delays.
   */
  async lookupActivityStatus(
    projectId?: string,
    query?: string,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(`LiveTool [lookup_activity_status]: Project [${projectId || 'default'}], Query: "${query}"`);

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;

    if (!query || query.trim().length === 0) {
      return {
        status: 'error',
        message: 'Query parameter cannot be empty.'
      };
    }

    // Deterministically resolve activity within the project
    const resolution = this.activityResolver.resolve(canonicalProjectId, query);

    if (resolution.status === 'not_found') {
      return {
        status: 'not_found',
        query,
        message: `No activity found matching "${query}" in project ${project.code}.`
      };
    }

    if (resolution.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        query,
        candidates: resolution.candidates.map((c) => ({
          code: c.externalId,
          name: c.name,
          location: c.location || 'N/A'
        })),
        message: `Multiple activities matched "${query}": ${resolution.candidates.map((c) => `${c.externalId} (${c.name})`).join(', ')}. Please clarify which one you mean.`
      };
    }

    const resolved = resolution.activity!;
    const today = getTodayDateString();

    // Pull authoritative progress snapshot and intelligence delays
    let plannedProgress = 0;
    let actualProgress = 0;
    let varianceState = 'on_plan';
    let progressVariance = 0;
    let executionStatus: string = 'not_started';
    let plannedStart = 'N/A';
    let plannedFinish = 'N/A';
    let actualStart: string | null = null;
    let actualFinish: string | null = null;
    let overdue = false;

    try {
      const snapshot = this.snapshotService.getProgressSnapshot(canonicalProjectId, today);
      const snapItem = snapshot.activities.find((a) => a.activityId === resolved.id);
      if (snapItem) {
        plannedProgress = snapItem.plannedProgress;
        actualProgress = snapItem.actualProgress;
        varianceState = snapItem.varianceState;
        progressVariance = snapItem.progressVariance;
        executionStatus = snapItem.status;
        plannedStart = snapItem.plannedStart;
        plannedFinish = snapItem.plannedFinish;
        actualStart = snapItem.actualStart;
        actualFinish = snapItem.actualFinish;
        overdue = snapItem.overdue;
      }
    } catch (snapErr: any) {
      logger.warn(`LiveTool [lookup_activity_status]: Snapshot lookup error: ${snapErr.message}`);
    }

    // Check for delay reasons from project intelligence
    const delayReasons: string[] = [];
    try {
      const intelligence = this.intelligenceService.getIntelligence(canonicalProjectId, { asOfDate: today });
      const delayedItem = intelligence.delayed.find((d) => d.activityId === resolved.id);
      if (delayedItem) {
        delayReasons.push(...delayedItem.reasons.map((r) => r.message));
      }
      const atRiskItem = intelligence.atRisk.find((r) => r.activityId === resolved.id);
      if (atRiskItem) {
        delayReasons.push(...atRiskItem.reasons.map((r) => `At Risk: ${r.message}`));
      }
    } catch {
      // Graceful fallback
    }

    return {
      status: 'resolved',
      projectId: canonicalProjectId,
      projectCode: project.code,
      activityId: resolved.id,
      code: resolved.externalId,
      name: resolved.name,
      location: resolved.location || 'N/A',
      executionStatus,
      plannedProgress: `${plannedProgress}%`,
      actualProgress: `${actualProgress}%`,
      progressVariance: `${progressVariance}%`,
      varianceState: varianceState.replace('_', ' '),
      plannedDates: `${plannedStart} to ${plannedFinish}`,
      plannedStart,
      plannedFinish,
      actualStart: actualStart || 'Not started',
      actualFinish: actualFinish || (executionStatus === 'completed' ? today : 'Pending'),
      overdue,
      delays: delayReasons.length > 0 ? delayReasons : ['No reported delays or variance blockers.'],
      summary: `Activity "${resolved.name}" (${resolved.externalId}) is ${executionStatus.replace('_', ' ')} with ${actualProgress}% actual progress vs ${plannedProgress}% planned (${varianceState.replace('_', ' ')}). Planned finish: ${plannedFinish}. ${overdue ? 'Currently OVERDUE. ' : ''}${delayReasons.length > 0 ? `Delays: ${delayReasons.join('; ')}.` : 'On schedule.'}`
    };
  }

  /**
   * Tool 3: record_field_progress(projectId, rawStatement)
   * Immediately returns a tool execution result to Gemini Live confirming intake:
   *   { status: "queued", message: "Progress statement captured. Verifying and committing to project schedule." }
   * Asynchronously:
   * 1. Calls FieldProgressExtractionService (Groq openai/gpt-oss-20b).
   * 2. Calls progressUpdateService.createManualUpdate with sourceType = 'voice'.
   * 3. Matches and normalizes via progressService.normalizeAndRecordProgress.
   * 4. Once committed, dispatches verbal confirmation:
   *    "System Event: Progress update committed successfully. Activity: [name] ([code]), Progress: [percentage]%. Verbally inform the worker: 'Update verified: [name] is saved at [percentage]%.'"
   */
  async recordFieldProgress(
    projectId?: string,
    rawStatement?: string,
    context?: LiveToolExecutionContext,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(`LiveTool [record_field_progress]: Intake received for project [${projectId || 'default'}]: "${rawStatement}"`);

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;

    if (!rawStatement || rawStatement.trim().length === 0) {
      return {
        status: 'error',
        message: 'Progress statement cannot be empty.'
      };
    }

    // Launch asynchronous extraction, linking, and verbal confirmation pipeline
    // This allows the immediate tool response to return instantaneously without blocking speech
    this.processProgressStatementAsync(canonicalProjectId, rawStatement, project, context).catch(
      (asyncErr) => {
        logger.error(
          `LiveTool [record_field_progress]: Asynchronous processing failed for statement "${rawStatement}": ${asyncErr.message}`,
          asyncErr
        );
      }
    );

    // Immediate synchronous return confirming intake
    return {
      status: 'queued',
      projectId: canonicalProjectId,
      projectCode: project.code,
      message: 'Progress statement captured. Verifying and committing to project schedule.'
    };
  }

  /**
   * Executes the asynchronous Groq extraction, schedule matching, SQLite commit,
   * and verbal confirmation trigger.
   */
  public async processProgressStatementAsync(
    projectId: string,
    rawStatement: string,
    project: any,
    context?: LiveToolExecutionContext
  ): Promise<void> {
    const today = getTodayDateString();

    logger.debug(`LiveTool [processProgressStatementAsync]: Step 1 - Extracting structured facts via Groq...`);
    // 1. Asynchronously extract structured facts using Groq
    const extraction = await this.extractionService.extractFromReport(rawStatement);

    if (!extraction || !Array.isArray(extraction.items) || extraction.items.length === 0) {
      logger.warn(`LiveTool [processProgressStatementAsync]: No structured items extracted from "${rawStatement}".`);
      return;
    }

    logger.debug(`LiveTool [processProgressStatementAsync]: Step 2 - Creating manual progress update (sourceType='voice')...`);
    // 2. Calls progressUpdateService.createManualUpdate with sourceType = 'voice'
    const updateRecord = this.progressUpdateService.createManualUpdate({
      projectId,
      reportDate: today,
      rawText: rawStatement,
      sourceType: 'voice'
    });

    logger.debug(`LiveTool [processProgressStatementAsync]: Step 3 - Matching and persisting candidates...`);
    // 3. Match extraction items against project activities
    const matchReport = await this.matchingService.matchProgressUpdate(
      projectId,
      updateRecord.id,
      extraction,
      { persist: true }
    );

    // Retrieve the persisted matches from the repository
    const persistedMatches = this.activityMatchRepo.listByProgressUpdateId(updateRecord.id, projectId);

    for (const item of extraction.items) {
      let matchedActivityId: string | null = null;
      let matchedRecordId: string | null = null;
      let isConfirmed = false;

      // Find best match among persisted matches
      const matchCandidate = persistedMatches.find(
        (m) => m.progressUpdateId === updateRecord.id
      );

      if (matchCandidate) {
        matchedActivityId = matchCandidate.activityId;
        matchedRecordId = matchCandidate.id;
        isConfirmed = matchCandidate.status === 'confirmed';
      } else {
        // Fallback to DeterministicActivityResolver if matching threshold was missed
        let resolved = this.activityResolver.resolve(projectId, item.reference || rawStatement);
        if (resolved.status !== 'resolved' && item.location) {
          const locQuery = `${item.location} ${item.reference || ''}`.trim();
          resolved = this.activityResolver.resolve(projectId, locQuery);
        }
        if (resolved.status !== 'resolved' && rawStatement) {
          resolved = this.activityResolver.resolve(projectId, rawStatement);
        }
        if (resolved.status === 'resolved' && resolved.activity) {
          const fallbackMatch = this.activityMatchRepo.create({
            projectId,
            progressUpdateId: updateRecord.id,
            activityId: resolved.activity.id,
            confidenceScore: 0.95,
            matchMethod: 'exact_id',
            matchedText: resolved.activity.name,
            rationale: 'Resolved deterministically via fallback resolver',
            status: 'confirmed',
            confidenceTier: 'high',
            reviewState: 'resolved',
            reviewedBy: 'system',
            reviewedAt: new Date().toISOString()
          });
          matchedActivityId = fallbackMatch.activityId;
          matchedRecordId = fallbackMatch.id;
          isConfirmed = true;
        }
      }

      if (!matchedActivityId || !matchedRecordId) {
        logger.warn(
          `LiveTool [processProgressStatementAsync]: Could not link item "${item.reference}" to an activity in project [${project.code}].`
        );
        continue;
      }

      const activity = this.activityRepo.getById(matchedActivityId);
      if (!activity) {
        logger.warn(`LiveTool [processProgressStatementAsync]: Activity [${matchedActivityId}] not found in repository.`);
        continue;
      }

      if (isConfirmed) {
        logger.debug(
          `LiveTool [processProgressStatementAsync]: Step 4 - Normalizing and recording progress for activity "${activity.name}" (${activity.externalId})...`
        );

        // 4. Normalizes and links the extracted item via progressService.normalizeAndRecordProgress
        const recordedProgress = this.progressService.normalizeAndRecordProgress({
          projectId,
          updateId: updateRecord.id,
          matchId: matchedRecordId,
          fact: item,
          allowSuggested: false
        });

        const percentage = recordedProgress.actualPercent;
        const activityName = activity.name;
        const activityCode = activity.externalId;

        logger.info(
          `LiveTool [processProgressStatementAsync]: Step 5 - DB update committed: "${activityName}" (${activityCode}) at ${percentage}%. Triggering verbal confirmation...`
        );

        // 5. Verbal Confirmation Trigger:
        // Once the database transaction commits, dispatch high-priority system turn to Gemini Live
        const systemEventText = `System Event: Progress update committed successfully. Activity: ${activityName} (${activityCode}), Progress: ${percentage}%. Verbally inform the worker: 'Update verified: ${activityName} is saved at ${percentage}%.'`;

        // Dispatch to session if direct context is available
        if (context?.session) {
          context.session.dispatchVerbalConfirmation(systemEventText);
          context.session.sendToClient({
            type: 'progress_verified',
            activityId: activity.id,
            activityCode,
            activityName,
            progressPercent: percentage,
            message: `Update verified: ${activityName} is saved at ${percentage}%.`
          });
        } else if (context?.gateway) {
          const projectSessions = context.gateway.getSessionsForProject(projectId);
          for (const s of projectSessions) {
            s.dispatchVerbalConfirmation(systemEventText);
            s.sendToClient({
              type: 'progress_verified',
              activityId: activity.id,
              activityCode,
              activityName,
              progressPercent: percentage,
              message: `Update verified: ${activityName} is saved at ${percentage}%.`
            });
          }
        }
      } else {
        // Ambiguous match (e.g. reviewState: 'awaiting_review')
        // Route to Admin Review Queue without blocking or mutating canonical progress!
        const activityName = activity.name;
        const activityCode = activity.externalId;

        logger.info(
          `LiveTool [processProgressStatementAsync]: Match for "${activityName}" (${activityCode}) is ambiguous (${matchCandidate?.reviewState || 'awaiting_review'}). Queued for Admin Human Review.`
        );

        const systemEventText = `System Event: Progress update recorded but requires admin review. Activity candidate: ${activityName} (${activityCode}). Verbally inform the worker: 'Update captured and submitted for review: ambiguous match routed to Admin review queue.'`;

        if (context?.session) {
          context.session.dispatchVerbalConfirmation(systemEventText);
          context.session.sendToClient({
            type: 'progress_review_needed',
            activityId: activity.id,
            activityCode,
            activityName,
            matchId: matchedRecordId,
            reviewState: matchCandidate?.reviewState || 'awaiting_review',
            message: `Update captured and queued for admin review for ${activityName}.`
          });
        } else if (context?.gateway) {
          const projectSessions = context.gateway.getSessionsForProject(projectId);
          for (const s of projectSessions) {
            s.dispatchVerbalConfirmation(systemEventText);
            s.sendToClient({
              type: 'progress_review_needed',
              activityId: activity.id,
              activityCode,
              activityName,
              matchId: matchedRecordId,
              reviewState: matchCandidate?.reviewState || 'awaiting_review',
              message: `Update captured and queued for admin review for ${activityName}.`
            });
          }
        }
      }
    }
  }

  /**
   * Tool 4: get_project_intelligence(projectId)
   * Fetches full project health, all delayed tasks with root causes, at-risk tasks,
   * approaching milestones, and recent events.
   */
  async getProjectIntelligence(
    projectId?: string,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(`LiveTool [get_project_intelligence]: Project [${projectId || 'default'}]`);

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;
    const today = getTodayDateString();

    try {
      const intelligence = this.intelligenceService.getIntelligence(canonicalProjectId, { asOfDate: today });
      const snapshot = this.snapshotService.getProgressSnapshot(canonicalProjectId, today);

      const delayedCount = intelligence.delayed?.length || 0;
      const atRiskCount = intelligence.atRisk?.length || 0;
      const projectRiskStatus = delayedCount > 0 ? 'DELAYED' : atRiskCount > 0 ? 'AT_RISK' : 'ON_TRACK';

      return {
        status: 'success',
        projectId: canonicalProjectId,
        projectCode: project.code,
        projectName: project.name,
        asOfDate: today,
        health: {
          overallActualProgress: snapshot.summary.overallActualProgress,
          overallPlannedProgress: snapshot.summary.overallPlannedProgress,
          progressVariance: snapshot.summary.progressVariance,
          varianceState: snapshot.summary.varianceState.replace('_', ' '),
          projectRiskStatus,
          totalActivities: snapshot.summary.totalActivities
        },
        counts: {
          delayed: delayedCount,
          atRisk: atRiskCount,
          approachingMilestones: intelligence.approachingMilestones?.length || 0,
          stale: intelligence.staleActivities?.length || 0
        },
        delayedActivities: (intelligence.delayed || []).map((d) => ({
          code: d.externalId,
          name: d.name,
          plannedFinish: d.plannedFinish,
          progressVariance: d.progressVariance,
          overdue: d.overdue,
          reasons: d.reasons.map((r) => r.message)
        })),
        atRiskActivities: (intelligence.atRisk || []).map((r) => ({
          code: r.externalId,
          name: r.name,
          variance: r.progressVariance,
          reasons: r.reasons.map((res) => res.message)
        })),
        approachingMilestones: (intelligence.approachingMilestones || []).map((m) => ({
          code: m.externalId,
          name: m.name,
          targetDate: m.milestoneDate,
          daysUntil: m.daysUntil,
          status: m.status
        })),
        recentChanges: (intelligence.recentChanges || []).slice(0, 5).map((c) => ({
          type: c.eventType,
          date: c.createdAt,
          description: c.summary
        })),
        summary: `Project "${project.name}" (${project.code}) is currently ${projectRiskStatus.replace('_', ' ')} with ${snapshot.summary.overallActualProgress}% actual vs ${snapshot.summary.overallPlannedProgress}% planned (${snapshot.summary.varianceState.replace('_', ' ')}). ${delayedCount} activities are delayed, ${atRiskCount} at risk, and ${intelligence.approachingMilestones?.length || 0} milestones approaching.`
      };
    } catch (err: any) {
      logger.error(`LiveTool [get_project_intelligence] failed: ${err.message}`, err);
      return {
        status: 'error',
        message: `Failed to retrieve intelligence for project ${project.code}: ${err.message}`
      };
    }
  }

  /**
   * Tool 5: search_project_activities(projectId, query, statusFilter, locationFilter, limit)
   * Searches, filters, or lists activities in the project database.
   */
  async searchProjectActivities(
    projectId?: string,
    query?: string,
    statusFilter?: string,
    locationFilter?: string,
    limit: number = 10,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(
      `LiveTool [search_project_activities]: Project [${projectId || 'default'}], Query: "${query || ''}", Status: "${statusFilter || 'all'}"`
    );

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;
    const today = getTodayDateString();

    const rawActivities = this.activityRepo.listByProjectId(canonicalProjectId);
    let snapshotItems: ActivityProgressSnapshotItem[] = [];
    try {
      const snap = this.snapshotService.getProgressSnapshot(canonicalProjectId, today);
      snapshotItems = snap.activities;
    } catch {}

    const snapMap = new Map(snapshotItems.map((s) => [s.activityId, s]));

    let filtered = rawActivities;

    if (query && query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.externalId.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.location && a.location.toLowerCase().includes(q))
      );
    }

    if (locationFilter && locationFilter.trim().length > 0) {
      const loc = locationFilter.trim().toLowerCase();
      filtered = filtered.filter((a) => a.location && a.location.toLowerCase().includes(loc));
    }

    let results = filtered.map((a) => {
      const snap = snapMap.get(a.id);
      return {
        activityId: a.id,
        code: a.externalId,
        name: a.name,
        location: a.location || 'N/A',
        status: snap?.status || 'not_started',
        plannedStart: a.plannedStart,
        plannedFinish: a.plannedFinish,
        actualProgress: snap ? `${snap.actualProgress}%` : '0%',
        plannedProgress: snap ? `${snap.plannedProgress}%` : '0%',
        overdue: snap?.overdue || false
      };
    });

    if (statusFilter && statusFilter.trim().length > 0 && statusFilter.toLowerCase() !== 'all') {
      const sf = statusFilter.trim().toLowerCase();
      results = results.filter((r) => r.status.toLowerCase() === sf);
    }

    const capped = results.slice(0, Math.min(limit || 10, 25));

    return {
      status: 'success',
      projectId: canonicalProjectId,
      projectCode: project.code,
      totalMatched: results.length,
      returnedCount: capped.length,
      activities: capped,
      summary: `Found ${results.length} activity(ies) matching query in project ${project.code}. Returning ${capped.length}.`
    };
  }

  /**
   * Tool 6: query_project_assistant(projectId, question)
   * Answers complex analytical questions grounded in verified SQLite facts.
   */
  async queryProjectAssistant(
    projectId?: string,
    question?: string,
    sessionProjectId?: string
  ): Promise<Record<string, any>> {
    logger.info(`LiveTool [query_project_assistant]: Project [${projectId || 'default'}], Question: "${question}"`);

    const project = this.resolveProject(projectId, sessionProjectId);
    if (!project) {
      return {
        status: 'error',
        message: `Project with ID or code "${projectId || sessionProjectId || 'unknown'}" not found.`
      };
    }

    const canonicalProjectId = project.id;
    if (!question || question.trim().length === 0) {
      return {
        status: 'error',
        message: 'Question cannot be empty.'
      };
    }

    try {
      const ans = await this.assistantService.answerQuestion(canonicalProjectId, question);
      return {
        status: 'success',
        projectId: canonicalProjectId,
        projectCode: project.code,
        intent: ans.intent,
        answer: ans.answer,
        verifiedFacts: ans.verifiedFacts.slice(0, 5)
      };
    } catch (err: any) {
      logger.error(`LiveTool [query_project_assistant] failed: ${err.message}`, err);
      return {
        status: 'error',
        message: `Query failed: ${err.message}`
      };
    }
  }

  /**
   * Router executing tool calls based on call.name.
   */
  async executeTool(
    sessionProjectId: string,
    call: LiveFunctionCall,
    context?: LiveToolExecutionContext
  ): Promise<Record<string, any>> {
    const args = call.args || {};
    const effectiveProjectId = args.projectId || sessionProjectId;

    switch (call.name) {
      case 'get_project_intelligence':
        return await this.getProjectIntelligence(effectiveProjectId, sessionProjectId);

      case 'get_next_recommended_activities':
        return await this.getNextRecommendedActivities(effectiveProjectId, args.location, sessionProjectId);

      case 'lookup_activity_status':
        return await this.lookupActivityStatus(effectiveProjectId, args.query, sessionProjectId);

      case 'search_project_activities':
        return await this.searchProjectActivities(
          effectiveProjectId,
          args.query,
          args.status,
          args.location,
          args.limit,
          sessionProjectId
        );

      case 'record_field_progress':
        return await this.recordFieldProgress(effectiveProjectId, args.rawStatement, context, sessionProjectId);

      case 'query_project_assistant':
        return await this.queryProjectAssistant(effectiveProjectId, args.question, sessionProjectId);

      default:
        logger.warn(`LiveToolHandlers: Unknown tool call "${call.name}".`);
        return {
          status: 'error',
          tool: call.name,
          message: `Unknown live tool "${call.name}". Supported tools: get_project_intelligence, get_next_recommended_activities, lookup_activity_status, search_project_activities, record_field_progress, query_project_assistant.`
        };
    }
  }
}

/**
 * Creates a configured live tool executor for GeminiLiveGateway.
 */
export function createLiveToolExecutor(
  deps: LiveToolHandlerDependencies = {}
): (projectId: string, call: LiveFunctionCall, context?: LiveToolExecutionContext) => Promise<Record<string, any>> {
  const handlers = new LiveToolHandlers(deps);
  return (projectId: string, call: LiveFunctionCall, context?: LiveToolExecutionContext) =>
    handlers.executeTool(projectId, call, context);
}
