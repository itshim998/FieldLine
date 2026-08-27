import { describe, it, expect } from 'vitest';
import { CsvExtractor } from '../src/services/ingestion/extractors/csv.extractor.js';
import { ValidationError } from '../src/errors/AppError.js';
import {
  MAX_CSV_ROWS,
  MAX_CSV_COLS,
  MAX_EXTRACTED_TEXT_LENGTH
} from '../src/services/ingestion/document-ingestion.types.js';

describe('CsvExtractor', () => {
  const extractor = new CsvExtractor();

  it('should support .csv files and csv mime types', () => {
    expect(extractor.supports('text', 'report.csv', 'text/csv')).toBe(true);
    expect(extractor.supports('other', 'report.csv', 'application/csv')).toBe(true);
    expect(extractor.supports('pdf', 'report.pdf', 'application/pdf')).toBe(false);
    expect(extractor.supports('xlsx', 'report.xlsx', 'application/vnd.ms-excel')).toBe(false);
  });

  it('should extract valid CSV with headers and data rows', async () => {
    const csvContent = [
      'Date,Activity,Location,Quantity,Status',
      '2026-08-25,Pier P1 Pour,Zone A,100 m3,In Progress',
      '2026-08-26,Pier P2 Rebar,Zone B,50 tons,Completed'
    ].join('\n');

    const result = await extractor.extract({
      evidenceId: 'ev-1',
      projectId: 'proj-1',
      sourceFileName: 'field_report.csv',
      fileBuffer: Buffer.from(csvContent, 'utf-8')
    });

    expect(result.evidenceId).toBe('ev-1');
    expect(result.projectId).toBe('proj-1');
    expect(result.sourceFileName).toBe('field_report.csv');
    expect(result.sourceType).toBe('csv');
    expect(result.text).toContain('Date | Activity | Location | Quantity | Status');
    expect(result.text).toContain('2026-08-25 | Pier P1 Pour | Zone A | 100 m3 | In Progress');
    expect(result.text).toContain('2026-08-26 | Pier P2 Rebar | Zone B | 50 tons | Completed');
    expect(result.metadata?.rowCount).toBe(3);
    expect(result.metadata?.columnCount).toBe(5);
  });

  it('should handle UTF-8 with BOM and international characters', async () => {
    const csvWithBom =
      '\uFEFFDate,Description,Location\n2026-08-25,Betonarbeiten für Pfeiler P1 (100 m³),Sektor München';

    const result = await extractor.extract({
      evidenceId: 'ev-bom',
      projectId: 'proj-1',
      sourceFileName: 'german_report.csv',
      fileBuffer: Buffer.from(csvWithBom, 'utf-8')
    });

    expect(result.text).toContain('Date | Description | Location');
    expect(result.text).toContain('2026-08-25 | Betonarbeiten für Pfeiler P1 (100 m³) | Sektor München');
    expect(result.text).not.toContain('\uFEFF');
  });

  it('should reject empty buffer or whitespace-only CSV', async () => {
    await expect(
      extractor.extract({
        evidenceId: 'ev-empty',
        projectId: 'proj-1',
        sourceFileName: 'empty.csv',
        fileBuffer: Buffer.from('', 'utf-8')
      })
    ).rejects.toThrow(ValidationError);

    await expect(
      extractor.extract({
        evidenceId: 'ev-ws',
        projectId: 'proj-1',
        sourceFileName: 'whitespace.csv',
        fileBuffer: Buffer.from('   \n\n\t  \n  ', 'utf-8')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject CSV with only empty cells / commas', async () => {
    await expect(
      extractor.extract({
        evidenceId: 'ev-commas',
        projectId: 'proj-1',
        sourceFileName: 'all_commas.csv',
        fileBuffer: Buffer.from(',,,,\n,,,,\n,,,,', 'utf-8')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should reject malformed CSV syntax cleanly', async () => {
    const malformedCsv = 'col1,col2\n"unclosed quote line,test';

    await expect(
      extractor.extract({
        evidenceId: 'ev-malformed',
        projectId: 'proj-1',
        sourceFileName: 'malformed.csv',
        fileBuffer: Buffer.from(malformedCsv, 'utf-8')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should enforce column count limits', async () => {
    const excessiveColsRow = Array.from({ length: MAX_CSV_COLS + 5 }, (_, i) => `Col${i}`).join(',');

    await expect(
      extractor.extract({
        evidenceId: 'ev-excessive-cols',
        projectId: 'proj-1',
        sourceFileName: 'wide.csv',
        fileBuffer: Buffer.from(excessiveColsRow, 'utf-8')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should enforce row count limits', async () => {
    const rows = ['header1,header2'];
    for (let i = 0; i <= MAX_CSV_ROWS + 10; i++) {
      rows.push(`val1_${i},val2_${i}`);
    }

    await expect(
      extractor.extract({
        evidenceId: 'ev-excessive-rows',
        projectId: 'proj-1',
        sourceFileName: 'huge.csv',
        fileBuffer: Buffer.from(rows.join('\n'), 'utf-8')
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should bound maximum extracted text length to MAX_EXTRACTED_TEXT_LENGTH', async () => {
    const longCell = 'X'.repeat(500);
    const rows = ['h1,h2'];
    for (let i = 0; i < 200; i++) {
      rows.push(`${i},${longCell}`);
    }

    const result = await extractor.extract({
      evidenceId: 'ev-long',
      projectId: 'proj-1',
      sourceFileName: 'long.csv',
      fileBuffer: Buffer.from(rows.join('\n'), 'utf-8')
    });

    expect(result.text.length).toBeLessThanOrEqual(MAX_EXTRACTED_TEXT_LENGTH);
  });
});
