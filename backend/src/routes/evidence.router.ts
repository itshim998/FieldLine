import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { evidenceService as defaultEvidenceService, EvidenceService } from '../services/evidence/evidence.service.js';
import { JobService, jobService as defaultJobService } from '../jobs/job.service.js';
import { validateParams } from '../middleware/validate.js';
import { requireRole, optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  evidenceProjectIdParamSchema,
  evidenceParamsSchema,
  progressUpdateEvidenceParamsSchema,
  activityEvidenceParamsSchema,
  uploadEvidenceBodySchema
} from '../validation/evidence.schema.js';
import { ValidationError } from '../errors/AppError.js';
import { env } from '../config/env.js';

/**
 * Sanitizes an evidence record or DTO by stripping internal server filesystem paths (filePath).
 * Guarantees the Filesystem Privacy Invariant across all API responses.
 */
export function sanitizeEvidenceDto<T extends { filePath?: unknown }>(item: T): Omit<T, 'filePath'> {
  const { filePath: _rawPath, ...rest } = item;
  return rest;
}

export function createEvidenceRouter(
  service: EvidenceService = defaultEvidenceService,
  jobSvc: JobService = defaultJobService
): Router {
  const router = Router();

  // Ensure local temporary upload directory exists
  const tempUploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'tmp');
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
  }

  // Configure Multer storage and size limit (20 MB)
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, tempUploadDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const rawExt = path.extname(file.originalname).toLowerCase();
      const safeExt = /^\.[a-z0-9]+$/i.test(rawExt) ? rawExt : '';
      cb(null, `upload-${uniqueSuffix}${safeExt}`);
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 20 * 1024 * 1024 // 20MB
    }
  });

  // Multer upload wrapper with custom error translation
  const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ValidationError('Uploaded file exceeds the maximum allowed size of 20MB'));
          }
          return next(new ValidationError(`Upload error: ${err.message}`));
        }
        return next(err);
      }
      next();
    });
  };

  // POST /projects/:projectId/evidence - Upload and persist field evidence file
  router.post(
    '/projects/:projectId/evidence',
    handleUpload,
    requireRole(['worker', 'admin']),
    validateParams(evidenceProjectIdParamSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;

        if (!req.file) {
          throw new ValidationError('No file uploaded. Form field "file" is required.');
        }

        // Validate body fields if provided
        const parsedBody = uploadEvidenceBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
          throw new ValidationError(parsedBody.error.issues[0]?.message || 'Invalid evidence form payload');
        }

        const uploadResult = await service.uploadEvidence(
          projectId,
          {
            path: req.file.path,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
          },
          {
            progressUpdateId: parsedBody.data.progressUpdateId ?? undefined,
            fileType: parsedBody.data.fileType,
            metadataJson: parsedBody.data.metadataJson ?? undefined
          }
        );

        res.status(uploadResult.deduplicated ? 200 : 201).json({
          evidence: sanitizeEvidenceDto(uploadResult),
          deduplicated: uploadResult.deduplicated
        });
      } catch (error) {
        // Clean up temporary upload file if left over
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
          } catch {
            // Ignore cleanup failure
          }
        }
        next(error);
      }
    }
  );

  // GET /projects/:projectId/evidence - List all evidence records for a project
  router.get(
    '/projects/:projectId/evidence',
    optionalAuthenticateSession,
    validateParams(evidenceProjectIdParamSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId } = req.params;
        const evidence = await service.listProjectEvidence(projectId);
        res.status(200).json({ evidence: evidence.map(sanitizeEvidenceDto) });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/evidence/:evidenceId - Retrieve metadata for a single evidence record
  router.get(
    '/projects/:projectId/evidence/:evidenceId',
    optionalAuthenticateSession,
    validateParams(evidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, evidenceId } = req.params;
        const evidence = await service.getEvidence(projectId, evidenceId);
        res.status(200).json({ evidence: sanitizeEvidenceDto(evidence) });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/evidence/:evidenceId/content - Stream the physical evidence file content safely
  router.get(
    '/projects/:projectId/evidence/:evidenceId/content',
    requireRole(['worker', 'admin']),
    validateParams(evidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, evidenceId } = req.params;
        const contentResult = await service.getEvidenceContent(projectId, evidenceId);

        res.setHeader('Content-Type', contentResult.mimeType);
        if (contentResult.fileSizeBytes) {
          res.setHeader('Content-Length', contentResult.fileSizeBytes);
        }
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${encodeURIComponent(contentResult.fileName)}"`
        );

        res.sendFile(contentResult.absoluteFilePath);
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/progress-updates/:updateId/evidence - List evidence attached to a progress update
  router.get(
    '/projects/:projectId/progress-updates/:updateId/evidence',
    optionalAuthenticateSession,
    validateParams(progressUpdateEvidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, updateId } = req.params;
        const evidence = await service.listProgressUpdateEvidence(projectId, updateId);
        res.status(200).json({ evidence: evidence.map(sanitizeEvidenceDto) });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/activities/:activityId/evidence - Trace all evidence originating for an activity
  router.get(
    '/projects/:projectId/activities/:activityId/evidence',
    optionalAuthenticateSession,
    validateParams(activityEvidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, activityId } = req.params;
        const evidence = await service.listActivityEvidence(projectId, activityId);
        res.status(200).json({ evidence: evidence.map(sanitizeEvidenceDto) });
      } catch (error) {
        next(error);
      }
    }
  );

  // DELETE /projects/:projectId/evidence/:evidenceId - Safely delete evidence file and record (Admin Only)
  router.delete(
    '/projects/:projectId/evidence/:evidenceId',
    requireRole(['admin']),
    validateParams(evidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, evidenceId } = req.params;
        await service.deleteEvidence(projectId, evidenceId);
        res.status(200).json({ success: true });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /projects/:projectId/evidence/:evidenceId/process - Enqueue document ingestion job asynchronously (Admin Only)
  router.post(
    '/projects/:projectId/evidence/:evidenceId/process',
    requireRole(['admin']),
    validateParams(evidenceParamsSchema),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { projectId, evidenceId } = req.params;
        const job = await jobSvc.enqueueDocumentIngestion(projectId, evidenceId);
        const statusCode = job.status === 'completed' ? 200 : 202;
        res.status(statusCode).json({
          job: {
            id: job.id,
            projectId: job.projectId,
            jobType: job.jobType,
            status: job.status,
            createdAt: job.createdAt
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const evidenceRouter: Router = createEvidenceRouter();
