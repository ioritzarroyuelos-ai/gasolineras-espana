import { Hono } from 'hono'
import { buildLandingPage, landingHeaders, type LandingData, type LandingTiempo } from './html/landing'
import { mastheadHtml, MASTHEAD_CSS } from './html/masthead'
// Lógica del tiempo compartida con el robot/tests (scripts/lib/tiempo.mjs + .d.mts).
// Las rutas /tiempo/* viven en src/routes/tiempo.ts; aqui solo quedan los usos
// residuales del tiempo en la portada (franjaTiempo) y en sitemap-tiempo.xml.
import { frescuraTiempo } from '../scripts/lib/tiempo.mjs'
import type { MunicipioLista, Prediccion } from '../scripts/lib/tiempo.mjs'
import { buildObservatorioPage, observatorioHeaders, type Variacion } from './html/observatorio'
import {
  buildObservatorio, observatorioFromPre, calculaVariaciones,
  type ObservatorioPre, type FilaHistorico,
} from './lib/observatorio'
// Las rutas /itv/* viven en src/routes/itv.ts; aqui solo quedan los usos de ITV
// en sitemap.xml (parseItv/provinciasConItv/municipiosConItv/estacionesDeProvincia).
import {
  parseItv, provinciasConItv, municipiosConItv, estacionesDeProvincia,
  type ItvFile,
} from './lib/itv'
// Las rutas /farmacias/* viven en src/routes/farmacias.ts; estas funciones siguen
// aqui porque las usa sitemap-guardias.xml (guardiasForMunicipio si se fue al modulo).
import {
  guardiasFileForProvincia, parseGuardias, guardiasForProvincia,
  municipiosConGuardia, frescuraGuardia,
  GUARDIAS_TERRITORIO_BY_PROVINCIA, type GuardiasFile,
} from './lib/guardias'
// La sesion Google + sync KV viven en src/routes/auth.ts. Aqui solo quedan los
// tokens firmados de Telegram (los usa tgChatFromAuth, aun en index).
import { signTelegramToken, verifyTelegramToken } from './lib/auth'
import { BRAND } from './lib/brand'
import { resumenFromPre } from './lib/gasolineras-precalculo'
import {
  validateId,
  isValidProvinciaId,
  sanitizeLatLng,
  originAllowed,
  canonicalSite,
  tokensEqualConstTime,
  classifyPriceVsCycle,
} from './lib/pure'
import { APP_VERSION } from './lib/version'
// LRU/SlidingWindowLimiter y los schemas del Ministerio (MinistryResponseSchema…)
// se movieron a src/lib/runtime.ts junto con las cachés, limiters y proxiedFetch.
import { PROVINCIAS, provinciaBySlug } from './lib/provincias'
// Las rutas /gasolineras/* viven en src/routes/gasolineras.ts (junto con buildPage,
// los builders y municipiosInProvincia/findMunicipioBySlug/statsForMunicipio/
// topCheapestStationsIn/StationLite). Aqui se quedan topMunicipiosInProvincia
// (sitemap.xml) y statsNacional (portada /).
import { topMunicipiosInProvincia, statsNacional } from './lib/municipios'
import { registerTiempoRoutes } from './routes/tiempo'
import { registerItvRoutes } from './routes/itv'
import { registerFarmaciasRoutes } from './routes/farmacias'
import { registerGasolinerasRoutes } from './routes/gasolineras'
import { registerAuthRoutes } from './routes/auth'
import { registerHomeRoutes } from './routes/home'
import { registerMetaRoutes } from './routes/meta'
import { registerAdminRoutes } from './routes/admin'
import {
  snapshotToRows,
  buildInsertBatches,
  todayUtc,
  purgeCutoffDate,
  FUEL_CODES,
  centsToEuros,
  hydrateDedupe,
} from './lib/history'

// Infra compartida del servidor (logger, cachés, fetch al Ministerio, snapshots,
// histórico estático, CORS/host, rate-limiters, nonce/CSP, cabeceras) vive en
// src/lib/runtime.ts (B1). Los tipos del snapshot se definen alli; se re-exportan
// para que los módulos de ruta sigan usando import type { MinistryResponse } from ../index.
import {
  slog, srvCache, snapshotCache, geoCache, buildUserAgent, cachedJson, proxiedFetch,
  loadSnapshot, filterStations, incrementIsoDate, maxIsoDate,
  loadStaticHistoryForStation, loadStaticMedianForProvince, loadStaticNational,
  ALLOWED_ORIGINS, resolveHost, resolveScheme,
  apiLimiter, ingestLimiter, geoLimiter, cspLimiter, errLimiter, histLimiter,
  exportLimiter, reportLimiter, vitalsLimiter, clientKey, authorizeCron,
  genNonce, pageHeaders,
  SNAPSHOT_STALE_MS, MUNI_INDEX_TTL, GEO_TTL_FRESH, GEO_TTL_STALE, GEO_UPSTREAM_TIMEOUT,
} from './lib/runtime'
import type { MinistryResponse, StationRecord } from './lib/runtime'
export type { MinistryResponse, StationRecord }
type MunicipiosSnapshot = {
  Fecha?: string
  Data: Record<string, Array<{ IDMunicipio: string; Municipio: string; IDProvincia: string }>>
}
type SnapshotMeta = {
  fetchedAt?: string
  ministryDate?: string
  stationCount?: number
  source?: string
}

// ---- ENV ----
// Exportado para que los sub-modulos de rutas (src/routes/*) tipen `app` y el
// contexto sin duplicar el shape. Es import type-only alli -> sin ciclo en runtime.
// ASSETS: binding automatico de Cloudflare Pages (sirve /public).
// TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY: opcionales. Si estan, /api/ingest
//   exige token valido. Si faltan, el reto se omite (modo dev sin cuenta Cloudflare).
// HEALTH_ADMIN_TOKEN: si se define, /api/health solo devuelve detalle (snapshot,
//   cache sizes) cuando la peticion trae 'X-Admin-Token: <valor>'. Sin header,
//   devuelve solo { ok, ts }. Sin env var, devuelve todo (modo dev).
// DB: binding D1 con el historico de precios (migrations/0001_price_history.sql).
//   Solo esta presente en deploys con el binding configurado — en dev sin D1,
//   los endpoints de historico responden 503 "historia no disponible".
// PUBLIC_ORIGIN: dominio publico (https://webapp.pages.dev) usado por el cron
//   scheduled() para fetchear el snapshot estatico de /data/stations.json
//   (mismo path que consume loadSnapshot en peticiones normales).
// `meta` de D1 trae el contador de filas afectadas por UPDATE/DELETE — lo
// usamos para construir respuestas tipo { acknowledged: N }. En runtime real
// de Workers esto viene siempre poblado; el tipo opcional es para no romper
// si Cloudflare cambia la forma en el futuro.
type D1RunResult = { meta?: { changes?: number; last_row_id?: number }; success?: boolean }
type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement
  run: () => Promise<D1RunResult>
  all: <T = unknown>() => Promise<{ results: T[] }>
}
type D1Database = {
  prepare: (sql: string) => D1PreparedStatement
  batch: (statements: D1PreparedStatement[]) => Promise<unknown[]>
  exec: (sql: string) => Promise<unknown>
}
export type Env = {
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  HEALTH_ADMIN_TOKEN?: string
  DB?: D1Database
  PUBLIC_ORIGIN?: string
  // CRON_TOKEN: shared secret entre GitHub Actions y el Worker. GHA manda
  // `Authorization: Bearer <CRON_TOKEN>` en los POST a /api/cron/*. Si no
  // esta definido, los endpoints de cron responden 503 (modo dev sin cron).
  CRON_TOKEN?: string
  // Ship 25: bot de Telegram dedicado para alertas de bajadas de precio.
  // Sustituye a Web Push (Ship 23, retirado). Si alguna falta, los endpoints
  // /api/telegram/* responden 503 y el panel de alertas se oculta del UI.
  //   TELEGRAM_BOT_TOKEN      — secret_text. Dado por @BotFather al crear el bot.
  //   TELEGRAM_BOT_USERNAME   — plain_text. Username sin @, ej: "GasAlertasEsBot".
  //                             Se expone al cliente para construir deep links
  //                             t.me/<username>?start=<token>.
  //   TELEGRAM_WEBHOOK_SECRET — secret_text. Random que pasamos a setWebhook y
  //                             luego validamos en el header
  //                             `X-Telegram-Bot-Api-Secret-Token` de cada update.
  //                             Evita que un atacante simule updates al webhook.
  TELEGRAM_BOT_TOKEN?:      string
  TELEGRAM_BOT_USERNAME?:   string
  TELEGRAM_WEBHOOK_SECRET?: string
  // Ship 25.2: URL de la plataforma de donaciones/propinas que se renderiza en
  // el boton "Invitame a un cafe" del footer. Si no esta definida o no es una
  // URL http(s) valida, el boton se omite del render (sin layout shift).
  // Valores aceptados: https://ko-fi.com/<handle>, https://buymeacoffee.com/<handle>,
  //                    https://paypal.me/<handle>, https://github.com/sponsors/<handle>.
  // Configurar con: npx wrangler pages secret put SUPPORT_URL --project-name=webapp
  SUPPORT_URL?: string
  // ---- Google OAuth + KV sync (Ship 26) ----
  // GOOGLE_CLIENT_ID: publico, se inyecta en el HTML para inicializar GIS.
  GOOGLE_CLIENT_ID?: string
  // SESSION_SECRET: secret (wrangler pages secret put). Firma los JWT de sesion
  // con HMAC-SHA256. Si falta, /api/auth/* responde 503.
  SESSION_SECRET?: string
  // USER_DATA: KV namespace para sincronizar datos del usuario (favoritas,
  // diario, rutas, perfil). Si falta, /api/sync/* responde 503 pero el login
  // sigue funcionando sin persistencia cross-device.
  USER_DATA?: KVNamespace
}
// Shape minima de KVNamespace (solo lo que usamos). Evita dep en @cloudflare/workers-types.
type KVNamespace = {
  get: (key: string, opts?: { type?: 'text' | 'json' }) => Promise<unknown>
  put: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>
  delete: (key: string) => Promise<void>
  list: (opts?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>
}

const app = new Hono<{ Bindings: Env }>()

// APP_VERSION se importa desde ./lib/version para romper el ciclo de imports
// con ./html/shell. Se expone via /api/health.
export { APP_VERSION }

app.use('/api/*', async (c, next) => {
  const origin = c.req.header('origin') || ''
  const host   = c.req.header('host')   || ''
  if (!originAllowed(origin, host, ALLOWED_ORIGINS)) {
    slog('warn', 'cors.block', { origin, host, path: c.req.path })
    return c.json({ error: 'forbidden origin' }, 403)
  }

  // Rate-limit salvo OPTIONS (preflight) y /api/health (monitorizacion)
  if (c.req.method !== 'OPTIONS' && c.req.path !== '/api/health') {
    const rl = apiLimiter.check(clientKey(c))
    if (!rl.allowed) {
      slog('warn', 'ratelimit.block', { key: clientKey(c), path: c.req.path })
      return c.json({ error: 'rate limited' }, 429, {
        'Retry-After': String(rl.retryAfterSec),
        'X-RateLimit-Limit': '120',
        'X-RateLimit-Remaining': '0',
      })
    }
    c.header('X-RateLimit-Limit', '120')
    c.header('X-RateLimit-Remaining', String(rl.remaining))
  }

  await next()
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
  }
})


