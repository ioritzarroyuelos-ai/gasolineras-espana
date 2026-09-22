// Vertical Farmacias de guardia (scrapers de los 47 colegios provinciales).
// Extraido de index.tsx (B1). registerFarmaciasRoutes(app, deps) registra
// /farmacias*, /api/guardias/municipios y las paginas SSR por provincia/municipio.
// Orden interno CRITICO: /farmacias/guardia va ANTES de /farmacias/:provinciaSlug
// o "guardia" se tragaria como slug de provincia. Se preserva dentro del modulo.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, resolveScheme, resolveHost, MUNI_INDEX_TTL } from '../lib/runtime'
import { buildFarmaciasPage, farmaciasHeaders } from '../html/farmacias'
import {
  buildGuardiaMunicipioPage, buildGuardiaIndexPage, buildGuardiaProvinciaPage,
  buildGuardiaProvinciaFlatPage, guardiaHeaders,
} from '../html/guardia-municipio'
import {
  guardiasFileForProvincia, parseGuardias, guardiasForProvincia,
  municipiosConGuardia, guardiasForMunicipio, frescuraGuardia,
  GUARDIAS_TERRITORIO_BY_PROVINCIA, type GuardiasFile,
} from '../lib/guardias'
import { PROVINCIAS, provinciaBySlug } from '../lib/provincias'

