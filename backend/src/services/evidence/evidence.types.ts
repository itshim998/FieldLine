import { Evidence, EvidenceFileType } from '../../models/domain.types.js';
import type { MaybePromise } from '../../database/provider.js';

export interface UploadedFilePayload {
  originalname: string;
  mimetype?: string;
  size: number;
  path: string;
}

export interface UploadEvidenceOptions {
  progressUpdateId?: string | null;
  fileType?: EvidenceFileType;
  metadataJson?: string | null;
}

export interface UploadEvidenceResult extends Evidence {
  deduplicated: boolean;
}

export interface EvidenceFileContentResult {
  evidence: Evidence;
  absoluteFilePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
}

export interface EvidenceService {
  uploadEvidence(
    projectId: string,
    file: UploadedFilePayload,
    options?: UploadEvidenceOptions
  ): Promise<UploadEvidenceResult>;
  listProjectEvidence(projectId: string): MaybePromise<Evidence[]>;
  getEvidence(projectId: string, evidenceId: string): MaybePromise<Evidence>;
  getEvidenceContent(projectId: string, evidenceId: string): MaybePromise<EvidenceFileContentResult>;
  listProgressUpdateEvidence(projectId: string, updateId: string): MaybePromise<Evidence[]>;
  listActivityEvidence(projectId: string, activityId: string): MaybePromise<Evidence[]>;
  deleteEvidence(projectId: string, evidenceId: string): MaybePromise<boolean>;
}
