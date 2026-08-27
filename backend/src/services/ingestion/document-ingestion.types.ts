import { Evidence, ProgressUpdate, ProgressUpdateSourceType } from '../../models/domain.types.js';
import { FieldProgressExtraction } from '../../ai/contracts/field-progress-extraction.contract.js';
import { FieldFactMatchResult } from '../matching/activity-matching.types.js';
import { normalizeDate } from '../normalization/date-normalizer.js';

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
  matches: FieldFactMatchResult[];
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

/**
 * Deterministically extracts an explicit report date from normalized document text,
 * or returns null if no valid, defensible date can be parsed.
 */
export function extractReportDate(text: string): string | null {
  if (!text || typeof text !== 'string') return null;

  // 1. Explicit labeled date patterns (e.g. "Report Date: 2026-08-25", "Date: 25/08/2026")
  const labeledPatterns = [
    /(?:report\s*date|date\s*of\s*report|as\s*of\s*date|report\s*period\s*(?:ending|date)|observation\s*date|field\s*date)\s*[:|=]\s*([^\r\n,;|]+)/i,
    /(?:date)\s*[:|=]\s*([^\r\n,;|]+)/i,
    /(?:report\s*date|date\s*of\s*report|as\s*of\s*date)\s*\|\s*([^\r\n|]+)/i
  ];

  for (const pattern of labeledPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      try {
        const canonical = normalizeDate(candidate, 'reportDate');
        if (canonical) return canonical;
      } catch {
        // try next pattern
      }
    }
  }

  // 2. Standalone ISO date YYYY-MM-DD
  const isoMatch = text.match(/\b(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))\b/);
  if (isoMatch) {
    try {
      const canonical = normalizeDate(isoMatch[1], 'reportDate');
      if (canonical) return canonical;
    } catch {
      // ignore
    }
  }

  // 3. Standalone DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = text.match(/\b((?:0[1-9]|[12]\d|3[01])[-/.](?:0[1-9]|1[0-2])[-/.](?:20\d{2}))\b/);
  if (dmyMatch) {
    try {
      const canonical = normalizeDate(dmyMatch[1], 'reportDate');
      if (canonical) return canonical;
    } catch {
      // ignore
    }
  }

  return null;
}
