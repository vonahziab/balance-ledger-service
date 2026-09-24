import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    // Decorators (class-transformer, Nest DI) read metadata via Reflect.
    setupFiles: ['reflect-metadata'],
    include: ['src/**/*.spec.ts'],
  },
});
