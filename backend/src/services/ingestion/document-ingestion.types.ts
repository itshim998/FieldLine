import { Evidence, ProgressUpdate, ProgressUpdateSourceType } from '../../models/domain.types.js';
import { FieldProgressExtraction } from '../../ai/contracts/field-progress-extraction.contract.js';

export const MAX_EXTRACTED_TEXT_LENGTH = 40000;
export const MAX_CSV_ROWS = 2000;
export const MAX_CSV_COLS = 50;
export const MAX_XLSX_SHEETS = 10;
export const MAX_XLSX_ROWS_PER_SHEET = 1000;
export const MAX_XLSX_CELLS_PER_SHEET = 10000;
export const MAX_PDF_PAGES = 50;

export interface NormalizedDocument {
  evidenceId: string;
  projectId: string;
  sourceFileName: string;
  sourceType: 'csv' | 'xlsx' | 'pdf' | 'image' | 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractDocumentInput {
  evidenceId: string;
  projectId: string;
  sourceFileName: string;
  fileBuffer: Buffer;
  filePath?: string;
  mimeType?: string | null;
}

export interface DocumentExtractor {
  readonly name: string;
  supports(fileType: string, fileName: string, mimeType?: string | null): boolean;
  extract(input: ExtractDocumentInput): Promise<NormalizedDocument>;
}

export interface ProcessEvidenceResult {
  evidence: Evidence;
  progressUpdate: ProgressUpdate;
  normalizedDocument: {
    sourceType: string;
    textLength: number;
    metadata?: Record<string, unknown>;
  };
  extraction: FieldProgressExtraction;
}

export interface DocumentIngestionService {
  extractDocument(projectId: string, evidenceId: string): Promise<NormalizedDocument>;
  processEvidence(projectId: string, evidenceId: string): Promise<ProcessEvidenceResult>;
}

export function mapSourceTypeToProgressUpdateType(
  sourceType: 'csv' | 'xlsx' | 'pdf' | 'image' | 'text'
): ProgressUpdateSourceType {
  switch (sourceType) {
    case 'csv':
      return 'text';
    case 'xlsx':
      return 'xlsx';
    case 'pdf':
      return 'pdf';
    case 'image':
      return 'image';
    case 'text':
    default:
      return 'text';
  }
}
