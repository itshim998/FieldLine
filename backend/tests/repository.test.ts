import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase } from '../src/database/db.js';
import { SqliteSystemRepository } from '../src/repositories/system.repository.js';

describe('SqliteSystemRepository', () => {
  beforeEach(() => {
    closeDatabase();
    initDatabase({ dbPath: ':memory:' });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should verify database is healthy when SQLite connection is active', () => {
    const repo = new SqliteSystemRepository();
    expect(repo.isHealthy()).toBe(true);
  });

  it('should retrieve all system metadata from database', () => {
    const repo = new SqliteSystemRepository();
    const metadata = repo.getAllMetadata();

    expect(metadata).toBeDefined();
    expect(metadata.app_name).toBe('FieldLine');
    expect(metadata.sih_ps_id).toBe('SIH26122');
    expect(metadata.schema_version).toBe('0.1.0');
  });

  it('should get and set individual metadata keys deterministically', () => {
    const repo = new SqliteSystemRepository();

    expect(repo.getMetadata('non_existent_key')).toBeNull();

    repo.setMetadata('custom_test_key', 'custom_test_value');
    expect(repo.getMetadata('custom_test_key')).toBe('custom_test_value');

    // Update existing key
    repo.setMetadata('custom_test_key', 'updated_value');
    expect(repo.getMetadata('custom_test_key')).toBe('updated_value');
  });

  it('should handle broken database connection gracefully in isHealthy and getAllMetadata', () => {
    // Repository pointing to a broken/closed db provider
    const brokenRepo = new SqliteSystemRepository(() => {
      throw new Error('Database connection failed');
    });

    expect(brokenRepo.isHealthy()).toBe(false);
    expect(brokenRepo.getAllMetadata()).toEqual({});
    expect(brokenRepo.getMetadata('app_name')).toBeNull();
  });
});
