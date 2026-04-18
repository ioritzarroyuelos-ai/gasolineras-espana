// Config de Playwright para tests E2E + a11y (axe-core).
//
// Filosofia:
//   - Un unico navegador (chromium) porque el CSS critico ya se auditó por
//     Lighthouse en CI. Multinavegador no aporta señal aqui.
//   - webServer arranca wrangler pages dev automaticamente si no está corriendo.
//   - baseURL configurable por env para apuntar a staging si hace falta.
//   - reporter list+html local; solo list en CI.
//   - Trace + screenshot solo on-failure: evita gigas en artifacts del happy path.

import { defineConfig, devices } from '@playwright/test'

const PORT = 8788
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:' + PORT
const IS_CI = !!process.env.CI

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 1 : undefined,
  reporter: IS_CI ? [['list']] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Mas tolerante en CI runner (CPU compartido)
    actionTimeout: IS_CI ? 10_000 : 5_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Solo arrancamos el servidor si el usuario no lo levantó ya.
  // reuseExistingServer evita conflictos durante desarrollo local.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run build && npx wrangler pages dev --port=' + PORT + ' --ip=127.0.0.1 dist',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
