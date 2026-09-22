import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests de la portada tras extraerla a src/routes/home.ts (B1). Con ASSETS
// 404 la portada degrada (sin datos frescos) pero renderiza 200; /?action redirige
// al mapa (compat PWA vieja). /precios-carburantes se verifica en prod (necesita
// observatorio.json para renderizar; sin datos da 404 legítimo).
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('portada / + /precios-carburantes tras extraer a src/routes/home.ts (B1)', () => {
  it('/ responde 200 HTML (degradada sin datos)', async () => {
    const res = await app.request('/', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/?action=cheapest redirige 301 al mapa (compat PWA vieja)', async () => {
    const res = await app.request('/?action=cheapest', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/gasolineras/mapa?action=cheapest')
  })

  it('/precios-carburantes está registrada (no cae al notFound genérico con 500)', async () => {
    const res = await app.request('/precios-carburantes', {}, { ASSETS: assets404() })
    expect(res.status).toBeLessThan(500)
  })
})
