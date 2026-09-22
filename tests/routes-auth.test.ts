import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests de auth tras extraerlo a src/routes/auth.ts (B1). Sin secretos
// en el env (SESSION_SECRET/GOOGLE_CLIENT_ID/USER_DATA ausentes) verificamos la
// degradacion documentada: 503 sin config, 401 sin sesion, {user:null} en /api/me.

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas /api/auth y /api/sync tras extraer a src/routes/auth.ts (B1)', () => {
  it('POST /api/auth/google -> 503 sin GOOGLE_CLIENT_ID/SESSION_SECRET', async () => {
    const res = await app.request('/api/auth/google', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/auth/logout -> 200 y limpia cookie', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' }, {})
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') || '').not.toBe('')
  })

  it('GET /api/me -> 200 {user:null} sin sesion', async () => {
    const res = await app.request('/api/me', {}, {})
    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({ user: null })
  })

  it('GET /api/sync -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync', {}, {})
    expect(res.status).toBe(401)
  })

  it('PUT /api/sync/:key -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync/gs_favs_v1', { method: 'PUT', body: '[]' }, {})
    expect(res.status).toBe(401)
  })

  it('DELETE /api/sync/:key -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync/gs_favs_v1', { method: 'DELETE' }, {})
    expect(res.status).toBe(401)
  })
})
