import { normalizeText } from './text-normalizer.js';

/**
 * Explicit canonical unit dictionary.
 * Maps common case-insensitive variations and aliases to their canonical standard symbol.
 */
const CANONICAL_UNIT_MAP: Record<string, string> = {
  // Mass / Weight
  kg: 'kg',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  g: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  mg: 'mg',
  milligram: 'mg',
  milligrams: 'mg',
  t: 't',
  ton: 't',
  tons: 't',
  tonne: 't',
  tonnes: 't',
  mt: 't',
  'metric ton': 't',
  'metric tons': 't',
  'metric tonne': 't',
  'metric tonnes': 't',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',

  // Length
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  km: 'km',
  kilometer: 'km',
  kilometers: 'km',
  kilometre: 'km',
  kilometres: 'km',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  millimetre: 'mm',
  millimetres: 'mm',
  ft: 'ft',
  feet: 'ft',
  foot: 'ft',
  in: 'in',
  inch: 'in',
  inches: 'in',
  yd: 'yd',
  yard: 'yd',
  yards: 'yd',
  mi: 'mi',
  mile: 'mi',
  miles: 'mi',

  // Area
  m2: 'm2',
  'm²': 'm2',
  sqm: 'm2',
  'sq m': 'm2',
  'sq.m': 'm2',
  'sq. m': 'm2',
  'square meter': 'm2',
  'square meters': 'm2',
  'square metre': 'm2',
  'square metres': 'm2',
  sqft: 'sqft',
  'sq ft': 'sqft',
  'sq.ft': 'sqft',
  'sq. ft': 'sqft',
  'square feet': 'sqft',
  'square foot': 'sqft',
  ft2: 'sqft',
  'ft²': 'sqft',
  ha: 'ha',
  hectare: 'ha',
  hectares: 'ha',
  acre: 'acre',
  acres: 'acre',
  sqyd: 'sqyd',
  'sq yd': 'sqyd',
  'square yard': 'sqyd',
  'square yards': 'sqyd',

  // Volume
  m3: 'm3',
  'm³': 'm3',
  cum: 'm3',
  'cu m': 'm3',
  'cu.m': 'm3',
  'cu. m': 'm3',
  'cubic meter': 'm3',
  'cubic meters': 'm3',
  'cubic metre': 'm3',
  'cubic metres': 'm3',
  cuft: 'cuft',
  'cu ft': 'cuft',
  'cu.ft': 'cuft',
  'cu. ft': 'cuft',
  'cubic feet': 'cuft',
  'cubic foot': 'cuft',
  cft: 'cuft',
  ft3: 'cuft',
  'ft³': 'cuft',
  l: 'l',
  ltr: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  gal: 'gal',
  gallon: 'gal',
  gallons: 'gal',

  // Count / Discrete
  nos: 'nos',
  no: 'nos',
  'no.': 'nos',
  nr: 'nos',
  ea: 'nos',
  each: 'nos',
  pcs: 'nos',
  piece: 'nos',
  pieces: 'nos',
  item: 'nos',
  items: 'nos',
  unit: 'nos',
  units: 'nos',
  set: 'set',
  sets: 'set',
  pair: 'pair',
  pairs: 'pair',
  lot: 'ls',
  lots: 'ls',
  ls: 'ls',
  'lump sum': 'ls',
  lumpsum: 'ls',

  // Time
  hr: 'hr',
  hrs: 'hr',
  hour: 'hr',
  hours: 'hr',
  d: 'day',
  day: 'day',
  days: 'day',
  wk: 'wk',
  wks: 'wk',
  week: 'wk',
  weeks: 'wk',
  mo: 'mo',
  mos: 'mo',
  month: 'mo',
  months: 'mo',

  // Percentage
  '%': '%',
  pct: '%',
  percent: '%',
  percentage: '%'
};

/**
 * Deterministically normalizes a unit label to its canonical representation.
 *
 * Rules:
 * - Empty or missing values return null
 * - Common aliases (e.g. "KGS", "metre", "sqm", "tonnes") map to canonical symbols ("kg", "m", "m2", "t")
 * - Unrecognized units are preserved as normalized text (trimmed, collapsed whitespace)
 * - QUANTITY IS NEVER CONVERTED (1000 kg does not become 1 t)
 */
export function normalizeUnit(value: unknown): string | null {
  const normalized = normalizeText(value, { collapseWhitespace: true, allowEmpty: false });
  if (!normalized) {
    return null;
  }

  const lookupKey = normalized.toLowerCase();
  if (lookupKey in CANONICAL_UNIT_MAP) {
    return CANONICAL_UNIT_MAP[lookupKey];
  }

  // Preserve unrecognized unit label in normalized text form
  return normalized;
}
