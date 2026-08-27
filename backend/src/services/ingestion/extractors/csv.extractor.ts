import { parse } from 'csv-parse/sync';
import path from 'node:path';
import {
  DocumentExtractor,
  ExtractDocumentInput,
  NormalizedDocument,
  MAX_CSV_ROWS,
  MAX_CSV_COLS,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../document-ingestion.types.js';
import { ValidationError } from '../../../errors/AppError.js';

export class CsvExtractor implements DocumentExtractor {
  public readonly name: string = 'csv-extractor';

  supports(_fileType: string, fileName: string, mimeType?: string | null): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    return ext === '.csv' || mime === 'text/csv' || mime === 'application/csv';
  }

  async extract(input: ExtractDocumentInput): Promise<NormalizedDocument> {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new ValidationError('CSV document is empty');
    }

    // Decode UTF-8 string, stripping possible UTF-8 BOM
    let rawContent: string;
    try {
      rawContent = input.fileBuffer.toString('utf-8');
      if (rawContent.charCodeAt(0) === 0xFEFF) {
        rawContent = rawContent.slice(1);
      }
    } catch (decodeErr) {
      throw new ValidationError(`Failed to decode CSV content as UTF-8: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`);
    }

    const trimmed = rawContent.trim();
    if (trimmed.length === 0) {
      throw new ValidationError('CSV document is empty or contains only whitespace');
    }

    let records: string[][];
    try {
      records = parse(rawContent, {
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
        cast: false
      });
    } catch (parseErr) {
      throw new ValidationError(
        `Invalid or malformed CSV format: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
      );
    }

    if (!records || records.length === 0) {
      throw new ValidationError('CSV document contains no data rows');
    }

    if (records.length > MAX_CSV_ROWS) {
      throw new ValidationError(
        `CSV document exceeds maximum allowed row limit of ${MAX_CSV_ROWS.toLocaleString()} rows (found ${records.length.toLocaleString()})`
      );
    }

    let maxColsFound = 0;
    let hasNonEmptyCell = false;

    for (let r = 0; r < records.length; r++) {
      const row = records[r];
      if (row.length > maxColsFound) {
        maxColsFound = row.length;
      }
      if (row.length > MAX_CSV_COLS) {
        throw new ValidationError(
          `CSV row ${r + 1} exceeds maximum allowed column limit of ${MAX_CSV_COLS} columns (found ${row.length})`
        );
      }
      for (const cell of row) {
        if (cell && cell.trim().length > 0) {
          hasNonEmptyCell = true;
        }
      }
    }

    if (!hasNonEmptyCell) {
      throw new ValidationError('CSV document contains no readable text or data cells');
    }

    // Build clean, bounded tabular representation
    const formattedLines: string[] = [];
    for (const row of records) {
      const line = row.map((cell) => (cell ? cell.trim() : '')).join(' | ');
      formattedLines.push(line);
    }

    let normalizedText = formattedLines.join('\n').trim();

    if (normalizedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      normalizedText = normalizedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'csv',
      text: normalizedText,
      metadata: {
        rowCount: records.length,
        columnCount: maxColsFound
      }
    };
  }
}

export const csvExtractor = new CsvExtractor();
