import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    // Декораторы (class-transformer, DI Nest) читают метаданные через Reflect.
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts'],
  },
});
