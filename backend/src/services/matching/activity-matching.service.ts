import { ProjectRepository, projectRepository as defaultProjectRepo } from '../../repositories/project.repository.js';
import { ProgressUpdateRepository, progressUpdateRepository as defaultProgressUpdateRepo } from '../../repositories/progress-update.repository.js';
import { ActivityRepository, activityRepository as defaultActivityRepo } from '../../repositories/activity.repository.js';
import { ActivityMatchRepository, activityMatchRepository as defaultActivityMatchRepo } from '../../repositories/activity-match.repository.js';
import { ProjectEventRepository, projectEventRepository as defaultProjectEventRepo } from '../../repositories/project-event.repository.js';
import { FieldProgressExtraction } from '../../ai/contracts/field-progress-extraction.contract.js';
import {
  CandidateMatch,
  FieldFactMatchResult,
  MatchReportResult,
  MatchingOptions
} from './activity-matching.types.js';
import { scoreActivityCandidate } from './activity-match-scoring.js';
import { SemanticActivityMatcher, defaultSemanticMatcher } from './semantic-matcher.js';
import { LLMActivityDisambiguator, defaultLlmActivityDisambiguator } from './llm-disambiguator.js';
import { classifyMatchConfidence, DEFAULT_MIN_CONFIDENCE_THRESHOLD, DEFAULT_AUTO_CONFIRM_MARGIN, DEFAULT_HIGH_CONFIDENCE_THRESHOLD, DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD } from './match-review-policy.js';
import { ActivityMatch, CreateActivityMatchInput, CreateProjectEventInput } from '../../models/domain.types.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { logger } from '../../config/logger.js';

export {
  DEFAULT_MIN_CONFIDENCE_THRESHOLD,
  DEFAULT_AUTO_CONFIRM_MARGIN,
  DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  DEFAULT_MEDIUM_CONFIDENCE_THRESHOLD
};

export const DEFAULT_ALTERNATIVE_SCORE_MARGIN = 0.05;
export const DEFAULT_MAX_ALTERNATIVES = 3;

/**
 * Core application service orchestrating activity matching and human review workflow for field progress updates.
 */
export class ActivityMatchingService {
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityRepo: ActivityRepository;
  private activityMatchRepo: ActivityMatchRepository;
  private projectEventRepo: ProjectEventRepository;
  private semanticMatcher: SemanticActivityMatcher;
  private llmDisambiguator: LLMActivityDisambiguator;

  constructor(dependencies?: {
    projectRepo?: ProjectRepository;
    progressUpdateRepo?: ProgressUpdateRepository;
    activityRepo?: ActivityRepository;
    activityMatchRepo?: ActivityMatchRepository;
    projectEventRepo?: ProjectEventRepository;
    semanticMatcher?: SemanticActivityMatcher;
    llmDisambiguator?: LLMActivityDisambiguator;
  }) {
    this.projectRepo = dependencies?.projectRepo || defaultProjectRepo;
    this.progressUpdateRepo = dependencies?.progressUpdateRepo || defaultProgressUpdateRepo;
    this.activityRepo = dependencies?.activityRepo || defaultActivityRepo;
    this.activityMatchRepo = dependencies?.activityMatchRepo || defaultActivityMatchRepo;
    this.projectEventRepo = dependencies?.projectEventRepo || defaultProjectEventRepo;
    this.semanticMatcher = dependencies?.semanticMatcher || defaultSemanticMatcher;
    this.llmDisambiguator = dependencies?.llmDisambiguator || defaultLlmActivityDisambiguator;
  }

