import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests de telemetría/admin tras extraer a src/routes/admin.ts (B1).
// Sin CRON_TOKEN las rutas /api/admin/* dan 503 (authorizeCron); las públicas
// responden sin 500. Prueban matching + el gate de autorización.
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas telemetría/admin tras extraer a src/routes/admin.ts (B1)', () => {
  it('GET /api/admin/errors -> 503 sin CRON_TOKEN (authorizeCron)', async () => {
    const res = await app.request('/api/admin/errors', {}, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/admin/errors/ack -> 503 sin CRON_TOKEN', async () => {
    const res = await app.request('/api/admin/errors/ack', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBe(503)
  })

  it('GET /api/admin/reports -> 503 sin CRON_TOKEN', async () => {
    const res = await app.request('/api/admin/reports', {}, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/csp-report -> registrada (< 500)', async () => {
    const res = await app.request('/api/csp-report', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBeLessThan(500)
  })

  it('POST /api/vitals -> registrada (< 500)', async () => {
    const res = await app.request('/api/vitals', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBeLessThan(500)
  })

  it('POST /api/reports/price -> registrada (< 500 / 503 sin DB)', async () => {
    const res = await app.request('/api/reports/price', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBeLessThan(500)
  })
})
