import * as XLSX from 'xlsx';
import path from 'node:path';
import {
  DocumentExtractor,
  ExtractDocumentInput,
  NormalizedDocument,
  MAX_XLSX_SHEETS,
  MAX_XLSX_ROWS_PER_SHEET,
  MAX_XLSX_CELLS_PER_SHEET,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../document-ingestion.types.js';
import { ValidationError } from '../../../errors/AppError.js';

function isExcelWorkbookBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 4) return false;
  // ZIP signature (PK..) for .xlsx / .xlsm / .xltx
  if (buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
    return true;
  }
  // OLE2 Compound Document signature for .xls (BIFF8)
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  ) {
    return true;
  }
  // XML Spreadsheet 2003 format
  const headStr = buf.slice(0, 100).toString('utf-8').trimStart();
  if (headStr.startsWith('<?xml') && (headStr.includes('Workbook') || headStr.includes('spreadsheet'))) {
    return true;
  }
  return false;
}

export class XlsxExtractor implements DocumentExtractor {
  public readonly name: string = 'xlsx-extractor';

  supports(fileType: string, fileName: string, mimeType?: string | null): boolean {
    const ext = path.extname(fileName).toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    return (
      fileType === 'xlsx' ||
      ext === '.xlsx' ||
      ext === '.xls' ||
      mime.includes('spreadsheet') ||
      mime.includes('excel') ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel'
    );
  }

  async extract(input: ExtractDocumentInput): Promise<NormalizedDocument> {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new ValidationError('Excel workbook document is empty');
    }

    if (!isExcelWorkbookBuffer(input.fileBuffer)) {
      throw new ValidationError('Failed to parse Excel workbook: corrupt or invalid file format');
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(input.fileBuffer, {
        type: 'buffer',
        dense: true,
        cellDates: true,
        raw: false
      });
    } catch (parseErr) {
      throw new ValidationError(
        `Failed to parse Excel workbook: ${parseErr instanceof Error ? parseErr.message : 'corrupt or invalid format'}`
      );
    }

    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new ValidationError('Excel workbook contains no sheets');
    }

    const sheetCount = workbook.SheetNames.length;
    const sheetsToProcess = workbook.SheetNames.slice(0, MAX_XLSX_SHEETS);

    const sheetBlocks: string[] = [];
    let totalCellCount = 0;
    let totalRowCount = 0;
    let hasReadableData = false;

    for (const sheetName of sheetsToProcess) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;

      // Extract rows as 2D array
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        defval: '',
        raw: false,
        blankrows: false
      });

      if (!rawRows || rawRows.length === 0) {
        continue;
      }

      const rowsToProcess = rawRows.slice(0, MAX_XLSX_ROWS_PER_SHEET);
      const rowLines: string[] = [];

      let sheetCells = 0;
      for (const row of rowsToProcess) {
        if (!Array.isArray(row)) continue;

        // Skip completely empty rows
        const hasContent = row.some(
          (c) => c !== null && c !== undefined && String(c).trim().length > 0
        );
        if (!hasContent) continue;

        sheetCells += row.length;
        if (sheetCells > MAX_XLSX_CELLS_PER_SHEET) {
          rowLines.push('... [Sheet cell limit reached]');
          break;
        }

        const formattedLine = row
          .map((c) => (c === null || c === undefined ? '' : String(c).trim()))
          .join(' | ');

        rowLines.push(formattedLine);
        hasReadableData = true;
        totalRowCount++;
      }

      totalCellCount += sheetCells;

      if (rowLines.length > 0) {
        sheetBlocks.push(`Sheet: ${sheetName}\n\n${rowLines.join('\n')}`);
      }
    }

    if (!hasReadableData || sheetBlocks.length === 0) {
      throw new ValidationError('Excel workbook contains no readable text or data rows');
    }

    let normalizedText = sheetBlocks.join('\n\n---\n\n').trim();

    if (normalizedText.length > MAX_EXTRACTED_TEXT_LENGTH) {
      normalizedText = normalizedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH).trim();
    }

    return {
      evidenceId: input.evidenceId,
      projectId: input.projectId,
      sourceFileName: input.sourceFileName,
      sourceType: 'xlsx',
      text: normalizedText,
      metadata: {
        totalSheets: sheetCount,
        processedSheets: sheetsToProcess.length,
        totalRows: totalRowCount,
        totalCells: totalCellCount
      }
    };
  }
}

export const xlsxExtractor = new XlsxExtractor();
