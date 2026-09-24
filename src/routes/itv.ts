// Vertical ITV (datos del FeatureServer de la DGT). Extraido de index.tsx (B1).
// registerItvRoutes(app, deps) registra /api/itv/municipios + /itv/* preservando
// EXACTAMENTE el orden inline (clave: /itv/precios ANTES de /itv/:provinciaSlug, o
// "precios" se tragaria como slug de provincia). La infra compartida se inyecta.
//
// OJO: el sitemap.xml en index.tsx sigue usando parseItv/provinciasConItv/etc
// directamente; por eso esos imports permanecen alli. Aqui solo viven cargaItv y
// las rutas.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase, MUNI_INDEX_TTL } from '../lib/runtime'
import {
  parseItv, provinciaPorSlug, provinciasConItv, municipiosConItv,
  estacionesDeProvincia, estacionesDeMunicipio,
  type EstacionITV, type ItvFile,
} from '../lib/itv'
import {
  buildItvIndexPage, buildItvProvinciaPage, buildItvMunicipioPage, buildItvPreciosPage, itvHeaders,
} from '../html/itv'
import { tarifaPorProvincia } from '../lib/itv-tarifas'

export function registerItvRoutes(app: Hono<{ Bindings: Env }>): void {

  async function cargaItv(c: { req: { url: string }; env: Env }): Promise<EstacionITV[]> {
    return parseItv(await loadSnapshot<ItvFile>(c.req.url, 'itv.json', c.env.ASSETS))
  }

  // Indice ligero de municipios con ITV para el autocompletado de /itv/.
  // Mismo patron que /api/guardias/municipios: [{n: municipio, p: provincia,
  // u: /itv/<prov>/<mun>}], cacheado en memoria (los datos ITV son estaticos).
  let itvMuniIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  app.get('/api/itv/municipios', async c => {
    const CACHE = { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }
    if (itvMuniIndex && Date.now() - itvMuniIndex.ts < MUNI_INDEX_TTL) {
      return c.json(itvMuniIndex.data, 200, CACHE)
    }
    const todas = await cargaItv(c)
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
    itvMuniIndex = { ts: Date.now(), data: out }
    return c.json(out, 200, CACHE)
  })

  app.get('/itv/', async c => {
    const todas = await cargaItv(c)
    if (!todas.length) return c.notFound()
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/'
    return new Response(
      buildItvIndexPage(nonce, provinciasConItv(todas), todas.length, canonical),
      { headers: itvHeaders(nonce) },
    )
  })

  // Canonicalizamos `/itv` -> `/itv/` para no duplicar, igual que /gasolineras.
  app.get('/itv', c => c.redirect('/itv/', 301))

  // `/itv/precios` — comparativa nacional. Va ANTES de `/itv/:provinciaSlug` o el
  // parametro se tragaria "precios" como si fuera un slug de provincia.
  //
  // Es la pagina con mas opcion real de posicionar de todo el vertical: el dato es
  // oficial y citable, y las SERP de "precio ITV" las ocupan agregadores que no
  // citan fuente ni distinguen el regimen fiscal de cada territorio.
  app.get('/itv/precios', c => {
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/precios'
    return new Response(buildItvPreciosPage(nonce, canonical), { headers: itvHeaders(nonce) })
  })

  app.get('/itv/:provinciaSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const prov = provinciaPorSlug(provSlug)
    if (!prov) return c.notFound()

    const deProvincia = estacionesDeProvincia(await cargaItv(c), prov.id)
    // Sin estaciones no se publica pagina: mejor un 404 que una URL vacia en el indice.
    if (!deProvincia.length) return c.notFound()

    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/' + provSlug
    return new Response(buildItvProvinciaPage(nonce, {
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      estaciones: deProvincia,
      municipios: municipiosConItv(deProvincia),
      tarifa: tarifaPorProvincia(provSlug),
      canonical,
    }), { headers: itvHeaders(nonce) })
  })

  app.get('/itv/:provinciaSlug/:municipioSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const munSlug  = c.req.param('municipioSlug')
    const prov = provinciaPorSlug(provSlug)
    if (!prov) return c.notFound()

    const deProvincia = estacionesDeProvincia(await cargaItv(c), prov.id)
    if (!deProvincia.length) return c.notFound()

    const municipios = municipiosConItv(deProvincia)
    const munEntry = municipios.find(m => m.slug === munSlug)
    if (!munEntry) return c.notFound()

    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/itv/' + provSlug + '/' + munSlug
    return new Response(buildItvMunicipioPage(nonce, {
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      municipioName: munEntry.name,
      estaciones: estacionesDeMunicipio(deProvincia, munSlug),
      otrosMunicipios: municipios.filter(m => m.slug !== munSlug),
      canonical,
    }), { headers: itvHeaders(nonce) })
  })
}
