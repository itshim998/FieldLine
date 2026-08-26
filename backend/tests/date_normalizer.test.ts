import { describe, it, expect } from 'vitest';
import { normalizeDate } from '../src/services/normalization/date-normalizer.js';
import { NormalizationError } from '../src/services/normalization/normalizationError.js';

describe('Date Normalizer', () => {
  describe('ISO 8601 formats', () => {
    it('should normalize standard YYYY-MM-DD', () => {
      expect(normalizeDate('2026-04-01')).toBe('2026-04-01');
      expect(normalizeDate('2026-4-1')).toBe('2026-04-01');
    });

    it('should normalize YYYY/MM/DD and YYYY.MM.DD', () => {
      expect(normalizeDate('2026/06/15')).toBe('2026-06-15');
      expect(normalizeDate('2026.12.31')).toBe('2026-12-31');
    });

    it('should normalize ISO timestamp strings', () => {
      expect(normalizeDate('2026-05-10T00:00:00.000Z')).toBe('2026-05-10');
      expect(normalizeDate('2026-05-10T14:30:00+05:30')).toBe('2026-05-10');
    });
  });

  describe('JavaScript Date and Excel Serial formats', () => {
    it('should normalize JavaScript Date instances', () => {
      const date = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01
      expect(normalizeDate(date)).toBe('2026-03-01');
    });

    it('should normalize Excel serial date numbers', () => {
      // 46082 in Excel 1900 date system represents 2026-03-01 (20513 days since 1970-01-01 + 25569)
      expect(normalizeDate(46082)).toBe('2026-03-01');
      expect(normalizeDate('46082')).toBe('2026-03-01');
      expect(normalizeDate(46083)).toBe('2026-03-02');
    });

  });

  describe('Named Month formats (Unambiguous)', () => {
    it('should normalize DD-MMM-YYYY and DD MMM YYYY', () => {
      expect(normalizeDate('01-Apr-2026')).toBe('2026-04-01');
      expect(normalizeDate('15 March 2026')).toBe('2026-03-15');
      expect(normalizeDate('31-Dec-2026')).toBe('2026-12-31');
    });

    it('should normalize MMM DD, YYYY and Month DD YYYY', () => {
      expect(normalizeDate('Apr 1, 2026')).toBe('2026-04-01');
      expect(normalizeDate('April 1, 2026')).toBe('2026-04-01');
      expect(normalizeDate('June 25, 2026')).toBe('2026-06-25');
    });

    it('should normalize YYYY-MMM-DD', () => {
      expect(normalizeDate('2026-Apr-01')).toBe('2026-04-01');
      expect(normalizeDate('2026-Oct-15')).toBe('2026-10-15');
    });
  });

  describe('Slash and Dash formats with disambiguation', () => {
    it('should normalize unambiguous day-first dates (day > 12)', () => {
      expect(normalizeDate('25/06/2026')).toBe('2026-06-25');
      expect(normalizeDate('31-01-2026')).toBe('2026-01-31');
    });

    it('should normalize unambiguous month-first dates (month <= 12, day > 12)', () => {
      expect(normalizeDate('06/25/2026')).toBe('2026-06-25');
      expect(normalizeDate('01/31/2026')).toBe('2026-01-31');
    });

    it('should normalize identical day and month dates (e.g. 05/05/2026)', () => {
      expect(normalizeDate('05/05/2026')).toBe('2026-05-05');
      expect(normalizeDate('12/12/2026')).toBe('2026-12-12');
    });

    it('should reject genuinely ambiguous numeric dates with clear NormalizationError', () => {
      expect(() => normalizeDate('01/02/2026', 'Start Date', 10)).toThrow(NormalizationError);
      expect(() => normalizeDate('01/02/2026', 'Start Date', 10)).toThrow(
        /Row 10: Could not normalize Start Date '01\/02\/2026': Ambiguous date format/
      );
    });
  });

  describe('Invalid and Impossible Calendar Dates', () => {
    it('should reject invalid calendar dates like 31/31/2026 or 2026-02-30', () => {
      expect(() => normalizeDate('31/31/2026')).toThrow(NormalizationError);
      expect(() => normalizeDate('2026-02-30')).toThrow(NormalizationError);
      expect(() => normalizeDate('2026-13-01')).toThrow(NormalizationError);
    });

    it('should correctly validate leap years (2024 is leap, 2026 is not)', () => {
      expect(normalizeDate('2024-02-29')).toBe('2024-02-29');
      expect(() => normalizeDate('2026-02-29')).toThrow(NormalizationError);
    });

    it('should reject missing or empty dates with NormalizationError', () => {
      expect(() => normalizeDate('', 'Finish Date', 3)).toThrow(NormalizationError);
      expect(() => normalizeDate(null, 'Start Date')).toThrow(/Date cannot be empty/);
      expect(() => normalizeDate(undefined, 'Start Date')).toThrow(/Date cannot be empty/);
    });
  });
});
