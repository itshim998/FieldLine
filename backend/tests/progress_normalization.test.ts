import { describe, it, expect } from 'vitest';
import {
  normalizeProgress,
  areUnitsCompatible,
  mapExtractionStatus
} from '../src/services/progress/progress-normalization.js';
import { Activity } from '../src/models/domain.types.js';
import { FieldProgressItem } from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('Pass 10 — Pure Progress Normalization Unit Tests', () => {
  const baseActivity: Activity = {
    id: 'act-101',
    projectId: 'proj-1',
    scheduleId: 'sched-1',
    externalId: 'ACT-101',
    name: 'Foundation Concrete Pouring',
    description: 'Pouring raft foundation Block B',
    wbsCode: '1.1.2',
    location: 'Block B',
    plannedStart: '2026-08-01',
    plannedFinish: '2026-08-30',
    plannedQuantity: 500,
    unit: 'm3',
    baselineProgress: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z'
  };

  const baseFact: FieldProgressItem = {
    reference: 'Foundation Concrete',
    location: 'Block B',
    progress_percent: 60,
    status: 'in_progress'
  };

  describe('Percentage Normalization', () => {
    it('normalizes explicit reported percentage when no quantity is present', () => {
      const actWithoutQty: Activity = { ...baseActivity, plannedQuantity: null, unit: null };
      const fact: FieldProgressItem = { ...baseFact, progress_percent: 60 };

      const result = normalizeProgress({
        fact,
        activity: actWithoutQty,
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(60);
      expect(result.percentSource).toBe('reported_percent');
      expect(result.status).toBe('in_progress');
      expect(result.actualStart).toBe('2026-08-26');
    });

    it('handles 0% and 100% boundary percentages cleanly', () => {
      const actWithoutQty: Activity = { ...baseActivity, plannedQuantity: null, unit: null };

      const res0 = normalizeProgress({
        fact: { ...baseFact, progress_percent: 0, status: 'not_started' },
        activity: actWithoutQty,
        asOfDate: '2026-08-26'
      });
      expect(res0.actualPercent).toBe(0);
      expect(res0.percentSource).toBe('reported_percent');
      expect(res0.status).toBe('not_started');

      const res100 = normalizeProgress({
        fact: { ...baseFact, progress_percent: 100, status: 'completed' },
        activity: actWithoutQty,
        asOfDate: '2026-08-26'
      });
      expect(res100.actualPercent).toBe(100);
      expect(res100.percentSource).toBe('reported_percent');
      expect(res100.status).toBe('completed');
    });
  });

  describe('Quantity-Derived Percentage Math', () => {
    it('calculates quantity-derived percentage accurately (300 / 500 = 60%)', () => {
      const factWithoutPct: FieldProgressItem = { ...baseFact, progress_percent: null };

      const result = normalizeProgress({
        fact: factWithoutPct,
        activity: baseActivity,
        actualQuantity: 300,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(60);
      expect(result.actualQuantity).toBe(300);
      expect(result.percentSource).toBe('quantity_derived');
      expect(result.notes).toContain('Quantity-derived progress: 300/500 m3 (60%)');
    });

    it('rounds quantity-derived percentages to 2 decimal places (233 / 500 = 46.6%)', () => {
      const factWithoutPct: FieldProgressItem = { ...baseFact, progress_percent: null };

      const result = normalizeProgress({
        fact: factWithoutPct,
        activity: baseActivity,
        actualQuantity: 233,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(46.6);
      expect(result.actualQuantity).toBe(233);
      expect(result.percentSource).toBe('quantity_derived');
    });
  });

  describe('Precedence — Quantity-Derived Over Reported Percentage', () => {
    it('prioritizes quantity-derived math over contradictory reported percentage', () => {
      const factWithContradictoryPct: FieldProgressItem = { ...baseFact, progress_percent: 40 };

      const result = normalizeProgress({
        fact: factWithContradictoryPct,
        activity: baseActivity,
        actualQuantity: 300,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(60); // 300/500 = 60%, NOT reported 40%
      expect(result.actualQuantity).toBe(300);
      expect(result.percentSource).toBe('quantity_derived');
    });
  });

  describe('Unit Compatibility Rules', () => {
    it('recognizes canonical unit variants as compatible (m3 vs m³)', () => {
      const actM3: Activity = { ...baseActivity, unit: 'm³' };

      expect(areUnitsCompatible('m3', 'm³')).toBe(true);

      const result = normalizeProgress({
        fact: { ...baseFact, progress_percent: null },
        activity: actM3,
        actualQuantity: 300,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(60);
      expect(result.percentSource).toBe('quantity_derived');
    });

    it('rejects incompatible units (m3 vs tonnes) and falls back to reported percentage', () => {
      const actTonnes: Activity = { ...baseActivity, unit: 'tonnes' };
      const factWithReportedPct: FieldProgressItem = { ...baseFact, progress_percent: 45 };

      expect(areUnitsCompatible('m3', 'tonnes')).toBe(false);

      const result = normalizeProgress({
        fact: factWithReportedPct,
        activity: actTonnes,
        actualQuantity: 300,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      // Quantity math skipped due to incompatible units, falls back to reported 45%
      expect(result.actualPercent).toBe(45);
      expect(result.actualQuantity).toBe(300);
      expect(result.percentSource).toBe('reported_percent');
      expect(result.notes).toContain('Incompatible units');
    });
  });

  describe('Quantity Overrun Capping', () => {
    it('caps percentage at 100% when actualQuantity exceeds plannedQuantity while preserving quantity and note', () => {
      const factWithoutPct: FieldProgressItem = { ...baseFact, progress_percent: null };

      const result = normalizeProgress({
        fact: factWithoutPct,
        activity: baseActivity,
        actualQuantity: 550,
        quantityUnit: 'm3',
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(100);
      expect(result.actualQuantity).toBe(550);
      expect(result.percentSource).toBe('quantity_derived');
      expect(result.status).toBe('completed');
      expect(result.notes).toContain('exceeded 100%; actual percent was capped at 100');
    });
  });

  describe('Status Normalization & Fallbacks', () => {
    it('falls back to 100% for completed status when no percentage or quantity is provided', () => {
      const actWithoutQty: Activity = { ...baseActivity, plannedQuantity: null, unit: null };
      const factCompleted: FieldProgressItem = {
        reference: 'Concrete Pouring',
        location: 'Block B',
        progress_percent: null,
        status: 'completed'
      };

      const result = normalizeProgress({
        fact: factCompleted,
        activity: actWithoutQty,
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBe(100);
      expect(result.percentSource).toBe('completed_status');
      expect(result.status).toBe('completed');
      expect(result.actualFinish).toBe('2026-08-26');
    });

    it('returns null percentage when progress is unavailable (e.g. in_progress with no quantities/percentages)', () => {
      const actWithoutQty: Activity = { ...baseActivity, plannedQuantity: null, unit: null };
      const factInProgress: FieldProgressItem = {
        reference: 'Concrete Pouring',
        location: 'Block B',
        progress_percent: null,
        status: 'in_progress'
      };

      const result = normalizeProgress({
        fact: factInProgress,
        activity: actWithoutQty,
        asOfDate: '2026-08-26'
      });

      expect(result.actualPercent).toBeNull();
      expect(result.percentSource).toBe('unavailable');
      expect(result.status).toBe('in_progress');
    });

    it('maps all Pass 8 extraction statuses deterministically', () => {
      expect(mapExtractionStatus('not_started', null, null)).toBe('not_started');
      expect(mapExtractionStatus('in_progress', null, null)).toBe('in_progress');
      expect(mapExtractionStatus('completed', null, null)).toBe('completed');
      expect(mapExtractionStatus('delayed', null, null)).toBe('delayed');
      expect(mapExtractionStatus('unknown', 100, null)).toBe('completed');
      expect(mapExtractionStatus('unknown', 50, null)).toBe('in_progress');
      expect(mapExtractionStatus('unknown', 0, 0)).toBe('not_started');
    });
  });

  describe('Actual Start / Finish Dates', () => {
    it('sets actualStart on in_progress status and null actualFinish', () => {
      const result = normalizeProgress({
        fact: { ...baseFact, progress_percent: 50, status: 'in_progress' },
        activity: baseActivity,
        asOfDate: '2026-08-20'
      });

      expect(result.actualStart).toBe('2026-08-20');
      expect(result.actualFinish).toBeNull();
    });

    it('sets actualFinish on completed status', () => {
      const result = normalizeProgress({
        fact: { ...baseFact, progress_percent: 100, status: 'completed' },
        activity: baseActivity,
        asOfDate: '2026-08-26'
      });

      expect(result.actualFinish).toBe('2026-08-26');
    });
  });
});
