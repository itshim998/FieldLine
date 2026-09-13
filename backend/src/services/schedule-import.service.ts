import fs from 'node:fs';
import path from 'node:path';
import { ProjectRepository, projectRepository as defaultProjectRepo } from '../repositories/project.repository.js';
import { ScheduleRepository, scheduleRepository as defaultScheduleRepo } from '../repositories/schedule.repository.js';
import { ActivityRepository, activityRepository as defaultActivityRepo } from '../repositories/activity.repository.js';
import { getScheduleParser } from './importer/parserFactory.js';
import { ScheduleNormalizer, scheduleNormalizer as defaultNormalizer } from './normalization/index.js';
import { ScheduleValidator, scheduleValidator as defaultValidator } from './validation/index.js';
import {
  Schedule,
  Activity,
  ScheduleImportSummary,
  CreateActivityInput
} from '../models/domain.types.js';
import { NotFoundError, ValidationError, ScheduleValidationError } from '../errors/AppError.js';
import { MaybePromise } from '../database/provider.js';

export interface ScheduleImportFileInput {
  path: string;
  originalname: string;
  mimetype?: string;
  size?: number;
}

export interface ScheduleImportService {
  importSchedule(projectId: string, file: ScheduleImportFileInput): Promise<ScheduleImportSummary>;
  listSchedules(projectId: string): MaybePromise<Schedule[]>;
  getSchedule(projectId: string, scheduleId: string): MaybePromise<Schedule>;
  listScheduleActivities(projectId: string, scheduleId: string): MaybePromise<Activity[]>;
}

export class DefaultScheduleImportService implements ScheduleImportService {
  private projectRepo: ProjectRepository;
  private scheduleRepo: ScheduleRepository;
  private activityRepo: ActivityRepository;
  private normalizer: ScheduleNormalizer;
  private validator: ScheduleValidator;

  constructor(
    projectRepo: ProjectRepository = defaultProjectRepo,
    scheduleRepo: ScheduleRepository = defaultScheduleRepo,
    activityRepo: ActivityRepository = defaultActivityRepo,
    normalizer: ScheduleNormalizer = defaultNormalizer,
    validator: ScheduleValidator = defaultValidator
  ) {
    this.projectRepo = projectRepo;
    this.scheduleRepo = scheduleRepo;
    this.activityRepo = activityRepo;
    this.normalizer = normalizer;
    this.validator = validator;
  }


  async importSchedule(
    projectId: string,
    file: ScheduleImportFileInput
  ): Promise<ScheduleImportSummary> {
    // 1. Validate project existence
    const project = await this.projectRepo.getById(projectId);
    if (!project) {
      this.cleanupTempFile(file.path);
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    try {
      // 2. Resolve parser
      const { parser, sourceType } = getScheduleParser(file.originalname, file.mimetype);

      // 3. Parse canonical rows
      const canonicalRows = await parser.parse(file.path, file.originalname);

      if (!canonicalRows || canonicalRows.length === 0) {
        throw new ValidationError('Uploaded schedule contains no activity rows');
      }

      // 4. Deterministically normalize canonical rows (PASS 5)
      const normalizedRows = this.normalizer.normalizeScheduleRows(canonicalRows);

      // 5. Deterministically validate normalized schedule activities (PASS 6)
      const validationResult = this.validator.validateSchedule(normalizedRows);
      if (!validationResult.isValid) {
        throw new ScheduleValidationError(validationResult.issues);
      }

      // 6. Derive sensible schedule name
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext).trim();
      const scheduleName = baseName || `${project.name} Schedule`;

      // 7. Execute atomic persistence via repository boundary using normalized inputs
      const activityInputs: Omit<CreateActivityInput, 'scheduleId'>[] = normalizedRows.map((row) => ({
        projectId,
        externalId: row.externalId,
        name: row.name,
        description: row.description,
        wbsCode: row.wbsCode,
        location: row.location,
        plannedStart: row.plannedStart,
        plannedFinish: row.plannedFinish,
        plannedQuantity: row.plannedQuantity,
        unit: row.unit,
        baselineProgress: row.baselineProgress ?? 0.0
      }));

      const { schedule } = await this.scheduleRepo.createWithActivities(
        {
          projectId,
          name: scheduleName,
          version: '1.0',
          sourceType,
          sourceFilename: file.originalname,
          isBaseline: true
        },
        activityInputs
      );

      return {
        schedule,
        activitiesImported: normalizedRows.length,
        rowCount: normalizedRows.length,
        sourceType,
        originalFilename: file.originalname
      };

    } finally {
      this.cleanupTempFile(file.path);
    }
  }

  listSchedules(projectId: string): MaybePromise<Schedule[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        return this.scheduleRepo.listByProjectId(projectId);
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    return this.scheduleRepo.listByProjectId(projectId);
  }

  getSchedule(projectId: string, scheduleId: string): MaybePromise<Schedule> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then(async (project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const schedule = await this.scheduleRepo.getByIdAndProjectId(scheduleId, projectId);
        if (!schedule) {
          throw new NotFoundError(`Schedule with ID '${scheduleId}' not found in project '${projectId}'`);
        }
        return schedule;
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    const schedule = this.scheduleRepo.getByIdAndProjectId(scheduleId, projectId);
    if (schedule instanceof Promise) {
      return schedule.then((s) => {
        if (!s) {
          throw new NotFoundError(`Schedule with ID '${scheduleId}' not found in project '${projectId}'`);
        }
        return s;
      });
    }
    if (!schedule) {
      throw new NotFoundError(`Schedule with ID '${scheduleId}' not found in project '${projectId}'`);
    }
    return schedule;
  }

  listScheduleActivities(projectId: string, scheduleId: string): MaybePromise<Activity[]> {
    const schedRes = this.getSchedule(projectId, scheduleId);
    if (schedRes instanceof Promise) {
      return schedRes.then(() => this.activityRepo.listByScheduleId(scheduleId));
    }
    return this.activityRepo.listByScheduleId(scheduleId);
  }

  private cleanupTempFile(filePath: string): void {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignored in cleanup
      }
    }
  }
}

export const scheduleImportService: ScheduleImportService = new DefaultScheduleImportService();
