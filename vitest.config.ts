// Config de Vitest. Separamos los tests unitarios (tests/*.test.ts) de los
// E2E Playwright (tests/e2e/**) — Vitest no debe intentar correr los E2E
// (usan el runner de Playwright con su propio config).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
  },
})
