import { Router, Request, Response, NextFunction } from 'express';
import {
  ActivityMatchingService,
  activityMatchingService as defaultMatchingService
} from '../services/matching/activity-matching.service.js';
import { validateRequest, validateParams } from '../middleware/validate.js';
import { requireRole, optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  matchProgressUpdateParamsSchema,
  matchProgressUpdateRequestSchema,
  reviewMatchParamsSchema,
  confirmMatchRequestSchema,
  rejectMatchRequestSchema,
  resolveMatchRequestSchema
} from '../validation/activity-matching.schema.js';

/**
 * Sanitizes an activity match for worker consumption.
 * Omit internal AI confidence tiers and algorithm scores when viewed by workers.
 */
export function sanitizeMatchForRole<T extends Record<string, any>>(match: T, role?: string): T {
  if (role === 'worker') {
    const copy = { ...match } as Record<string, any>;
    delete copy.confidenceScore;
    copy.confidenceTier = null;
    return copy as T;
  }
  return match;
}

export function createActivityMatchingRouter(
  service: ActivityMatchingService = defaultMatchingService
): Router {
  const router = Router();

  // POST /projects/:projectId/progress-updates/:updateId/matches
  // Matches structured field facts against project activities and persists matches based on review policy
  router.post(
    '/projects/:projectId/progress-updates/:updateId/matches',
    optionalAuthenticateSession,
    validateRequest({
      params: matchProgressUpdateParamsSchema,
      body: matchProgressUpdateRequestSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, updateId } = req.params;
        const { extraction } = req.body;

        const result = await service.matchProgressUpdate(projectId, updateId, extraction, {
          persist: true
        });

        const role = req.session?.accountType;
        const projectedMatches = result.matches.map((m) => sanitizeMatchForRole(m, role));

        res.status(200).json({ matches: projectedMatches });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/progress-updates/:updateId/matches
  // Retrieves previously persisted matches for a specific progress update
  router.get(
    '/projects/:projectId/progress-updates/:updateId/matches',
    optionalAuthenticateSession,
    validateParams(matchProgressUpdateParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, updateId } = req.params;
        const matches = service.getMatchesForUpdate(projectId, updateId);

        const role = req.session?.accountType;
        const projectedMatches = matches.map((m) => sanitizeMatchForRole(m, role));

        res.status(200).json({ matches: projectedMatches });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/activity-matches/:matchId
  // Retrieves a single activity match by ID with project boundary enforcement
  router.get(
    '/projects/:projectId/activity-matches/:matchId',
    optionalAuthenticateSession,
    validateParams(reviewMatchParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, matchId } = req.params;
        const match = service.getMatchById(projectId, matchId);

        const role = req.session?.accountType;
        res.status(200).json({ match: sanitizeMatchForRole(match, role) });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/activity-matches/:matchId/confirm (Admin Only)
  // Human review action: Confirms a suggested match
  router.post(
    '/projects/:projectId/activity-matches/:matchId/confirm',
    requireRole(['admin']),
    validateRequest({
      params: reviewMatchParamsSchema,
      body: confirmMatchRequestSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, matchId } = req.params;
        const reviewer = req.body?.reviewer || 'human';

        const updatedMatch = await service.confirmMatch(projectId, matchId, reviewer);

        res.status(200).json({ match: updatedMatch });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/activity-matches/:matchId/reject (Admin Only)
  // Human review action: Rejects a suggested or candidate match
  router.post(
    '/projects/:projectId/activity-matches/:matchId/reject',
    requireRole(['admin']),
    validateRequest({
      params: reviewMatchParamsSchema,
      body: rejectMatchRequestSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, matchId } = req.params;
        const reviewer = req.body?.reviewer || 'human';
        const reason = req.body?.reason;

        const updatedMatch = await service.rejectMatch(projectId, matchId, reviewer, reason);

        res.status(200).json({ match: updatedMatch });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/activity-matches/:matchId/resolve (Admin Only)
  // Human review action: Resolves a low-confidence/unresolved match to a chosen activity
  router.post(
    '/projects/:projectId/activity-matches/:matchId/resolve',
    requireRole(['admin']),
    validateRequest({
      params: reviewMatchParamsSchema,
      body: resolveMatchRequestSchema
    }),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, matchId } = req.params;
        const { activityId, reviewer = 'human', reason } = req.body;

        const updatedMatch = await service.resolveMatch(
          projectId,
          matchId,
          activityId,
          reviewer,
          reason
        );

        res.status(200).json({ match: updatedMatch });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const activityMatchingRouter: Router = createActivityMatchingRouter();
