import { defineConfig } from 'vitest/config';

// Интеграционные тесты используют Testcontainers (Docker), основные — в M4.
export default defineConfig({
  test: {
    globals: true,
    root: './',
    // Декораторы (class-transformer, DI Nest) читают метаданные через Reflect.
    setupFiles: ['reflect-metadata'],
    include: ['test/**/*.integration-spec.ts'],
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