// ---- Portada (/) + Observatorio (/precios-carburantes) ----
// Rutas en src/routes/home.ts (incluye el helper franjaTiempo). Se registran aqui
// para que `/` siga siendo la primera ruta. Ambas son paths estaticos exactos: no
// hay shadowing con las rutas namespaced de los verticales.
registerHomeRoutes(app)

// ---- Gasolineras (precios del Ministerio) ----
// Rutas en src/routes/gasolineras.ts: /gasolineras (301), /api/gasolineras/municipios,
// /gasolineras/ (buscador), /gasolineras/mapa (SPA), /gasolineras/:slug (SEO provincia)
// y /gasolineras/:prov/:mun (SEO municipio). Orden interno critico (/gasolineras/mapa
// ANTES de /gasolineras/:slug); preservado en el modulo.
registerGasolinerasRoutes(app, { loadSnapshot, genNonce, MUNI_INDEX_TTL, slog, pageHeaders })

// ---- Farmacias de guardia ----
// Rutas en src/routes/farmacias.ts: /farmacias, /farmacias/, /farmacias/guardia,
// /api/guardias/municipios, /farmacias/:prov, /farmacias/:prov/:mun. Orden interno
// critico (/farmacias/guardia ANTES de /farmacias/:prov); preservado en el modulo.
registerFarmaciasRoutes(app, { loadSnapshot, genNonce, resolveScheme, resolveHost, MUNI_INDEX_TTL })

// Vertical del tiempo (AEMET + Open-Meteo). Rutas en src/routes/tiempo.ts:
// /api/tiempo/municipios, /tiempo, /tiempo/, /tiempo/:prov, /tiempo/:prov/:mun.
// Se registran aqui para preservar el orden relativo al resto de verticales.
registerTiempoRoutes(app, { loadSnapshot, genNonce, resolveScheme, resolveHost, MUNI_INDEX_TTL })

// ---- ITV (datos del FeatureServer de la DGT) ----
// Rutas en src/routes/itv.ts: /api/itv/municipios, /itv/, /itv, /itv/precios,
// /itv/:prov, /itv/:prov/:mun. El orden interno importa (/itv/precios ANTES de
// /itv/:provinciaSlug); se preserva dentro del modulo.
registerItvRoutes(app, { loadSnapshot, genNonce, resolveScheme, resolveHost, MUNI_INDEX_TTL })

// ---- SEO: robots.txt ----
// ---- META/SEO ----
// Rutas en src/routes/meta.ts: /robots.txt, /sitemap*.xml, /status, /privacidad.
// Paths estaticos exactos (sin :param, sin catch-all) -> orden neutro.
registerMetaRoutes(app)

// ---- API ----

// ---- Auth (Google Sign-In + sesion JWT + sync KV) ----
// Rutas en src/routes/auth.ts: /api/auth/google, /api/auth/logout, /api/me,
// /api/sync (GET) y /api/sync/:key (PUT/DELETE). Degradacion: sin
// GOOGLE_CLIENT_ID/SESSION_SECRET -> 503; sin USER_DATA -> /api/sync 503.
registerAuthRoutes(app, { ingestLimiter, clientKey, slog })

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
  const out = await cachedJson('geo-rev-' + encodeURIComponent(cacheKey), 3600, async () => {
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
        caches: {
          srv: (srvCache as unknown as { size: number }).size,
          snapshot: (snapshotCache as unknown as { size: number }).size,
          geo: (geoCache as unknown as { size: number }).size,
        },
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

// ---- HISTORICO DE PRECIOS (D1) ----
// Devuelve la serie temporal de una estacion para N dias. Lee de D1 (tabla
// price_history, poblada por scheduled() diario). Si el binding DB no existe
// (dev local sin `wrangler d1 create`), respondemos 503 sin romper la UI —
// el cliente muestra "historial no disponible" en el popup.
//
// Respuesta:
//   { station_id, days, series: { '95': [{date, price}, ...], '98': [...], ... } }
//
// 'days' limitado a [1, 365] para acotar el trabajo por request. 365d de 4
// combustibles son 1460 filas max — serializado sale ~40 KB gzip, razonable.
//
// Cache-Control: public, max-age=3600. El dato cambia como mucho 1 vez/dia
// (cron a las 20:00 UTC), asi que 1h de CDN cache es conservador y evita que
// cualquier viral-tweet nos dispare 100k reads/hora contra D1.
app.get('/api/history/:stationId', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  // IDEESS: 1-10 digitos. Misma regla que snapshotToRows y validateId,
  // reproducida aqui porque la param del path no pasa por validateId().
  const stationId = c.req.param('stationId')
  if (!stationId || !/^\d{1,10}$/.test(stationId)) {
    return c.json({ error: 'invalid_station_id' }, 400)
  }

  // ?days=N con clamp [1, 365]. Default 30 = sweet spot para un sparkline
  // legible sin abrumar al servidor.
  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  // Cutoff = hoy - days. Usamos el mismo formato YYYY-MM-DD que usa la tabla
  // para evitar conversiones timezone-sensitive.
  const today = new Date()
  const cutoffDate = new Date(today.getTime())
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const todayIso = today.toISOString().slice(0, 10)

  // Series base por fuel — la rellenamos primero desde el JSON estatico (si
  // existe) y luego sobreescribimos con datos D1 para fechas mas recientes.
  // El JSON estatico lo mantiene al dia el bot (scripts/actualiza-historico-estatico.mjs
  // tras cada foto de precios), asi que normalmente llega hasta hoy y D1 no se
  // consulta; solo si el bot fallara un dia se pediria ese dia a D1.
  const series: Record<string, Array<{ date: string; price: number }>> = {}
  for (const f of FUEL_CODES) series[f] = []
  let staticTo: string | null = null

  try {
    const staticData = await loadStaticHistoryForStation(c.req.url, stationId, c.env.ASSETS)
    if (staticData) {
      staticTo = staticData.to
      // Filtrar al rango [cutoff, today] e hidratar (re-expandir el dedupe a
      // un punto por dia para que el sparkline interpole correctamente sin
      // falsas rampas entre cambios distantes).
      for (const fuel of FUEL_CODES) {
        const dedup = staticData.byFuel[fuel]
        if (!dedup || dedup.length === 0) continue
        series[fuel] = hydrateDedupe(dedup, cutoff, todayIso)
      }
    }
  } catch (err) {
    // Fallback silencioso: si el JSON estatico falla, seguimos con D1 solo.
    slog('warn', 'history.static_load_failed', {
      stationId,
      err: String(err).slice(0, 200),
    })
  }

  // D1: leemos el rango que NO cubre el JSON estatico, o todo si no hay JSON.
  // Los datos D1 sobreescriben (priorizan) sobre el JSON para esas fechas — el
  // cron diario es la fuente mas reciente; el JSON estatico es snapshot fijo.
  if (c.env.DB) {
    const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoff) : cutoff
    if (d1From <= todayIso) {
      try {
        const stmt = c.env.DB
          .prepare('SELECT fuel_code, date, price_cents FROM price_history WHERE station_id = ? AND date >= ? ORDER BY date ASC')
          .bind(stationId, d1From)
        const { results } = await stmt.all<{ fuel_code: string; date: string; price_cents: number }>()
        // Mergear: usamos un Map por fecha para que D1 sobreescriba a JSON
        // (en caso de overlap) y mantengamos un solo punto por (fuel, date).
        for (const f of FUEL_CODES) {
          const arr = series[f]
          if (arr.length === 0) continue
          // Indexar serie estatica por fecha para sobreescritura barata.
          const byDate = new Map<string, { date: string; price: number }>()
          for (const p of arr) byDate.set(p.date, p)
          series[f] = Array.from(byDate.values())
        }
        for (const r of results) {
          const arr = series[r.fuel_code]
          if (!arr) continue
          // Mantener orden cronologico al insertar/sobreescribir.
          const idx = arr.findIndex(p => p.date === r.date)
          const point = { date: r.date, price: centsToEuros(r.price_cents) }
          if (idx >= 0) arr[idx] = point
          else arr.push(point)
        }
        // Re-ordenar por fecha (los append D1 pueden venir despues que los
        // dias hidratados; cheap sort de ~365 elementos).
        for (const f of FUEL_CODES) {
          series[f].sort((a, b) => a.date.localeCompare(b.date))
        }
      } catch (err) {
        slog('error', 'history.query_failed', {
          stationId,
          days,
          err: String(err).slice(0, 300),
        })
        // Si la consulta D1 falla pero tenemos serie estatica, devolvemos eso.
        if (!staticTo) {
          return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
        }
      }
    }
  } else if (!staticTo) {
    // Ni D1 ni JSON estatico (dev sin binding y sin assets): 503 para que
    // el cliente muestre UI de "historial no disponible".
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  return c.json(
    { station_id: stationId, days, series },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  )
})

// Mediana provincial por dia para un combustible. Se dibuja como linea de
// referencia en el sparkline del popup para que el usuario vea si esta
// gasolinera esta "por encima" o "por debajo" de la media de su provincia.
//
// Entrada: :id = IDProvincia (2 digitos), ?fuel=95|98|diesel|diesel_plus,
//          ?days=[1,365] (default 30).
// Salida: { provincia_id, fuel, days, median: [{date, price}, ...] }
//
// La mediana se calcula en Cloudflare, no en SQL — SQLite no tiene PERCENTILE
// nativo. Traemos todos los precios del periodo, agrupamos por date en memoria
// y ordenamos. Coste acotado: ~800 estaciones/provincia × 30 dias = 24k rows
// max (provincia grande), que procesar en JS es trivial.
app.get('/api/history/province/:id', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const id = c.req.param('id')
  if (!isValidProvinciaId(id)) {
    return c.json({ error: 'invalid_province_id' }, 400)
  }

  const fuel = c.req.query('fuel') || ''
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  const cutoffDate = new Date()
  const todayDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const todayIso = todayDate.toISOString().slice(0, 10)

  // Median[date] = cents. La rellenamos primero desde el JSON estatico (mediana
  // pre-calculada por buildMedianFile en backfill-static-history.mjs), luego
  // sobreescribimos con datos D1 para fechas posteriores al `to` del JSON.
  // Para el JSON estatico no hace falta hidratar: la mediana ya es un punto
  // por dia (no esta dedupeada) en el archivo.
  const medianByDate = new Map<string, number>()
  let staticTo: string | null = null

  try {
    const staticMedian = await loadStaticMedianForProvince(c.req.url, id, fuel, c.env.ASSETS)
    if (staticMedian) {
      staticTo = staticMedian.to
      for (const [date, cents] of staticMedian.points) {
        if (date >= cutoff && date <= todayIso) {
          medianByDate.set(date, cents)
        }
      }
    }
  } catch (err) {
    slog('warn', 'history.static_median_load_failed', {
      provinciaId: id,
      fuel,
      err: String(err).slice(0, 200),
    })
  }

  // D1: solo consultamos el rango NO cubierto por el JSON estatico. Si no hay
  // JSON estatico (provincia sin backfill), consultamos todo.
  if (c.env.DB) {
    const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoff) : cutoff
    if (d1From <= todayIso) {
      // Para mediana D1 necesitamos la lista de stationIds de la provincia.
      const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      if (snap && Array.isArray(snap.ListaEESSPrecio)) {
        const stationIds = snap.ListaEESSPrecio
          .filter(s => s.IDProvincia === id && typeof s['IDEESS'] === 'string' && /^\d{1,10}$/.test(s['IDEESS']))
          .map(s => s['IDEESS'] as string)

        if (stationIds.length > 0) {
          // D1 limita a 100 parametros bound por query. Con 2 fijos (fuel, cutoff)
          // podemos meter como mucho 98 station_ids por sub-query. Paginamos en
          // chunks de 90 (margen) y consultamos en paralelo — Madrid (~900 estaciones)
          // sale en 10 sub-queries, milisegundos en total.
          const CHUNK = 90
          const sqlTemplate = (n: number) =>
            `SELECT date, price_cents FROM price_history WHERE fuel_code = ? AND date >= ? AND station_id IN (${new Array(n).fill('?').join(',')})`
          try {
            const queries: Promise<{ results: Array<{ date: string; price_cents: number }> }>[] = []
            for (let i = 0; i < stationIds.length; i += CHUNK) {
              const slice = stationIds.slice(i, i + CHUNK)
              const sql = sqlTemplate(slice.length)
              queries.push(
                c.env.DB.prepare(sql).bind(fuel, d1From, ...slice)
                  .all<{ date: string; price_cents: number }>()
              )
            }
            const subResults = await Promise.all(queries)
            // Agrupa por dia y calcula la mediana (valor central) — mismo
            // algoritmo que el JSON estatico para que ambos sean consistentes.
            const byDate = new Map<string, number[]>()
            for (const sr of subResults) for (const r of sr.results) {
              let arr = byDate.get(r.date)
              if (!arr) { arr = []; byDate.set(r.date, arr) }
              arr.push(r.price_cents)
            }
            for (const [date, arr] of byDate) {
              arr.sort((a, b) => a - b)
              const mid = arr[Math.floor(arr.length / 2)]
              medianByDate.set(date, mid)  // sobreescribe JSON estatico si hay solapamiento
            }
          } catch (err) {
            slog('error', 'history.province_median_failed', {
              provinciaId: id,
              fuel,
              days,
              err: String(err).slice(0, 300),
            })
            // Si D1 falla pero tenemos serie estatica, devolvemos eso.
            if (!staticTo) {
              return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
            }
          }
        }
      }
    }
  } else if (!staticTo) {
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  const median: Array<{ date: string; price: number }> = []
  const dates = Array.from(medianByDate.keys()).sort()
  for (const date of dates) {
    median.push({ date, price: centsToEuros(medianByDate.get(date)!) })
  }

  return c.json(
    { provincia_id: id, fuel, days, median },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  )
})

