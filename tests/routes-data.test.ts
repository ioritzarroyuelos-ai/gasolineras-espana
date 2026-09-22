import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests del core de datos tras dividir en src/routes/data.ts + history.ts (B1).
// Solo rutas SIN red (las que llaman a proxiedFetch pegarían al Ministerio real):
// /api/health (loadSnapshot mock), history/predict (503 sin DB), stats/national y
// export (degradan a 200 sin datos). Prueban matching + el orden data→history.
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('core de datos tras dividir en data.ts + history.ts (B1)', () => {
  it('GET /api/health responde (200 fresco / 503 stale) — registrada', async () => {
    const res = await app.request('/api/health', {}, { ASSETS: assets404() })
    expect([200, 503]).toContain(res.status)
  })

  it('GET /api/history/:stationId -> 503 sin DB', async () => {
    const res = await app.request('/api/history/12345', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
  })

  it('GET /api/history/province/:id -> < 500 (400 id inválido / 503 sin DB)', async () => {
    const res = await app.request('/api/history/province/28', {}, { ASSETS: assets404() })
    expect(res.status).toBeLessThan(500)
  })

  it('GET /api/stats/national -> 503 sin serie estática (registrada)', async () => {
    const res = await app.request('/api/stats/national', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
  })

  it('GET /api/predict/:stationId -> registrada (400 id inválido / 503 sin DB)', async () => {
    const res = await app.request('/api/predict/12345', {}, { ASSETS: assets404() })
    expect([400, 503]).toContain(res.status)
  })

  it('GET /api/export -> 503 sin snapshot (registrada)', async () => {
    const res = await app.request('/api/export', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
  })
})
