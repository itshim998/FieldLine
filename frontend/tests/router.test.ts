import { describe, it, expect } from 'vitest';
import { parseRoute, buildUrl, isValidTab, RouteState } from '../src/router.js';

describe('FieldLine Router & History Navigation', () => {
  describe('isValidTab', () => {
    it('should recognize all valid workspace tabs', () => {
      expect(isValidTab('overview')).toBe(true);
      expect(isValidTab('schedules')).toBe(true);
      expect(isValidTab('progress')).toBe(true);
      expect(isValidTab('evidence')).toBe(true);
      expect(isValidTab('intelligence')).toBe(true);
      expect(isValidTab('activity-detail')).toBe(true);
    });

    it('should reject invalid tabs', () => {
      expect(isValidTab('settings')).toBe(false);
      expect(isValidTab('unknown')).toBe(false);
      expect(isValidTab('')).toBe(false);
    });
  });

  describe('parseRoute', () => {
    it('should parse root path as all projects view', () => {
      const route = parseRoute('/', '', '');
      expect(route).toEqual({
        projectId: null,
        tab: 'overview',
        activityId: null
      });
    });

    it('should parse project overview route', () => {
      const route = parseRoute('/projects/proj-123', '', '');
      expect(route).toEqual({
        projectId: 'proj-123',
        tab: 'overview',
        activityId: null
      });
    });

    it('should parse project workspace tabs', () => {
      expect(parseRoute('/projects/proj-123/schedules', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'schedules',
        activityId: null
      });

      expect(parseRoute('/projects/proj-123/progress', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'progress',
        activityId: null
      });

      expect(parseRoute('/projects/proj-123/evidence', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'evidence',
        activityId: null
      });

      expect(parseRoute('/projects/proj-123/intelligence', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'intelligence',
        activityId: null
      });
    });

    it('should parse activity detail route', () => {
      expect(parseRoute('/projects/proj-123/activities/act-456', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'activity-detail',
        activityId: 'act-456'
      });

      expect(parseRoute('/projects/proj-123/activity/act-789', '', '')).toEqual({
        projectId: 'proj-123',
        tab: 'activity-detail',
        activityId: 'act-789'
      });
    });

    it('should handle URL encoded project IDs and activity IDs', () => {
      expect(parseRoute('/projects/proj%20123/activities/act%20456', '', '')).toEqual({
        projectId: 'proj 123',
        tab: 'activity-detail',
        activityId: 'act 456'
      });
    });

    it('should parse hash-based fallback URLs', () => {
      expect(parseRoute('/', '#/projects/proj-abc/evidence', '')).toEqual({
        projectId: 'proj-abc',
        tab: 'evidence',
        activityId: null
      });

      expect(parseRoute('/', '#/projects/proj-abc/activities/act-xyz', '')).toEqual({
        projectId: 'proj-abc',
        tab: 'activity-detail',
        activityId: 'act-xyz'
      });
    });

    it('should parse query parameters fallback', () => {
      expect(parseRoute('/', '', '?projectId=proj-999&tab=intelligence')).toEqual({
        projectId: 'proj-999',
        tab: 'intelligence',
        activityId: null
      });

      expect(parseRoute('/', '', '?projectId=proj-999&activityId=act-999')).toEqual({
        projectId: 'proj-999',
        tab: 'activity-detail',
        activityId: 'act-999'
      });
    });
  });

  describe('buildUrl', () => {
    it('should build root URL for null project', () => {
      expect(buildUrl({ projectId: null, tab: 'overview' })).toBe('/');
    });

    it('should build overview URL for project', () => {
      expect(buildUrl({ projectId: 'proj-123', tab: 'overview' })).toBe('/projects/proj-123');
    });

    it('should build tab URLs for project', () => {
      expect(buildUrl({ projectId: 'proj-123', tab: 'schedules' })).toBe('/projects/proj-123/schedules');
      expect(buildUrl({ projectId: 'proj-123', tab: 'progress' })).toBe('/projects/proj-123/progress');
      expect(buildUrl({ projectId: 'proj-123', tab: 'evidence' })).toBe('/projects/proj-123/evidence');
      expect(buildUrl({ projectId: 'proj-123', tab: 'intelligence' })).toBe('/projects/proj-123/intelligence');
    });

    it('should build activity detail URL with activityId', () => {
      expect(
        buildUrl({
          projectId: 'proj-123',
          tab: 'activity-detail',
          activityId: 'act-456'
        })
      ).toBe('/projects/proj-123/activities/act-456');
    });

    it('should properly encode special characters in URLs', () => {
      expect(
        buildUrl({
          projectId: 'proj 123/special',
          tab: 'activity-detail',
          activityId: 'act 456/detail'
        })
      ).toBe('/projects/proj%20123%2Fspecial/activities/act%20456%2Fdetail');
    });
  });
});