  /**
   * Computes candidate matches for field progress extraction items without mutating database state.
   */
  async computeMatches(
    projectId: string,
    extraction: FieldProgressExtraction,
    options: MatchingOptions = {}
  ): Promise<FieldFactMatchResult[]> {
    const {
      minConfidenceThreshold = DEFAULT_MIN_CONFIDENCE_THRESHOLD,
      alternativeScoreMargin = DEFAULT_ALTERNATIVE_SCORE_MARGIN,
      maxAlternatives = DEFAULT_MAX_ALTERNATIVES,
      enableLlmDisambiguation = false
    } = options;

    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Fetch scheduled activities for this project
    const activities = this.activityRepo.listByProjectId(projectId);
    logger.debug(`ActivityMatchingService: Loaded ${activities.length} activities for project ${projectId}`);

    const matchResults: FieldFactMatchResult[] = [];

    // If project has no activities, return empty match results for each fact
    if (activities.length === 0) {
      for (const fact of extraction.items) {
        const decision = classifyMatchConfidence(null, []);
        matchResults.push({
          fact,
          bestMatch: null,
          alternatives: [],
          confidenceTier: decision.tier,
          reviewDecision: decision
        });
      }
      return matchResults;
    }

    // 3. Score each field fact against project activities
    for (const fact of extraction.items) {
      const candidates: CandidateMatch[] = [];

      for (const activity of activities) {
        const candidate = scoreActivityCandidate(fact, activity);
        if (candidate.confidenceScore >= minConfidenceThreshold) {
          candidates.push(candidate);
        }
      }

      // Sort descending by confidence score
      candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);

      let rankedCandidates = [...candidates];

      // Disambiguate if ambiguous top candidates exist and LLM disambiguation is enabled
      if (
        enableLlmDisambiguation &&
        rankedCandidates.length >= 2 &&
        rankedCandidates[0].matchMethod !== 'exact_id' &&
        Math.abs(rankedCandidates[0].confidenceScore - rankedCandidates[1].confidenceScore) <= alternativeScoreMargin
      ) {
        rankedCandidates = await this.llmDisambiguator.disambiguate(fact, rankedCandidates.slice(0, 3));
      }

      let bestMatch: CandidateMatch | null = null;
      let alternatives: CandidateMatch[] = [];

      if (rankedCandidates.length > 0) {
        bestMatch = rankedCandidates[0];
        alternatives = rankedCandidates.slice(1, 1 + maxAlternatives);
      }

      const reviewDecision = classifyMatchConfidence(bestMatch, alternatives);

      matchResults.push({
        fact,
        bestMatch,
        alternatives,
        confidenceTier: reviewDecision.tier,
        reviewDecision
      });
    }

