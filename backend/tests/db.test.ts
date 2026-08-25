import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, getDatabase, isDatabaseHealthy } from '../src/database/db.js';

describe('SQLite Database Layer', () => {
  beforeEach(() => {
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('should initialize an in-memory SQLite database with base schema', () => {
    const db = initDatabase({ dbPath: ':memory:' });
    expect(db).toBeDefined();
    expect(isDatabaseHealthy()).toBe(true);

    // Verify system_metadata table exists
    const row = db.prepare("SELECT value FROM system_metadata WHERE key = 'schema_version'").get() as { value: string };
    expect(row).toBeDefined();
    expect(row.value).toBe('0.1.0');
  });

  it('should support read and write operations deterministically', () => {
    const db = initDatabase({ dbPath: ':memory:' });

    db.prepare("INSERT INTO system_metadata (key, value) VALUES ('test_key', 'test_value')").run();

    const row = db.prepare("SELECT value FROM system_metadata WHERE key = 'test_key'").get() as { value: string };
    expect(row).toBeDefined();
    expect(row.value).toBe('test_value');
  });

  it('should reinitialize the database after close', () => {
    initDatabase({ dbPath: ':memory:' });
    expect(isDatabaseHealthy()).toBe(true);

    closeDatabase();
    // After closing, isDatabaseHealthy invokes getDatabase() which reinitializes a fresh database instance
    expect(isDatabaseHealthy()).toBe(true);
  });
});