// ---- STATS NACIONALES (Ship 15) ----
// Precio medio nacional por dia para los dos combustibles mas consumidos
// (gasolina 95 + gasoleo A). Devuelve, para cada fuel:
//
//   - today     : media del ultimo dia disponible en la serie
//   - avg30d    : media simple de las medias diarias del periodo
//   - delta_pct : (today - avg30d) / avg30d * 100 — positivo = mas caro hoy
//   - samples   : cuantas estaciones aportaron hoy (sanity check / confianza)
//
// La serie diaria (media de centimos por dia y combustible) la deja el bot en
// history/national.json; aqui solo se agrega la ventana pedida. Es media, no
// mediana, por continuidad con lo que calculaba AVG(price_cents) en D1: a escala
// nacional con ~11k estaciones/dia, el 5% de outliers raramente desplaza la
// media > 1 cent — acceptable.
//
// Motivacion: el usuario abre la app en la home sin saber si el precio que ve
// en su ciudad es "bueno" o "malo" en contexto. Un "precio medio nacional
// hoy: 1.48 € ↓ 0.2% vs. 30d" da contexto inmediato.
//
// Cache-Control: public, max-age=3600 — igual que history/*. Tras cada foto
// del bot los valores cambian, pero entre fotos son constantes.
type StatFuelRow = { date: string; fuel_code: string; avg_cents: number; n?: number }

interface NationalStatsFuel {
  today: number | null
  avg30d: number | null
  delta_pct: number | null
  samples_today: number | null
  days_available: number
  last_date: string | null
}

