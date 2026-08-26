import { describe, it, expect } from 'vitest';
import {
  normalizeNumber,
  normalizePercentage
} from '../src/services/normalization/number-normalizer.js';
import { NormalizationError } from '../src/services/normalization/normalizationError.js';

describe('Number and Percentage Normalizer', () => {
  describe('normalizeNumber', () => {
    it('should normalize standard numbers and numeric strings', () => {
      expect(normalizeNumber(1250)).toBe(1250);
      expect(normalizeNumber('1250')).toBe(1250);
      expect(normalizeNumber(' 1250.00 ')).toBe(1250);
      expect(normalizeNumber('1250.75')).toBe(1250.75);
    });

    it('should normalize thousands comma separators', () => {
      expect(normalizeNumber('1,250')).toBe(1250);
      expect(normalizeNumber('1,250,000.50')).toBe(1250000.5);
    });

    it('should normalize space thousands separators', () => {
      expect(normalizeNumber('1 250 000.50')).toBe(1250000.5);
    });

    it('should normalize scientific notation', () => {
      expect(normalizeNumber('1.25E3')).toBe(1250);
      expect(normalizeNumber('1.25e3')).toBe(1250);
      expect(normalizeNumber('1.5e-2')).toBe(0.015);
    });

    it('should return null for empty or missing values', () => {
      expect(normalizeNumber('')).toBeNull();
      expect(normalizeNumber('   ')).toBeNull();
      expect(normalizeNumber(null)).toBeNull();
      expect(normalizeNumber(undefined)).toBeNull();
    });

    it('should reject ambiguous locale formats like European 1.234,56', () => {
      expect(() => normalizeNumber('1.234,56', 'Quantity', 5)).toThrow(NormalizationError);
      expect(() => normalizeNumber('1.234,56', 'Quantity', 5)).toThrow(/Ambiguous or unsupported numeric format/);
    });

    it('should reject malformed or non-numeric strings', () => {
      expect(() => normalizeNumber('abc')).toThrow(NormalizationError);
      expect(() => normalizeNumber('12.34.56')).toThrow(NormalizationError);
      expect(() => normalizeNumber(NaN)).toThrow(NormalizationError);
      expect(() => normalizeNumber(Infinity)).toThrow(NormalizationError);
    });
  });

  describe('normalizePercentage', () => {
    it('should normalize percentage strings with % suffix', () => {
      expect(normalizePercentage('50%')).toBe(50);
      expect(normalizePercentage(' 50 % ')).toBe(50);
      expect(normalizePercentage('100%')).toBe(100);
      expect(normalizePercentage('0%')).toBe(0);
    });

    it('should normalize plain numeric percentages without rewriting decimal semantics', () => {
      expect(normalizePercentage(50)).toBe(50);
      expect(normalizePercentage('50')).toBe(50);
      // 0.5 is preserved as 0.5 and NOT rewritten into 50
      expect(normalizePercentage(0.5)).toBe(0.5);
      expect(normalizePercentage('0.5')).toBe(0.5);
    });

    it('should return null for empty percentage values', () => {
      expect(normalizePercentage('')).toBeNull();
      expect(normalizePercentage('   ')).toBeNull();
      expect(normalizePercentage(null)).toBeNull();
      expect(normalizePercentage(undefined)).toBeNull();
    });
  });
});
