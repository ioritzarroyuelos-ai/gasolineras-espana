import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Las rutas distinguen un municipio real sin turno de un nombre inexistente
// y de una caída temporal de los datos.

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

  it('el buscador puede reintentar si no estuvo disponible ninguna fuente', async () => {
    const res = await app.request('/api/guardias/municipios', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual([])
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
    expect(data.map(m => m.u)).toEqual(['/farmacias/cuenca/cuenca', '/farmacias/lugo', '/farmacias/madrid/madrid', '/farmacias/toledo/toledo'])
  })

  it('/farmacias/:prov -> 404 si la provincia no existe', async () => {
    const res = await app.request('/farmacias/provincia-que-no-existe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it('una caída del directorio tiene salida oficial y se puede reintentar', async () => {
    const res = await app.request('/farmacias/madrid/getafe', {}, { ASSETS: assets404() })
    expect(res.status).toBe(503)
    const html = await res.text()
    expect(html).toContain('Ahora no podemos comprobar los turnos')
    expect(html).toContain('https://www.cofm.es/es/buscador-de-farmacias/')
  })

  const catalogo = [
    { ine: '28026', nombre: 'Brunete', provinciaNombre: 'Madrid' },
    { ine: '28127', nombre: 'Rozas de Madrid, Las', provinciaNombre: 'Madrid' },
    { ine: '27028', nombre: 'Lugo', provinciaNombre: 'Lugo' },
  ]
  function sitio() {
    return { ASSETS: { fetch: async (req: Request) => {
      const ruta = new URL(req.url).pathname
      if (ruta === '/data/localidades-index.json') return Response.json(catalogo)
      if (ruta === '/data/localidades/28.json') return Response.json(catalogo.slice(0, 2))
      if (ruta === '/data/guardias-madrid.json') return Response.json({ territorio: 'madrid', source: 'cofm.es',
        ts: new Date().toISOString(), guardias: [[0, 0, 'Calle de prueba', 'Las Rozas', '', '', '', ''],
          [0, 0, 'Calle de ejemplo', 'Barrio del Colegio', '', '', '', '']] })
      return new Response(null, { status: 404 })
    } } }
  }

  it('un municipio real sin turno mantiene la página con colegio y provincia; un nombre inventado sigue dando 404', async () => {
    const resp = await app.request('/farmacias/madrid/brunete', {}, sitio())
    expect(resp.status).toBe(200)
    expect(resp.headers.get('X-Robots-Tag')).toContain('noindex')
    const html = await resp.text()
    expect(html).toContain('Hoy no tenemos un turno confirmado en Brunete')
    expect(html).toContain('href="/farmacias/madrid"')
    expect(html).toContain('https://www.cofm.es/es/buscador-de-farmacias/')
    expect(html).not.toContain('class="g-card"')
    expect((await app.request('/farmacias/madrid/no-existe', {}, sitio())).status).toBe(404)
    const siguiente = await app.request('/farmacias/madrid/rozas-de-madrid-las?turno=ahora', {}, sitio())
    expect(siguiente.headers.get('location')).toBe('/farmacias/madrid/las-rozas?turno=ahora')
  })

  it('la búsqueda sin JavaScript encuentra municipios y ofrece una salida si el nombre no existe', async () => {
    const lugar = await app.request('/farmacias/buscar?q=Brunete', {}, sitio())
    expect(lugar.headers.get('location')).toBe('/farmacias/madrid/brunete')
    const barrio = await app.request('/farmacias/buscar?q=Barrio+del+Colegio', {}, sitio())
    expect(barrio.headers.get('location')).toBe('/farmacias/madrid/barrio-del-colegio')
    const vacia = await app.request('/farmacias/buscar?q=pueblo-inventado', {}, sitio())
    expect(vacia.status).toBe(200)
    expect(await vacia.text()).toContain('Consultar por provincia')
    expect(vacia.headers.get('X-Robots-Tag')).toContain('noindex')
  })

  it('incluye Lugo en el directorio y enlaza al buscador de su colegio', async () => {
    const dir = await app.request('/farmacias/guardia', {}, sitio())
    expect(await dir.text()).toContain('href="/farmacias/lugo"')
    const lugo = await app.request('/farmacias/lugo', {}, sitio())
    expect(lugo.status).toBe(200)
    expect(await lugo.text()).toContain('https://www.coflugo.org/farmacia-guardia')
  })
})
