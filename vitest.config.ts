import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['frontend/tests/**', 'happy-dom']
    ],
    env: {
      AI_PROVIDER: 'mock',
      NODE_ENV: 'test'
    },
    include: ['backend/tests/**/*.test.ts', 'frontend/tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/']
    }
  }
});
