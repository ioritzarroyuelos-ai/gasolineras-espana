import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests del vertical ITV tras extraerlo a src/routes/itv.ts (B1).
// Mismo enfoque que routes-tiempo: ASSETS falso via 3er arg de app.request y
// reimport por test para caches limpias. Con ASSETS 404, parseItv(null) -> []
// y las paginas con datos degradan a 404 (igual que en prod sin itv.json), lo
// que basta para fijar el matching de rutas y el orden (/itv/precios antes de
// /itv/:prov).

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas /itv/* tras extraer a src/routes/itv.ts (B1)', () => {
  it('/itv (sin barra) redirige 301 a /itv/', async () => {
    const res = await app.request('/itv', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/itv/')
  })

  it('/itv/precios responde 200 HTML (pagina estatica, sin datos)', async () => {
    const res = await app.request('/itv/precios', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/api/itv/municipios responde 200 con JSON array', async () => {
    const res = await app.request('/api/itv/municipios', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('/itv/ -> 404 cuando no hay estaciones (itv.json ausente)', async () => {
    const res = await app.request('/itv/', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it('/itv/:prov -> 404 si la provincia no existe', async () => {
    const res = await app.request('/itv/provincia-que-no-existe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it('/itv/:prov/:mun -> 404 si no hay datos', async () => {
    const res = await app.request('/itv/madrid/getafe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })
})
