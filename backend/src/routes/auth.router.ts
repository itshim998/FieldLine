import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { projectRepository } from '../repositories/project.repository.js';
import { AuthenticationError, NotFoundError } from '../errors/AppError.js';

export const authRouter = Router();

const loginSchema = z
  .object({
    projectId: z.string().optional(),
    projectCode: z.string().optional(),
    accountType: z.enum(['worker', 'admin'], {
      required_error: "accountType is required ('worker' | 'admin')"
    }),
    passcode: z.string().min(1, 'Passcode or password is required')
  })
  .refine((data) => data.projectId !== undefined || data.projectCode !== undefined, {
    message: 'Either projectId or projectCode must be provided'
  });

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    throw new AuthenticationError('Missing Authorization header');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new AuthenticationError('Malformed Authorization header (expected Bearer <token>)');
  }

  return parts[1];
}

/**
 * POST /api/auth/login
 * Authenticates against a project's Worker (PIN) or Admin (Password) account.
 */
authRouter.post('/auth/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = loginSchema.parse(req.body);
    const result = await authService.authenticate(validated);

    res.status(200).json({
      success: true,
      token: result.token,
      session: result.session,
      project: result.project
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/session
 * Validates the current Bearer token and returns authenticated session identity.
 */
authRouter.get('/auth/session', (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = extractBearerToken(req);
    const session = authService.verifySessionToken(token);
    const project = projectRepository.getById(session.projectId);

    if (!project) {
      throw new AuthenticationError('Associated project not found');
    }

    res.status(200).json({
      success: true,
      session,
      project: {
        id: project.id,
        code: project.code,
        name: project.name
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify
 * Verifies token validity from body or header.
 */
authRouter.post('/auth/verify', (req: Request, res: Response, next: NextFunction) => {
  try {
    let token = req.body?.token;
    if (!token) {
      token = extractBearerToken(req);
    }
    const session = authService.verifySessionToken(token);

    res.status(200).json({
      valid: true,
      session
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:projectId/accounts
 * Returns public account profiles (without credential hashes) for a project.
 */
authRouter.get('/projects/:projectId/accounts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const project = projectRepository.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project not found: ${projectId}`);
    }

    const accounts = authService.getPublicAccounts(projectId);

    res.status(200).json({
      success: true,
      projectId,
      accounts
    });
  } catch (err) {
    next(err);
  }
});
