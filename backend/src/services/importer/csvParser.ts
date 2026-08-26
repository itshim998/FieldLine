import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { CanonicalScheduleImportRow } from '../../models/domain.types.js';
import { ValidationError } from '../../errors/AppError.js';
import { ScheduleParser } from './types.js';
import { validateHeaders, transformRowToCanonical } from './headerMapper.js';

export class CsvScheduleParser implements ScheduleParser {
  async parse(filePath: string, _originalFilename: string): Promise<CanonicalScheduleImportRow[]> {
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, 'utf-8');
    } catch (err: unknown) {
      throw new ValidationError(`Failed to read CSV file: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!fileContent || !fileContent.trim()) {
      throw new ValidationError('Uploaded CSV file is empty');
    }

    let records: Record<string, string>[];
    try {
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: false
      });
    } catch (err: unknown) {
      throw new ValidationError(`Malformed CSV file: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!records || records.length === 0) {
      // Check if there were headers but no data
      try {
        const rawLines: string[][] = parse(fileContent, {
          skip_empty_lines: true,
          trim: true,
          bom: true
        });
        if (rawLines.length === 1) {
          validateHeaders(rawLines[0]);
          throw new ValidationError('Uploaded CSV file contains headers but no activity rows');
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
      }
      throw new ValidationError('Uploaded CSV file contains no data rows');
    }

    // Extract headers from the first record keys
    const rawHeaders = Object.keys(records[0]);
    const headerToField = validateHeaders(rawHeaders);

    const canonicalRows: CanonicalScheduleImportRow[] = [];

    for (let i = 0; i < records.length; i++) {
      const rowNumber = i + 2; // Line 1 is headers, data begins at Line 2
      const canonical = transformRowToCanonical(records[i], headerToField, rowNumber);
      if (canonical) {
        canonicalRows.push(canonical);
      }
    }

    if (canonicalRows.length === 0) {
      throw new ValidationError('Uploaded CSV file contains no valid activity rows');
    }

    return canonicalRows;
  }
}
