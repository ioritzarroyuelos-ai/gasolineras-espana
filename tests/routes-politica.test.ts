import { describe, it, expect, beforeEach, vi } from 'vitest'
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
    { empresa: 'Data10', fechaTexto: '11-12 jun', campoFin: '2026-06-12', muestra: 1000, datos: [{ candidaturaId: 'pp', pct: 50.3, escanos: 73 }, { candidaturaId: 'psoe', pct: 18.4, escanos: 26 }] },
    { empresa: 'Otra', fechaTexto: '1-3 may', campoFin: '2026-05-03', datos: [{ candidaturaId: 'pp', pct: 48, escanos: { min: 70, max: 72 } }] },
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

  it('GET /politica/autonomicas/madrid -> 200 con sondeos y sube/baja', async () => {
    const res = await app.request('/politica/autonomicas/madrid', {}, env)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Asamblea de Madrid')
    expect(html).toContain('Data10')
    expect(html).toContain('mayoría 72')
    // PP 73 estimado vs 70 de referencia -> +3
    expect(html).toContain('▲+3')
    // Atribución Wikipedia CC BY-SA
    expect(html).toContain('CC BY-SA')
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