    return matchResults;
  }

  /**
   * Matches structured field progress extraction items against project activities
   * and persists candidates according to the Pass 19 deterministic review policy:
   * - High confidence unambiguous -> auto-confirmed (status: 'confirmed', reviewedBy: 'system')
   * - Medium confidence / ambiguous -> suggested (status: 'suggested', reviewState: 'awaiting_review')
   * - Low confidence -> unresolved (status: 'suggested', reviewState: 'unresolved')
   *
   * All match updates, deletions, and audit events are committed atomically inside a single transaction.
   */
  async matchProgressUpdate(
    projectId: string,
    progressUpdateId: string,
    extraction: FieldProgressExtraction,
    options: MatchingOptions = {}
  ): Promise<MatchReportResult> {
    const { persist = true } = options;

    // 1. Verify progress report exists and belongs to the specified project (strict isolation)
    const progressRecord = this.progressUpdateRepo.getByIdAndProjectId(progressUpdateId, projectId);
    if (!progressRecord) {
      const project = this.projectRepo.getById(projectId);
      if (!project) {
        throw new NotFoundError(`Project with ID '${projectId}' not found`);
      }
      throw new NotFoundError(
        `Progress report with ID '${progressUpdateId}' not found for project '${projectId}'`
      );
    }

    // 2. Compute candidate matches
    const matchResults = await this.computeMatches(projectId, extraction, options);

    // 3. Persist matches and events atomically if requested
    if (persist) {
      const nowIso = new Date().toISOString();
      const toPersist: CreateActivityMatchInput[] = [];
      const events: CreateProjectEventInput[] = [];

      for (const r of matchResults) {
        if (!r.bestMatch) continue;

        const decision = r.reviewDecision || classifyMatchConfidence(r.bestMatch, r.alternatives);
        const isAutoConfirm = decision.autoConfirm;
        const matchId = crypto.randomUUID();

        toPersist.push({
          id: matchId,
          projectId,
          progressUpdateId,
          activityId: r.bestMatch.activityId,
          confidenceScore: r.bestMatch.confidenceScore,
          matchMethod: r.bestMatch.matchMethod,
          matchedText: r.bestMatch.matchedText,
          rationale: r.bestMatch.rationale,
          status: isAutoConfirm ? ('confirmed' as const) : ('suggested' as const),
          confidenceTier: decision.tier,
          reviewState: decision.reviewState,
          reviewedBy: isAutoConfirm ? 'system' : null,
          reviewedAt: isAutoConfirm ? nowIso : null
        });

        if (isAutoConfirm) {
          events.push({
            projectId,
            eventType: 'match_auto_confirmed',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: `Activity match automatically confirmed by system for activity '${r.bestMatch.activityId}' (${(r.bestMatch.confidenceScore * 100).toFixed(0)}% confidence)`,
            payloadJson: JSON.stringify({
              matchId,
              progressUpdateId,
              activityId: r.bestMatch.activityId,
              confidenceScore: r.bestMatch.confidenceScore,
              confidenceTier: decision.tier,
              reviewSource: 'system'
            })
          });
        } else {
          events.push({
            projectId,
            eventType: 'match_suggested',
            entityType: 'activity_matches',
            entityId: matchId,
            summary: `Activity match suggested for activity '${r.bestMatch.activityId}' (${(r.bestMatch.confidenceScore * 100).toFixed(0)}% confidence, ${decision.tier} tier, state: ${decision.reviewState})`,
            payloadJson: JSON.stringify({
              matchId,
              progressUpdateId,
              activityId: r.bestMatch.activityId,
              confidenceScore: r.bestMatch.confidenceScore,
              confidenceTier: decision.tier,
              reviewState: decision.reviewState
            })
          });
        }
      }

      this.activityMatchRepo.persistMatchesAndEventsAtomically({
        projectId,
        progressUpdateId,
        matches: toPersist,
        events
      });
      logger.debug(`ActivityMatchingService: Atomically persisted ${toPersist.length} matches and ${events.length} events for report ${progressUpdateId}`);
    }

    return {
      projectId,
      progressUpdateId,
      matches: matchResults
    };
  }

  /**
   * Retrieves existing persisted matches for a given progress update.
   */
  getMatchesForUpdate(projectId: string, progressUpdateId: string): ActivityMatch[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const progressRecord = this.progressUpdateRepo.getByIdAndProjectId(progressUpdateId, projectId);
    if (!progressRecord) {
      throw new NotFoundError(
        `Progress report with ID '${progressUpdateId}' not found for project '${projectId}'`
      );
    }

    return this.activityMatchRepo.listByProgressUpdateId(progressUpdateId, projectId);
  }

  /**
   * Retrieves a single match by ID, ensuring strict project boundary.
   */
  getMatchById(projectId: string, matchId: string): ActivityMatch {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const match = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!match) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    return match;
  }

  /**
   * Human review action: Confirms a suggested match atomically with its audit event.
   * Confirmed matches are immutable historical decisions and cannot be re-confirmed, rejected, or retargeted.
   */
  async confirmMatch(
    projectId: string,
    matchId: string,
    reviewer: string = 'human'
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot confirm match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot confirm match '${matchId}'. Rejected match history is immutable.`
      );
    }
    if (existingMatch.reviewState === 'unresolved') {
      throw new ValidationError(
        `Cannot confirm unresolved match '${matchId}' without selecting an activity. Use resolve to assign a specific activity.`
      );
    }

    const nowIso = new Date().toISOString();
    return this.activityMatchRepo.confirmMatchAtomically({
      id: matchId,
      projectId,
      reviewer: reviewer || 'human',
      nowIso
    });
  }

  /**
   * Human review action: Rejects a suggested or unresolved match atomically with its audit event.
   * Rejected matches are immutable historical decisions and cannot be re-rejected, confirmed, or retargeted.
   */
  async rejectMatch(
    projectId: string,
    matchId: string,
    reviewer: string = 'human',
    reason?: string
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot reject match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot reject match '${matchId}'. Rejected match history is immutable.`
      );
    }

    const nowIso = new Date().toISOString();
    const rationale = reason
      ? `${existingMatch.rationale || ''} [Rejected: ${reason}]`.trim()
      : existingMatch.rationale;

    return this.activityMatchRepo.rejectMatchAtomically({
      id: matchId,
      projectId,
      reviewer: reviewer || 'human',
      rationale,
      nowIso,
      reason
    });
  }

  /**
   * Human review action: Resolves an unresolved or candidate match to a chosen activity atomically with its audit event.
   * Once a match is confirmed, its activityId and status become immutable and cannot be retargeted.
   */
  async resolveMatch(
    projectId: string,
    matchId: string,
    targetActivityId: string,
    reviewer: string = 'human',
    reason?: string
  ): Promise<ActivityMatch> {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const existingMatch = this.activityMatchRepo.getByIdAndProjectId(matchId, projectId);
    if (!existingMatch) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    if (existingMatch.status === 'confirmed') {
      throw new ValidationError(
        `Cannot resolve or retarget match '${matchId}'. Confirmed match history is immutable.`
      );
    }
    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot resolve match '${matchId}'. Rejected match history is immutable.`
      );
    }

    // Verify target activity belongs to the same project (strict cross-project isolation)
    const targetActivity = this.activityRepo.getById(targetActivityId);
    if (!targetActivity || targetActivity.projectId !== projectId) {
      throw new NotFoundError(
        `Target activity with ID '${targetActivityId}' not found for project '${projectId}'`
      );
    }

    const nowIso = new Date().toISOString();
    const originalRationale = existingMatch.rationale;
    const rationale = reason
      ? `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId}): ${reason}]`.trim()
      : `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId})]`.trim();

    return this.activityMatchRepo.resolveMatchAtomically({
      id: matchId,
      projectId,
      targetActivityId,
      targetActivityName: targetActivity.name,
      targetActivityExternalId: targetActivity.externalId,
      originalActivityId: existingMatch.activityId,
      originalRationale,
      reviewer: reviewer || 'human',
      rationale,
      nowIso,
      reason
    });
  }
}

export const activityMatchingService = new ActivityMatchingService();
