/**
 * Database schema configuration for FieldLine.
 * Authoritative schema evolution is driven by the migration engine in ./migrator.ts.
 */

export const SCHEMA_VERSION = '0.2.0';

export const CORE_TABLES = [
  'system_metadata',
  'schema_migrations',
  'projects',
  'schedules',
  'activities',
  'progress_updates',
  'evidence',
  'activity_matches',
  'activity_progress',
  'project_events'
] as const;

export type CoreTableName = (typeof CORE_TABLES)[number];
