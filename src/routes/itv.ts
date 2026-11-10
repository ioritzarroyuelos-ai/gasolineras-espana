// Directorio ITV, búsqueda de municipios y centros próximos. Las rutas
// /itv/buscar y /itv/precios preceden al parámetro de provincia.
import type { Context, Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase, MUNI_INDEX_TTL } from '../lib/runtime'
import {
  parseItv, provinciaPorSlug, provinciasConItv, municipiosConItv,
  estacionesDeProvincia, estacionesDeMunicipio,
  type ItvFile,
} from '../lib/itv'
import {
  buildItvIndexPage, buildItvProvinciaPage, buildItvMunicipioPage, buildItvPreciosPage, buildItvBusquedaPage, itvHeaders,
} from '../html/itv'
import { tarifaPorProvincia } from '../lib/itv-tarifas'
import type { EstadoTarifasItv } from '../lib/itv-tarifas-estado'
import type { MunicipioLista } from '../../scripts/lib/tiempo.mjs'
import { catalogoTiempo, preparaBuscadorTiempo, rutaMunicipioTiempo, type IndiceBusquedaTiempo } from '../lib/tiempo-municipios'
import { buscaItv, estacionesCercanas, estacionesEnMunicipio, origenDelMunicipio, rutaAnteriorItv } from '../lib/itv-busqueda'

type Contexto = Context<{ Bindings: Env }>