// Agrega el precio medio nacional a partir de una serie diaria ya calculada
// (una fila por dia y combustible), hoy la de history/national.json. Devuelve
// exactamente la forma que espera el cliente (core.ts).
function computeNationalStats(rows: StatFuelRow[], days: number): { days: number; fuels: Record<string, NationalStatsFuel> } {
  const FUELS = ['95', 'diesel'] as const
  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  const byFuel = new Map<string, StatFuelRow[]>()
  for (const f of FUELS) byFuel.set(f, [])
  for (const r of rows) {
    if (r.date < cutoff) continue
    const arr = byFuel.get(r.fuel_code)
    if (arr) arr.push(r)
  }

  const out: Record<string, NationalStatsFuel> = {}
  for (const fuel of FUELS) {
    const arr = (byFuel.get(fuel) || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    if (arr.length === 0) {
      out[fuel] = { today: null, avg30d: null, delta_pct: null, samples_today: null, days_available: 0, last_date: null }
      continue
    }
    const last = arr[arr.length - 1]
    const todayEur = centsToEuros(Math.round(last.avg_cents))
    let sum = 0
    for (const r of arr) sum += r.avg_cents
    const avgCents = sum / arr.length
    const avgEur = centsToEuros(Math.round(avgCents))
    const deltaPct = avgCents > 0 ? ((last.avg_cents - avgCents) / avgCents) * 100 : 0
    out[fuel] = {
      today: todayEur,
      avg30d: avgEur,
      delta_pct: Math.round(deltaPct * 100) / 100,
      samples_today: typeof last.n === 'number' ? last.n : null,
      days_available: arr.length,
      last_date: last.date,
    }
  }
  return { days, fuels: out }
}

app.get('/api/stats/national', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 7 || n > 90) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  const CACHE = { 'Cache-Control': 'public, max-age=3600' }

  // Serie diaria de history/national.json (10 min en memoria via loadSnapshot).
  // Sin fichero no hay respaldo en D1 a proposito: reagregar ~2,1 M de filas en
  // cada visita es lo que agoto el cupo diario del plan gratuito. La home sale
  // sin el bloque de precios ese dia, igual que cuando D1 no respondia.
  let rows: FilaHistorico[] | null = null
  try {
    rows = await loadStaticNational(c.req.url, c.env.ASSETS)
  } catch (err) {
    slog('warn', 'stats.static_load_failed', { err: String(err).slice(0, 200) })
  }
  if (!rows) {
    slog('error', 'stats.national_unavailable', { days })
    return c.json({ error: 'stats_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }
  return c.json(computeNationalStats(rows, days), 200, CACHE)
})

// ---- PREDICTOR SEMANAL (D1 + classifyPriceVsCycle) ----
// "¿Lleno ahora o espero?" — dada una estacion y combustible, lee los precios
// observados en los ultimos 90 dias en el MISMO DIA DE LA SEMANA que hoy y
// los compara con el precio actual. Devuelve un veredicto 'buy_now' / 'wait' /
// 'neutral' + percentil + muestra de control.
//
// Respuesta (ejemplo):
//   { station_id, fuel, verdict:"buy_now", percentile:15, sampleCount:12,
//     tipicalEurL:1.589, confidence:"high", currentEurL:1.569 }
//
// El precio "actual" lo enviamos via query ?current=1.569 para evitar otra
// ida y vuelta D1 (el cliente ya lo tiene del snapshot del Ministerio). El
// servidor solo valida que sea finito + positivo + dentro de rango (0.5 .. 5).
// Si no viene, intentamos inferirlo de la ultima muestra en D1.
//
// Cache-Control: public, max-age=3600 — la ventana cambia una vez al dia con
// el cron de ingest, asi que 1h de CDN es seguro y corta cualquier viral hit.
app.get('/api/predict/:stationId', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const stationId = c.req.param('stationId')
  if (!stationId || !/^\d{1,10}$/.test(stationId)) {
    return c.json({ error: 'invalid_station_id' }, 400)
  }

  const fuel = c.req.query('fuel') || ''
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  // Precio actual: opcional, pero si viene lo validamos. 0.5-5 €/L cubre
  // cualquier combustible plausible (hidrogeno esta en ~9€/kg pero lo
  // expresamos por L-equivalente, asi que acotamos generoso).
  const curRaw = c.req.query('current')
  let currentEurL: number | null = null
  if (curRaw != null) {
    const n = parseFloat(curRaw.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0.1 || n > 10) {
      return c.json({ error: 'invalid_current' }, 400)
    }
    currentEurL = n
  }

  const now = new Date()
  const weekday = now.getUTCDay()      // 0=Dom .. 6=Sab (UTC — consistente con date UTC en D1)
  const cutoff = new Date(now.getTime())
  cutoff.setUTCDate(cutoff.getUTCDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const todayIso = now.toISOString().slice(0, 10)

  try {
    // Muestras del mismo dia de la semana en los ultimos 90d. Las recolectamos
    // primero del JSON estatico (1 año de backfill — ~13 muestras del weekday
    // garantizadas) y luego mergeamos con D1 para los dias mas recientes que
    // no cubre el JSON. Sin esta combinacion, los primeros 90d del cron diario
    // dejan <4 muestras y `classifyPriceVsCycle` marca confidence='low' →
    // el badge muestra "poca muestra".
    const samplesByDate = new Map<string, number>()  // D1 sobreescribe JSON
    let staticTo: string | null = null
    let lastKnownEurL: number | null = null  // fallback de currentEurL si no hay D1

    try {
      const staticData = await loadStaticHistoryForStation(c.req.url, stationId, c.env.ASSETS)
      if (staticData) {
        staticTo = staticData.to
        const dedup = staticData.byFuel[fuel]
        if (dedup && dedup.length > 0) {
          // Hidratamos el dedupe a un punto por dia y filtramos por weekday.
          // El hidratado es necesario porque el dedupe solo guarda cambios:
          // si el ultimo cambio fue hace 30 dias, todos los weekdays despues
          // mantienen ese precio y deben contar como muestras.
          const points = hydrateDedupe(dedup, cutoffStr, todayIso)
          for (const p of points) {
            if (new Date(p.date + 'T00:00:00Z').getUTCDay() === weekday) {
              samplesByDate.set(p.date, p.price)
            }
          }
          // Ultimo precio conocido del JSON (cualquier dia). Fallback para
          // currentEurL cuando no hay D1 ni viene en query.
          lastKnownEurL = dedup[dedup.length - 1][1] / 1000
        }
      }
    } catch (err) {
      slog('warn', 'predict.static_load_failed', {
        stationId,
        err: String(err).slice(0, 200),
      })
    }

    // D1: rango que NO cubre el JSON estatico, mismo weekday. SQLite no tiene
    // DAYOFWEEK pero strftime('%w', date) devuelve 0-6 (0=Dom). Si no hay JSON,
    // D1 cubre el rango completo 90d.
    if (c.env.DB) {
      const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoffStr) : cutoffStr
      if (d1From <= todayIso) {
        try {
          const stmt = c.env.DB
            .prepare(
              `SELECT date, price_cents
               FROM price_history
               WHERE station_id = ?
                 AND fuel_code  = ?
                 AND date       >= ?
                 AND CAST(strftime('%w', date) AS INTEGER) = ?
               ORDER BY date ASC`
            )
            .bind(stationId, fuel, d1From, weekday)
          const { results } = await stmt.all<{ date: string; price_cents: number }>()
          for (const r of results) {
            samplesByDate.set(r.date, centsToEuros(r.price_cents))
          }
        } catch (err) {
          slog('error', 'predict.query_failed', {
            stationId,
            fuel,
            err: String(err).slice(0, 300),
          })
          // Si la query D1 falla pero tenemos JSON estatico, seguimos con eso.
          if (!staticTo) {
            return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
          }
        }
      }

      // Fallback de currentEurL: ultima muestra cualquiera (no solo weekday).
      // Query separada para no contaminar la lista de muestras del predictor.
      if (currentEurL == null) {
        try {
          const last = await c.env.DB
            .prepare('SELECT price_cents FROM price_history WHERE station_id = ? AND fuel_code = ? ORDER BY date DESC LIMIT 1')
            .bind(stationId, fuel)
            .all<{ price_cents: number }>()
          if (last.results.length > 0) {
            currentEurL = centsToEuros(last.results[0].price_cents)
          }
        } catch {
          // ignoramos: caera al fallback del JSON o devolvera verdict=null
        }
      }
    } else if (!staticTo) {
      // Ni D1 ni JSON estatico (dev sin binding y sin assets).
      return c.json({ error: 'predict_unavailable' }, 503, { 'Cache-Control': 'no-store' })
    }

    // Si seguimos sin currentEurL (sin D1, sin query param), usamos el ultimo
    // precio conocido del JSON estatico. Es desactualizado por horas/dias pero
    // permite emitir un veredicto razonable.
    if (currentEurL == null && lastKnownEurL != null) {
      currentEurL = lastKnownEurL
    }

    // Ordenamos por fecha asc para consistencia con la API previa (los Map
    // mantienen orden de insercion: JSON va antes que D1 y ambos vienen
    // ordenados, pero un sort explicito asegura el invariante).
    const weekdaySamples = Array.from(samplesByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, price]) => price)

    if (currentEurL == null) {
      return c.json(
        { station_id: stationId, fuel, verdict: null, sampleCount: 0, weekday },
        200,
        { 'Cache-Control': 'public, max-age=3600' },
      )
    }

    const pred = classifyPriceVsCycle({ currentEurL, weekdaySamples })
    if (!pred) {
      return c.json(
        { station_id: stationId, fuel, verdict: null, sampleCount: 0, weekday, currentEurL },
        200,
        { 'Cache-Control': 'public, max-age=3600' },
      )
    }

    return c.json(
      {
        station_id: stationId,
        fuel,
        weekday,
        currentEurL,
        verdict:     pred.verdict,
        percentile:  pred.percentile,
        sampleCount: pred.sampleCount,
        confidence:  pred.confidence,
        tipicalEurL: pred.tipicalEurL,
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  } catch (err) {
    slog('error', 'predict.query_failed', {
      stationId,
      fuel,
      err: String(err).slice(0, 300),
    })
    return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
  }
})

// ============================================================================
// EXPORT CSV (datos publicos)
// ============================================================================
// GET /api/export?fuel=95&provincia=48  (ambos opcionales)
// Devuelve CSV con todas las estaciones (o filtradas por provincia) y el
// precio del combustible pedido. Pensado para bloggers, periodistas,
// investigadores academicos y analistas que quieran operar con los datos
// sin tener que navegar el JSON del Ministerio.
//
// Diseno:
// - Rate limit agresivo (exportLimiter = 6/min/IP): payload grande (~12k filas,
//   varios MB) y uso legitimo es "descargar una vez al dia", no polling.
// - Fuente: snapshot estatico diario (mismo que alimenta el mapa). Cache-Control
//   1h en CDN; aunque el snapshot es diario dejamos margen por si el cron tarda.
// - Formato: RFC 4180 — coma como separador, comillas dobles escapadas
//   duplicandolas. Content-Disposition con filename para que el navegador
//   descargue directamente.
// - Columnas: ideess,rotulo,direccion,cp,municipio,provincia,lat,lng,horario,
//   fuel,precio_eur_l,fecha (fecha = Fecha del snapshot, no el dia del request).
// - Filas sin precio del combustible pedido: omitidas (una estacion que no
//   vende 98 no aparece en el export de 98). Esto es lo que el consumidor
//   espera: "dame el precio de 98 en tal provincia".
app.get('/api/export', async c => {
  const key = clientKey(c)
  const rl = exportLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const fuel = c.req.query('fuel') || '95'
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel', valid: FUEL_CODES }, 400)
  }
  // Invertir FUEL_MAP para ir de codigo a campo del Ministerio. Lo hacemos
  // inline porque es barato y no merece otra export desde history.ts.
  const MINISTRY_FIELD: Record<string, string> = {
    '95':          'Precio Gasolina 95 E5',
    '98':          'Precio Gasolina 98 E5',
    'diesel':      'Precio Gasoleo A',
    'diesel_plus': 'Precio Gasoleo Premium',
  }
  const ministryField = MINISTRY_FIELD[fuel]
  if (!ministryField) {
    // No deberia ocurrir si FUEL_CODES esta sincronizado, pero defensivo.
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  const provinciaRaw = c.req.query('provincia') || ''
  let provinciaFilter: string | null = null
  if (provinciaRaw) {
    if (!isValidProvinciaId(provinciaRaw)) {
      return c.json({ error: 'invalid_provincia' }, 400)
    }
    provinciaFilter = provinciaRaw
  }

  const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  if (!snap) return c.json({ error: 'snapshot no disponible' }, 503)

  const filtered = filterStations(snap, s => {
    if (provinciaFilter && s.IDProvincia !== provinciaFilter) return false
    // Solo incluimos estaciones con precio valido para el combustible pedido.
    const raw = s[ministryField]
    if (!raw) return false
    const n = parseFloat(String(raw).replace(',', '.'))
    return Number.isFinite(n) && n > 0
  })
  if (!filtered) return c.json({ error: 'snapshot corrupto' }, 503)

  // Escapado RFC 4180: envuelve en comillas si hay coma, comilla, CR o LF;
  // dentro, las comillas se duplican.
  const csvEscape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (s.indexOf(',') < 0 && s.indexOf('"') < 0 && s.indexOf('\n') < 0 && s.indexOf('\r') < 0) return s
    return '"' + s.replace(/"/g, '""') + '"'
  }

  const fechaSnap = typeof snap.Fecha === 'string' ? snap.Fecha : ''
  const header = 'ideess,rotulo,direccion,cp,municipio,provincia,lat,lng,horario,fuel,precio_eur_l,fecha'
  const lines: string[] = [header]
  const list = filtered.ListaEESSPrecio || []
  for (const s of list) {
    const lat = String(s['Latitud'] ?? '').replace(',', '.')
    const lng = String(s['Longitud (WGS84)'] ?? '').replace(',', '.')
    const priceRaw = s[ministryField]
    const priceNum = parseFloat(String(priceRaw).replace(',', '.'))
    if (!Number.isFinite(priceNum)) continue
    // El Ministerio usa claves con tilde: "Rótulo" y "Dirección" (no
    // "Rotulo"/"Direccion"). Probamos ambas por defensa: el cliente Web
    // usa las versiones sin tilde en algunos sitios y el snapshot podria
    // cambiar en el futuro si cambian el endpoint.
    const rotulo    = s['Rótulo']    || s['Rotulo']    || ''
    const direccion = s['Dirección'] || s['Direccion'] || ''
    lines.push([
      csvEscape(s['IDEESS']),
      csvEscape(rotulo),
      csvEscape(direccion),
      csvEscape(s['C.P.']),
      csvEscape(s['Municipio']),
      csvEscape(s['Provincia']),
      csvEscape(lat),
      csvEscape(lng),
      csvEscape(s['Horario']),
      csvEscape(fuel),
      csvEscape(priceNum.toFixed(3)),
      csvEscape(fechaSnap),
    ].join(','))
  }
  // Sufijo \r\n en lugar de \n por compatibilidad estricta con Excel en
  // Windows; los parsers modernos aceptan ambos.
  const csv = lines.join('\r\n') + '\r\n'

  // Nombre de fichero descriptivo pero determinista — permite al usuario
  // reemplazar descargas sucesivas sin colisiones raras. Sanitizamos la
  // provincia (solo digitos) porque ya validamos arriba, pero por defensa.
  const fname = 'gasolineras_' + fuel +
    (provinciaFilter ? '_prov' + provinciaFilter : '') +
    '_' + (fechaSnap || 'snapshot').replace(/[^0-9-]/g, '') + '.csv'

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + fname + '"',
      // Cache CDN: el snapshot se regenera 1/dia, 1h de edge cache protege
      // de avalanchas sin servir datos mas viejos que lo que ya es.
      'Cache-Control': 'public, max-age=3600',
      'X-Data-Source': 'snapshot',
      // Permite que herramientas JS en otros origenes consuman el CSV si
      // alguien monta un notebook (Observable, etc.) — no contiene datos
      // privados.
      'Access-Control-Allow-Origin': '*',
    },
  })
})

// ---- CRON (disparados por GitHub Actions) ----
// Cloudflare Pages no soporta Cron Triggers nativos (solo Workers puros los
// tienen). Asi que aqui exponemos dos endpoints HTTP POST protegidos por un
// `Authorization: Bearer <CRON_TOKEN>` que GHA invoca con curl en horario
// programado. Si CRON_TOKEN no esta definido (dev), respondemos 503 sin hacer
// nada — evita que cualquiera los active sin intencion.
//
// GHA workflows:
//   .github/workflows/cron-ingest.yml → 0 20 * * * (tras el fetch de 19:00)
//   .github/workflows/cron-purge.yml  → 0 3 * * 0  (domingos)
// authorizeCron vive en src/lib/runtime.ts (compartido por cron/telegram/admin).

// POST /api/cron/ingest — ingesta diaria del snapshot a D1.
// Idempotente via INSERT OR REPLACE: si GHA hace retry no duplica datos.
app.post('/api/cron/ingest', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  const result = await runDailyIngest(c.env)
  // Solo escribe: la serie nacional y las variaciones ya no se recalculan aqui
  // (las deja el bot en history/national.json), asi que este cron no gasta cupo
  // de lecturas de D1. La ingesta se mantiene como respaldo de los endpoints de
  // historico para el dia en que el bot falle.
  return c.json(result, result.ok ? 200 : 500, { 'Cache-Control': 'no-store' })
})

