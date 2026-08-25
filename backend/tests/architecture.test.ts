import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function getFilesRecursively(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Architectural Boundary Enforcement', () => {
  const srcRoot = path.resolve(__dirname, '../src');

  it('services must not import express or depend on HTTP objects', () => {
    const servicesFiles = getFilesRecursively(path.join(srcRoot, 'services'));

    for (const file of servicesFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]express['"]/);
      expect(content).not.toMatch(/Request,\s*Response/);
    }
  });

  it('services must not import better-sqlite3 directly or depend on SQLite handles', () => {
    const servicesFiles = getFilesRecursively(path.join(srcRoot, 'services'));

    for (const file of servicesFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"]better-sqlite3['"]/);
      expect(content).not.toMatch(/from\s+['"].*database\/db(\.js)?['"]/);
    }
  });

  it('services must not contain direct raw SQL statements', () => {
    const servicesFiles = getFilesRecursively(path.join(srcRoot, 'services'));

    for (const file of servicesFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/SELECT\s+/i);
      expect(content).not.toMatch(/INSERT\s+INTO/i);
      expect(content).not.toMatch(/UPDATE\s+/i);
      expect(content).not.toMatch(/DELETE\s+FROM/i);
    }
  });

  it('routes must not contain direct raw SQL statements or import database directly', () => {
    const routesFiles = getFilesRecursively(path.join(srcRoot, 'routes'));

    for (const file of routesFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/from\s+['"].*database\/db(\.js)?['"]/);
      expect(content).not.toMatch(/SELECT\s+/i);
      expect(content).not.toMatch(/INSERT\s+INTO/i);
    }
  });

  it('AI layer must NOT import SQLite, database, or repository modules', () => {
    const aiFiles = getFilesRecursively(path.join(srcRoot, 'ai'));

    for (const file of aiFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      expect(content).not.toMatch(/better-sqlite3/);
      expect(content).not.toMatch(/from\s+['"].*database/);
      expect(content).not.toMatch(/from\s+['"].*repositories/);
      expect(content).not.toMatch(/SELECT\s+/i);
      expect(content).not.toMatch(/INSERT\s+INTO/i);
    }
  });
});
