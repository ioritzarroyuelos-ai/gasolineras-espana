// Vertical POLÍTICA (elecciones + sondeos). Registra /api/politica/elecciones y
// las páginas SSR /politica/*. Solo LEE los JSON estáticos que genera el robot
// (public/data/politica/), como el resto de verticales. La VEDA (LOREG 69.7) se
// evalúa en CADA request con la fecha del servidor (no depende de que el robot
// haya corrido): si estamos en la ventana, no se muestran sondeos.
//
// Orden de rutas: las literales (/politica/, /politica/autonomicas/...) ANTES del
// parámetro /politica/:eleccionId, o el :param se tragaría "autonomicas".
import type { Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase } from '../lib/runtime'
import { enVeda, estadoEleccion } from '../lib/politica'
import type { EleccionFile, IndexFile } from '../lib/politica-schemas'
import { ELECCIONES, eleccionPorId } from '../../scripts/lib/politica-catalogo.mjs'
import { buildIndexPage, buildAutonomicasIndex, buildEleccionPage, politicaHeaders } from '../html/politica'

const rutaFichero = (id: string, tipo: string) => (tipo === 'autonomica' ? 'politica/autonomicas/' + id + '.json' : 'politica/' + id + '.json')

export function registerPoliticaRoutes(app: Hono<{ Bindings: Env }>): void {
  const cargaIndex = (c: { req: { url: string }; env: Env }) =>
    loadSnapshot<IndexFile>(c.req.url, 'politica/index.json', c.env.ASSETS)

  // API: índice de elecciones (sin sondeos), para navegación/otros usos.
  app.get('/api/politica/elecciones', async (c) => {
    const idx = await cargaIndex(c)
    if (!idx) return c.json({ error: 'no disponible' }, 503)
    return c.json(idx, 200, { 'Cache-Control': 'public, max-age=1800, s-maxage=3600' })
  })

  // Índice general.
  app.get('/politica', (c) => c.redirect('/politica/', 301))
  app.get('/politica/', async (c) => {
    const idx = await cargaIndex(c)
    if (!idx) return c.notFound()
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/politica/'
    return new Response(buildIndexPage(nonce, idx.elecciones, canonical), { headers: politicaHeaders(nonce) })
  })

  // Índice de autonómicas (ANTES del :eleccionId).
  app.get('/politica/autonomicas', (c) => c.redirect('/politica/autonomicas/', 301))
  app.get('/politica/autonomicas/', async (c) => {
    const idx = await cargaIndex(c)
    if (!idx) return c.notFound()
    const auton = idx.elecciones.filter((e) => e.tipo === 'autonomica')
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/politica/autonomicas/'
    return new Response(buildAutonomicasIndex(nonce, auton, canonical), { headers: politicaHeaders(nonce) })
  })

  // Página de una comunidad autónoma.
  app.get('/politica/autonomicas/:comunidad', async (c) => {
    const id = c.req.param('comunidad')
    const cat = eleccionPorId(id)
    if (!cat || cat.tipo !== 'autonomica') return c.notFound()
    const canonical = canonicalBase(c) + '/politica/autonomicas/' + id
    return paginaEleccion(c, cat, canonical)
  })

  // Página de generales/europeas.
  app.get('/politica/:eleccionId', async (c) => {
    const id = c.req.param('eleccionId')
    if (id === 'autonomicas') return c.redirect('/politica/autonomicas/', 301)
    const cat = eleccionPorId(id)
    if (!cat || cat.tipo === 'autonomica') return c.notFound()
    const canonical = canonicalBase(c) + '/politica/' + id
    return paginaEleccion(c, cat, canonical)
  })

  async function paginaEleccion(
    c: { req: { url: string }; env: Env },
    cat: (typeof ELECCIONES)[number],
    canonical: string,
  ): Promise<Response> {
    const file = await loadSnapshot<EleccionFile>(c.req.url, rutaFichero(cat.id, cat.tipo), c.env.ASSETS)
    if (!file) return new Response('No disponible', { status: 503 })
    const ahoraISO = new Date().toISOString()
    const veda = enVeda(ahoraISO, cat.proxima)
    const estado = veda
      ? 'ok'
      : estadoEleccion({ tieneSondeos: (file.sondeos || []).length > 0, ultimaComprobacionOk: (file as { ultimaComprobacionOk?: string }).ultimaComprobacionOk }, ahoraISO)
    const nonce = genNonce()
    return new Response(
      buildEleccionPage({ nonce, cat, file, estado, enVeda: veda, ahoraISO, canonical }),
      { headers: politicaHeaders(nonce) },
    )
  }
}