// POST /api/cron/purge — borra filas > 2 anos.
app.post('/api/cron/purge', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  const result = await runWeeklyPurge(c.env)
  return c.json(result, result.ok ? 200 : 500, { 'Cache-Control': 'no-store' })
})

// ============================================================
// Ship 25: ALERTAS POR TELEGRAM — reemplaza Web Push (Ship 23, retirado).
// ============================================================
// Flow de vinculacion bot↔web (Ship 25.1 — 1 round-trip menos que 25.0):
//   1. Web llama POST /api/telegram/start-link con body {favs, threshold_cents}.
//      Server genera token random, serializa los favs en JSON y mete todo en
//      telegram_pending_tokens (chat_id NULL, expires en 10min). Devuelve
//      { token, deepLink: "https://t.me/<BotUsername>?start=<tok>" }.
//   2. Cliente abre el deepLink (window.open en una pestana o deep link movil).
//      En Telegram el user pulsa START — Telegram envia "/start <tok>" al bot.
//   3. El webhook /api/telegram/webhook recibe el update (valida el secret
//      `X-Telegram-Bot-Api-Secret-Token`), parsea /start <tok>, y atomicamente:
//      (a) actualiza telegram_pending_tokens SET chat_id = .../confirmed_at = now
//      (b) lee favs_json + threshold_cents de la misma fila
//      (c) inserta las filas en telegram_subscriptions (chat_id + cada fav)
//      (d) borra el pending_token
//      (e) manda sendMessage al user listando las gasolineras ya vigiladas.
//   4. La web hace polling a GET /api/telegram/confirm?token=... cada 2s.
//      Cuando el endpoint devuelve confirmed=true, guarda chat_id en
//      localStorage y marca el panel como activo. No hay /subscribe adicional.
//
// Flow de alertas:
//   - Cron GHA (.github/workflows/cron-telegram-check.yml) invoca cada 2h
//     POST /api/cron/telegram-check con Authorization Bearer CRON_TOKEN.
//   - El worker lee el snapshot /data/stations.json una vez, indexa por
//     station_id, y itera todas las filas de telegram_subscriptions.
//   - Si precio actual < baseline_cents - threshold_cents y ha pasado el
//     cooldown de 12h, envia sendMessage al chat_id con el detalle y
//     actualiza baseline_cents + last_notified_at.
//
// Si TELEGRAM_BOT_TOKEN no esta configurado los endpoints responden 503 y
// el panel del UI se oculta — el resto de la app funciona igual.

function isTelegramConfigured(env: Env): boolean {
  return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET)
}

// GET /api/telegram/config — el cliente la llama al abrir el panel para saber
// si las alertas Telegram estan disponibles y cual es el username del bot
// (necesario para construir deep links t.me/<bot>?start=...). Publica.
app.get('/api/telegram/config', c => {
  const ok = !!(c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_BOT_USERNAME)
  if (!ok) return c.json({ ok: false, error: 'telegram_not_configured' }, 503, { 'Cache-Control': 'no-store' })
  return c.json({ ok: true, username: c.env.TELEGRAM_BOT_USERNAME }, 200, {
    // Cache corto: si roto el bot username queremos propagacion rapida.
    'Cache-Control': 'public, max-age=300',
  })
})

// Menu de comandos del bot (la lista azul de sugerencias en Telegram). Unica
// fuente de verdad, en codigo. Se aplica con /api/telegram/set-commands.
const TELEGRAM_BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'precios', description: 'Precios de ahora de tus gasolineras' },
  { command: 'start',   description: 'Empezar / volver a empezar' },
  { command: 'help',    description: 'Ayuda y comandos' },
  { command: 'stop',    description: 'Darte de baja (borra tus alertas)' },
]

