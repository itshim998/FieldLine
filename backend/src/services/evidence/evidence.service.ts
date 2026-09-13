import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  EvidenceRepository,
  evidenceRepository as defaultEvidenceRepo
} from '../../repositories/evidence.repository.js';
import {
  ProjectRepository,
  projectRepository as defaultProjectRepo
} from '../../repositories/project.repository.js';
import {
  ProgressUpdateRepository,
  progressUpdateRepository as defaultProgressUpdateRepo
} from '../../repositories/progress-update.repository.js';
import {
  ActivityRepository,
  activityRepository as defaultActivityRepo
} from '../../repositories/activity.repository.js';
import {
  Evidence,
  EvidenceFileType,
  CreateEvidenceInput,
  CreateProjectEventInput
} from '../../models/domain.types.js';
import {
  UploadedFilePayload,
  UploadEvidenceOptions,
  UploadEvidenceResult,
  EvidenceFileContentResult,
  EvidenceService
} from './evidence.types.js';
import { NotFoundError, ValidationError } from '../../errors/AppError.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export function detectEvidenceFileType(
  fileName: string,
  mimeType?: string | null
): EvidenceFileType {
  const ext = path.extname(fileName).toLowerCase();
  const mime = (mimeType || '').toLowerCase();

  if (
    ext === '.pdf' ||
    mime === 'application/pdf'
  ) {
    return 'pdf';
  }

  if (
    ext === '.xlsx' ||
    ext === '.xls' ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    return 'xlsx';
  }

  if (
    ext === '.png' ||
    ext === '.jpg' ||
    ext === '.jpeg' ||
    ext === '.gif' ||
    ext === '.webp' ||
    ext === '.svg' ||
    ext === '.bmp' ||
    ext === '.tiff' ||
    mime.startsWith('image/')
  ) {
    return 'image';
  }

  if (
    ext === '.vtt' ||
    ext === '.srt' ||
    ext === '.transcript' ||
    mime === 'text/vtt'
  ) {
    return 'transcript';
  }

  if (
    ext === '.txt' ||
    ext === '.csv' ||
    ext === '.tsv' ||
    ext === '.log' ||
    ext === '.md' ||
    ext === '.json' ||
    mime.startsWith('text/') ||
    mime === 'application/json'
  ) {
    return 'text';
  }

  return 'other';
}

import type { MaybePromise } from '../../database/provider.js';

export class DefaultEvidenceService implements EvidenceService {
  private evidenceRepo: EvidenceRepository;
  private projectRepo: ProjectRepository;
  private progressUpdateRepo: ProgressUpdateRepository;
  private activityRepo: ActivityRepository;
  private uploadDir: string;

  constructor(
    evidenceRepo: EvidenceRepository = defaultEvidenceRepo,
    projectRepo: ProjectRepository = defaultProjectRepo,
    progressUpdateRepo: ProgressUpdateRepository = defaultProgressUpdateRepo,
    activityRepo: ActivityRepository = defaultActivityRepo,
    uploadDir: string = env.UPLOAD_DIR
  ) {
    this.evidenceRepo = evidenceRepo;
    this.projectRepo = projectRepo;
    this.progressUpdateRepo = progressUpdateRepo;
    this.activityRepo = activityRepo;
    this.uploadDir = uploadDir;
  }

