import { defineConfig } from 'vitest/config';

// Интеграционные и e2e-тесты используют Testcontainers (Docker).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    // Декораторы (class-transformer, DI Nest) читают метаданные через Reflect.
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.integration-spec.ts', 'test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
