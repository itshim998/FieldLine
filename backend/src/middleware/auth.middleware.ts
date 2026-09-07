import { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import { authService as defaultAuthService, AuthService } from '../services/auth.service.js';
import { AccountType, SessionIdentity } from '../models/domain.types.js';
import { AuthenticationError, ForbiddenError } from '../errors/AppError.js';

let activeAuthService: AuthService = defaultAuthService;

/**
 * Allows overriding AuthService in tests if required.
 */
export function setAuthServiceForMiddleware(service: AuthService): void {
  activeAuthService = service;
}

/**
 * Safely extracts the bearer token from the Authorization header.
 * Returns null if no Authorization header is present.
 * Throws AuthenticationError if the header is malformed.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1].trim()) {
    throw new AuthenticationError('Malformed Authorization header (expected Bearer <token>)');
  }

  return parts[1].trim();
}

/**
 * Extracts and verifies the session token from headers.
 * Attaches the verified SessionIdentity to req.session.
 * Throws AuthenticationError if missing, malformed, invalid, or expired.
 */
export function authenticateSession(req: Request): SessionIdentity {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError('Authentication required: Missing Authorization header');
  }

  const session = activeAuthService.verifySessionToken(token);
  req.session = session;
  return session;
}

/**
 * Verifies that the authenticated session belongs strictly to the requested project scope (:projectId).
 * Throws ForbiddenError if the session's projectId does not match req.params.projectId.
 */
export function requireProjectScope(req: Request): void {
  if (!req.session) {
    throw new AuthenticationError('Authentication required');
  }

  const paramProjectId = req.params.projectId;
  if (paramProjectId && paramProjectId !== req.session.projectId) {
    throw new ForbiddenError(
      `Project scope mismatch: Session project '${req.session.projectId}' cannot access project '${paramProjectId}'`
    );
  }
}

/**
 * Express middleware that enforces:
 * 1. Valid authenticated session token in Authorization header.
 * 2. Strict project scoping (:projectId matches session.projectId).
 * 3. Role authorization (session.accountType must be in allowedRoles).
 * Returns HTTP 401 on authentication failures, HTTP 403 on scope or role violations.
 */
export function requireRole(allowedRoles: AccountType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const session = authenticateSession(req);
      requireProjectScope(req);

      if (!allowedRoles.includes(session.accountType)) {
        throw new ForbiddenError(
          `Forbidden: Account role '${session.accountType}' is not authorized for this operation`
        );
      }

      next();
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }
      next(err);
    }
  };
}

/**
 * Express middleware that optionally extracts and verifies a session token if present.
 * Does not fail if no Authorization header is provided.
 * If a token is provided:
 * - Verifies the token (throws 401 if invalid/expired)
 * - Verifies project scoping (throws 403 if project mismatch)
 * - Attaches req.session so subsequent route handlers can project data appropriately.
 */
export function optionalAuthenticateSession(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extractBearerToken(req);
    if (token) {
      const session = activeAuthService.verifySessionToken(token);
      req.session = session;

      const paramProjectId = req.params.projectId;
      if (paramProjectId && paramProjectId !== session.projectId) {
        throw new ForbiddenError(
          `Project scope mismatch: Session project '${session.projectId}' cannot access project '${paramProjectId}'`
        );
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}
