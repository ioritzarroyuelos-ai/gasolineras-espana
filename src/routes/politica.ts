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
import { ELECCIONES, eleccionPorId, rutasEleccion } from '../../scripts/lib/politica-catalogo.mjs'
import { completaResultadosOficiales } from '../../scripts/lib/politica-resultados-oficiales.mjs'
import { buildIndexPage, buildAutonomicasIndex, buildEleccionPage, buildSenadoPage, politicaHeaders, SONDEOS_POR_PAGINA } from '../html/politica'

const rutaFichero = (id: string, tipo: string) => (tipo === 'autonomica' ? 'politica/autonomicas/' + id + '.json' : 'politica/' + id + '.json')

export function registerPoliticaRoutes(app: Hono<{ Bindings: Env }>): void {
  async function cargaIndex(c: { req: { url: string }; env: Env }) {
    const index = await loadSnapshot<IndexFile>(c.req.url, 'politica/index.json', c.env.ASSETS)
    if (!index) return null
    // Una convocatoria verificada entra en vigor al desplegar el catálogo,
    // aunque el robot todavía no haya actualizado su copia del índice.
    const ahoraISO = new Date().toISOString()
    const elecciones = index.elecciones.map(e => {
      const proxima = eleccionPorId(e.id)?.proxima
      if (proxima && enVeda(ahoraISO, proxima)) {
        return { ...e, fecha: proxima, fechaUltimoSondeo: null, fechaUltimaPublicacion: null }
      }
      return proxima?.confirmada || proxima?.anioPrevisto ? { ...e, fecha: proxima } : e
    })
    return { ...index, elecciones }
  }

  // Sólo los JSON de elecciones convocadas pasan por el Worker. Antes de la
  // veda se transmite el archivo directamente. Durante la veda se conserva
  // el resultado anterior, incluso si el robot sigue teniendo encuestas.
  for (const cat of ELECCIONES.filter(e => e.proxima.confirmada)) {
    app.get(rutasEleccion(cat).datos, async c => {
      const assets = c.env.ASSETS
      if (!assets) return c.json({ error: 'no disponible' }, 503, { 'Cache-Control': 'no-store' })
      if (enVeda(new Date().toISOString(), cat.proxima)) {
        const file = await loadSnapshot<EleccionFile>(c.req.url, rutaFichero(cat.id, cat.tipo), assets)
        if (!file) return c.json({ error: 'no disponible' }, 503, { 'Cache-Control': 'no-store' })
        return c.json({ ...file, sondeos: [], fechaUltimoSondeo: null, fechaUltimaPublicacion: null, veda: true }, 200, { 'Cache-Control': 'no-store' })
      }
      const asset = await assets.fetch(c.req.raw)
      const headers = new Headers(asset.headers)
      headers.set('Cache-Control', 'no-store')
      return new Response(asset.body, { status: asset.status, headers })
    })
  }

  // API: índice de elecciones (sin sondeos), para navegación/otros usos.
  app.get('/api/politica/elecciones', async (c) => {
    const idx = await cargaIndex(c)
    if (!idx) return c.json({ error: 'no disponible' }, 503)
    const cache = idx.elecciones.some(e => e.fecha.confirmada) ? 'no-store' : 'public, max-age=1800, s-maxage=3600'
    return c.json(idx, 200, { 'Cache-Control': cache })
  })

  // Índice general.
  app.get('/politica', (c) => c.redirect('/politica/', 301))
  app.get('/politica/', async (c) => {
    const idx = await cargaIndex(c)
    if (!idx) return c.notFound()
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/politica/'
    const headers = politicaHeaders(nonce)
    if (idx.elecciones.some(e => e.fecha.confirmada)) headers['Cache-Control'] = 'no-store'
    return new Response(buildIndexPage(nonce, idx.elecciones, canonical), { headers })
  })

  // Índice de autonómicas (ANTES del :eleccionId).
  app.get('/politica/autonomicas', (c) => c.redirect('/politica/autonomicas/', 301))
  app.get('/politica/autonomicas/', async (c) => {
    const comunidad = c.req.query('comunidad')
    if (comunidad) {
      const destino = eleccionPorId(comunidad)
      if (!destino || destino.tipo !== 'autonomica') return c.notFound()
      return c.redirect('/politica/autonomicas/' + destino.id, 302)
    }
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
  app.get('/politica/generales/senado', async c => {
    const cat = eleccionPorId('generales')!
    return paginaEleccion(c, cat, canonicalBase(c) + '/politica/generales/senado', true)
  })
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
    esSenado = false,
  ): Promise<Response> {
    const guardado = await loadSnapshot<EleccionFile>(c.req.url, rutaFichero(cat.id, cat.tipo), c.env.ASSETS)
    if (!guardado) return new Response('No disponible', { status: 503 })
    const file = completaResultadosOficiales(guardado)
    const ahoraISO = new Date().toISOString()
    const veda = enVeda(ahoraISO, cat.proxima)
    const params = new URL(c.req.url).searchParams
    const rawPagina = params.get('pagina') || '1'
    const referencia = params.get('referencia') === 'elecciones' ? 'elecciones' : 'anterior'
    const pagina = Number(rawPagina)
    const maxPagina = veda || esSenado ? 1 : Math.max(1, Math.ceil(file.sondeos.length / SONDEOS_POR_PAGINA))
    if (!/^[1-9]\d{0,4}$/.test(rawPagina) || pagina > maxPagina) return new Response('Página no encontrada', { status: 404 })
    if (pagina > 1) canonical += '?pagina=' + pagina
    const estado = veda
      ? 'ok'
      : estadoEleccion({ tieneSondeos: (file.sondeos || []).length > 0, ultimaComprobacionOk: file.ultimaComprobacionOk }, ahoraISO)
    const nonce = genNonce()
    const render = esSenado ? buildSenadoPage : buildEleccionPage
    const headers = politicaHeaders(nonce)
    if (cat.proxima.confirmada && !esSenado) headers['Cache-Control'] = 'no-store'
    return new Response(render({ nonce, cat, file, estado, enVeda: veda, ahoraISO, canonical, pagina, referencia }), { headers })
  }
}
