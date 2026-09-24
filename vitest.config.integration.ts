import { defineConfig } from 'vitest/config';

// Integration tests use Testcontainers (Docker) and are added in M4.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    // Decorators (class-transformer, Nest DI) read metadata via Reflect.
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.integration-spec.ts'],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
