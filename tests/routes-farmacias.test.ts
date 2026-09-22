import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests del vertical farmacias/guardias tras extraerlo a
// src/routes/farmacias.ts (B1). ASSETS 404 -> loadSnapshot null; las paginas con
// datos degradan a 404 y los indices salen vacios, suficiente para fijar el
// matching y el orden critico (/farmacias/guardia antes de /farmacias/:prov).

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas /farmacias/* tras extraer a src/routes/farmacias.ts (B1)', () => {
  it('/farmacias (sin barra) redirige 301 a /farmacias/', async () => {
    const res = await app.request('/farmacias', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/farmacias/')
  })

  it('/farmacias/ responde 200 HTML (buscador)', async () => {
    const res = await app.request('/farmacias/', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/farmacias/guardia responde 200 HTML (indice de provincias, sin snapshot)', async () => {
    const res = await app.request('/farmacias/guardia', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/api/guardias/municipios responde 200 con JSON array', async () => {
    const res = await app.request('/api/guardias/municipios', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('/farmacias/:prov -> 404 si la provincia no existe', async () => {
    const res = await app.request('/farmacias/provincia-que-no-existe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it('/farmacias/:prov/:mun -> 404 sin datos de guardia', async () => {
    const res = await app.request('/farmacias/madrid/getafe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })
})
