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

  it('el índice carga en paralelo con límite, comparte CLM y tolera una fuente caída', async () => {
    let activas = 0, maximas = 0
    const llamadas: string[] = []
    const ASSETS = { fetch: async (req: Request) => {
      const file = new URL(req.url).pathname.split('/').pop()!
      llamadas.push(file)
      maximas = Math.max(maximas, ++activas)
      try {
        await new Promise(resolve => setTimeout(resolve, 5))
        if (file === 'guardias-asturias.json') throw new Error('fuente no disponible')
        const territorio = file === 'guardias-clm.json' ? 'clm' : 'madrid'
        const guardias = file === 'guardias-clm.json'
          ? [[0, 0, 'Calle 1', 'Toledo', '', '', '', '', '45'], [0, 0, 'Calle 2', 'Cuenca', '', '', '', '', '16']]
          : file === 'guardias-madrid.json' ? [[0, 0, 'Calle 3', 'Madrid', '', '', '', '']] : null
        return guardias ? Response.json({ territorio, guardias, count: guardias.length }) : new Response(null, { status: 404 })
      } finally { activas-- }
    } }
    const res = await app.request('/api/guardias/municipios', {}, { ASSETS })
    const data = await res.json() as Array<{ n: string; p: string; u: string }>
    expect(res.status).toBe(200)
    expect(maximas).toBeGreaterThan(1)
    expect(maximas).toBeLessThanOrEqual(6)
    expect(llamadas).toHaveLength(47)
    expect(new Set(llamadas).size).toBe(47)
    expect(data.map(m => m.u)).toEqual(['/farmacias/cuenca/cuenca', '/farmacias/madrid/madrid', '/farmacias/toledo/toledo'])
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
