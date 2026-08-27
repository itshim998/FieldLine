import { Evidence, EvidenceFileType } from '../../models/domain.types.js';

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
  ): Promise<Evidence>;
  listProjectEvidence(projectId: string): Evidence[];
  getEvidence(projectId: string, evidenceId: string): Evidence;
  getEvidenceContent(projectId: string, evidenceId: string): EvidenceFileContentResult;
  listProgressUpdateEvidence(projectId: string, updateId: string): Evidence[];
  listActivityEvidence(projectId: string, activityId: string): Evidence[];
  deleteEvidence(projectId: string, evidenceId: string): boolean;
}
