import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests del vertical gasolineras tras extraerlo a src/routes/gasolineras.ts
// (B1). ASSETS 404 -> sin snapshot: las paginas SEO por provincia siguen
// renderizando (degradan sin stats) y las de municipio dan 404 (no resuelven el
// municipio). El caso /gasolineras/mapa -> 200 valida el ORDEN critico: si se
// registrara despues de /gasolineras/:slug, "mapa" se tomaria como slug de
// provincia y daria 404.

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas /gasolineras/* tras extraer a src/routes/gasolineras.ts (B1)', () => {
  it('/gasolineras (sin barra) redirige 301 a /gasolineras/', async () => {
    const res = await app.request('/gasolineras', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/gasolineras/')
  })

  it('/gasolineras/ responde 200 HTML (buscador)', async () => {
    const res = await app.request('/gasolineras/', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/gasolineras/?action=... redirige 301 al mapa (compat PWA vieja)', async () => {
    const res = await app.request('/gasolineras/?action=cerca', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/gasolineras/mapa?action=cerca')
  })

  it('/gasolineras/mapa responde 200 HTML (orden ANTES de :slug)', async () => {
    const res = await app.request('/gasolineras/mapa', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/api/gasolineras/municipios avisa del fallo sin cachear una lista vacía', async () => {
    const res = await app.request('/api/gasolineras/municipios', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'municipios_unavailable' })
  })

  it('muestra la fecha que corresponde a los precios precomputados, aunque no sea hoy', async () => {
    const data = {
      v: 1, fechaMinisterio: '01/11/2026 8:58:14', provinciaCounts: { '28': 1 },
      nacionalStats: { stationCount: 1, stats: { '95': { min: 1.4, max: 1.6, avg: 1.5, count: 1 } } },
    }
    const res = await app.request('/gasolineras/', {}, { ASSETS: { fetch: async () => Response.json(data) } })
    const html = await res.text()
    expect(html).toContain('01/11/2026 8:58:14 (hora peninsular)')
    expect(html).not.toContain('combustible hoy')
  })

  it('/gasolineras/:slug -> 200 con provincia valida (SEO, degradada sin datos)', async () => {
    const res = await app.request('/gasolineras/madrid', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
  })

  it('/gasolineras/:slug -> 404 con slug de provincia inventado', async () => {
    const res = await app.request('/gasolineras/atlantida', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it('/gasolineras/:prov/:mun -> 404 sin datos (no resuelve el municipio)', async () => {
    const res = await app.request('/gasolineras/madrid/getafe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })
})