export function registerItvRoutes(app: Hono<{ Bindings: Env }>): void {

  async function cargaItv(c: Contexto) {
    const [file, tarifasEstado] = await Promise.all([
      loadSnapshot<ItvFile>(c.req.url, 'itv.json', c.env.ASSETS),
      loadSnapshot<EstadoTarifasItv>(c.req.url, 'itv-tarifas-estado.json', c.env.ASSETS),
    ])
    return { estaciones: parseItv(file), updatedAt: file?.generatedAt, fuentesEstado: file?.fuentesEstado, tarifasEstado }
  }

  let catalogo: { ts: number; datos: MunicipioLista[] } | undefined
  let busqueda: { ts: number; datos: IndiceBusquedaTiempo } | undefined
  async function cargaCatalogo(c: Contexto) {
    if (catalogo && Date.now() - catalogo.ts < MUNI_INDEX_TTL) return catalogo.datos
    const base = await loadSnapshot<{municipios: MunicipioLista[]}>(c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
    const datos = catalogoTiempo(base?.municipios || [])
    if (datos.length) catalogo = { ts: Date.now(), datos }
    return datos
  }
  async function cargaBusqueda(c: Contexto) {
    if (busqueda && Date.now() - busqueda.ts < MUNI_INDEX_TTL) return busqueda.datos
    const precalculado = await loadSnapshot<IndiceBusquedaTiempo>(c.req.url, 'tiempo/buscador-v1.json', c.env.ASSETS)
    const datos = Array.isArray(precalculado) && precalculado.length ? precalculado : preparaBuscadorTiempo(await cargaCatalogo(c))
    if (datos.length) busqueda = { ts: Date.now(), datos }
    return datos
  }

  // La API sin consulta conserva el listado de localidades con estación para
  // sus consumidores anteriores. El buscador consulta el catálogo completo.
  let itvMuniIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  app.get('/api/itv/municipios', async c => {
    const CACHE = { 'Cache-Control': 'public, max-age=300, s-maxage=300' }
    const q = c.req.query('q')
    if (q !== undefined) {
      if (q.trim().length < 2) return c.json([], 200, CACHE)
      const indice = await cargaBusqueda(c)
      if (!indice.length) return c.json({ error: 'No se pudo consultar el listado. Inténtalo de nuevo.' }, 503, { 'Cache-Control': 'no-store' })
      return c.json(buscaItv(indice, q).resultados, 200, CACHE)
    }
    if (itvMuniIndex && Date.now() - itvMuniIndex.ts < MUNI_INDEX_TTL) {
      return c.json(itvMuniIndex.data, 200, CACHE)
    }
    const { estaciones: todas } = await cargaItv(c)
    const out: Array<{ n: string; p: string; u: string }> = []
    const seen = new Set<string>()
    for (const prov of provinciasConItv(todas)) {
      for (const m of municipiosConItv(estacionesDeProvincia(todas, prov.id))) {
        const u = '/itv/' + prov.slug + '/' + m.slug
        if (seen.has(u)) continue
        seen.add(u)
        out.push({ n: m.name, p: prov.name, u })
      }
    }
    out.sort((a, b) => a.n.localeCompare(b.n, 'es'))
    if (out.length) itvMuniIndex = { ts: Date.now(), data: out }
    return c.json(out, 200, out.length ? CACHE : { 'Cache-Control': 'no-store' })
  })

  app.get('/itv/', async c => {
    const { estaciones: todas, updatedAt, fuentesEstado } = await cargaItv(c)
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/'
    if (!todas.length) return new Response(buildItvBusquedaPage(nonce, '', [], canonical, true), {
      status: 503, headers: { ...itvHeaders(nonce), 'Cache-Control': 'no-store' },
    })
    return new Response(
      buildItvIndexPage(nonce, provinciasConItv(todas), todas.length, canonical, updatedAt, fuentesEstado),
      { headers: itvHeaders(nonce) },
    )
  })

  // Canonicalizamos `/itv` -> `/itv/` para no duplicar, igual que /gasolineras.
  app.get('/itv', c => c.redirect('/itv/', 301))

  app.get('/itv/buscar', async c => {
    const q = (c.req.query('q') || '').trim().slice(0, 80)
    if (q.length < 2) return c.redirect('/itv/', 302)
    const indice = await cargaBusqueda(c)
    const { resultados, destino } = buscaItv(indice, q)
    if (destino) return c.redirect(destino, 302)
    const nonce = genNonce()
    const headers = itvHeaders(nonce)
    headers['Cache-Control'] = 'no-store'
    return new Response(buildItvBusquedaPage(nonce, q, resultados, canonicalBase(c) + '/itv/buscar', !indice.length),
      { status: indice.length ? 200 : 503, headers })
  })

  // `/itv/precios` — comparativa nacional. Va ANTES de `/itv/:provinciaSlug` o el
  // parametro se tragaria "precios" como si fuera un slug de provincia.
  //
  app.get('/itv/precios', async c => {
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/precios'
    const combustible = c.req.query('combustible') === 'diesel' ? 'diesel' : 'gasolina'
    const estado = await loadSnapshot<EstadoTarifasItv>(c.req.url, 'itv-tarifas-estado.json', c.env.ASSETS)
    return new Response(buildItvPreciosPage(nonce, canonical, combustible, estado), { headers: itvHeaders(nonce) })
  })

  app.get('/itv/:provinciaSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const prov = provinciaPorSlug(provSlug)
    if (!prov) return c.notFound()

    const { estaciones, updatedAt, fuentesEstado, tarifasEstado } = await cargaItv(c)
    const deProvincia = estacionesDeProvincia(estaciones, prov.id)
    // Un municipio puede tener centros próximos aunque su provincia carezca de datos.
    if (!deProvincia.length && !(await cargaCatalogo(c)).some(m => m.provinciaId === prov.id)) return c.notFound()

    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/' + provSlug
    return new Response(buildItvProvinciaPage(nonce, {
      updatedAt,
      fuentesEstado,
      tarifasEstado,
      directorioDisponible: estaciones.length > 0,
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      estaciones: deProvincia,
      municipios: municipiosConItv(deProvincia),
      tarifa: tarifaPorProvincia(provSlug),
      canonical,
    }), { status: estaciones.length ? 200 : 503,
      headers: { ...itvHeaders(nonce), ...(!estaciones.length && { 'Cache-Control': 'no-store' }) } })
  })

  app.get('/itv/:provinciaSlug/:municipioSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const munSlug  = c.req.param('municipioSlug')
    const prov = provinciaPorSlug(provSlug)
    if (!prov) return c.notFound()

    const [{ estaciones, updatedAt, fuentesEstado, tarifasEstado }, catalogo] = await Promise.all([cargaItv(c), cargaCatalogo(c)])
    const deProvincia = estacionesDeProvincia(estaciones, prov.id)
    const catalogoProvincia = catalogo.filter(m => m.provinciaId === prov.id)
    const municipios = municipiosConItv(deProvincia)
    const munEntry = municipios.find(m => m.slug === munSlug)
    const lugar = rutaMunicipioTiempo(catalogoProvincia, munSlug)
    const anterior = !munEntry && !lugar ? rutaAnteriorItv(deProvincia, munSlug) : undefined
    if (anterior) return c.redirect('/itv/' + provSlug + '/' + anterior, 301)
    if (!munEntry && !lugar) return c.notFound()
    if (!munEntry && lugar?.redirigir) return c.redirect('/itv/' + provSlug + '/' + lugar.municipio.slug, 301)
    const directas = lugar
      ? estacionesEnMunicipio(deProvincia, lugar.municipio, catalogoProvincia)
      : estacionesDeMunicipio(deProvincia, munSlug)
    const origen = origenDelMunicipio(lugar?.municipio)
    const cercanas = !directas.length && origen ? estacionesCercanas(estaciones, origen) : []

    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/' + provSlug + '/' + munSlug
    return new Response(buildItvMunicipioPage(nonce, {
      updatedAt,
      fuentesEstado,
      tarifasEstado,
      directorioDisponible: estaciones.length > 0,
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      municipioName: lugar?.municipio.nombre || munEntry!.name,
      estaciones: directas,
      cercanas,
      origenCercanas: origen,
      tarifa: tarifaPorProvincia(provSlug),
      otrosMunicipios: municipios.filter(m => m.slug !== munSlug),
      canonical,
    }), { status: estaciones.length ? 200 : 503,
      headers: { ...itvHeaders(nonce), ...(!estaciones.length && { 'Cache-Control': 'no-store' }) } })
  })
}
