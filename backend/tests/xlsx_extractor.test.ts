import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { XlsxExtractor } from '../src/services/ingestion/extractors/xlsx.extractor.js';
import { ValidationError } from '../src/errors/AppError.js';
import {
  MAX_XLSX_SHEETS,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../src/services/ingestion/document-ingestion.types.js';

describe('XlsxExtractor', () => {
  const extractor = new XlsxExtractor();

  function createWorkbookBuffer(sheets: Record<string, unknown[][]>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const [name, data] of Object.entries(sheets)) {
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  it('should support .xlsx, .xls, and spreadsheet mime types', () => {
    expect(extractor.supports('xlsx', 'report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(extractor.supports('text', 'report.xls', 'application/vnd.ms-excel')).toBe(true);
    expect(extractor.supports('pdf', 'report.pdf', 'application/pdf')).toBe(false);
  });

  it('should extract valid single-sheet workbook with tabular data', async () => {
    const buf = createWorkbookBuffer({
      'Shift Report': [
        ['Date', 'Activity', 'Location', 'Quantity', 'Status'],
        ['2026-08-25', 'Pier P1 Concrete Pour', 'Zone A', 100, 'In Progress'],
        ['2026-08-26', 'Pier P2 Excavation', 'Zone B', 450, 'Completed']
      ]
    });

    const result = await extractor.extract({
      evidenceId: 'ev-xlsx-1',
      projectId: 'proj-1',
      sourceFileName: 'site_log.xlsx',
      fileBuffer: buf
    });

    expect(result.evidenceId).toBe('ev-xlsx-1');
    expect(result.sourceType).toBe('xlsx');
    expect(result.text).toContain('Sheet: Shift Report');
    expect(result.text).toContain('Date | Activity | Location | Quantity | Status');
    expect(result.text).toContain('2026-08-25 | Pier P1 Concrete Pour | Zone A | 100 | In Progress');
    expect(result.text).toContain('2026-08-26 | Pier P2 Excavation | Zone B | 450 | Completed');
    expect(result.metadata?.totalSheets).toBe(1);
    expect(result.metadata?.totalRows).toBe(3);
  });

  it('should extract multi-sheet workbook preserving sheet names and deterministic order', async () => {
    const buf = createWorkbookBuffer({
      'Concrete Log': [
        ['Batch ID', 'Volume m3', 'Status'],
        ['BATCH-101', 50, 'Delivered']
      ],
      'Rebar Inspection': [
        ['Location', 'Inspection Result'],
        ['Pier P1', 'Passed QA']
      ]
    });

    const result = await extractor.extract({
      evidenceId: 'ev-xlsx-multi',
      projectId: 'proj-1',
      sourceFileName: 'multi_sheet.xlsx',
      fileBuffer: buf
    });

    expect(result.text).toContain('Sheet: Concrete Log');
    expect(result.text).toContain('BATCH-101 | 50 | Delivered');
    expect(result.text).toContain('Sheet: Rebar Inspection');
    expect(result.text).toContain('Pier P1 | Passed QA');
    expect(result.metadata?.totalSheets).toBe(2);
    expect(result.metadata?.processedSheets).toBe(2);
  });

  it('should handle empty cells and varied data types without error', async () => {
    const buf = createWorkbookBuffer({
      'Mixed Data': [
        ['String', 'Number', 'Empty', 'Boolean'],
        ['Test Work', 123.45, null, true],
        ['Second Row', 0, undefined, false]
      ]
    });

    const result = await extractor.extract({
      evidenceId: 'ev-xlsx-mixed',
      projectId: 'proj-1',
      sourceFileName: 'mixed.xlsx',
      fileBuffer: buf
    });

    expect(result.text).toContain('Test Work | 123.45 |  | TRUE');
    expect(result.text).toContain('Second Row | 0 |  | FALSE');
  });

  it('should reject corrupt / invalid workbook buffer', async () => {
    const corruptBuffer = Buffer.from('NOT AN EXCEL WORKBOOK FILE CONTENT');

    await expect(
      extractor.extract({
        evidenceId: 'ev-corrupt',
        projectId: 'proj-1',
        sourceFileName: 'corrupt.xlsx',
        fileBuffer: corruptBuffer
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject empty workbook or sheets with no content', async () => {
    const buf = createWorkbookBuffer({
      'Empty Sheet': [
        ['', ''],
        ['', '']
      ]
    });

    await expect(
      extractor.extract({
        evidenceId: 'ev-empty-sheet',
        projectId: 'proj-1',
        sourceFileName: 'empty_sheets.xlsx',
        fileBuffer: buf
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should bound sheet processing to MAX_XLSX_SHEETS', async () => {
    const sheets: Record<string, unknown[][]> = {};
    for (let i = 1; i <= MAX_XLSX_SHEETS + 5; i++) {
      sheets[`Sheet${i}`] = [['Header'], [`Data_${i}`]];
    }

    const buf = createWorkbookBuffer(sheets);

    const result = await extractor.extract({
      evidenceId: 'ev-many-sheets',
      projectId: 'proj-1',
      sourceFileName: 'many_sheets.xlsx',
      fileBuffer: buf
    });

    expect(result.metadata?.totalSheets).toBe(MAX_XLSX_SHEETS + 5);
    expect(result.metadata?.processedSheets).toBe(MAX_XLSX_SHEETS);
  });

  it('should bound total extracted text to MAX_EXTRACTED_TEXT_LENGTH', async () => {
    const bigData: string[][] = [['Header']];
    const bigCell = 'Z'.repeat(500);
    for (let i = 0; i < 200; i++) {
      bigData.push([bigCell]);
    }

    const buf = createWorkbookBuffer({ 'Big Sheet': bigData });

    const result = await extractor.extract({
      evidenceId: 'ev-huge-text',
      projectId: 'proj-1',
      sourceFileName: 'huge.xlsx',
      fileBuffer: buf
    });

    expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_TEXT_LENGTH);
  });
});
