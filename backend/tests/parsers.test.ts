import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { CsvScheduleParser } from '../src/services/importer/csvParser.js';
import { XlsxScheduleParser } from '../src/services/importer/xlsxParser.js';
import { getScheduleParser } from '../src/services/importer/parserFactory.js';
import { ValidationError } from '../src/errors/AppError.js';

const fixturesDir = path.resolve(process.cwd(), 'backend', 'tests', 'fixtures');

describe('Schedule Parsers', () => {
  describe('CsvScheduleParser', () => {
    const csvParser = new CsvScheduleParser();

    it('should successfully parse valid standard CSV file', async () => {
      const filePath = path.join(fixturesDir, 'valid_schedule.csv');
      const rows = await csvParser.parse(filePath, 'valid_schedule.csv');

      expect(rows).toHaveLength(5);
      expect(rows[0]).toEqual({
        externalId: 'ACT-101',
        name: 'Site Mobilization & Clearing',
        description: 'Initial site preparation and clearing',
        wbsCode: '1.1',
        location: 'Sector A',
        plannedStart: '2026-03-01',
        plannedFinish: '2026-03-15',
        plannedQuantity: 500,
        unit: 'm2'
      });
      expect(rows[4].externalId).toBe('ACT-105');
      expect(rows[4].plannedQuantity).toBe(120);
    });

    it('should successfully parse CSV with alias headers', async () => {
      const filePath = path.join(fixturesDir, 'valid_schedule_aliases.csv');
      const rows = await csvParser.parse(filePath, 'valid_schedule_aliases.csv');

      expect(rows).toHaveLength(3);
      expect(rows[0].externalId).toBe('TASK-001');
      expect(rows[0].name).toBe('Grading & Compaction');
      expect(rows[0].wbsCode).toBe('ROAD-01');
      expect(rows[0].location).toBe('Access Zone 1');
      expect(rows[0].plannedQuantity).toBe(2500);
      expect(rows[0].unit).toBe('sqm');
    });

    it('should reject CSV missing required headers with clear ValidationError', async () => {
      const filePath = path.join(fixturesDir, 'missing_headers.csv');
      await expect(csvParser.parse(filePath, 'missing_headers.csv')).rejects.toThrow(ValidationError);
      await expect(csvParser.parse(filePath, 'missing_headers.csv')).rejects.toThrow(/Missing required schedule column/);
    });

    it('should reject malformed CSV file', async () => {
      const filePath = path.join(fixturesDir, 'malformed.csv');
      await expect(csvParser.parse(filePath, 'malformed.csv')).rejects.toThrow(ValidationError);
    });
  });

  describe('XlsxScheduleParser', () => {
    const xlsxParser = new XlsxScheduleParser();

    it('should successfully parse valid XLSX schedule workbook', async () => {
      const filePath = path.join(fixturesDir, 'valid_schedule.xlsx');
      const rows = await xlsxParser.parse(filePath, 'valid_schedule.xlsx');

      expect(rows).toHaveLength(3);
      expect(rows[0].externalId).toBe('XL-001');
      expect(rows[0].name).toBe('Substation Earthworks');
      expect(rows[0].wbsCode).toBe('SUB-01');
      expect(rows[0].location).toBe('Switchyard Area');
      expect(rows[0].plannedStart).toBe('2026-06-01');
      expect(rows[0].plannedFinish).toBe('2026-06-25');
      expect(rows[0].plannedQuantity).toBe(3200);
      expect(rows[0].unit).toBe('m3');
    });

    it('should reject XLSX missing required headers with clear ValidationError', async () => {
      const filePath = path.join(fixturesDir, 'missing_headers.xlsx');
      await expect(xlsxParser.parse(filePath, 'missing_headers.xlsx')).rejects.toThrow(ValidationError);
      await expect(xlsxParser.parse(filePath, 'missing_headers.xlsx')).rejects.toThrow(/Missing required schedule column/);
    });
  });

  describe('ParserFactory', () => {
    it('should resolve CsvScheduleParser for .csv files', () => {
      const { parser, sourceType } = getScheduleParser('my_project_schedule.csv');
      expect(parser).toBeInstanceOf(CsvScheduleParser);
      expect(sourceType).toBe('csv');
    });

    it('should resolve XlsxScheduleParser for .xlsx files', () => {
      const { parser, sourceType } = getScheduleParser('construction_plan.XLSX');
      expect(parser).toBeInstanceOf(XlsxScheduleParser);
      expect(sourceType).toBe('xlsx');
    });

    it('should reject unsupported file extensions cleanly', () => {
      expect(() => getScheduleParser('schedule.pdf')).toThrow(ValidationError);
      expect(() => getScheduleParser('data.json')).toThrow(ValidationError);
      expect(() => getScheduleParser('notes.txt')).toThrow(ValidationError);
    });
  });
});
