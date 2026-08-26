import { describe, it, expect } from 'vitest';
import {
  matchHeaderToCanonicalField,
  validateHeaders,
  transformRowToCanonical,
  normalizeHeaderString
} from '../src/services/importer/headerMapper.js';
import { ValidationError } from '../src/errors/AppError.js';

describe('HeaderMapper and Aliases', () => {
  it('should normalize header strings reliably', () => {
    expect(normalizeHeaderString('  Activity_ID  ')).toBe('activity id');
    expect(normalizeHeaderString('Planned-Start-Date')).toBe('planned start date');
    expect(normalizeHeaderString('WBS   Code')).toBe('wbs code');
  });

  it('should match canonical field names and common aliases', () => {
    // Activity ID aliases
    expect(matchHeaderToCanonicalField('Activity ID')).toBe('externalId');
    expect(matchHeaderToCanonicalField('activityid')).toBe('externalId');
    expect(matchHeaderToCanonicalField('Task ID')).toBe('externalId');
    expect(matchHeaderToCanonicalField('Task_ID')).toBe('externalId');
    expect(matchHeaderToCanonicalField('Activity')).toBe('externalId');
    expect(matchHeaderToCanonicalField('Code')).toBe('externalId');

    // Name aliases
    expect(matchHeaderToCanonicalField('Activity Name')).toBe('name');
    expect(matchHeaderToCanonicalField('Task Name')).toBe('name');
    expect(matchHeaderToCanonicalField('Name')).toBe('name');
    expect(matchHeaderToCanonicalField('Title')).toBe('name');

    // Start / Finish aliases
    expect(matchHeaderToCanonicalField('Planned Start')).toBe('plannedStart');
    expect(matchHeaderToCanonicalField('Start Date')).toBe('plannedStart');
    expect(matchHeaderToCanonicalField('Start')).toBe('plannedStart');
    expect(matchHeaderToCanonicalField('Planned Finish')).toBe('plannedFinish');
    expect(matchHeaderToCanonicalField('Finish Date')).toBe('plannedFinish');
    expect(matchHeaderToCanonicalField('Finish')).toBe('plannedFinish');
    expect(matchHeaderToCanonicalField('End Date')).toBe('plannedFinish');

    // WBS / Location / Quantity / Unit
    expect(matchHeaderToCanonicalField('WBS Code')).toBe('wbsCode');
    expect(matchHeaderToCanonicalField('WBS')).toBe('wbsCode');
    expect(matchHeaderToCanonicalField('Location')).toBe('location');
    expect(matchHeaderToCanonicalField('Area')).toBe('location');
    expect(matchHeaderToCanonicalField('Qty')).toBe('plannedQuantity');
    expect(matchHeaderToCanonicalField('Planned Quantity')).toBe('plannedQuantity');
    expect(matchHeaderToCanonicalField('UOM')).toBe('unit');
    expect(matchHeaderToCanonicalField('Unit')).toBe('unit');
  });

  it('should validate and accept headers with all required fields', () => {
    const rawHeaders = ['Activity ID', 'Activity Name', 'Start Date', 'Finish Date', 'WBS', 'Qty'];
    const mapping = validateHeaders(rawHeaders);
    expect(mapping['Activity ID']).toBe('externalId');
    expect(mapping['Activity Name']).toBe('name');
    expect(mapping['Start Date']).toBe('plannedStart');
    expect(mapping['Finish Date']).toBe('plannedFinish');
    expect(mapping['WBS']).toBe('wbsCode');
    expect(mapping['Qty']).toBe('plannedQuantity');
  });

  it('should throw ValidationError when required headers are missing', () => {
    const rawHeaders = ['Activity ID', 'Description', 'Location'];
    expect(() => validateHeaders(rawHeaders)).toThrow(ValidationError);
    expect(() => validateHeaders(rawHeaders)).toThrow(/Missing required schedule column/);
  });

  it('should transform a valid row into CanonicalScheduleImportRow', () => {
    const headerToField = validateHeaders([
      'Task ID',
      'Task Name',
      'Description',
      'WBS Code',
      'Area',
      'Start Date',
      'Finish Date',
      'Qty',
      'UOM'
    ]);

    const rawRow = {
      'Task ID': 'ACT-001 ',
      'Task Name': ' Earthworks Excavation ',
      'Description': 'Excavation of site yard',
      'WBS Code': '1.1',
      'Area': 'Zone A',
      'Start Date': '2026-05-01',
      'Finish Date': '2026-05-15',
      'Qty': '1500.5',
      'UOM': 'm3'
    };

    const canonical = transformRowToCanonical(rawRow, headerToField, 2);
    expect(canonical).not.toBeNull();
    expect(canonical).toEqual({
      externalId: 'ACT-001',
      name: 'Earthworks Excavation',
      description: 'Excavation of site yard',
      wbsCode: '1.1',
      location: 'Zone A',
      plannedStart: '2026-05-01',
      plannedFinish: '2026-05-15',
      plannedQuantity: 1500.5,
      unit: 'm3'
    });
  });

  it('should throw ValidationError when a row is missing required values', () => {
    const headerToField = validateHeaders(['Activity ID', 'Activity Name', 'Start', 'Finish']);
    const badRow = {
      'Activity ID': '',
      'Activity Name': 'Some task',
      'Start': '2026-01-01',
      'Finish': '2026-01-10'
    };

    expect(() => transformRowToCanonical(badRow, headerToField, 5)).toThrow(ValidationError);
    expect(() => transformRowToCanonical(badRow, headerToField, 5)).toThrow(/Row 5: Missing required field/);
  });

  it('should transform numeric quantities or throw on unparseable format', () => {
    const headerToField = validateHeaders(['Activity ID', 'Activity Name', 'Start', 'Finish', 'Quantity']);
    const negQtyRow = {
      'Activity ID': 'A1',
      'Activity Name': 'Task 1',
      'Start': '2026-01-01',
      'Finish': '2026-01-10',
      'Quantity': '-50'
    };

    const res = transformRowToCanonical(negQtyRow, headerToField, 3);
    expect(res?.plannedQuantity).toBe(-50);

    const malformedRow = {
      'Activity ID': 'A1',
      'Activity Name': 'Task 1',
      'Start': '2026-01-01',
      'Finish': '2026-01-10',
      'Quantity': 'invalid_num'
    };
    expect(() => transformRowToCanonical(malformedRow, headerToField, 3)).toThrow();
  });
});
