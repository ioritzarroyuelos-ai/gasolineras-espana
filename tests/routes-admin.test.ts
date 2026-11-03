import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import { localDB } from './helpers/sqlite.mjs'
import errorsSchema from '../migrations/0002_client_errors.sql?raw'
import enrichment from '../migrations/0004_client_errors_enrichment.sql?raw'

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
  it('reavisa errores recurrentes tras 24 h; no repite resueltos ni pierde errores durante el envío', async () => {
    const DB = localDB([errorsSchema, enrichment])
    const now = Date.now(), day = 86400_000
    DB.exec(`INSERT INTO client_errors(fingerprint,message,first_seen,last_seen,notified_at) VALUES
      ('a','nuevo',${now},${now},NULL),
      ('b','recurrente',${now-day*3},${now-1000},${now-day*2}),
      ('c','avisado hace poco',${now-day},${now-1000},${now-10000}),
      ('d','no reaparece',${now-day*3},${now-day*2},${now-day*2});`)
    const headers = { Authorization: 'Bearer prueba' }, env = { DB, CRON_TOKEN: 'prueba' }
    try {
      const response = await app.request('/api/admin/errors?unnotified=1', { headers }, env)
      expect(response.status).toBe(200)
      const body = await response.json() as { errors: { fingerprint: string }[]; ts: string }
      expect(body.errors.map(e => e.fingerprint).sort()).toEqual(['a', 'b'])
      const before = Date.parse(body.ts)
      DB.exec(`UPDATE client_errors SET last_seen=${before+1} WHERE fingerprint='b'`)
      const ack = await app.request(`/api/admin/errors/ack?fingerprints=a,b&before=${before}`, { method: 'POST', headers }, env)
      expect(ack.status).toBe(200)
      expect((await (await app.request('/api/admin/errors?unnotified=1', { headers }, env)).json() as { errors: unknown[] }).errors).toHaveLength(0)
      vi.spyOn(Date, 'now').mockReturnValue(before + day + 1)
      const next = await (await app.request('/api/admin/errors?unnotified=1', { headers }, env)).json() as { errors: { fingerprint: string }[] }
      expect(next.errors.map(e => e.fingerprint).sort()).toEqual(['b', 'c'])
    } finally { vi.restoreAllMocks(); DB.close() }
  })
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
