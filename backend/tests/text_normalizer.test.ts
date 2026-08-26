import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  normalizeIdentifier,
  normalizeName,
  normalizeOptionalText
} from '../src/services/normalization/text-normalizer.js';
import { NormalizationError } from '../src/services/normalization/normalizationError.js';

describe('Text Normalizer', () => {
  describe('normalizeText', () => {
    it('should trim leading and trailing whitespace', () => {
      expect(normalizeText('   hello world   ')).toBe('hello world');
    });

    it('should collapse multiple internal whitespace characters by default', () => {
      expect(normalizeText('  Excavation   and    Grading  ')).toBe('Excavation and Grading');
      expect(normalizeText("Line1\n\n  \t Line2")).toBe('Line1 Line2');
    });

    it('should convert empty or whitespace-only strings to null by default', () => {
      expect(normalizeText('')).toBeNull();
      expect(normalizeText('   ')).toBeNull();
      expect(normalizeText(null)).toBeNull();
      expect(normalizeText(undefined)).toBeNull();
    });

    it('should allow empty string when allowEmpty is true', () => {
      expect(normalizeText('   ', { allowEmpty: true })).toBe('');
      expect(normalizeText('', { allowEmpty: true })).toBe('');
    });
  });

  describe('normalizeIdentifier', () => {
    it('should preserve identifier punctuation, symbols, and case', () => {
      expect(normalizeIdentifier('ACT-001/A')).toBe('ACT-001/A');
      expect(normalizeIdentifier('  TASK_102.B  ')).toBe('TASK_102.B');
      expect(normalizeIdentifier('sub-item-01')).toBe('sub-item-01');
    });

    it('should trim and collapse internal spaces in identifiers', () => {
      expect(normalizeIdentifier('  ACT   001  ')).toBe('ACT 001');
    });

    it('should throw NormalizationError for missing or empty identifiers', () => {
      expect(() => normalizeIdentifier('', 'Activity ID', 4)).toThrow(NormalizationError);
      expect(() => normalizeIdentifier('   ', 'Activity ID', 4)).toThrow(/Row 4: Could not normalize Activity ID/);
      expect(() => normalizeIdentifier(null, 'Activity ID')).toThrow(/Could not normalize Activity ID/);
    });
  });

  describe('normalizeName', () => {
    it('should trim and collapse internal spaces in activity names', () => {
      expect(normalizeName('  Site    Mobilization  &   Clearing  ')).toBe('Site Mobilization & Clearing');
    });

    it('should preserve original capitalization', () => {
      expect(normalizeName('Transformer Bay Gantry Erection')).toBe('Transformer Bay Gantry Erection');
      expect(normalizeName('piling works')).toBe('piling works');
    });

    it('should throw NormalizationError for missing or empty names', () => {
      expect(() => normalizeName('', 'Activity Name', 7)).toThrow(NormalizationError);
      expect(() => normalizeName('   ', 'Activity Name', 7)).toThrow(/Row 7: Could not normalize Activity Name/);
    });
  });

  describe('normalizeOptionalText', () => {
    it('should normalize optional text and convert empty to null', () => {
      expect(normalizeOptionalText('  Zone   A  ')).toBe('Zone A');
      expect(normalizeOptionalText('   ')).toBeNull();
      expect(normalizeOptionalText('')).toBeNull();
      expect(normalizeOptionalText(null)).toBeNull();
      expect(normalizeOptionalText(undefined)).toBeNull();
    });
  });
});
