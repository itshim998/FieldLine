import { ProjectRepository, projectRepository as defaultProjectRepo } from '../../repositories/project.repository.js';
import { ProgressUpdateRepository, progressUpdateRepository as defaultProgressUpdateRepo } from '../../repositories/progress-update.repository.js';
import { ActivityRepository, activityRepository as defaultActivityRepo } from '../../repositories/activity.repository.js';
import { ActivityMatchRepository, activityMatchRepository as defaultActivityMatchRepo } from '../../repositories/activity-match.repository.js';
import { ProjectEventRepository, projectEventRepository as defaultProjectEventRepo } from '../../repositories/project-event.repository.js';
import { FieldProgressExtraction, FieldProgressItem } from '../../ai/contracts/field-progress-extraction.contract.js';
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
import { ActivityMatch } from '../../models/domain.types.js';
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
      // Also verify project exists for appropriate error message
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

    // 3. Persist matches if requested
    if (persist) {
      // Clean up only previous suggestions for this report to preserve human-reviewed confirmed/rejected matches
      this.activityMatchRepo.deleteSuggestedByProgressUpdateId(progressUpdateId, projectId);

      const nowIso = new Date().toISOString();
      const toPersist = matchResults
        .filter((r): r is FieldFactMatchResult & { bestMatch: CandidateMatch } => r.bestMatch !== null)
        .map(r => {
          const decision = r.reviewDecision || classifyMatchConfidence(r.bestMatch, r.alternatives);
          const isAutoConfirm = decision.autoConfirm;

          return {
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
          };
        });

      if (toPersist.length > 0) {
        const persisted = this.activityMatchRepo.createMany(toPersist);
        logger.debug(`ActivityMatchingService: Persisted ${persisted.length} matches for report ${progressUpdateId}`);

        // Emit audit events for persisted matches
        for (const match of persisted) {
          try {
            if (match.status === 'confirmed') {
              this.projectEventRepo.create({
                projectId,
                eventType: 'match_auto_confirmed',
                entityType: 'activity_matches',
                entityId: match.id,
                summary: `Activity match automatically confirmed by system for activity '${match.activityId}' (${(match.confidenceScore * 100).toFixed(0)}% confidence)`,
                payloadJson: JSON.stringify({
                  matchId: match.id,
                  progressUpdateId,
                  activityId: match.activityId,
                  confidenceScore: match.confidenceScore,
                  confidenceTier: match.confidenceTier,
                  reviewSource: 'system'
                })
              });
            } else {
              this.projectEventRepo.create({
                projectId,
                eventType: 'match_suggested',
                entityType: 'activity_matches',
                entityId: match.id,
                summary: `Activity match suggested for activity '${match.activityId}' (${(match.confidenceScore * 100).toFixed(0)}% confidence, ${match.confidenceTier} tier, state: ${match.reviewState})`,
                payloadJson: JSON.stringify({
                  matchId: match.id,
                  progressUpdateId,
                  activityId: match.activityId,
                  confidenceScore: match.confidenceScore,
                  confidenceTier: match.confidenceTier,
                  reviewState: match.reviewState
                })
              });
            }
          } catch (err) {
            logger.debug(`Could not create matching event: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
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
   * Human review action: Confirms a suggested match.
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

    if (existingMatch.status === 'rejected') {
      throw new ValidationError(
        `Cannot confirm rejected match '${matchId}'. Use resolve to assign an activity.`
      );
    }

    const nowIso = new Date().toISOString();
    const updated = this.activityMatchRepo.updateMatchReview({
      id: matchId,
      projectId,
      status: 'confirmed',
      reviewState: 'resolved',
      reviewedBy: reviewer || 'human',
      reviewedAt: nowIso
    });

    if (!updated) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    // Record audit event
    try {
      this.projectEventRepo.create({
        projectId,
        eventType: 'match_confirmed',
        entityType: 'activity_matches',
        entityId: matchId,
        summary: `Activity match confirmed by reviewer '${reviewer}' for activity '${updated.activityId}'`,
        payloadJson: JSON.stringify({
          matchId,
          progressUpdateId: updated.progressUpdateId,
          activityId: updated.activityId,
          confidenceScore: updated.confidenceScore,
          confidenceTier: updated.confidenceTier,
          reviewSource: 'human',
          reviewer: reviewer || 'human'
        })
      });
    } catch (err) {
      logger.debug(`Could not create confirm event: ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  /**
   * Human review action: Rejects a suggested or unresolved match.
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

    const nowIso = new Date().toISOString();
    const rationale = reason
      ? `${existingMatch.rationale || ''} [Rejected: ${reason}]`.trim()
      : existingMatch.rationale;

    const updated = this.activityMatchRepo.updateMatchReview({
      id: matchId,
      projectId,
      status: 'rejected',
      reviewState: 'resolved',
      reviewedBy: reviewer || 'human',
      reviewedAt: nowIso,
      rationale
    });

    if (!updated) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    // Record audit event
    try {
      this.projectEventRepo.create({
        projectId,
        eventType: 'match_rejected',
        entityType: 'activity_matches',
        entityId: matchId,
        summary: `Activity match rejected by reviewer '${reviewer}' for activity '${updated.activityId}'`,
        payloadJson: JSON.stringify({
          matchId,
          progressUpdateId: updated.progressUpdateId,
          activityId: updated.activityId,
          confidenceScore: updated.confidenceScore,
          confidenceTier: updated.confidenceTier,
          reviewSource: 'human',
          reviewer: reviewer || 'human',
          reason: reason ?? null
        })
      });
    } catch (err) {
      logger.debug(`Could not create reject event: ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }

  /**
   * Human review action: Resolves an unresolved or candidate match to a chosen activity.
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

    // Verify target activity belongs to the same project
    const targetActivity = this.activityRepo.getById(targetActivityId);
    if (!targetActivity || targetActivity.projectId !== projectId) {
      throw new NotFoundError(
        `Target activity with ID '${targetActivityId}' not found for project '${projectId}'`
      );
    }

    const nowIso = new Date().toISOString();
    const originalActivityId = existingMatch.activityId;
    const originalRationale = existingMatch.rationale;
    const rationale = reason
      ? `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId}): ${reason}]`.trim()
      : `${originalRationale || ''} [Resolved manually to ${targetActivity.name} (${targetActivity.externalId})]`.trim();

    const updated = this.activityMatchRepo.updateMatchReview({
      id: matchId,
      projectId,
      activityId: targetActivityId,
      status: 'confirmed',
      reviewState: 'resolved',
      matchMethod: 'manual',
      reviewedBy: reviewer || 'human',
      reviewedAt: nowIso,
      rationale
    });

    if (!updated) {
      throw new NotFoundError(
        `Activity match with ID '${matchId}' not found for project '${projectId}'`
      );
    }

    // Record audit event
    try {
      this.projectEventRepo.create({
        projectId,
        eventType: 'match_resolved',
        entityType: 'activity_matches',
        entityId: matchId,
        summary: `Activity match manually resolved to '${targetActivity.name}' (${targetActivity.externalId}) by reviewer '${reviewer}'`,
        payloadJson: JSON.stringify({
          matchId,
          progressUpdateId: updated.progressUpdateId,
          activityId: targetActivityId,
          originalActivityId,
          confidenceScore: updated.confidenceScore,
          confidenceTier: updated.confidenceTier,
          matchMethod: 'manual',
          reviewSource: 'human',
          reviewer: reviewer || 'human',
          reason: reason ?? null
        })
      });
    } catch (err) {
      logger.debug(`Could not create resolve event: ${err instanceof Error ? err.message : String(err)}`);
    }

    return updated;
  }
}

export const activityMatchingService = new ActivityMatchingService();
