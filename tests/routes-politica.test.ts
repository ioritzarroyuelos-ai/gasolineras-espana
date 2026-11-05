import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parse } from 'node-html-parser'
import type { Hono } from 'hono'

// Endpoint tests de la vertical de política. Simulamos el binding ASSETS para
// servir los JSON estáticos desde memoria (loadSnapshot hace ASSETS.fetch).
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

const index = {
  schemaVer: 1,
  generado: '2026-09-23T00:00:00Z',
  elecciones: [
    { id: 'generales', tipo: 'generales', nombre: 'Elecciones generales de España', fecha: { valor: null, confirmada: false }, estado: 'ok', ruta: '/data/politica/generales.json' },
    { id: 'madrid', tipo: 'autonomica', nombre: 'Elecciones a la Asamblea de Madrid', comunidad: 'Comunidad de Madrid', fecha: { valor: '2027-05-23', confirmada: false }, estado: 'ok', ruta: '/data/politica/autonomicas/madrid.json' },
    { id: 'europeas', tipo: 'europeas', nombre: 'Elecciones al Parlamento Europeo (España)', fecha: { valor: null, confirmada: false }, estado: 'sin_sondeos', ruta: '/data/politica/europeas.json' },
  ],
}
const madrid = {
  schemaVer: 1, id: 'madrid', tipo: 'autonomica', ciclo: '2023',
  camara: { nombre: 'Asamblea de Madrid', escanos: 143, mayoria: 72 },
  candidaturas: [{ id: 'pp', nombre: 'Partido Popular', siglas: 'PP' }, { id: 'psoe', nombre: 'PSOE', siglas: 'PSOE' }],
  referencia: { fecha: '2023-05-28', escanos: [{ candidaturaId: 'pp', escanos: 70 }, { candidaturaId: 'psoe', escanos: 27 }], fuente: 'Ministerio del Interior' },
  sondeos: [
    { empresa: 'Data10', comitente: 'Diario', campoInicio: '2026-06-11', campoFin: '2026-06-12', muestra: 1000, datos: [{ candidaturaId: 'pp', pct: 50.3, escanos: 73 }, { candidaturaId: 'psoe', pct: 18.4, escanos: 26 }] },
    { empresa: 'Data10', comitente: 'Diario', campoInicio: '2026-05-01', campoFin: '2026-05-03', datos: [{ candidaturaId: 'pp', pct: 48, escanos: { min: 70, max: 72 } }] },
  ],
  ultimaComprobacionOk: '2026-09-23T00:00:00Z',
  procedencia: { wiki: 'en', articulo: '2027 Madrilenian regional election', url: 'https://en.wikipedia.org/wiki/2027_Madrilenian_regional_election', revid: 123, licencia: 'CC BY-SA 4.0', obtenido: '2026-09-23T00:00:00Z' },
}
const generales = {
  schemaVer: 1, id: 'generales', tipo: 'generales', ciclo: '2023',
  camara: { nombre: 'Congreso de los Diputados', escanos: 350, mayoria: 176 },
  candidaturas: [{ id: 'pp', nombre: 'PP', siglas: 'PP' }],
  referencia: { fecha: '2023-07-23', escanos: [{ candidaturaId: 'pp', escanos: 137 }], fuente: 'Ministerio del Interior' },
  sondeos: [{ empresa: 'X', fechaTexto: '1-5 sep', campoFin: '2026-09-05', datos: [{ candidaturaId: 'pp', pct: 33, escanos: 140 }] }],
  ultimaComprobacionOk: '2026-09-23T00:00:00Z',
  procedencia: { wiki: 'es', articulo: 'Encuestas...', url: 'https://es.wikipedia.org/', licencia: 'CC BY-SA 4.0', obtenido: '2026-09-23T00:00:00Z' },
}

