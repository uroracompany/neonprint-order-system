import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    globals: true,
    css: true,
    testTimeout: 15_000,
    exclude: [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      '.opencode/deploy/**',
      '.opencode/runs/**',
      'e2e/**',
    ],
  },
})
