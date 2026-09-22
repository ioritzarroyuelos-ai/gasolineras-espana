// Vertical Gasolineras (precios del Ministerio). Extraido de index.tsx (B1).
// registerGasolinerasRoutes(app, deps) registra: /gasolineras (301), la portada
// buscador /gasolineras/, el mapa /gasolineras/mapa y las paginas SEO por
// provincia y municipio, mas /api/gasolineras/municipios (autocompletado).
// Orden interno CRITICO: /gasolineras/mapa va ANTES de /gasolineras/:slug o
// "mapa" se interpretaria como slug de provincia. Se preserva en el modulo.
//
// pageHeaders y slog se inyectan como deps porque el index los comparte con
// otras rutas (sitemap/status). buildPage/builders y los helpers de municipios
// se importan directamente (son puros).
import type { Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import { buildPage } from '../html/shell'
import { buildGasolinerasLanding, gasolinerasLandingHeaders, type GasLandingProvincia } from '../html/gasolineras'
import { PROVINCIAS, provinciaBySlug } from '../lib/provincias'
import {
  municipiosInProvincia, topMunicipiosInProvincia, findMunicipioBySlug,
  statsForMunicipio, statsNacional, topCheapestStationsIn, type StationLite,
} from '../lib/municipios'
import { resumenFromPre } from '../lib/gasolineras-precalculo'

export interface GasolinerasDeps {
  loadSnapshot: <T>(origin: string, file: string, assets?: { fetch: (req: Request) => Promise<Response> }) => Promise<T | null>
  genNonce: () => string
  MUNI_INDEX_TTL: number
  slog: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  pageHeaders: (nonce: string, turnstile: boolean, googleAuth?: boolean) => Record<string, string>
}

export function registerGasolinerasRoutes(app: Hono<{ Bindings: Env }>, deps: GasolinerasDeps): void {
  const { loadSnapshot, genNonce, MUNI_INDEX_TTL, slog, pageHeaders } = deps

  // Canonicalizamos `/gasolineras` (sin barra) → `/gasolineras/` para evitar
  // duplicado SEO. Usamos 301 porque es permanente.
  app.get('/gasolineras', c => {
    const url = new URL(c.req.url)
    return c.redirect('/gasolineras/' + (url.search || ''), 301)
  })

  // Indice ligero de municipios con gasolinera para el autocompletado de la
  // portada. Mismo patron que /api/guardias/municipios: [{n,p,u}] con
  // u=/gasolineras/<prov>/<mun>. ~3.250 entradas; cache en memoria (TTL 30 min)
  // y CDN. Solo se descarga cuando el usuario empieza a buscar.
  let muniGasIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  app.get('/api/gasolineras/municipios', async c => {
    const CACHE = { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }
    if (muniGasIndex && Date.now() - muniGasIndex.ts < MUNI_INDEX_TTL) {
      return c.json(muniGasIndex.data, 200, CACHE)
    }
    const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
    const out: Array<{ n: string; p: string; u: string }> = []
    const seen = new Set<string>()
    for (const prov of PROVINCIAS) {
      for (const m of municipiosInProvincia(snap, prov.id)) {
        const u = '/gasolineras/' + prov.slug + '/' + m.slug
        if (seen.has(u)) continue
        seen.add(u)
        out.push({ n: m.name, p: prov.name, u })
      }
    }
    out.sort((a, b) => a.n.localeCompare(b.n, 'es'))
    muniGasIndex = { ts: Date.now(), data: out }
    return c.json(out, 200, CACHE)
  })

  // `/gasolineras/` — portada: buscador de municipio + "usar mi ubicacion" +
  // "planificar ruta" + contenido SEO (precios medios nacionales y enlaces por
  // provincia). El mapa interactivo completo vive en /gasolineras/mapa. Ver
  // src/html/gasolineras.ts.
  app.get('/gasolineras/', async c => {
    // Transicion PWA: apps con el manifest viejo aun apuntan a
    // /gasolineras/?action=... (esperando el mapa). La portada no procesa
    // acciones -> las reenviamos al mapa para no romper esos accesos directos.
    const reqUrl = new URL(c.req.url)
    if (reqUrl.searchParams.has('action')) {
      return c.redirect('/gasolineras/mapa' + reqUrl.search, 301)
    }
    const nonce = genNonce()
    let stats: Record<string, { min: number; avg: number; max: number; count: number }> | undefined
    let provincias: GasLandingProvincia[] = []
    try {
      // M5: stats nacionales + recuento por provincia desde el resumen precomputado;
      // fallback al calculo completo sobre stations.json (12 MB) si falta/no valida.
      const resumen = resumenFromPre(await loadSnapshot<unknown>(c.req.url, 'gasolineras-resumen.json', c.env.ASSETS))
      if (resumen) {
        stats = Object.keys(resumen.nacionalStats.stats).length ? resumen.nacionalStats.stats : undefined
        const counts = resumen.provinciaCounts
        provincias = PROVINCIAS
          .map(p => ({ slug: p.slug, name: p.name, count: counts[p.id] || 0 }))
          .filter(p => p.count > 0)
          .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      } else {
        const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
        const r = statsNacional(snap)
        stats = Object.keys(r.stats).length ? r.stats : undefined
        if (snap && Array.isArray(snap.ListaEESSPrecio)) {
          const counts = new Map<string, number>()
          for (const s of snap.ListaEESSPrecio) {
            if (s.IDProvincia) counts.set(s.IDProvincia, (counts.get(s.IDProvincia) || 0) + 1)
          }
          provincias = PROVINCIAS
            .map(p => ({ slug: p.slug, name: p.name, count: counts.get(p.id) || 0 }))
            .filter(p => p.count > 0)
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        }
      }
    } catch { /* degradacion: portada sin bloque de precios/provincias */ }
    return new Response(
      buildGasolinerasLanding(nonce, c.req.url, { stats, provincias }),
      { headers: gasolinerasLandingHeaders(nonce) },
    )
  })

  // `/gasolineras/mapa` — el mapa interactivo completo (la SPA de siempre). La
  // portada /gasolineras/ paso a ser un buscador; esta ruta conserva el mapa con
  // filtros, ubicacion (?cerca=1) y rutas (?desde=&hasta=). Va ANTES de
  // `/gasolineras/:slug` o "mapa" se interpretaria como slug de provincia. Es la
  // misma pagina que la home de mapa, con noindex (herramienta, no contenido SEO).
  app.get('/gasolineras/mapa', async c => {
    const nonce = genNonce()
    const turnstile = !!c.env.TURNSTILE_SITE_KEY
    const googleAuth = !!c.env.GOOGLE_CLIENT_ID
    let snapshotDate: string | undefined
    try {
      const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      if (snap && typeof snap.Fecha === 'string') snapshotDate = snap.Fecha
    } catch { /* degradacion silenciosa */ }
    return new Response(buildPage(nonce, c.req.url, {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      snapshotDate,
      supportUrl: c.env.SUPPORT_URL,
      googleClientId: c.env.GOOGLE_CLIENT_ID,
      mapTool: true,
    }), { headers: pageHeaders(nonce, turnstile, googleAuth) })
  })

  // ---- Rutas SEO por provincia ----
  // /gasolineras/madrid, /gasolineras/barcelona, ... → pre-renderizamos la app
  // con meta tags especificos y el cliente auto-selecciona esa provincia via
  // window.__SEO__. Si el slug no existe (ej. /gasolineras/atlantida), 404
  // pra evitar que Google indexe URLs inventadas.
  app.get('/gasolineras/:slug', async c => {
    const slug = c.req.param('slug')
    const prov = provinciaBySlug(slug)
    if (!prov) return c.notFound()
    const nonce = genNonce()
    const turnstile = !!c.env.TURNSTILE_SITE_KEY
    const googleAuth = !!c.env.GOOGLE_CLIENT_ID

    // Pre-computamos stats de precios por combustible para la provincia. Sirve
    // para: (a) meta description enriquecida, (b) Dataset variableMeasured en
    // JSON-LD, (c) bloque SEO visible al final del body. Todo en una sola
    // pasada al snapshot que ya esta cacheado en memoria.
    let stats: Record<string, { min: number; avg: number; max: number; count: number }> | undefined
    let stationCount = 0
    let municipios: Array<{ slug: string; name: string; stationCount: number }> | undefined
    let snapshotDate: string | undefined  // Ship 15: Fecha del Ministerio para el badge de frescura.
    let topStations: StationLite[] | undefined  // Ship 17: top-10 baratas en 95 para JSON-LD ItemList.
    try {
      const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      if (snap && typeof snap.Fecha === 'string') snapshotDate = snap.Fecha
      if (snap && Array.isArray(snap.ListaEESSPrecio)) {
        // Top-10 mas baratas en 95 para JSON-LD ItemList (rich results).
        // Scope provincial — el municipal tiene su propio handler.
        topStations = topCheapestStationsIn(snap, {
          provinciaId: prov.id,
          fuelCode: '95',
          limit: 10,
        })
        if (topStations.length === 0) topStations = undefined
        const FIELD: Record<string, string> = {
          '95':          'Precio Gasolina 95 E5',
          '98':          'Precio Gasolina 98 E5',
          'diesel':      'Precio Gasoleo A',
          'diesel_plus': 'Precio Gasoleo Premium',
        }
        const buckets: Record<string, number[]> = { '95': [], '98': [], 'diesel': [], 'diesel_plus': [] }
        for (const s of snap.ListaEESSPrecio) {
          if (s.IDProvincia !== prov.id) continue
          stationCount++
          for (const fuelCode of Object.keys(FIELD)) {
            const raw = s[FIELD[fuelCode]]
            if (!raw) continue
            const n = parseFloat(String(raw).replace(',', '.'))
            if (Number.isFinite(n) && n > 0) buckets[fuelCode].push(n)
          }
        }
        stats = {}
        for (const fuelCode of Object.keys(buckets)) {
          const arr = buckets[fuelCode]
          if (arr.length === 0) continue
          const sum = arr.reduce((a, b) => a + b, 0)
          stats[fuelCode] = {
            min:   Math.min(...arr),
            max:   Math.max(...arr),
            avg:   sum / arr.length,
            count: arr.length,
          }
        }
        // Ship 11: top municipios por nº de estaciones, para internal linking
        // SEO y para ayudar a los crawlers a descubrir paginas municipio.
        // Filtro de minimo 5 estaciones evita bloat con aldeas.
        municipios = topMunicipiosInProvincia(snap, prov.id, { limit: 15, minStations: 5 })
          .map(m => ({ slug: m.slug, name: m.name, stationCount: m.stationCount }))
      }
    } catch (err) {
      // Fallo de snapshot: seguimos renderizando sin stats (degradacion
      // elegante — la pagina sigue funcionando, solo pierde la descripcion
      // enriquecida).
      slog('warn', 'seo.stats_failed', { slug, err: String(err).slice(0, 200) })
    }

    return new Response(buildPage(nonce, c.req.url, {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      seo: {
        provinciaId: prov.id,
        provinciaSlug: prov.slug,
        provinciaName: prov.name,
        stats,
        stationCount: stationCount || undefined,
        topStations,
      },
      municipios,
      snapshotDate,
      supportUrl: c.env.SUPPORT_URL,
      googleClientId: c.env.GOOGLE_CLIENT_ID,
    }), { headers: pageHeaders(nonce, turnstile, googleAuth) })
  })

  // ---- SEO: /gasolineras/:provinciaSlug/:municipioSlug (Ship 11) ----
  // Pagina por municipio: mismo patron que la provincia — pre-computa stats
  // restringidas al municipio y los pasa a buildPage. El slug del municipio
  // no esta hard-coded (hay ~8k municipios y el dataset cambia); se resuelve
  // al vuelo slugificando los nombres del snapshot y matcheando contra la ruta.
  // Si no se encuentra o la provincia no existe, 404 para evitar basura en el
  // indice de Google.
  app.get('/gasolineras/:provinciaSlug/:municipioSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const munSlug  = c.req.param('municipioSlug')
    const prov = provinciaBySlug(provSlug)
    if (!prov) return c.notFound()
    const nonce = genNonce()
    const turnstile = !!c.env.TURNSTILE_SITE_KEY
    const googleAuth = !!c.env.GOOGLE_CLIENT_ID

    let stats: Record<string, { min: number; avg: number; max: number; count: number }> | undefined
    let stationCount = 0
    let munName: string | undefined
    let munId: string | undefined
    let snapshotDate: string | undefined  // Ship 15
    let topStations: StationLite[] | undefined  // Ship 17
    try {
      const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      if (snap && typeof snap.Fecha === 'string') snapshotDate = snap.Fecha
      const mun = findMunicipioBySlug(snap, prov.id, munSlug)
      if (!mun) return c.notFound()
      munName = mun.name
      munId   = mun.id
      const r = statsForMunicipio(snap, prov.id, mun.id)
      stats = Object.keys(r.stats).length > 0 ? r.stats : undefined
      stationCount = r.stationCount
      // Top-10 baratas dentro del municipio para ItemList/GasStation en JSON-LD.
      // Si el municipio tiene <10 estaciones con 95, devuelve las que haya; si
      // no tiene ninguna con 95, queda undefined (no emitimos ItemList).
      topStations = topCheapestStationsIn(snap, {
        provinciaId: prov.id,
        municipioId: mun.id,
        fuelCode: '95',
        limit: 10,
      })
      if (topStations.length === 0) topStations = undefined
    } catch (err) {
      slog('warn', 'seo.municipio_stats_failed', { slug: provSlug + '/' + munSlug, err: String(err).slice(0, 200) })
      return c.notFound()
    }

    return new Response(buildPage(nonce, c.req.url, {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      seo: {
        provinciaId: prov.id,
        provinciaSlug: prov.slug,
        provinciaName: prov.name,
        municipioId:   munId,
        municipioSlug: munSlug,
        municipioName: munName,
        stats,
        stationCount: stationCount || undefined,
        topStations,
      },
      snapshotDate,
      supportUrl: c.env.SUPPORT_URL,
      googleClientId: c.env.GOOGLE_CLIENT_ID,
    }), { headers: pageHeaders(nonce, turnstile, googleAuth) })
  })
}
