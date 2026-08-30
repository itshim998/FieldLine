import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      AI_PROVIDER: 'mock',
      NODE_ENV: 'test'
    },
    include: ['backend/tests/**/*.test.ts', 'frontend/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
