import { describe, it, expect } from 'vitest';
import { normalizeUnit } from '../src/services/normalization/unit-normalizer.js';

describe('Unit Normalizer', () => {
  it('should normalize mass units to canonical symbols', () => {
    expect(normalizeUnit('kg')).toBe('kg');
    expect(normalizeUnit('KGS')).toBe('kg');
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('tonnes')).toBe('t');
    expect(normalizeUnit('MT')).toBe('t');
    expect(normalizeUnit('metric tons')).toBe('t');
  });

  it('should normalize length units to canonical symbols', () => {
    expect(normalizeUnit('meter')).toBe('m');
    expect(normalizeUnit('metre')).toBe('m');
    expect(normalizeUnit('meters')).toBe('m');
    expect(normalizeUnit('KM')).toBe('km');
    expect(normalizeUnit('millimeters')).toBe('mm');
    expect(normalizeUnit('feet')).toBe('ft');
  });

  it('should normalize area units to canonical symbols', () => {
    expect(normalizeUnit('m2')).toBe('m2');
    expect(normalizeUnit('m²')).toBe('m2');
    expect(normalizeUnit('sqm')).toBe('m2');
    expect(normalizeUnit('sq m')).toBe('m2');
    expect(normalizeUnit('square meters')).toBe('m2');
    expect(normalizeUnit('sqft')).toBe('sqft');
    expect(normalizeUnit('hectares')).toBe('ha');
  });

  it('should normalize volume units to canonical symbols', () => {
    expect(normalizeUnit('m3')).toBe('m3');
    expect(normalizeUnit('m³')).toBe('m3');
    expect(normalizeUnit('cum')).toBe('m3');
    expect(normalizeUnit('cu m')).toBe('m3');
    expect(normalizeUnit('cubic meters')).toBe('m3');
    expect(normalizeUnit('liters')).toBe('l');
  });

  it('should normalize discrete count units to canonical symbols', () => {
    expect(normalizeUnit('nos')).toBe('nos');
    expect(normalizeUnit('no.')).toBe('nos');
    expect(normalizeUnit('each')).toBe('nos');
    expect(normalizeUnit('pcs')).toBe('nos');
    expect(normalizeUnit('pieces')).toBe('nos');
    expect(normalizeUnit('units')).toBe('nos');
    expect(normalizeUnit('sets')).toBe('set');
    expect(normalizeUnit('lump sum')).toBe('ls');
  });

  it('should normalize time units to canonical symbols', () => {
    expect(normalizeUnit('hours')).toBe('hr');
    expect(normalizeUnit('hrs')).toBe('hr');
    expect(normalizeUnit('days')).toBe('day');
    expect(normalizeUnit('weeks')).toBe('wk');
    expect(normalizeUnit('months')).toBe('mo');
  });

  it('should preserve unrecognized unit labels in clean normalized text format', () => {
    expect(normalizeUnit('  kVA  ')).toBe('kVA');
    expect(normalizeUnit('bbl')).toBe('bbl');
    expect(normalizeUnit(' custom_points ')).toBe('custom_points');
  });

  it('should return null for empty or whitespace-only units', () => {
    expect(normalizeUnit('')).toBeNull();
    expect(normalizeUnit('   ')).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit(undefined)).toBeNull();
  });
});