// POST /api/telegram/set-commands — registra el menu de comandos del bot con el
// token ya guardado en CF (no hay que volver a pasarlo). Idempotente. Protegido
// con CRON_TOKEN, igual que los /api/cron/*. Se dispara desde el workflow
// telegram-set-commands.yml (o con un curl manual autenticado).
app.post('/api/telegram/set-commands', async c => {
  const authz = await authorizeCron(c)
  if (!authz.ok) return c.json(authz.body, authz.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  const { tgSetMyCommands } = await import('./lib/telegram')
  const r = await tgSetMyCommands(c.env.TELEGRAM_BOT_TOKEN!, TELEGRAM_BOT_COMMANDS)
  if (!r.ok) {
    slog('warn', 'telegram_set_commands_failed', { description: r.description })
    return c.json({ ok: false, error: 'set_commands_failed', description: r.description }, 502, { 'Cache-Control': 'no-store' })
  }
  slog('info', 'telegram_set_commands_ok', { count: TELEGRAM_BOT_COMMANDS.length })
  return c.json({ ok: true, count: TELEGRAM_BOT_COMMANDS.length }, 200, { 'Cache-Control': 'no-store' })
})

const PENDING_TOKEN_TTL_MS = 10 * 60 * 1000  // 10 min

// POST /api/telegram/start-link — genera token + deepLink para iniciar el flow.
// Body: { favs: [{station_id, fuel_code, baseline_cents?}], threshold_cents? }
// Almacenamos los favoritos serializados en el pending_token: asi el webhook
// puede insertarlos en telegram_subscriptions y listarlos en el mensaje de
// confirmacion en una sola transaccion (ver migracion 0008).
app.post('/api/telegram/start-link', async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  let body: any = {}
  // Body opcional: si el cliente viejo no lo envia (compatibilidad), vamos
  // con favs=[] y threshold default — el flow degrada a "bot vinculado sin
  // alertas activas", aunque en la practica el cliente nuevo siempre lo manda.
  try { body = await c.req.json() } catch {/* sin body: usamos defaults */}
  const favsRaw = Array.isArray(body?.favs) ? body.favs : []
  const thresholdCents = typeof body?.threshold_cents === 'number' && Number.isFinite(body.threshold_cents)
    ? Math.max(1, Math.min(200, Math.round(body.threshold_cents)))
    : 10
  if (favsRaw.length > 100) return c.json({ ok: false, error: 'too_many_favs' }, 400)
  // Sanitiza el array de favs antes de serializar (evita meter basura en D1).
  const favsClean: Array<{ station_id: string; fuel_code: string; baseline_cents: number | null }> = []
  for (const f of favsRaw) {
    const stationId = typeof f?.station_id === 'string' ? f.station_id.trim() : ''
    const fuelCode  = typeof f?.fuel_code  === 'string' ? f.fuel_code.trim()  : ''
    const baselineCents = typeof f?.baseline_cents === 'number' && Number.isFinite(f.baseline_cents)
      ? Math.round(f.baseline_cents) : null
    if (!stationId || !['95', '98', 'diesel', 'diesel_plus'].includes(fuelCode)) continue
    favsClean.push({ station_id: stationId, fuel_code: fuelCode, baseline_cents: baselineCents })
  }
  const { generateLinkToken } = await import('./lib/telegram')
  const token = generateLinkToken()
  const now = Date.now()
  try {
    await c.env.DB.prepare(
      `INSERT INTO telegram_pending_tokens
         (token, chat_id, confirmed_at, created_at, expires_at, favs_json, threshold_cents)
       VALUES (?, NULL, NULL, ?, ?, ?, ?)`
    ).bind(token, now, now + PENDING_TOKEN_TTL_MS, JSON.stringify(favsClean), thresholdCents).run()
    return c.json({
      ok: true,
      token,
      deepLink: `https://t.me/${c.env.TELEGRAM_BOT_USERNAME}?start=${token}`,
      expiresInSec: Math.floor(PENDING_TOKEN_TTL_MS / 1000),
      favs_queued: favsClean.length,
    }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    slog('error', 'telegram_start_link_error', { message: (e as Error).message })
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// POST /api/telegram/webhook — recibe updates del bot. Validamos el secret
// para estar seguros de que el request viene de Telegram (seteamos el secret
// con setWebhook y Telegram nos lo devuelve en el header). Responde SIEMPRE
// 200 si el secret es valido, incluso si el update no es procesable — asi
// Telegram no reintenta indefinidamente.
app.post('/api/telegram/webhook', async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const got = c.req.header('x-telegram-bot-api-secret-token') || ''
  // tokensEqualConstTime para evitar timing attacks (el secret es relativamente corto).
  if (!tokensEqualConstTime(got, c.env.TELEGRAM_WEBHOOK_SECRET!)) {
    slog('warn', 'telegram_webhook_bad_secret', {})
    return c.json({ ok: false, error: 'bad_secret' }, 401)
  }
  let update: any
  try { update = await c.req.json() } catch { return c.json({ ok: true }, 200) }
  const msg = update?.message
  if (!msg || typeof msg.text !== 'string' || !msg.chat?.id) {
    // No es un mensaje de texto — ignoramos silenciosamente.
    return c.json({ ok: true }, 200)
  }
  const chatId = Number(msg.chat.id)
  const text = String(msg.text).trim()
  const { tgSendMessage, tgEscapeHtml, buildPreciosMessages } = await import('./lib/telegram')
  // Comandos soportados:
  //   /start <token> — vincula la web con este chat_id
  //   /start (sin token) — welcome con link a la web
  //   /precios — lista bajo demanda de las gasolineras activadas + precio actual
  //   /help — ayuda
  //   /stop — el user pide baja voluntaria (borramos todas sus subs)
  //   cualquier otra cosa — echo con ayuda basica
  if (text.startsWith('/start ')) {
    const token = text.slice('/start '.length).trim()
    const now = Date.now()
    // 1) Valida + marca el token como confirmado (atomic via WHERE chat_id IS NULL).
    const r = await c.env.DB.prepare(
      `UPDATE telegram_pending_tokens
         SET chat_id = ?, confirmed_at = ?
       WHERE token = ? AND expires_at > ? AND chat_id IS NULL`
    ).bind(chatId, now, token, now).run()
    const ok = (r.meta?.changes ?? 0) > 0
    if (!ok) {
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
        '⚠️ <b>Token no valido o caducado</b> (>10 min desde que se genero).\n\nVuelve a la web y pulsa "Activar alertas" de nuevo.')
      slog('info', 'telegram_bind', { ok: false, chat_id: chatId })
      return c.json({ ok: true }, 200)
    }
    // 2) Recupera los favs que el cliente pre-cargo en /start-link.
    const pend = await c.env.DB.prepare(
      'SELECT favs_json, threshold_cents FROM telegram_pending_tokens WHERE token = ?'
    ).bind(token).all<{ favs_json: string; threshold_cents: number }>()
    const pendRow = pend.results[0]
    let favs: Array<{ station_id: string; fuel_code: string; baseline_cents: number | null }> = []
    let thresholdCents = 10
    if (pendRow) {
      thresholdCents = pendRow.threshold_cents ?? 10
      try {
        const parsed = JSON.parse(pendRow.favs_json || '[]')
        if (Array.isArray(parsed)) favs = parsed
      } catch { /* mantenemos favs=[] */ }
    }
    // 3) Inserta cada fav en telegram_subscriptions (chat_id ya confirmado).
    let inserted = 0
    for (const f of favs) {
      if (!f.station_id || !f.fuel_code) continue
      try {
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO telegram_subscriptions
           (chat_id, station_id, fuel_code, threshold_cents, baseline_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(chatId, f.station_id, f.fuel_code, thresholdCents, f.baseline_cents, now).run()
        inserted++
      } catch (e) {
        slog('error', 'telegram_bind_insert_error', { message: (e as Error).message })
      }
    }
    // 4) NO borramos el token aqui: el cliente sigue haciendo polling a
    //    /api/telegram/confirm?token=... durante unos segundos y necesita
    //    encontrar la fila con chat_id + confirmed_at seteados. El cron
    //    telegram-check purga filas con expires_at caducado (+1h grace).
    // 5) Trae detalles de las estaciones del snapshot para pintarlas bonitas.
    //    Si el snapshot no esta disponible mostramos un fallback generico.
    const fuelLabel: Record<string, string> = {
      '95': 'Gasolina 95', '98': 'Gasolina 98',
      'diesel': 'Diesel', 'diesel_plus': 'Diesel Premium',
    }
    let favsListHtml = ''
    if (inserted > 0) {
      const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
      let snap: { ListaEESSPrecio?: Array<Record<string, string>> } | null = null
      try {
        const rs = await fetch(origin + '/data/stations.json', { cf: { cacheTtl: 60 } } as RequestInit)
        if (rs.ok) snap = await rs.json() as { ListaEESSPrecio?: Array<Record<string, string>> }
      } catch {/* no-op */}
      const byStation = new Map<string, Record<string, string>>()
      if (snap?.ListaEESSPrecio) {
        for (const st of snap.ListaEESSPrecio) {
          const id = st['IDEESS'] || st['IDEESS_'] || ''
          if (id) byStation.set(String(id), st)
        }
      }
      const lines: string[] = []
      for (const f of favs) {
        const st = byStation.get(f.station_id)
        const rotulo = st ? tgEscapeHtml(String(st['Rotulo'] || 'Gasolinera')) : 'Gasolinera'
        const municipio = st ? tgEscapeHtml(String(st['Municipio'] || '')) : ''
        const lbl = fuelLabel[f.fuel_code] || f.fuel_code
        lines.push(`• <b>${rotulo}</b>${municipio ? ' — ' + municipio : ''} <i>(${lbl})</i>`)
      }
      favsListHtml = lines.join('\n')
    }
    const reply = inserted > 0
      ? `🔔 <b>¡Listo! Alertas activadas</b>\n\n` +
        `${inserted === 1 ? 'Vigilo esta gasolinera' : `Vigilo estas <b>${inserted}</b> gasolineras`} para ti:\n${favsListHtml}\n\n` +
        `📅 Cada manana a las 8:00 te mando su precio actual.\n` +
        `⚡ Escribe /precios cuando quieras el listado al momento.\n\n` +
        `<i>Para pararlas en cualquier momento: /stop</i>`
      : `✅ <b>Vinculado</b>, pero no llego ninguna gasolinera.\n\n` +
        `Vuelve a la web, toca una gasolinera en el mapa y pulsa "Activar alerta" de nuevo.`
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply)
    slog('info', 'telegram_bind', { ok: true, chat_id: chatId, subscribed: inserted })
    return c.json({ ok: true }, 200)
  }
  if (text === '/start') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `👋 ¡Hola! Te mando cada manana el precio de las gasolineras que elijas.\n\n` +
      `Para activarlo:\n` +
      `1. Abre ${tgEscapeHtml(c.env.PUBLIC_ORIGIN || 'la web')}\n` +
      `2. Toca una gasolinera en el mapa\n` +
      `3. Pulsa "Activar alerta"\n\n` +
      `Cada dia a las 8:00 te llega el precio actual. Escribe /precios para pedirlo cuando quieras.`,
    )
    return c.json({ ok: true }, 200)
  }
  if (text === '/precios') {
    // Listado bajo demanda: mismas gasolineras del resumen diario, precio de ahora.
    const subsR = await c.env.DB.prepare(
      'SELECT station_id, fuel_code FROM telegram_subscriptions WHERE chat_id = ?'
    ).bind(chatId).all<{ station_id: string; fuel_code: string }>()
    const chatSubs = subsR.results || []
    if (!chatSubs.length) {
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
        `Todavia no vigilas ninguna gasolinera.\n\n` +
        `Abre ${tgEscapeHtml(c.env.PUBLIC_ORIGIN || 'la web')}, toca una gasolinera en el mapa y pulsa <b>Activar alerta</b>.`)
      return c.json({ ok: true }, 200)
    }
    const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
    let snap: { ListaEESSPrecio?: Array<Record<string, string>> } | null = null
    try {
      const rs = await fetch(origin + '/data/stations.json', { cf: { cacheTtl: 60 } } as RequestInit)
      if (rs.ok) snap = await rs.json() as { ListaEESSPrecio?: Array<Record<string, string>> }
    } catch {/* no-op */}
    const snapLoaded = !!snap?.ListaEESSPrecio
    const byStation = new Map<string, Record<string, string>>()
    if (snap?.ListaEESSPrecio) {
      for (const st of snap.ListaEESSPrecio) {
        const id = st['IDEESS'] || st['IDEESS_'] || ''
        if (id) byStation.set(String(id), st)
      }
    }
    const { fecha } = spainDateParts(Date.now())
    const messages = buildPreciosMessages(chatSubs, byStation, fecha)
    if (!messages.length) {
      // Dos causas distintas de lista vacia: (a) el snapshot no cargo (fallo
      // transitorio -> reintentar sirve); (b) cargo bien pero ninguna de tus
      // gasolineras sigue en los datos (cerraron / las quito el Ministerio ->
      // reintentar no arregla nada, hay que activar otra).
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
        snapLoaded
          ? `Ninguna de tus gasolineras aparece ya en los datos oficiales (puede que hayan cerrado).\n\n` +
            `Abre ${tgEscapeHtml(c.env.PUBLIC_ORIGIN || 'la web')}, toca otra en el mapa y pulsa <b>Activar alerta</b>.`
          : `No he podido leer los precios ahora mismo. Intentalo en un rato.`)
      return c.json({ ok: true }, 200)
    }
    for (const m of messages) await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, m)
    slog('info', 'telegram_precios', { chat_id: chatId, stations: chatSubs.length, msgs: messages.length })
    return c.json({ ok: true }, 200)
  }
  if (text === '/help') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `<b>Comandos:</b>\n` +
      `/precios — el precio de ahora de tus gasolineras\n` +
      `/start — volver a empezar\n` +
      `/stop — darte de baja (borra todas tus alertas)\n` +
      `/help — esta ayuda`,
    )
    return c.json({ ok: true }, 200)
  }
  if (text === '/stop') {
    const r = await c.env.DB.prepare(
      'DELETE FROM telegram_subscriptions WHERE chat_id = ?'
    ).bind(chatId).run()
    const n = r.meta?.changes ?? 0
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      n > 0
        ? `🗑️ Borradas <b>${n}</b> alerta(s). Si cambias de opinion, vuelve a la web y pulsa "Activar alertas" de nuevo.`
        : `No tenias alertas activas. Nada que borrar.`,
    )
    slog('info', 'telegram_stop', { chat_id: chatId, removed: n })
    return c.json({ ok: true }, 200)
  }
  // Cualquier otro texto — ayuda breve.
  await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
    `No entiendo eso. Manda /help para ver los comandos.`,
  )
  return c.json({ ok: true }, 200)
})

// GET /api/telegram/confirm?token=... — polling endpoint para la web.
// Secreto para firmar/verificar el token de sesion de Telegram. Preferimos
// SESSION_SECRET (secreto general del servidor); si no esta, caemos al token
// del bot (siempre presente cuando Telegram esta configurado). Si no hay
// ninguno, verifyTelegramToken devuelve null y los endpoints fallan cerrados.
function tgAuthSecret(env: { SESSION_SECRET?: string; TELEGRAM_BOT_TOKEN?: string }): string {
  return env.SESSION_SECRET || env.TELEGRAM_BOT_TOKEN || ''
}
// Saca el chat_id de "Authorization: Bearer <token>" verificando la firma.
// Devuelve null si no hay token valido (el llamante responde 401). Este es el
// arreglo del IDOR: el chat_id ya NO se acepta desde query/body del cliente.
async function tgChatFromAuth(c: { req: { header: (n: string) => string | undefined }; env: { SESSION_SECRET?: string; TELEGRAM_BOT_TOKEN?: string } }): Promise<number | null> {
  const h = c.req.header('Authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  return verifyTelegramToken(m[1].trim(), tgAuthSecret(c.env))
}

// Devuelve { ok, confirmed, chat_id? } — chat_id solo si confirmed=true.
app.get('/api/telegram/confirm', async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const token = c.req.query('token') || ''
  if (!token || token.length !== 32 || !/^[a-f0-9]+$/.test(token)) {
    return c.json({ ok: false, error: 'invalid_token' }, 400, { 'Cache-Control': 'no-store' })
  }
  // Nota: el tipo local D1PreparedStatement solo expone `.all()` y `.run()`
  // (ver declaracion en la cabecera del archivo), asi que usamos `.all()` y
  // tomamos `results[0]` en vez de `.first()`.
  const r = await c.env.DB.prepare(
    'SELECT chat_id, confirmed_at, expires_at FROM telegram_pending_tokens WHERE token = ?'
  ).bind(token).all<{ chat_id: number | null; confirmed_at: number | null; expires_at: number }>()
  const row = r.results[0]
  if (!row) return c.json({ ok: true, confirmed: false, expired: true }, 200, { 'Cache-Control': 'no-store' })
  // Caducidad: aplica TAMBIEN a las filas confirmadas. Antes, una fila
  // confirmada se podia canjear indefinidamente por tokens nuevos de 180d
  // mientras la purga (cron) no la borrara. El token de vinculacion solo debe
  // canjearse dentro de su ventana corta (~10 min).
  if (row.expires_at < Date.now()) {
    return c.json({ ok: true, confirmed: false, expired: true }, 200, { 'Cache-Control': 'no-store' })
  }
  if (row.confirmed_at && row.chat_id) {
    // Emitimos el token de sesion de Telegram: la web lo guardara y lo enviara
    // en cada operacion (Authorization: Bearer). Es la credencial real, no el chat_id.
    const auth = await signTelegramToken(row.chat_id, tgAuthSecret(c.env))
    return c.json({ ok: true, confirmed: true, chat_id: row.chat_id, auth }, 200, { 'Cache-Control': 'no-store' })
  }
  return c.json({ ok: true, confirmed: false }, 200, { 'Cache-Control': 'no-store' })
})

// (Ship 25.1) /api/telegram/subscribe eliminado: la insercion de favoritos en
// telegram_subscriptions se hace ahora dentro del webhook /start <token>,
// en la misma transaccion que la confirmacion del pending_token. El cliente
// envia los favoritos en /api/telegram/start-link (body {favs, threshold_cents})
// y el polling /api/telegram/confirm solo notifica al UI que ya esta listo.