export function registerFarmaciasRoutes(app: Hono<{ Bindings: Env }>): void {

  // ---- Farmacias (Fase 1 MVP nacional) ----
  // `/farmacias` sin barra -> 301 a `/farmacias/` (misma canonicalizacion que
  // hacemos con /gasolineras para evitar duplicado SEO).
  app.get('/farmacias', c => {
    const url = new URL(c.req.url)
    return c.redirect('/farmacias/' + (url.search || ''), 301)
  })

  // `/farmacias/` — buscador de farmacia de guardia por texto (autocompletado).
  // Pagina autocontenida (HTML+CSS+JS inline con nonce). Ya no hay mapa ni
  // snapshot OSM: consume /api/guardias/municipios y lleva a la pagina SEO del
  // municipio elegido. (El antiguo farmacias.json y su cron se retiraron.)
  app.get('/farmacias/', c => {
    const nonce = genNonce()
    return new Response(buildFarmaciasPage(nonce, c.req.url), { headers: farmaciasHeaders(nonce) })
  })

  // `/farmacias/:provincia/:municipio` — pagina SEO de farmacia de guardia,
  // renderizada ENTERA en servidor (a diferencia de /farmacias/, que es la SPA).
  // Motivo: "farmacia de guardia en <municipio>" es la consulta de mayor
  // intencion del proyecto y una SPA no se indexa. Los datos ya los generan los
  // scrapers de los 47 colegios provinciales, incluidos los que solo publican en
  // PDF, que es justo donde la competencia no llega.
  // 404 si la provincia, el fichero o el municipio no existen, para no meter
  // paginas vacias en el indice.
  // `/farmacias/guardia` — indice nacional de provincias con guardia.
  // IMPORTANTE: va declarada ANTES que `/farmacias/:provinciaSlug`, o el parametro
  // se tragaria "guardia" como si fuera un slug de provincia.
  app.get('/farmacias/guardia', c => {
    const provincias = PROVINCIAS
      .filter(p => guardiasFileForProvincia(p.slug))
      .map(p => ({ slug: p.slug, name: p.name }))
    const nonce = genNonce()
    const canonical = resolveScheme(c) + '://' + resolveHost(c) + '/farmacias/guardia'
    return new Response(
      buildGuardiaIndexPage(nonce, provincias, canonical),
      { headers: guardiaHeaders(nonce) },
    )
  })

  // Indice de municipios con guardia para el autocompletado de /farmacias/.
  // Recorre los 47 ficheros una vez y cachea 30 min en memoria. Devuelve
  // [{n: municipio, p: provincia, u: url de su pagina de guardia}]. Reusa las
  // MISMAS funciones que las rutas SSR (municipiosConGuardia, guardiasForProvincia),
  // asi que los slugs coinciden exactos y el enlace nunca da 404. Incluye tambien
  // los territorios caducados: el usuario los encuentra y su pagina ya muestra el
  // aviso de "sin turno actualizado".
  let muniGuardiaIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  app.get('/api/guardias/municipios', async c => {
    const CACHE = { 'Cache-Control': 'public, max-age=3600' }
    if (muniGuardiaIndex && Date.now() - muniGuardiaIndex.ts < MUNI_INDEX_TTL) {
      return c.json(muniGuardiaIndex.data, 200, CACHE)
    }
    const out: Array<{ n: string; p: string; u: string }> = []
    const seen = new Set<string>()
    const cache = new Map<string, GuardiasFile | null>()
    for (const provSlug of Object.keys(GUARDIAS_TERRITORIO_BY_PROVINCIA)) {
      const prov = provinciaBySlug(provSlug)
      const file = guardiasFileForProvincia(provSlug)
      if (!prov || !file) continue
      if (!cache.has(file)) {
        try { cache.set(file, await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS)) }
        catch { cache.set(file, null) }
      }
      const raw = cache.get(file)
      if (!raw) continue
      const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
      const municipios = municipiosConGuardia(all)
      if (municipios.length) {
        for (const m of municipios) {
          const u = '/farmacias/' + provSlug + '/' + m.slug
          if (seen.has(u)) continue
          seen.add(u)
          out.push({ n: m.name, p: prov.name, u })
        }
      } else if (all.length) {
        // Provincia sin municipio (Baleares, Huesca): entrada provincial.
        const u = '/farmacias/' + provSlug
        if (!seen.has(u)) { seen.add(u); out.push({ n: prov.name, p: prov.name, u }) }
      }
    }
    out.sort((a, b) => a.n.localeCompare(b.n, 'es'))
    muniGuardiaIndex = { ts: Date.now(), data: out }
    return c.json(out, 200, CACHE)
  })

  // `/farmacias/:provincia` — municipios de la provincia con guardia publicada.
  // Es el eslabon que faltaba entre el indice y las 1.289 paginas de municipio.
  app.get('/farmacias/:provinciaSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const prov = provinciaBySlug(provSlug)
    if (!prov) return c.notFound()
    const file = guardiasFileForProvincia(provSlug)
    if (!file) return c.notFound()

    const raw = await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS)
    if (!raw) return c.notFound()

    const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
    const municipios = municipiosConGuardia(all)

    const nonce = genNonce()
    const canonical = resolveScheme(c) + '://' + resolveHost(c) + '/farmacias/' + provSlug
    // Si el territorio no se ha refrescado en el ultimo pase (>30 h), no lo
    // dejamos indexar: la pagina mostrara el aviso de caducado en vez del turno.
    const hdrs = frescuraGuardia(raw.ts).fiable
      ? guardiaHeaders(nonce)
      : { ...guardiaHeaders(nonce), 'X-Robots-Tag': 'noindex, follow' }
    // Sin municipios (Baleares, Huesca): la fuente no trae municipio pero SI trae
    // guardias con direccion y telefono; se listan directamente en vez de un 404.
    if (!municipios.length) {
      if (!all.length) return c.notFound()
      return new Response(
        buildGuardiaProvinciaFlatPage(nonce, provSlug, prov.name, all, raw.ts, canonical),
        { headers: hdrs },
      )
    }
    return new Response(
      buildGuardiaProvinciaPage(nonce, provSlug, prov.name, municipios, raw.ts, canonical),
      { headers: hdrs },
    )
  })

  app.get('/farmacias/:provinciaSlug/:municipioSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const munSlug  = c.req.param('municipioSlug')
    const prov = provinciaBySlug(provSlug)
    if (!prov) return c.notFound()
    const file = guardiasFileForProvincia(provSlug)
    if (!file) return c.notFound()

    const raw = await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS)
    if (!raw) return c.notFound()

    const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
    const municipios = municipiosConGuardia(all)
    const munEntry = municipios.find(m => m.slug === munSlug)
    if (!munEntry) return c.notFound()

    const nonce = genNonce()
    const canonical = resolveScheme(c) + '://' + resolveHost(c) + '/farmacias/' + provSlug + '/' + munSlug
    const hdrs = frescuraGuardia(raw.ts).fiable
      ? guardiaHeaders(nonce)
      : { ...guardiaHeaders(nonce), 'X-Robots-Tag': 'noindex, follow' }
    return new Response(buildGuardiaMunicipioPage(nonce, {
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      municipioSlug: munSlug,
      municipioName: munEntry.name,
      guardias: guardiasForMunicipio(all, munSlug),
      otrosMunicipios: municipios.filter(m => m.slug !== munSlug),
      actualizado: raw.ts,
      fuente: raw.source,
      canonical,
    }), { headers: hdrs })
  })
}
