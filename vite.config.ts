import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5183 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
