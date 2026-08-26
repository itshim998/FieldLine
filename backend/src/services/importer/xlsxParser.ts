import fs from 'node:fs';
import * as XLSXModule from 'xlsx';
import { CanonicalScheduleImportRow } from '../../models/domain.types.js';
import { ValidationError } from '../../errors/AppError.js';
import { ScheduleParser } from './types.js';
import { validateHeaders, transformRowToCanonical } from './headerMapper.js';

// Resolve CJS / ESM module interoperability for SheetJS
const XLSX = (XLSXModule as unknown as { default: typeof XLSXModule }).default || XLSXModule;

export class XlsxScheduleParser implements ScheduleParser {
  async parse(filePath: string, _originalFilename: string): Promise<CanonicalScheduleImportRow[]> {
    let workbook: XLSXModule.WorkBook;
    try {
      const buffer = fs.readFileSync(filePath);
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch (err: unknown) {
      throw new ValidationError(`Malformed or unreadable XLSX file: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new ValidationError('Uploaded XLSX workbook contains no worksheets');
    }

    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      throw new ValidationError(`Worksheet '${firstSheetName}' could not be read`);
    }

    // Convert sheet to array of rows with header object mapping
    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    if (!rawMatrix || rawMatrix.length === 0) {
      throw new ValidationError('Uploaded XLSX file is empty');
    }

    const headerRow = rawMatrix[0];
    if (!Array.isArray(headerRow) || headerRow.length === 0) {
      throw new ValidationError('Uploaded XLSX file contains no valid header row');
    }

    const rawHeaders = headerRow.map((h) => (h !== null && h !== undefined ? String(h).trim() : ''));
    const headerToField = validateHeaders(rawHeaders);

    // Convert sheet to JSON objects using the headers
    const rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false
    });

    if (!rawRecords || rawRecords.length === 0) {
      throw new ValidationError('Uploaded XLSX file contains headers but no activity rows');
    }

    const canonicalRows: CanonicalScheduleImportRow[] = [];

    for (let i = 0; i < rawRecords.length; i++) {
      const rowNumber = i + 2; // Row 1 is header
      const canonical = transformRowToCanonical(rawRecords[i], headerToField, rowNumber);
      if (canonical) {
        canonicalRows.push(canonical);
      }
    }

    if (canonicalRows.length === 0) {
      throw new ValidationError('Uploaded XLSX file contains no valid activity rows');
    }

    return canonicalRows;
  }
}
