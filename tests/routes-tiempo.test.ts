import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'

// Tests de endpoint del vertical "tiempo" tras extraerlo a src/routes/tiempo.ts
// (B1). Fijan que las rutas siguen resolviendo (matching + status) EXACTAMENTE
// igual que cuando estaban inline en index.tsx. No dependen de red: inyectamos un
// ASSETS falso via el 3er argumento de app.request(path, init, env), que es lo
// que consume loadSnapshot.
//
// Los indices del tiempo se cachean en memoria (TTL 30 min) a nivel de modulo, asi
// que reimportamos el app en cada test (vi.resetModules) para que cada caso arranque
// con las caches vacias — sin esto, un test contaminaria al siguiente.

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

// ASSETS falso: sirve JSON para los paths cuyo sufijo casa; 404 para el resto
// (loadSnapshot devuelve null y la ruta degrada, igual que en prod sin datos).
function assetsReturning(bodyByPath: Record<string, unknown>) {
  return {
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname
      for (const key of Object.keys(bodyByPath)) {
        if (path.endsWith(key)) {
          return new Response(JSON.stringify(bodyByPath[key]), {
            status: 200, headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(null, { status: 404 })
    },
  }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

const MADRID: MunicipioLista = {
  ine: '28079', nombre: 'Madrid', provinciaId: '28', provinciaSlug: 'madrid',
  provinciaNombre: 'Madrid', slug: 'madrid', lat: 40.4168, lng: -3.7038, pob: 3000000, imp: true,
}

describe('rutas /tiempo/* tras extraer a src/routes/tiempo.ts (B1)', () => {
  it('/tiempo (sin barra) redirige 301 a /tiempo/', async () => {
    const res = await app.request('/tiempo', {}, { ASSETS: assetsReturning({}) })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/tiempo/')
  })

  it('/tiempo?foo=1 conserva el query en la redireccion 301', async () => {
    const res = await app.request('/tiempo?foo=1', {}, { ASSETS: assetsReturning({}) })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/tiempo/?foo=1')
  })

  it('/tiempo/ responde 200 HTML (indice) aun sin datos', async () => {
    const res = await app.request('/tiempo/', {}, { ASSETS: assetsReturning({}) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/api/tiempo/municipios responde 200 con JSON array', async () => {
    const res = await app.request('/api/tiempo/municipios', {}, { ASSETS: assetsReturning({}) })
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('/tiempo/:prov -> 404 si la provincia no existe en los datos', async () => {
    const res = await app.request('/tiempo/provincia-que-no-existe', {}, { ASSETS: assetsReturning({}) })
    expect(res.status).toBe(404)
  })

  it('/tiempo/:prov -> 200 cuando hay municipios de esa provincia', async () => {
    const env = { ASSETS: assetsReturning({ 'tiempo/municipios.json': { municipios: [MADRID] } }) }
    const res = await app.request('/tiempo/madrid', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/tiempo/:prov/:mun -> 404 si el municipio no esta en la provincia', async () => {
    const env = { ASSETS: assetsReturning({ 'tiempo/municipios.json': { municipios: [MADRID] } }) }
    const res = await app.request('/tiempo/madrid/municipio-inexistente', {}, env)
    expect(res.status).toBe(404)
  })
})
