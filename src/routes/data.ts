// Core de datos (proxy Ministerio + snapshot + geo + ops). Extraido de index.tsx (B1).
// Rutas: /api/provincias, /api/municipios/:idProv, /api/estaciones/{provincia,municipio}/:id,
// /api/geocode/reverse, /api/health, /api/tiles/satellite/:z/:x/:y. Importa infra de runtime.
import type { Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import {
  proxiedFetch, loadSnapshot, filterStations, cachedJson,
  geoCache, cacheSizes, slog, clientKey, geoLimiter, SNAPSHOT_STALE_MS,
  buildUserAgent, GEO_TTL_FRESH, GEO_TTL_STALE, GEO_UPSTREAM_TIMEOUT,
} from '../lib/runtime'
import { validateId, isValidProvinciaId, sanitizeLatLng, tokensEqualConstTime } from '../lib/pure'
import { APP_VERSION } from '../lib/version'
import { DATA_SCHEMA_VER } from '../lib/schemas'   // M2: versiona la clave de caché persistente

type MunicipiosSnapshot = { Fecha?: string; Data: Record<string, Array<{ IDMunicipio: string; Municipio: string; IDProvincia: string }>> }
type SnapshotMeta = { fetchedAt?: string; ministryDate?: string; stationCount?: number; source?: string }

export function registerDataRoutes(app: Hono<{ Bindings: Env }>): void {
app.get('/api/provincias', async c => {
  try {
    return c.json(await proxiedFetch('/Listados/Provincias/'), 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch {
    return c.json({ error: 'No se pudo conectar con el Ministerio' }, 503)
  }
})

app.get('/api/municipios/:idProv', async c => {
  const idProv = validateId(c.req.param('idProv'))
  // Doble validacion: regex para descartar basura + allowlist INE (01-52) para
  // bloquear IDs validos en formato pero inexistentes (99999, etc). Sin esto un
  // atacante podria forzar 99998 misses distintos y saturar el upstream.
  if (!idProv || !isValidProvinciaId(idProv)) return c.json({ error: 'ID de provincia invalido' }, 400)
  try {
    return c.json(await proxiedFetch('/Listados/MunicipiosPorProvincia/' + idProv))
  } catch {
    const snap = await loadSnapshot<MunicipiosSnapshot>(c.req.url, 'municipios.json', c.env.ASSETS)
    const list = snap?.Data?.[idProv]
    if (list && list.length) {
      return c.json(list, 200, { 'X-Data-Source': 'snapshot' })
    }
    return c.json({ error: 'Error al cargar municipios' }, 503)
  }
})

app.get('/api/estaciones/provincia/:idProv', async c => {
  const idProv = validateId(c.req.param('idProv'))
  if (!idProv || !isValidProvinciaId(idProv)) return c.json({ error: 'ID de provincia invalido' }, 400)
  try {
    return c.json(await proxiedFetch('/EstacionesTerrestres/FiltroProvincia/' + idProv))
  } catch {
    const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
    const filtered = filterStations(snap, s => s.IDProvincia === idProv)
    if (filtered) return c.json(filtered, 200, { 'X-Data-Source': 'snapshot' })
    return c.json({ error: 'Error al cargar estaciones' }, 503)
  }
})

app.get('/api/estaciones/municipio/:idMun', async c => {
  const idMun = validateId(c.req.param('idMun'))
  if (!idMun) return c.json({ error: 'ID de municipio invalido' }, 400)
  try {
    return c.json(await proxiedFetch('/EstacionesTerrestres/FiltroMunicipio/' + idMun))
  } catch {
    const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
    const filtered = filterStations(snap, s => s.IDMunicipio === idMun)
    if (filtered) return c.json(filtered, 200, { 'X-Data-Source': 'snapshot' })
    return c.json({ error: 'Error al cargar estaciones' }, 503)
  }
})

// ---- Geocoding proxy (OpenStreetMap Nominatim) ----
// Motivacion: hacer este fetch server-side en vez de desde el navegador tiene
// tres beneficios:
//   1. Privacidad: la IP del usuario nunca llega a Nominatim (antes si llegaba).
//   2. Cache: un fetch del servidor sirve muchas peticiones identicas desde
//      distintos clientes.
//   3. Hardening: saneamos la entrada, timeoutamos el upstream, y solo dejamos
//      pasar un conjunto explicito de campos (pick-list) en la respuesta.
// Nominatim Usage Policy (https://operations.osmfoundation.org/policies/nominatim/)
// exige User-Agent identificable, bounded rate, y que cacheemos respuestas.
// Usado por /api/geocode/reverse (favoritas legacy → reverse geocode).
async function upstreamGeo<T>(url: string, host: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(GEO_UPSTREAM_TIMEOUT),
      headers: {
        'User-Agent': buildUserAgent(host),
        'Accept-Language': 'es,en',
      },
    })
    if (!res.ok) {
      slog('warn', 'geo.upstream_status', { status: res.status })
      return null
    }
    return await res.json() as T
  } catch (e) {
    slog('warn', 'geo.upstream_err', { err: String(e).slice(0, 200) })
    return null
  }
}

app.get('/api/geocode/reverse', async c => {
  const rl = geoLimiter.check(clientKey(c))
  if (!rl.allowed) {
    return c.json({ error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }
  const ll = sanitizeLatLng(c.req.query('lat'), c.req.query('lon'))
  if (!ll) return c.json({ error: 'coordenadas invalidas' }, 400)

  const cacheKey = 'r:' + ll.lat + ',' + ll.lng
  const hit = geoCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < GEO_TTL_FRESH) {
    return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' })
  }

  const host = c.req.header('host') || ''
  const out = await cachedJson('v' + DATA_SCHEMA_VER + '/geo-rev-' + encodeURIComponent(cacheKey), 3600, async () => {
    const url = 'https://nominatim.openstreetmap.org/reverse?'
      + 'format=json&zoom=16&addressdetails=1'
      + '&lat=' + encodeURIComponent(ll.lat)
      + '&lon=' + encodeURIComponent(ll.lng)
    const raw = await upstreamGeo<Record<string, unknown>>(url, host)
    if (!raw || typeof raw !== 'object') return null

    // Passthrough restrictivo: solo campos utiles al cliente.
    const o: Record<string, unknown> = {}
    if (typeof raw.display_name === 'string') {
      o.display_name = raw.display_name.length > 300 ? raw.display_name.slice(0, 300) : raw.display_name
    }
    if (raw.address && typeof raw.address === 'object') {
      const a = raw.address as Record<string, unknown>
      const addrOut: Record<string, string> = {}
      // Incluimos state_district y province porque el cliente los usa al adivinar
      // la provincia espanola desde coordenadas (mas fiables que 'state' en Espana).
      const addrKeys = [
        'road','neighbourhood','suburb',
        'village','town','city','municipality',
        'county','state_district','province','state',
        'postcode','country','country_code',
      ]
      for (const k of addrKeys) {
        const v = a[k]
        if (typeof v === 'string' && v.length <= 200) addrOut[k] = v
      }
      o.address = addrOut
    }
    if (typeof raw.lat === 'string') o.lat = raw.lat
    if (typeof raw.lon === 'string') o.lon = raw.lon
    return o
  })

  if (!out) {
    if (hit && Date.now() - hit.ts < GEO_TTL_STALE) {
      return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=600', 'X-Cache': 'STALE' })
    }
    return c.json({}, 200, { 'Cache-Control': 'no-store' })
  }

  geoCache.set(cacheKey, { data: out, ts: Date.now() })
  return c.json(out, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' })
})

// ---- Health check (para monitorizacion sintetica) ----
// Estrategia de exposicion de datos:
//   - Publico (sin token):      { ok, ts }              (minimo imprescindible
//                                                         para uptime monitors)
//   - Con X-Admin-Token valido: { ok, ts, version, snapshot, caches, ... }
//
// Si HEALTH_ADMIN_TOKEN no esta definido (dev), devuelve todo sin gate — no
// romper la experiencia local. En prod se configura el token y las herramientas
// de diagnostico lo envian.
//
// Devuelve 503 si el snapshot del Ministerio es mas viejo que SNAPSHOT_STALE_MS
// (24h) para que health checks disparen alertas — este 503 es PUBLICO porque
// un atacante no gana nada sabiendo que estamos stale (los usuarios ya lo ven).
app.get('/api/health', async c => {
  const meta = await loadSnapshot<SnapshotMeta>(c.req.url, 'snapshot-meta.json', c.env.ASSETS)
  const now = Date.now()
  let snapshotAgeMs: number | null = null
  let stale = false

  if (meta?.fetchedAt) {
    const t = Date.parse(meta.fetchedAt)
    if (Number.isFinite(t)) {
      snapshotAgeMs = now - t
      stale = snapshotAgeMs > SNAPSHOT_STALE_MS
    }
  } else {
    // Sin meta significa que no hay snapshot: lo consideramos stale por
    // precaucion (probablemente el workflow nunca corrio).
    stale = true
  }

  const adminToken = c.env.HEALTH_ADMIN_TOKEN
  const provided = c.req.header('x-admin-token') || ''
  // Comparacion en tiempo constante para evitar que un atacante deduzca el
  // token midiendo respuestas (timing attack). tokensEqualConstTime vive en pure.ts.
  const isAdmin = !adminToken || (provided.length > 0 && tokensEqualConstTime(provided, adminToken))

  // 'version' y 'stale' son publicos: version ya se expone en el cliente
  // (console.info/headers) y stale es deliberadamente publico para que los
  // health checks externos disparen alertas. El resto (snapshot meta, caches,
  // umbrales exactos) sigue gated por HEALTH_ADMIN_TOKEN.
  const bodyPublic: Record<string, unknown> = {
    ok: !stale,
    ts: new Date().toISOString(),
    version: APP_VERSION,
    stale,
  }
  const body = isAdmin
    ? {
        ...bodyPublic,
        caches: cacheSizes(),
        snapshot: meta ?? null,
        snapshotAgeMs,
        staleThresholdMs: SNAPSHOT_STALE_MS,
      }
    : bodyPublic

  if (stale) {
    slog('error', 'health.stale', { ageMs: snapshotAgeMs, meta })
    return c.json(body, 503, { 'Cache-Control': 'no-store' })
  }
  return c.json(body, 200, { 'Cache-Control': 'no-store' })
})

// ---- PROXY DE TILES SATELITE (CORS) ----
// Esri World Imagery NO envia cabeceras Access-Control-Allow-Origin, asi que
// L.TileLayer (etiquetas <img>) los puede mostrar pero MapLibre GL los intenta
// via fetch() y falla con CORS error. Para que la vista satelite use el MISMO
// L.maplibreGL que la vista normal (con toda la toponimia Liberty integrada y
// el satelite como raster-source dentro del style), necesitamos que los tiles
// se sirvan con CORS OK. Los reempaquetamos desde nuestro Worker:
//   - Validamos {z,x,y} como enteros razonables (evita proxear urls raras).
//   - Fetch a Esri sin credenciales.
//   - Re-emitimos con Access-Control-Allow-Origin: * y Cache-Control largo
//     (los tiles raster son inmutables — la ortofoto no cambia por semana).
// El runtime de Cloudflare cachea el upstream automaticamente via el cache
// interno del fetch (si el upstream no pone ETag usamos nuestro Cache-Control).
app.get('/api/tiles/satellite/:z/:x/:y', async c => {
  const z = Number(c.req.param('z'))
  const x = Number(c.req.param('x'))
  const y = Number(c.req.param('y'))
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) ||
      z < 0 || z > 20 || x < 0 || y < 0) {
    return c.text('bad tile', 400, { 'Access-Control-Allow-Origin': '*' })
  }
  const upstream = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
  try {
    // El cacheado lo maneja Cloudflare en el edge via el Cache-Control que
    // devolvemos abajo (max-age=86400 immutable) — no necesitamos pasar cf:{}
    // en el fetch (ademas tipa conflictivamente con RequestInit).
    const up = await fetch(upstream)
    if (!up.ok) return c.text('upstream ' + up.status, 502, { 'Access-Control-Allow-Origin': '*' })
    const body = await up.arrayBuffer()
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': up.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (_e) {
    return c.text('proxy error', 502, { 'Access-Control-Allow-Origin': '*' })
  }
})
}