const MAPA: Record<string, unknown> = {
  '/data/politica/index.json': index,
  '/data/politica/generales.json': generales,
  '/data/politica/europeas.json': { ...generales, id: 'europeas', tipo: 'europeas', sondeos: [], referencia: { ...generales.referencia, escanos: [] } },
  '/data/politica/autonomicas/madrid.json': madrid,
}
const ASSETS = {
  fetch: async (req: Request) => {
    const p = new URL(req.url).pathname
    return p in MAPA ? new Response(JSON.stringify(MAPA[p]), { status: 200 }) : new Response('', { status: 404 })
  },
}
const env = { ASSETS }

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas de política', () => {
  it('GET /api/politica/elecciones -> 200 con el índice', async () => {
    const res = await app.request('/api/politica/elecciones', {}, env)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.elecciones.length).toBe(3)
  })

  it('GET /politica -> 301 a /politica/', async () => {
    const res = await app.request('/politica', {}, env)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/politica/')
  })

  it('GET /politica/ -> 200 con el índice y las secciones', async () => {
    const res = await app.request('/politica/', {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Elecciones y sondeos en España')
    expect(html).toContain('/politica/generales')
    expect(html).toContain('/politica/autonomicas/madrid')
  })

  it('GET /politica/autonomicas/ -> 200 (índice de autonómicas)', async () => {
    const res = await app.request('/politica/autonomicas/', {}, env)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('autonómicas')
  })

  it('el selector regional sin JavaScript lleva a su elección y rechaza destinos ajenos', async () => {
    const doc = parse(await (await app.request('/politica/', {}, env)).text())
    const form = doc.querySelector('form.regional-form')!
    const select = form.querySelector('select')!
    const valor = select.querySelector('option[value="madrid"]')?.getAttribute('value')
    const accion = form.getAttribute('action')
    expect(accion).toBe('/politica/autonomicas/')
    expect(valor).toBe('madrid')
    const res = await app.request(accion + '?' + select.getAttribute('name') + '=' + valor, {}, env)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/politica/autonomicas/madrid')
    for (const id of ['generales', 'desconocida', 'https://example.com/']) {
      expect((await app.request(accion + '?comunidad=' + encodeURIComponent(id), {}, env)).status).toBe(404)
    }
  })

  it('compara con la encuesta anterior por defecto y permite abrir el resultado electoral desde el enlace', async () => {
    const ruta = '/politica/autonomicas/madrid'
    const res = await app.request(ruta, {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Asamblea de Madrid')
    expect(html).toContain('Data10')
    expect(html).toContain('mayoría 72')
    expect(html).toContain('CC BY-SA')
    const doc = parse(html)
    expect(doc.querySelectorAll('details.pm-poll')).toHaveLength(2)
    expect(doc.querySelector('.pm-ref')?.text).toContain('3 may 2026')
    expect(doc.querySelector('.pm-rows li span')?.text).toBe('↑ Sube de 1 a 3')
    const enlace = doc.querySelector('nav.referencias a[href*="referencia=elecciones"]')!.getAttribute('href')!
    const oficial = await app.request(enlace, {}, env)
    expect(oficial.status).toBe(200)
    const oficialDoc = parse(await oficial.text())
    expect(oficialDoc.querySelector('.pm-ref')?.text).toContain('Elecciones del 28 may 2023')
    expect(oficialDoc.querySelector('.pm-rows li span')?.text).toBe('↑ Sube 3')
    expect(oficialDoc.querySelector('.opciones [aria-current]')?.text).toBe('Elecciones del 28 may 2023')
  })

  it('mantiene la referencia en los enlaces del histórico y la página al cambiar de referencia', async () => {
    const ruta = '/politica/autonomicas/madrid'
    const sondeos = Array.from({ length: 26 }, (_, i) => ({
      ...madrid.sondeos[0], campoInicio: undefined, campoFin: '2026-05-' + String(i + 1).padStart(2, '0'),
    }))
    const assets = { fetch: async () => Response.json({ ...madrid, sondeos }) }
    const pedir = (url: string) => app.request(url, {}, { ASSETS: assets })
    const p1 = parse(await (await pedir(ruta + '?referencia=elecciones')).text())
    const antigua = p1.querySelector('a[rel="next"]')!.getAttribute('href')!
    expect(new URL(antigua, 'https://x').searchParams.get('referencia')).toBe('elecciones')
    const res = await pedir(antigua)
    expect(res.status).toBe(200)
    const p2 = parse(await res.text())
    expect(p2.querySelectorAll('details.pm-poll')).toHaveLength(1)
    expect(p2.querySelector('.paginas')?.text).toContain('Página 2 de 2')
    expect(p2.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\?pagina=2$/)
    const anterior = p2.querySelector('nav.referencias a')!.getAttribute('href')!
    const cambiada = parse(await (await pedir(anterior)).text())
    expect(cambiada.querySelector('.paginas')?.text).toContain('Página 2 de 2')
    expect(cambiada.querySelector('.opciones [aria-current]')?.text).toBe('Encuesta anterior')
    for (const pagina of ['0', '3', '-1', '1.5']) expect((await pedir(ruta + '?pagina=' + pagina)).status).toBe(404)
  })

  it('la misma petición entra y sale de la veda según la fecha oficial, también al pedir la referencia electoral', async () => {
    const catalogo = await import('../scripts/lib/politica-catalogo.mjs')
    const madridCatalogo = catalogo.eleccionPorId('madrid')!
    const busca = catalogo.eleccionPorId
    const simulada = vi.spyOn(catalogo, 'eleccionPorId').mockImplementation(id => id === 'madrid'
      ? { ...madridCatalogo, proxima: { valor: '2027-05-23', confirmada: true } } : busca(id))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const ruta = '/politica/autonomicas/madrid?referencia=elecciones'
      vi.setSystemTime(new Date('2027-05-20T12:00:00Z'))
      const vedada = await app.request(ruta, {}, env)
      expect(vedada.status).toBe(200)
      const html = await vedada.text()
      expect(html).toContain('Veda electoral')
      expect(html).toContain('Último resultado oficial')
      expect(html).not.toContain('Data10')
      const doc = parse(html)
      expect(doc.querySelector('.evsvg')).toBeNull()
      expect(doc.querySelector('nav.referencias')).toBeNull()
      vi.setSystemTime(new Date('2027-05-25T12:00:00Z'))
      const abierta = await app.request(ruta, {}, env)
      expect(abierta.status).toBe(200)
      expect(parse(await abierta.text()).querySelector('details.pm-poll')?.text).toContain('Data10')
    } finally {
      simulada.mockRestore()
      vi.useRealTimers()
    }
  })

  it('una elección sin sondeos ni reparto oficial muestra esas dos ausencias', async () => {
    const res = await app.request('/politica/europeas', {}, env)
    expect(res.status).toBe(200)
    const doc = parse(await res.text())
    expect(doc.querySelector('main')?.text).toContain('Todavía no hay sondeos')
    expect(doc.querySelector('main')?.text).toContain('Todavía no hay un reparto de escaños')
    expect(doc.querySelector('table.s')).toBeNull()
    expect(doc.querySelector('.evsvg')).toBeNull()
  })

  it('GET /politica/generales -> 200', async () => {
    const res = await app.request('/politica/generales', {}, env)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Congreso de los Diputados')
  })

  it('GET /politica/autonomicas -> 301 a /politica/autonomicas/', async () => {
    const res = await app.request('/politica/autonomicas', {}, env)
    expect(res.status).toBe(301)
  })

  it('GET /politica/noexiste -> 404', async () => {
    const res = await app.request('/politica/noexiste', {}, env)
    expect(res.status).toBe(404)
  })

  it('GET /politica/autonomicas/noexiste -> 404', async () => {
    const res = await app.request('/politica/autonomicas/noexiste', {}, env)
    expect(res.status).toBe(404)
  })

  it('sin ASSETS (datos no disponibles) -> /politica/ 404, /api 503', async () => {
    expect((await app.request('/politica/', {}, {})).status).toBe(404)
    expect((await app.request('/api/politica/elecciones', {}, {})).status).toBe(503)
  })
})