  async uploadEvidence(
    projectId: string,
    file: UploadedFilePayload,
    options?: UploadEvidenceOptions
  ): Promise<UploadEvidenceResult> {
    const project = await this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    if (options?.progressUpdateId) {
      const progressUpdateRecord = await this.progressUpdateRepo.getById(options.progressUpdateId);
      if (!progressUpdateRecord) {
        throw new NotFoundError(
          `Progress report with ID '${options.progressUpdateId}' not found`
        );
      }
      if (progressUpdateRecord.projectId !== projectId) {
        throw new ValidationError(
          `Progress report '${options.progressUpdateId}' belongs to a different project`
        );
      }
    }

    if (!file || !file.path) {
      throw new ValidationError('No file provided for evidence upload');
    }

    if (!fs.existsSync(file.path)) {
      throw new ValidationError('Uploaded file temporary source not found');
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(file.path);
    } catch (readErr) {
      throw new ValidationError(
        `Failed to read uploaded temporary file: ${readErr instanceof Error ? readErr.message : String(readErr)}`
      );
    }

    const contentSha256 = crypto
      .createHash('sha256')
      .update(fileBuffer)
      .digest('hex')
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentSha256)) {
      throw new ValidationError('Computed content SHA-256 hash is invalid');
    }

    const existingEvidence = await this.evidenceRepo.findByProjectIdAndHash(projectId, contentSha256);
    if (existingEvidence) {
      this.cleanupTempFile(file.path);
      return {
        ...existingEvidence,
        deduplicated: true
      };
    }

    return await this.saveAndPersistFile(projectId, file, contentSha256, options);
  }

  private cleanupTempFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore temp cleanup error
      }
    }
  }

  private async saveAndPersistFile(
    projectId: string,
    file: UploadedFilePayload,
    contentSha256: string,
    options?: UploadEvidenceOptions
  ): Promise<UploadEvidenceResult> {
    const fileType = options?.fileType || detectEvidenceFileType(file.originalname, file.mimetype);

    const rawExt = path.extname(file.originalname).toLowerCase();
    const safeExt = /^\.[a-z0-9]+$/i.test(rawExt) ? rawExt : '';
    const generatedFilename = `evidence-${Date.now()}-${crypto.randomUUID()}${safeExt}`;

    const projectDir = path.resolve(process.cwd(), this.uploadDir, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const targetFilePath = path.resolve(projectDir, generatedFilename);

    const relativeUpload = path.relative(projectDir, targetFilePath);
    if (relativeUpload.startsWith('..') || path.isAbsolute(relativeUpload)) {
      throw new ValidationError('Invalid target storage path detected');
    }

    try {
      fs.copyFileSync(file.path, targetFilePath);
      if (file.path !== targetFilePath && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore temp cleanup failure
        }
      }
    } catch (err) {
      throw new ValidationError(
        `Failed to store physical evidence file: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const evidenceId = crypto.randomUUID();
    const relativePath = `${projectId}/${generatedFilename}`;

    const evidenceInput: CreateEvidenceInput = {
      id: evidenceId,
      projectId,
      progressUpdateId: options?.progressUpdateId ?? null,
      fileName: file.originalname,
      filePath: relativePath,
      fileType,
      fileSizeBytes: file.size,
      mimeType: file.mimetype ?? null,
      metadataJson: options?.metadataJson ?? null,
      contentSha256
    };

    const eventInput: CreateProjectEventInput = {
      projectId,
      eventType: 'evidence_uploaded',
      entityType: 'evidence',
      entityId: evidenceId,
      summary: `Evidence file '${file.originalname}' uploaded`,
      payloadJson: JSON.stringify({
        evidenceId,
        fileName: file.originalname,
        fileType,
        fileSizeBytes: file.size,
        mimeType: file.mimetype ?? null,
        progressUpdateId: options?.progressUpdateId ?? null,
        contentSha256
      })
    };

    try {
      const persisted = await this.evidenceRepo.createWithEvent(evidenceInput, eventInput);
      return {
        ...persisted,
        deduplicated: false
      };
    } catch (dbError) {
      this.cleanupPermanentFile(targetFilePath);
      throw dbError;
    }
  }

  private cleanupPermanentFile(targetFilePath: string): void {
    if (fs.existsSync(targetFilePath)) {
      try {
        fs.unlinkSync(targetFilePath);
      } catch (cleanupErr) {
        logger.error('Failed to cleanup file after DB error', {
          targetFilePath,
          error: cleanupErr
        });
      }
    }
  }

  listProjectEvidence(projectId: string): MaybePromise<Evidence[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        return this.evidenceRepo.listByProjectId(projectId);
      });
    }
    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    return this.evidenceRepo.listByProjectId(projectId);
  }

  getEvidence(projectId: string, evidenceId: string): MaybePromise<Evidence> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        const evRes = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
        if (evRes instanceof Promise) {
          return evRes.then((evidence) => {
            if (!evidence) {
              throw new NotFoundError(
                `Evidence with ID '${evidenceId}' not found for project '${projectId}'`
              );
            }
            return evidence;
          });
        }
        if (!evRes) {
          throw new NotFoundError(
            `Evidence with ID '${evidenceId}' not found for project '${projectId}'`
          );
        }
        return evRes;
      });
    }

    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    const evRes = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (evRes instanceof Promise) {
      return evRes.then((evidence) => {
        if (!evidence) {
          throw new NotFoundError(
            `Evidence with ID '${evidenceId}' not found for project '${projectId}'`
          );
        }
        return evidence;
      });
    }
    if (!evRes) {
      throw new NotFoundError(
        `Evidence with ID '${evidenceId}' not found for project '${projectId}'`
      );
    }
    return evRes;
  }

  getEvidenceContent(
    projectId: string,
    evidenceId: string
  ): MaybePromise<EvidenceFileContentResult> {
    const evidenceRes = this.getEvidence(projectId, evidenceId);
    if (evidenceRes instanceof Promise) {
      return evidenceRes.then((evidence) => this.resolveEvidenceContent(projectId, evidence));
    }
    return this.resolveEvidenceContent(projectId, evidenceRes);
  }

  private resolveEvidenceContent(
    projectId: string,
    evidence: Evidence
  ): EvidenceFileContentResult {
    const projectRoot = path.resolve(process.cwd(), this.uploadDir, projectId);
    const resolvedPath = path.resolve(process.cwd(), this.uploadDir, evidence.filePath);

    // Verify resolved path is strictly within the project upload directory
    const relativePath = path.relative(projectRoot, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || relativePath === '') {
      throw new ValidationError('Evidence file path traversal detected');
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new NotFoundError(`Physical evidence content file not found on disk`);
    }

    return {
      evidence,
      absoluteFilePath: resolvedPath,
      fileName: evidence.fileName,
      mimeType: evidence.mimeType || 'application/octet-stream',
      fileSizeBytes: evidence.fileSizeBytes
    };
  }

  listProgressUpdateEvidence(projectId: string, updateId: string): MaybePromise<Evidence[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        return this.resolveProgressUpdateEvidence(projectId, updateId);
      });
    }
    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    return this.resolveProgressUpdateEvidence(projectId, updateId);
  }

  private resolveProgressUpdateEvidence(
    projectId: string,
    updateId: string
  ): MaybePromise<Evidence[]> {
    const updateRes = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (updateRes instanceof Promise) {
      return updateRes.then((progressUpdateRecord) => {
        if (!progressUpdateRecord) {
          throw new NotFoundError(
            `Progress report with ID '${updateId}' not found for project '${projectId}'`
          );
        }
        return this.evidenceRepo.listByProgressUpdateId(updateId, projectId);
      });
    }
    if (!updateRes) {
      throw new NotFoundError(
        `Progress report with ID '${updateId}' not found for project '${projectId}'`
      );
    }
    return this.evidenceRepo.listByProgressUpdateId(updateId, projectId);
  }

  listActivityEvidence(projectId: string, activityId: string): MaybePromise<Evidence[]> {
    const projectRes = this.projectRepo.getById(projectId);
    if (projectRes instanceof Promise) {
      return projectRes.then((project) => {
        if (!project) {
          throw new NotFoundError(`Project with ID '${projectId}' not found`);
        }
        return this.resolveActivityEvidence(projectId, activityId);
      });
    }
    if (!projectRes) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }
    return this.resolveActivityEvidence(projectId, activityId);
  }

  private resolveActivityEvidence(projectId: string, activityId: string): MaybePromise<Evidence[]> {
    const actRes = this.activityRepo.getByIdAndProjectId(activityId, projectId);
    if (actRes instanceof Promise) {
      return actRes.then((activity) => {
        if (!activity) {
          throw new NotFoundError(
            `Activity with ID '${activityId}' not found for project '${projectId}'`
          );
        }
        return this.evidenceRepo.listByActivityId(activityId, projectId);
      });
    }
    if (!actRes) {
      throw new NotFoundError(
        `Activity with ID '${activityId}' not found for project '${projectId}'`
      );
    }
    return this.evidenceRepo.listByActivityId(activityId, projectId);
  }

  deleteEvidence(projectId: string, evidenceId: string): MaybePromise<boolean> {
    const evidenceRes = this.getEvidence(projectId, evidenceId);
    if (evidenceRes instanceof Promise) {
      return evidenceRes.then((evidence) =>
        this.executeDeleteEvidence(projectId, evidenceId, evidence)
      );
    }
    return this.executeDeleteEvidence(projectId, evidenceId, evidenceRes);
  }

  private executeDeleteEvidence(
    projectId: string,
    evidenceId: string,
    evidence: Evidence
  ): MaybePromise<boolean> {
    const resolvedPath = path.resolve(process.cwd(), this.uploadDir, evidence.filePath);
    const projectRoot = path.resolve(process.cwd(), this.uploadDir, projectId);

    const fileExists = resolvedPath.startsWith(projectRoot) && fs.existsSync(resolvedPath);
    const tempTrashPath = `${resolvedPath}.${Date.now()}.${crypto.randomUUID()}.trash`;

    let fileStaged = false;
    if (fileExists) {
      try {
        fs.renameSync(resolvedPath, tempTrashPath);
        fileStaged = true;
      } catch (stageErr) {
        logger.error('Failed to stage evidence file for deletion', {
          resolvedPath,
          error: stageErr
        });
        throw new ValidationError(
          `Failed to stage evidence file for deletion: ${stageErr instanceof Error ? stageErr.message : String(stageErr)}`
        );
      }
    }

    try {
      const deleteRes = this.evidenceRepo.deleteByIdAndProjectId(evidenceId, projectId);
      if (deleteRes instanceof Promise) {
        return deleteRes
          .then((deleted) => {
            if (!deleted) {
              if (fileStaged && fs.existsSync(tempTrashPath)) {
                try {
                  fs.renameSync(tempTrashPath, resolvedPath);
                } catch (restoreErr) {
                  logger.error('Failed to restore staged evidence file after DB deletion no-op', {
                    tempTrashPath,
                    resolvedPath,
                    error: restoreErr
                  });
                }
              }
              return false;
            }

            if (fileStaged && fs.existsSync(tempTrashPath)) {
              try {
                fs.unlinkSync(tempTrashPath);
              } catch (unlinkErr) {
                logger.warn(
                  'Failed to unlink staged trash evidence file after successful DB deletion',
                  {
                    tempTrashPath,
                    error: unlinkErr
                  }
                );
              }
            }
            return true;
          })
          .catch((dbError) => {
            if (fileStaged && fs.existsSync(tempTrashPath)) {
              try {
                fs.renameSync(tempTrashPath, resolvedPath);
              } catch (restoreErr) {
                logger.error(
                  'Failed to restore staged evidence file after DB deletion failure',
                  {
                    tempTrashPath,
                    resolvedPath,
                    error: restoreErr
                  }
                );
              }
            }
            throw dbError;
          });
      }

      if (!deleteRes) {
        if (fileStaged && fs.existsSync(tempTrashPath)) {
          try {
            fs.renameSync(tempTrashPath, resolvedPath);
          } catch (restoreErr) {
            logger.error('Failed to restore staged evidence file after DB deletion no-op', {
              tempTrashPath,
              resolvedPath,
              error: restoreErr
            });
          }
        }
        return false;
      }

      if (fileStaged && fs.existsSync(tempTrashPath)) {
        try {
          fs.unlinkSync(tempTrashPath);
        } catch (unlinkErr) {
          logger.warn(
            'Failed to unlink staged trash evidence file after successful DB deletion',
            {
              tempTrashPath,
              error: unlinkErr
            }
          );
        }
      }

      return true;
    } catch (dbError) {
      if (fileStaged && fs.existsSync(tempTrashPath)) {
        try {
          fs.renameSync(tempTrashPath, resolvedPath);
        } catch (restoreErr) {
          logger.error('Failed to restore staged evidence file after DB deletion failure', {
            tempTrashPath,
            resolvedPath,
            error: restoreErr
          });
        }
      }
      throw dbError;
    }
  }
}

export const evidenceService: EvidenceService = new DefaultEvidenceService();
export type { EvidenceService } from './evidence.types.js';