// POST /api/telegram/unsubscribe — borra alertas de un chat.
// Body: { chat_id, station_id?, fuel_code? }  (si no pasas station+fuel, borra todas)
app.post('/api/telegram/unsubscribe', async c => {
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const chatId = await tgChatFromAuth(c)
  if (chatId == null) return c.json({ ok: false, error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' })
  // Body: {} borra todas las alertas del chat; {station_id, fuel_code} borra una.
  // Un JSON malformado se rechaza (no lo tratamos como "borrar todo").
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
  const stationId = typeof body?.station_id === 'string' ? body.station_id : ''
  const fuelCode  = typeof body?.fuel_code  === 'string' ? body.fuel_code  : ''
  try {
    if (stationId && fuelCode) {
      await c.env.DB.prepare(
        'DELETE FROM telegram_subscriptions WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
      ).bind(chatId, stationId, fuelCode).run()
    } else {
      await c.env.DB.prepare(
        'DELETE FROM telegram_subscriptions WHERE chat_id = ?'
      ).bind(chatId).run()
    }
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    slog('error', 'telegram_unsubscribe_error', { message: (e as Error).message })
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// GET /api/telegram/subscriptions?chat_id=X — lista las alertas activas de
// un chat. La UI lo consulta al abrir el modal de favoritas para renderizar
// el estado ON/OFF de la campana de cada favorita. Sin auth: igual que el
// resto de endpoints /api/telegram/*, el chat_id del localStorage es la
// unica "credencial" (modelo establecido desde Ship 25).
app.get('/api/telegram/subscriptions', async c => {
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const chatId = await tgChatFromAuth(c)
  if (chatId == null) return c.json({ ok: false, error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' })
  try {
    const r = await c.env.DB.prepare(
      'SELECT station_id, fuel_code FROM telegram_subscriptions WHERE chat_id = ?'
    ).bind(chatId).all<{ station_id: string; fuel_code: string }>()
    return c.json({ ok: true, subscriptions: r.results || [] }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    slog('error', 'telegram_list_subs_error', { message: (e as Error).message })
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// POST /api/telegram/toggle-fav — activa o pausa la alerta de UNA favorita.
// Body: { chat_id, station_id, fuel_code, enabled }
// - enabled=true:  inserta en telegram_subscriptions (threshold copiado del
//                  primer sub del mismo chat; default 15 si el chat no tiene
//                  subs) y manda al bot "🔔 Alerta añadida". Idempotente:
//                  si ya existia, devolvemos status=already_enabled sin
//                  duplicar mensaje.
// - enabled=false: borra la sub y manda "🔕 Alerta pausada". Idempotente
//                  igual (status=already_disabled si no existia).
// El rotulo + municipio se resuelven contra /data/stations.json (cacheado
// 60s en CF) para que el mensaje del bot sea descriptivo sin que el cliente
// tenga que enviarlo.
app.post('/api/telegram/toggle-fav', async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const chatId = await tgChatFromAuth(c)
  if (chatId == null) return c.json({ ok: false, error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' })
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
  const stationId = typeof body?.station_id === 'string' ? body.station_id.trim() : ''
  const fuelCode = typeof body?.fuel_code === 'string' ? body.fuel_code.trim() : ''
  const enabled = !!body?.enabled
  if (!stationId) return c.json({ ok: false, error: 'missing_station_id' }, 400)
  if (!['95', '98', 'diesel', 'diesel_plus'].includes(fuelCode)) {
    return c.json({ ok: false, error: 'invalid_fuel_code' }, 400)
  }
  const { tgSendMessage, tgEscapeHtml } = await import('./lib/telegram')
  const fuelLabel: Record<string, string> = {
    '95': 'Gasolina 95', '98': 'Gasolina 98',
    'diesel': 'Diesel', 'diesel_plus': 'Diesel Premium',
  }
  try {
    // 1) Existe ya la sub?
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM telegram_subscriptions WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
    ).bind(chatId, stationId, fuelCode).all()
    const alreadyExists = (existing.results?.length ?? 0) > 0

    // Idempotencia: no duplicamos mensajes ni insert/delete.
    if (enabled && alreadyExists) {
      return c.json({ ok: true, status: 'already_enabled' }, 200, { 'Cache-Control': 'no-store' })
    }
    if (!enabled && !alreadyExists) {
      return c.json({ ok: true, status: 'already_disabled' }, 200, { 'Cache-Control': 'no-store' })
    }

    // 2) Resuelve rotulo/municipio (para el mensaje del bot). Cacheado en CF.
    let rotulo = 'gasolinera'
    let municipio = ''
    try {
      const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
      const rs = await fetch(origin + '/data/stations.json', { cf: { cacheTtl: 60 } } as RequestInit)
      if (rs.ok) {
        const snap = await rs.json() as { ListaEESSPrecio?: Array<Record<string, string>> }
        const st = snap.ListaEESSPrecio?.find(s => String(s['IDEESS'] || '') === stationId)
        if (st) {
          rotulo = String(st['Rotulo'] || 'Gasolinera')
          municipio = String(st['Municipio'] || '')
        }
      }
    } catch {/* degradamos a nombre generico */}
    const rotuloEsc = tgEscapeHtml(rotulo)
    const munEsc = municipio ? tgEscapeHtml(municipio) : ''
    const lbl = fuelLabel[fuelCode] || fuelCode

    if (enabled) {
      // 3a) Copia threshold del primer sub del chat; default 10 (1 centimo/L).
      const chatSub = await c.env.DB.prepare(
        'SELECT threshold_cents FROM telegram_subscriptions WHERE chat_id = ? LIMIT 1'
      ).bind(chatId).all<{ threshold_cents: number }>()
      const threshold = chatSub.results?.[0]?.threshold_cents ?? 10
      await c.env.DB.prepare(
        `INSERT INTO telegram_subscriptions
         (chat_id, station_id, fuel_code, threshold_cents, baseline_cents, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).bind(chatId, stationId, fuelCode, threshold, Date.now()).run()
      const reply =
        `🔔 <b>Alerta activada</b>\n\n` +
        `Vigilo <b>${rotuloEsc}</b>${munEsc ? ' <i>(' + munEsc + ')</i>' : ''} — ${lbl}.\n\n` +
        `📅 Cada manana a las 8:00 te mando su precio. Pidelo cuando quieras con /precios.`
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply)
      slog('info', 'telegram_toggle_fav', { chat_id: chatId, enabled: true, station_id: stationId })
      return c.json({ ok: true, status: 'enabled' }, 200, { 'Cache-Control': 'no-store' })
    } else {
      // 3b) Desactivar: borrar + notificar.
      await c.env.DB.prepare(
        'DELETE FROM telegram_subscriptions WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
      ).bind(chatId, stationId, fuelCode).run()
      const reply =
        `🔕 <b>Alerta pausada</b>\n\n` +
        `Ya no vigilo <b>${rotuloEsc}</b>${munEsc ? ' <i>(' + munEsc + ')</i>' : ''} — ${lbl}.\n\n` +
        `<i>Puedes reactivarla desde la web cuando quieras.</i>`
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply)
      slog('info', 'telegram_toggle_fav', { chat_id: chatId, enabled: false, station_id: stationId })
      return c.json({ ok: true, status: 'disabled' }, 200, { 'Cache-Control': 'no-store' })
    }
  } catch (e) {
    slog('error', 'telegram_toggle_fav_error', { message: (e as Error).message })
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// Hora + fecha local de Espana (Europe/Madrid), robusto a DST via Intl.
// El cron dispara a dos horas UTC (06:00 y 07:00) y solo enviamos cuando en
// Espana son las 8:xx — asi acertamos las 8:00 tanto en horario de verano
// (UTC+2) como de invierno (UTC+1) sin depender del offset fijo.
function spainDateParts(nowMs: number): { hour: number; fecha: string } {
  const d = new Date(nowMs)
  let hour = 8
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
    }).formatToParts(d)
    const h = parts.find(p => p.type === 'hour')?.value
    if (h != null) {
      const n = parseInt(h, 10)
      if (Number.isFinite(n)) hour = n
    }
  } catch { /* fallback hour=8 */ }
  let fecha = ''
  try {
    fecha = new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long',
    }).format(d)
  } catch { /* fecha vacia: buildPreciosMessages la omite del header */ }
  return { hour, fecha }
}

// POST /api/cron/telegram-check — RESUMEN DIARIO (Ship 27).
// Ya no compara precios contra baseline: cada manana a las 8:00 (Europe/Madrid)
// manda UN mensaje por chat listando todas las gasolineras que el usuario
// activo, con el precio ACTUAL del combustible elegido. Requiere CRON_TOKEN.
// El workflow (cron-telegram-check.yml) dispara a 06:00 y 07:00 UTC; la guarda
// por hora hace no-op la que no cae en las 8:00 de Espana. ?force=1 salta la
// guarda y el dedup (para pruebas manuales).
app.post('/api/cron/telegram-check', async c => {
  const authz = await authorizeCron(c)
  if (!authz.ok) return c.json(authz.body, authz.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)

  const now = Date.now()
  const force = c.req.query('force') === '1'
  const { hour: spainHour, fecha } = spainDateParts(now)

  // Housekeeping: purga pending_tokens caducados (1h de colchon). Se hace
  // siempre, aunque hoy no toque mandar el resumen.
  try {
    await c.env.DB.prepare('DELETE FROM telegram_pending_tokens WHERE expires_at < ?')
      .bind(now - 60 * 60 * 1000).run()
  } catch { /* no-op: un fallo aqui no debe bloquear el resto */ }

  // Guarda por VENTANA matinal (8:00-11:59 Espana), no por hora exacta. El
  // workflow dispara a varias horas UTC (06/07/08/09) para cubrir el DST y dar
  // redundancia: si GitHub Actions se retrasa o se salta un disparo, otro de la
  // misma manana lo cubre. El dedup por chat (DIGEST_DEDUP_MS, mas abajo) evita
  // que se envie mas de una vez al dia aunque disparen varias ejecuciones.
  if (!force && (spainHour < 8 || spainHour > 11)) {
    return c.json({ ok: true, skipped: 'not_digest_window', spainHour }, 200, { 'Cache-Control': 'no-store' })
  }

  // Snapshot actual de precios.
  const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
  let snap: { ListaEESSPrecio?: Array<Record<string, string>> } | null = null
  try {
    const r = await fetch(origin + '/data/stations.json', { cf: { cacheTtl: 60 } } as RequestInit)
    if (r.ok) snap = await r.json() as { ListaEESSPrecio?: Array<Record<string, string>> }
  } catch {}
  if (!snap || !Array.isArray(snap.ListaEESSPrecio)) {
    return c.json({ ok: false, error: 'snapshot_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }
  const byStation = new Map<string, Record<string, string>>()
  for (const st of snap.ListaEESSPrecio) {
    const id = st['IDEESS'] || st['IDEESS_'] || ''
    if (id) byStation.set(String(id), st)
  }

  // Todas las subs, agrupadas por chat. ORDER BY last_notified_at ASC (NULLS
  // primero en SQLite) -> los chats menos atendidos van al frente, para el
  // reparto justo cuando el presupuesto de subrequests no llega a todos.
  const all = await c.env.DB.prepare(
    'SELECT chat_id, station_id, fuel_code, last_notified_at FROM telegram_subscriptions ORDER BY last_notified_at ASC'
  ).all<{ chat_id: number; station_id: string; fuel_code: string; last_notified_at: number | null }>()
  const subs = all.results || []
  const byChat = new Map<number, Array<{ station_id: string; fuel_code: string }>>()
  const lastByChat = new Map<number, number>()
  for (const s of subs) {
    let arr = byChat.get(s.chat_id)
    if (!arr) { arr = []; byChat.set(s.chat_id, arr) }
    arr.push({ station_id: s.station_id, fuel_code: s.fuel_code })
    const prev = lastByChat.get(s.chat_id) || 0
    if ((s.last_notified_at || 0) > prev) lastByChat.set(s.chat_id, s.last_notified_at || 0)
  }

  // Dedup: no repetir el resumen dentro de la misma manana (o en reruns
  // manuales del workflow). last_notified_at pasa a significar "ultimo resumen".
  // 20h < 24h: bloquea repeticiones entre los disparos de una misma manana pero
  // deja elegible al chat al dia siguiente.
  const DIGEST_DEDUP_MS = 20 * 60 * 60 * 1000
  // Tope de subrequests por invocacion. El plan gratis de Cloudflare limita a
  // ~50 (cada envio a Telegram y cada query D1 cuenta); si lo agotamos, el
  // siguiente fetch revienta y la cola de chats se queda sin resumen. Cortamos
  // con margen: los chats que no entren quedan sin sellar y los recoge otro
  // disparo de la misma manana (por eso ORDER BY last_notified_at ASC arriba).
  const SUBREQ_BUDGET = 40
  let subreq = 3  // ya gastados: DELETE pending + fetch stations.json + SELECT subs
  const { tgSendMessage, buildPreciosMessages } = await import('./lib/telegram')
  const chatEntries = [...byChat.entries()]
  let sentChats = 0, sentMsgs = 0, purged = 0, skipped = 0, errors = 0, deferred = 0
  for (let ci = 0; ci < chatEntries.length; ci++) {
    const [chatId, chatSubs] = chatEntries[ci]
    if (!force) {
      const last = lastByChat.get(chatId) || 0
      if (last && (now - last) < DIGEST_DEDUP_MS) { skipped++; continue }
    }
    const messages = buildPreciosMessages(chatSubs, byStation, fecha)
    if (!messages.length) { skipped++; continue }  // ninguna estacion resoluble
    // Presupuesto: coste del chat = envios (messages) + 1 UPDATE del sello. Si
    // no cabe, paramos aqui en vez de reventar por "Too many subrequests".
    if (subreq + messages.length + 1 > SUBREQ_BUDGET) {
      deferred = chatEntries.length - ci
      slog('info', 'telegram_digest_budget_hit', { deferred, subreq })
      break
    }
    let ok = true
    for (const m of messages) {
      try {
        const res = await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, m)
        subreq++
        if (res.ok) {
          sentMsgs++
        } else if (res.gone) {
          // User bloqueo al bot o borro el chat — purgar todas sus subs.
          await c.env.DB.prepare('DELETE FROM telegram_subscriptions WHERE chat_id = ?').bind(chatId).run()
          subreq++; purged++; ok = false; break
        } else {
          errors++; ok = false
          slog('warn', 'telegram_digest_send_failed', { status: res.status, description: res.description })
          break
        }
      } catch (e) {
        errors++; ok = false
        slog('error', 'telegram_digest_send_exception', { message: (e as Error).message })
        break
      }
    }
    if (ok) {
      sentChats++
      try {
        await c.env.DB.prepare('UPDATE telegram_subscriptions SET last_notified_at = ? WHERE chat_id = ?')
          .bind(now, chatId).run()
        subreq++
      } catch (e) {
        slog('error', 'telegram_digest_stamp_error', { message: (e as Error).message })
      }
    }
  }
  slog('info', 'telegram_digest_done', { chats: byChat.size, sentChats, sentMsgs, purged, skipped, errors, deferred, spainHour })
  return c.json({ ok: true, chats: byChat.size, sentChats, sentMsgs, purged, skipped, errors, deferred },
    200, { 'Cache-Control': 'no-store' })
})

// ---- CSP violation report endpoint ----
// Navegadores envian aqui cada violacion de Content-Security-Policy. Es la
// senal mas temprana que tenemos de: (a) intentos de XSS, (b) extensiones
// del usuario inyectando scripts, (c) errores en nuestra propia CSP.
// Aceptamos ambos formatos: CSP Level 2 (content-type application/csp-report)
// y CSP Level 3 (content-type application/reports+json). Rate-limit propio
// para evitar DoS por spam de reports.
// ---- Telemetría / Admin ----
// Rutas en src/routes/admin.ts (csp-report, client-error, admin/*, reports/price,
// ingest, vitals). Registradas tras el resto de /api/* y antes de onError.
registerAdminRoutes(app)

// ---- Global error handler ----
// Cualquier excepcion no capturada en un handler llega aqui. Hono por defecto
// devuelve el mensaje + stack en el body: inaceptable para produccion (leak de
// paths, nombres de funciones, dependencias). Devolvemos un 500 generico y
// mandamos el detalle a logs server-side.
app.onError((err, c) => {
  slog('error', 'unhandled', {
    path: c.req.path,
    method: c.req.method,
    err: String(err).slice(0, 300),
  })
  return c.json({ error: 'internal' }, 500, { 'Cache-Control': 'no-store' })
})

// 404 generico: cualquier ruta no registrada devuelve JSON estandar. Evita que
// Hono renderice una pagina por defecto (potencialmente con detalles del route
// tree) o que el Worker caiga en rutas de assets con fallback incontrolado.
app.notFound(c => {
  return c.json({ error: 'not_found' }, 404, { 'Cache-Control': 'no-store' })
})

// ---- LOGICA DE CRON (invocada desde /api/cron/*) ----
// Las dos funciones devuelven un objeto con `ok` + metricas para que el
// endpoint lo serialize como respuesta — GHA asi puede distinguir exito
// real de "llego pero fallo" y fallar el workflow en el segundo caso.

type IngestResult =
  | { ok: true; date: string; rows: number; batches: number; ms: number }
  | { ok: false; reason: string; detail?: string }

type PurgeResult =
  | { ok: true; cutoff: string; ms: number }
  | { ok: false; reason: string; detail?: string }

// Ingesta diaria: lee el snapshot estatico ya publicado (GHA lo commitea 2
// veces/dia) y upsertea los precios del dia a D1. Idempotente via
// INSERT OR REPLACE — si el endpoint se llama dos veces, la segunda pisa la
// primera sin duplicar filas.
async function runDailyIngest(env: Env): Promise<IngestResult> {
  const startedAt = Date.now()
  if (!env.DB) {
    slog('error', 'cron.ingest.no_db', {})
    return { ok: false, reason: 'no_db' }
  }
  if (!env.PUBLIC_ORIGIN) {
    slog('error', 'cron.ingest.no_origin', {})
    return { ok: false, reason: 'no_origin' }
  }

  let snapshot: MinistryResponse | null = null
  const url = new URL('/data/stations.json', env.PUBLIC_ORIGIN).toString()
  try {
    // fetch directo (sin loadSnapshot) porque PUBLIC_ORIGIN ya es absoluto y
    // el ASSETS binding del runtime de cron puede no estar disponible igual
    // que en una request normal. Preferimos HTTP publico (agnostico al runtime).
    const res = await fetch(url)
    if (!res.ok) {
      slog('error', 'cron.ingest.fetch_failed', { url, status: res.status })
      return { ok: false, reason: 'fetch_failed', detail: 'http ' + res.status }
    }
    snapshot = await res.json() as MinistryResponse
  } catch (err) {
    const detail = String(err).slice(0, 300)
    slog('error', 'cron.ingest.fetch_exception', { err: detail })
    return { ok: false, reason: 'fetch_exception', detail }
  }

  const date = todayUtc()
  const rows = snapshotToRows(snapshot, date)
  if (rows.length === 0) {
    slog('warn', 'cron.ingest.no_rows', { date })
    return { ok: false, reason: 'no_rows' }
  }

  // D1 limita a 100 PARAMETROS BOUND por query (no 999 como SQLite puro; es
  // un limite especifico de la implementacion de Cloudflare). Con 4 columnas,
  // 25 filas por statement dan exactamente 100 placeholders — maximo seguro.
  // 12k estaciones × 4 combustibles = ~48k filas → ~1920 batches.
  //
  // Para reducir el numero de round-trips al driver usamos D1.batch([stmts])
  // agrupando varios statements por llamada. batch() acepta hasta ~50 stmts
  // segun docs, asi que cargamos de 40 en 40 para dejar margen.
  const batches = buildInsertBatches(rows, 25)
  // Preparamos todos los statements y los mandamos de 40 en 40 a D1.batch().
  // D1.batch() ejecuta cada tanda como una transaccion — si una tanda falla,
  // toda esa tanda se revierte, pero las anteriores ya commitearon. Como
  // INSERT OR REPLACE es idempotente, reintentando completa el trabajo.
  const stmts = batches.map(b => env.DB!.prepare(b.sql).bind(...b.params))
  const BATCH_GROUP = 40
  let completedBatches = 0
  try {
    for (let i = 0; i < stmts.length; i += BATCH_GROUP) {
      await env.DB.batch(stmts.slice(i, i + BATCH_GROUP))
      completedBatches += Math.min(BATCH_GROUP, stmts.length - i)
    }
  } catch (err) {
    const detail = String(err).slice(0, 300)
    slog('error', 'cron.ingest.batch_failed', {
      err: detail,
      completedBatches,
      totalBatches: batches.length,
    })
    return { ok: false, reason: 'batch_failed', detail }
  }

  const ms = Date.now() - startedAt
  slog('info', 'cron.ingest.ok', {
    date,
    rows: rows.length,
    batches: batches.length,
    ms,
  })
  return { ok: true, date, rows: rows.length, batches: batches.length, ms }
}

// Purga semanal: borra filas con date < hoy-2a. Mantiene la BD dentro del
// free tier (5 GB). Un solo DELETE: SQLite usa el indice secundario
// idx_fuel_date y marca las paginas como libres sin full-table scan.
async function runWeeklyPurge(env: Env): Promise<PurgeResult> {
  const startedAt = Date.now()
  if (!env.DB) {
    slog('error', 'cron.purge.no_db', {})
    return { ok: false, reason: 'no_db' }
  }
  const cutoff = purgeCutoffDate(new Date(), 2)
  try {
    await env.DB.prepare('DELETE FROM price_history WHERE date < ?').bind(cutoff).run()
    const ms = Date.now() - startedAt
    slog('info', 'cron.purge.ok', { cutoff, ms })
    return { ok: true, cutoff, ms }
  } catch (err) {
    const detail = String(err).slice(0, 300)
    slog('error', 'cron.purge.failed', { cutoff, err: detail })
    return { ok: false, reason: 'delete_failed', detail }
  }
}

export default app
