// Vertical "El tiempo" (AEMET + suplente Open-Meteo). Extraido de index.tsx
// (B1: partir el monolito en sub-modulos por vertical). Las rutas se registran
// sobre el mismo `app` via registerTiempoRoutes(app, deps), preservando EXACTA-
// MENTE el orden y comportamiento que tenian inline. La infra compartida
// (loadSnapshot, genNonce, resolveHost/Scheme, MUNI_INDEX_TTL) se inyecta como
// `deps` para no duplicar ni mover el estado global del index.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase, MUNI_INDEX_TTL } from '../lib/runtime'
// Lógica del tiempo compartida con el robot/tests (scripts/lib/tiempo.mjs + .d.mts).
import { construyeIndiceMunicipios, resuelvePrediccion, frescuraTiempo } from '../../scripts/lib/tiempo.mjs'
import type { MunicipioLista, Prediccion } from '../../scripts/lib/tiempo.mjs'
import { buildTiempoIndexPage, buildTiempoProvinciaPage, buildTiempoMunicipioPage, tiempoHeaders } from '../html/tiempo'
import { DATA_SCHEMA_VER } from '../lib/schemas'   // M2: versiona la clave de caché persistente de la predicción

// Contrato de dependencias compartidas que el vertical necesita del runtime del
// index. Se pasan explicitamente (en vez de importarlas) para acotar el radio de
// impacto de la extraccion: index.tsx sigue siendo el dueño de esa infra.
export function registerTiempoRoutes(app: Hono<{ Bindings: Env }>): void {

  // Indice de municipios con predicción para el autocompletado de /tiempo/.
  // Lee public/data/tiempo/municipios.json (generado desde el maestro de AEMET) y
  // devuelve [{n,p,u}]. Cache en memoria (mismo patrón que guardias/itv).
  let muniTiempoIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  app.get('/api/tiempo/municipios', async c => {
    const CACHE = { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }
    if (muniTiempoIndex && Date.now() - muniTiempoIndex.ts < MUNI_INDEX_TTL) {
      return c.json(muniTiempoIndex.data, 200, CACHE)
    }
    const raw = await loadSnapshot<{ municipios: MunicipioLista[] }>(c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
    const data = construyeIndiceMunicipios((raw && raw.municipios) || [])
    muniTiempoIndex = { ts: Date.now(), data }
    return c.json(data, 200, CACHE)
  })

  // ---- El tiempo (AEMET, con suplente Open-Meteo) ----
  // Municipios cargados de tiempo/municipios.json (generado del maestro de AEMET),
  // cacheados en memoria e indexados por provincia y por slug.
  interface TiempoMuniCache {
    ts: number
    byProv: Map<string, MunicipioLista[]>
    provincias: Array<{ slug: string; name: string }>
  }
  let tiempoMuniCache: TiempoMuniCache | null = null
  async function cargaTiempoMunicipios(c: { req: { url: string }; env: Env }): Promise<TiempoMuniCache> {
    if (tiempoMuniCache && Date.now() - tiempoMuniCache.ts < MUNI_INDEX_TTL) return tiempoMuniCache
    const raw = await loadSnapshot<{ municipios: MunicipioLista[] }>(c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
    const all = (raw && raw.municipios) || []
    const byProv = new Map<string, MunicipioLista[]>()
    const provName = new Map<string, string>()
    for (const m of all) {
      const arr = byProv.get(m.provinciaSlug) || []
      arr.push(m)
      byProv.set(m.provinciaSlug, arr)
      provName.set(m.provinciaSlug, m.provinciaNombre)
    }
    const provincias = [...provName.entries()]
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    tiempoMuniCache = { ts: Date.now(), byProv, provincias }
    return tiempoMuniCache
  }

  // Resuelve la predicción de un municipio: Cache API (borde) -> AEMET -> Open-Meteo.
  // La clave de AEMET viene del secreto c.env.AEMET_API_KEY; si falta o AEMET falla,
  // resuelvePrediccion cae a Open-Meteo (etiquetado). Devuelve null si ambas fallan.
  async function resuelveTiempo(c: { env: Env; executionCtx?: { waitUntil: (p: Promise<unknown>) => void } }, m: MunicipioLista): Promise<Prediccion | null> {
    const cache = (caches as unknown as { default: Cache }).default
    const cacheKey = new Request('https://tiempo.cercaya.internal/v' + DATA_SCHEMA_VER + '/' + m.ine)
    try {
      const hit = await cache.match(cacheKey)
      if (hit) { const p = await hit.json() as Prediccion; if (frescuraTiempo(p.elaborado).fiable) return p }
    } catch { /* cache miss/parse: seguimos a la fuente */ }

    let pred: Prediccion
    try {
      pred = await resuelvePrediccion(
        { ine: m.ine, nombre: m.nombre, provincia: m.provinciaNombre, lat: m.lat ?? 0, lng: m.lng ?? 0 },
        { key: (c.env as Record<string, string | undefined>).AEMET_API_KEY },
      )
    } catch { return null }

    // Guardar en caché con TTL segun la fuente (mas corto si vino del suplente).
    try {
      const ttl = pred.fuente === 'AEMET' ? 7200 : 1800
      const resp = new Response(JSON.stringify(pred), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + ttl },
      })
      if (c.executionCtx && c.executionCtx.waitUntil) c.executionCtx.waitUntil(cache.put(cacheKey, resp))
      else await cache.put(cacheKey, resp)
    } catch { /* si el cache put falla, servimos igual */ }
    return pred
  }

  app.get('/tiempo', c => c.redirect('/tiempo/' + (new URL(c.req.url).search || ''), 301))

  app.get('/tiempo/', async c => {
    const { provincias } = await cargaTiempoMunicipios(c)
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/tiempo/'
    return new Response(buildTiempoIndexPage(nonce, provincias, canonical), { headers: tiempoHeaders(nonce) })
  })

  app.get('/tiempo/:prov', async c => {
    const provSlug = c.req.param('prov')
    const { byProv } = await cargaTiempoMunicipios(c)
    const munis = byProv.get(provSlug)
    if (!munis || !munis.length) return c.notFound()
    const municipios = munis
      .map(m => ({ slug: m.slug, nombre: m.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/tiempo/' + provSlug
    return new Response(buildTiempoProvinciaPage(nonce, {
      provinciaSlug: provSlug, provinciaName: munis[0].provinciaNombre, municipios, canonical,
    }), { headers: tiempoHeaders(nonce) })
  })

  app.get('/tiempo/:prov/:mun', async c => {
    const provSlug = c.req.param('prov')
    const munSlug = c.req.param('mun')
    const { byProv } = await cargaTiempoMunicipios(c)
    const munis = byProv.get(provSlug)
    if (!munis) return c.notFound()
    const m = munis.find(x => x.slug === munSlug)
    if (!m) return c.notFound()
    // Snapshot primero (municipios importantes precacheados por el robot): fichero
    // por provincia con las predicciones por código INE. Si está y es fresca, se usa
    // sin llamar a AEMET. Si no (municipio pequeño o snapshot viejo), bajo demanda.
    let pred: Prediccion | null = null
    const snap = await loadSnapshot<{ predicciones: Record<string, Prediccion> }>(
      c.req.url, 'tiempo/snapshot/' + provSlug + '.json', c.env.ASSETS)
    const desdeSnap = snap && snap.predicciones && snap.predicciones[m.ine]
    // Solo servimos el snapshot si es AEMET y fresco: nunca degradamos por debajo
    // del bajo-demanda (que consigue AEMET de uno en uno sin tocar el limite).
    if (desdeSnap && desdeSnap.fuente === 'AEMET' && frescuraTiempo(desdeSnap.elaborado).fiable) pred = desdeSnap
    if (!pred) pred = await resuelveTiempo(c, m)
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/tiempo/' + provSlug + '/' + munSlug
    if (!pred) {
      // Degradación: ni AEMET ni Open-Meteo respondieron.
      return new Response(buildTiempoMunicipioPage(nonce, {
        pred: { ine: m.ine, nombre: m.nombre, provincia: m.provinciaNombre, elaborado: '', fuente: 'AEMET', dias: [] },
        frescura: { fiable: false, horas: Infinity }, provinciaSlug: provSlug, canonical,
      }), { headers: tiempoHeaders(nonce), status: 200 })
    }
    return new Response(buildTiempoMunicipioPage(nonce, {
      pred, frescura: frescuraTiempo(pred.elaborado), provinciaSlug: provSlug, canonical,
    }), { headers: tiempoHeaders(nonce) })
  })
}
