import { describe, it, expect } from 'vitest';
import {
  fieldProgressExtractionSchema,
  fieldProgressItemSchema,
  fieldProgressStatusEnum
} from '../src/ai/contracts/field-progress-extraction.contract.js';

describe('FieldProgressExtraction Contract Schema Validation', () => {
  it('should validate a complete and valid extraction payload', () => {
    const validPayload = {
      items: [
        {
          reference: 'Foundation concrete pouring',
          location: 'Block B - Grid 4',
          progress_percent: 65,
          status: 'in_progress'
        },
        {
          reference: 'Excavation of trench',
          location: null,
          progress_percent: null,
          status: 'not_started'
        }
      ]
    };

    const parsed = fieldProgressExtractionSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(2);
      expect(parsed.data.items[0].reference).toBe('Foundation concrete pouring');
      expect(parsed.data.items[0].location).toBe('Block B - Grid 4');
      expect(parsed.data.items[0].progress_percent).toBe(65);
      expect(parsed.data.items[0].status).toBe('in_progress');
      expect(parsed.data.items[1].location).toBeNull();
      expect(parsed.data.items[1].progress_percent).toBeNull();
      expect(parsed.data.items[1].status).toBe('not_started');
    }
  });

  it('should allow an empty items array', () => {
    const emptyPayload = { items: [] };
    const parsed = fieldProgressExtractionSchema.safeParse(emptyPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toEqual([]);
    }
  });

  it('should allow up to the maximum bound of 20 items', () => {
    const twentyItems = Array.from({ length: 20 }, (_, i) => ({
      reference: `Work package item ${i + 1}`,
      location: `Zone ${i + 1}`,
      progress_percent: i * 5,
      status: 'in_progress' as const
    }));

    const parsed = fieldProgressExtractionSchema.safeParse({ items: twentyItems });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(20);
    }
  });

  it('should reject extractions containing more than 20 items', () => {
    const twentyOneItems = Array.from({ length: 21 }, (_, i) => ({
      reference: `Work package item ${i + 1}`,
      location: `Zone ${i + 1}`,
      progress_percent: 50,
      status: 'in_progress' as const
    }));

    const parsed = fieldProgressExtractionSchema.safeParse({ items: twentyOneItems });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/cannot exceed 20/i);
    }
  });

  it('should accept boundary values for progress_percent (0, 100, floats, null)', () => {
    const boundaries = [0, 100, 0.5, 99.99, null];

    for (const val of boundaries) {
      const parsed = fieldProgressItemSchema.safeParse({
        reference: 'Test reference',
        location: null,
        progress_percent: val,
        status: 'in_progress'
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('should reject progress_percent less than 0', () => {
    const parsed = fieldProgressItemSchema.safeParse({
      reference: 'Excavation',
      location: 'Site A',
      progress_percent: -1,
      status: 'in_progress'
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('at least 0'))).toBe(true);
    }
  });

  it('should reject progress_percent greater than 100', () => {
    const parsed = fieldProgressItemSchema.safeParse({
      reference: 'Excavation',
      location: 'Site A',
      progress_percent: 100.1,
      status: 'in_progress'
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.message.includes('not exceed 100'))).toBe(true);
    }
  });

  it('should accept all valid status enum values and reject invalid statuses', () => {
    const validStatuses = ['unknown', 'not_started', 'in_progress', 'completed', 'delayed'] as const;

    for (const status of validStatuses) {
      const parsed = fieldProgressItemSchema.safeParse({
        reference: 'Test activity',
        location: null,
        progress_percent: null,
        status
      });
      expect(parsed.success).toBe(true);
    }

    const invalidStatuses = ['finished', 'ongoing', 'IN_PROGRESS', 'pending', '', 123, null];
    for (const status of invalidStatuses) {
      const parsed = fieldProgressItemSchema.safeParse({
        reference: 'Test activity',
        location: null,
        progress_percent: null,
        status
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('should reject missing or empty reference', () => {
    // Missing reference
    expect(
      fieldProgressItemSchema.safeParse({
        location: 'Block A',
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(false);

    // Empty string reference
    expect(
      fieldProgressItemSchema.safeParse({
        reference: '',
        location: 'Block A',
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(false);

    // Whitespace only reference
    expect(
      fieldProgressItemSchema.safeParse({
        reference: '   ',
        location: 'Block A',
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(false);
  });

  it('should reject overlong reference (> 200 characters)', () => {
    const overlongRef = 'A'.repeat(201);
    const validRef = 'A'.repeat(200);

    expect(
      fieldProgressItemSchema.safeParse({
        reference: overlongRef,
        location: null,
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(false);

    expect(
      fieldProgressItemSchema.safeParse({
        reference: validRef,
        location: null,
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(true);
  });

  it('should reject overlong location (> 200 characters)', () => {
    const overlongLoc = 'B'.repeat(201);
    const validLoc = 'B'.repeat(200);

    expect(
      fieldProgressItemSchema.safeParse({
        reference: 'Bridge Pier',
        location: overlongLoc,
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(false);

    expect(
      fieldProgressItemSchema.safeParse({
        reference: 'Bridge Pier',
        location: validLoc,
        progress_percent: 50,
        status: 'in_progress'
      }).success
    ).toBe(true);
  });

  it('should accept null for location and progress_percent', () => {
    const minimalItem = {
      reference: 'Excavation work',
      location: null,
      progress_percent: null,
      status: 'in_progress' as const
    };

    const parsed = fieldProgressItemSchema.safeParse(minimalItem);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reference).toBe('Excavation work');
      expect(parsed.data.location).toBeNull();
      expect(parsed.data.progress_percent).toBeNull();
      expect(parsed.data.status).toBe('in_progress');
    }
  });

  it('should strictly reject unexpected extra fields on items and root', () => {
    // Extra field on item
    const extraOnItem = {
      items: [
        {
          reference: 'Foundation work',
          location: 'Block B',
          progress_percent: 60,
          status: 'in_progress',
          extraField: 'unauthorized data'
        }
      ]
    };
    expect(fieldProgressExtractionSchema.safeParse(extraOnItem).success).toBe(false);

    // Extra field on root
    const extraOnRoot = {
      items: [],
      metadata: { aiConfidence: 0.99 }
    };
    expect(fieldProgressExtractionSchema.safeParse(extraOnRoot).success).toBe(false);
  });
});
