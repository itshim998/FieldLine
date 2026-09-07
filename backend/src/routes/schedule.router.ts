import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { scheduleImportService, ScheduleImportService } from '../services/schedule-import.service.js';
import { validateParams } from '../middleware/validate.js';
import { requireRole, optionalAuthenticateSession } from '../middleware/auth.middleware.js';
import {
  projectIdParamSchema,
  scheduleParamsSchema
} from '../validation/schedule.schema.js';
import { ValidationError } from '../errors/AppError.js';
import { env } from '../config/env.js';

export function createScheduleRouter(service: ScheduleImportService = scheduleImportService): Router {
  const router = Router();

  // Ensure local temporary upload directory exists
  const tempUploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR, 'tmp');
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
  }

  // Configure Multer storage and size limit (10 MB)
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, tempUploadDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `import-${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.csv' || ext === '.xlsx') {
        cb(null, true);
      } else {
        cb(new ValidationError(`Unsupported file type '${ext || 'unknown'}'. Please upload a .csv or .xlsx file.`));
      }
    }
  });

  // Multer upload wrapper with error conversion
  const handleUpload = (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ValidationError('Uploaded file exceeds the maximum allowed size of 10MB'));
          }
          return next(new ValidationError(`Upload error: ${err.message}`));
        }
        return next(err);
      }
      next();
    });
  };

  const importHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { projectId } = req.params;

      if (!req.file) {
        throw new ValidationError('No schedule file uploaded. Form field "file" is required.');
      }

      const summary = await service.importSchedule(projectId, {
        path: req.file.path,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      res.status(201).json({
        success: true,
        schedule: summary.schedule,
        activitiesImported: summary.activitiesImported,
        rowCount: summary.rowCount,
        sourceType: summary.sourceType,
        originalFilename: summary.originalFilename
      });
    } catch (error) {
      // If file exists and wasn't cleaned up by service (e.g. error before calling service), clean it up
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          // ignore
        }
      }
      next(error);
    }
  };

  // POST /projects/:projectId/schedules/import - Import schedule file (Admin Only)
  router.post(
    '/projects/:projectId/schedules/import',
    handleUpload,
    requireRole(['admin']),
    validateParams(projectIdParamSchema),
    importHandler
  );

  // POST /projects/:projectId/schedules - Alias for import schedule file (Admin Only)
  router.post(
    '/projects/:projectId/schedules',
    handleUpload,
    requireRole(['admin']),
    validateParams(projectIdParamSchema),
    importHandler
  );

  // GET /projects/:projectId/schedules - List schedules for project
  router.get(
    '/projects/:projectId/schedules',
    optionalAuthenticateSession,
    validateParams(projectIdParamSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId } = req.params;
        const schedules = service.listSchedules(projectId);
        res.status(200).json({ schedules });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/schedules/:scheduleId - Get single schedule
  router.get(
    '/projects/:projectId/schedules/:scheduleId',
    optionalAuthenticateSession,
    validateParams(scheduleParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, scheduleId } = req.params;
        const schedule = service.getSchedule(projectId, scheduleId);
        res.status(200).json({ schedule });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /projects/:projectId/schedules/:scheduleId/activities - List activities for schedule
  router.get(
    '/projects/:projectId/schedules/:scheduleId/activities',
    optionalAuthenticateSession,
    validateParams(scheduleParamsSchema),
    (req: Request, res: Response, next: NextFunction): void => {
      try {
        const { projectId, scheduleId } = req.params;
        const activities = service.listScheduleActivities(projectId, scheduleId);
        res.status(200).json({ activities });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

export const scheduleRouter: Router = createScheduleRouter();
