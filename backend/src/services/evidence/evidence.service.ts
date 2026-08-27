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
  ): Promise<Evidence> {
    // 1. Verify project exists
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    // 2. Verify optional progress-report exists and belongs to the same project
    if (options?.progressUpdateId) {
      const progressUpdateRecord = this.progressUpdateRepo.getById(options.progressUpdateId);
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

    // 3. Validate uploaded file presence
    if (!file || !file.path) {
      throw new ValidationError('No file provided for evidence upload');
    }

    if (!fs.existsSync(file.path)) {
      throw new ValidationError('Uploaded file temporary source not found');
    }

    // 4. File type resolution
    const fileType = options?.fileType || detectEvidenceFileType(file.originalname, file.mimetype);

    // 5. Generate server-controlled safe filename and destination directory
    const rawExt = path.extname(file.originalname).toLowerCase();
    const safeExt = /^\.[a-z0-9]+$/i.test(rawExt) ? rawExt : '';
    const generatedFilename = `evidence-${Date.now()}-${crypto.randomUUID()}${safeExt}`;

    const projectDir = path.resolve(process.cwd(), this.uploadDir, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const targetFilePath = path.resolve(projectDir, generatedFilename);

    // Ensure path cannot traverse outside the project directory
    if (!targetFilePath.startsWith(projectDir)) {
      throw new ValidationError('Invalid target storage path detected');
    }

    // 6. Move/copy file to target storage path
    try {
      fs.copyFileSync(file.path, targetFilePath);
      // Try to clean up temp file if different from target
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

    // 7. Persist evidence row and project event in a single SQLite transaction
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
      metadataJson: options?.metadataJson ?? null
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
        progressUpdateId: options?.progressUpdateId ?? null
      })
    };

    try {
      const persisted = this.evidenceRepo.createWithEvent(evidenceInput, eventInput);
      return persisted;
    } catch (dbError) {
      // Clean up the physical file on database failure to preserve atomicity
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
      throw dbError;
    }
  }

  listProjectEvidence(projectId: string): Evidence[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    return this.evidenceRepo.listByProjectId(projectId);
  }

  getEvidence(projectId: string, evidenceId: string): Evidence {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const evidence = this.evidenceRepo.getByIdAndProjectId(evidenceId, projectId);
    if (!evidence) {
      throw new NotFoundError(`Evidence with ID '${evidenceId}' not found for project '${projectId}'`);
    }

    return evidence;
  }

  getEvidenceContent(projectId: string, evidenceId: string): EvidenceFileContentResult {
    const evidence = this.getEvidence(projectId, evidenceId);

    const projectRoot = path.resolve(process.cwd(), this.uploadDir, projectId);
    const resolvedPath = path.resolve(process.cwd(), this.uploadDir, evidence.filePath);

    // Verify resolved path is strictly within the project upload directory
    if (!resolvedPath.startsWith(projectRoot)) {
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

  listProgressUpdateEvidence(projectId: string, updateId: string): Evidence[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const progressUpdateRecord = this.progressUpdateRepo.getByIdAndProjectId(updateId, projectId);
    if (!progressUpdateRecord) {
      throw new NotFoundError(`Progress report with ID '${updateId}' not found for project '${projectId}'`);
    }

    return this.evidenceRepo.listByProgressUpdateId(updateId, projectId);
  }

  listActivityEvidence(projectId: string, activityId: string): Evidence[] {
    const project = this.projectRepo.getById(projectId);
    if (!project) {
      throw new NotFoundError(`Project with ID '${projectId}' not found`);
    }

    const activity = this.activityRepo.getByIdAndProjectId(activityId, projectId);
    if (!activity) {
      throw new NotFoundError(`Activity with ID '${activityId}' not found for project '${projectId}'`);
    }

    return this.evidenceRepo.listByActivityId(activityId, projectId);
  }

  deleteEvidence(projectId: string, evidenceId: string): boolean {
    const evidence = this.getEvidence(projectId, evidenceId);

    // Try to remove physical file safely
    const resolvedPath = path.resolve(process.cwd(), this.uploadDir, evidence.filePath);
    const projectRoot = path.resolve(process.cwd(), this.uploadDir, projectId);

    if (resolvedPath.startsWith(projectRoot) && fs.existsSync(resolvedPath)) {
      try {
        fs.unlinkSync(resolvedPath);
      } catch (err) {
        logger.error('Failed to unlink evidence file during delete', {
          resolvedPath,
          error: err
        });
      }
    }

    return this.evidenceRepo.deleteByIdAndProjectId(evidenceId, projectId);
  }
}

export const evidenceService: EvidenceService = new DefaultEvidenceService();
export type { EvidenceService } from './evidence.types.js';

