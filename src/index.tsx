import { Hono } from 'hono'
import { buildPage } from './html/shell'
import {
  verifyGoogleIdToken,
  signSessionJWT,
  verifySessionJWT,
  buildSessionCookie,
  buildLogoutCookie,
  parseSessionCookie,
  isSyncableKey,
} from './lib/auth'
import {
  LRU,
  validateId,
  isValidProvinciaId,
  sanitizeGeocodeQuery,
  sanitizeLatLng,
  originAllowed,
  SlidingWindowLimiter,
  tokensEqualConstTime,
  classifyPriceVsCycle,
} from './lib/pure'
import { APP_VERSION } from './lib/version'
import {
  MinistryResponseSchema,
  MunicipioListSchema,
  ProvinciaListSchema,
  safeValidate,
} from './lib/schemas'
import { PROVINCIAS, provinciaBySlug } from './lib/provincias'
import { topMunicipiosInProvincia, findMunicipioBySlug, statsForMunicipio, topCheapestStationsIn } from './lib/municipios'
import type { StationLite } from './lib/municipios'
import {
  snapshotToRows,
  buildInsertBatches,
  todayUtc,
  purgeCutoffDate,
  FUEL_CODES,
  centsToEuros,
} from './lib/history'

type StationRecord = Record<string, string> & {
  IDProvincia?: string
  IDMunicipio?: string
}
type MinistryResponse = {
  Fecha?: string
  ListaEESSPrecio?: StationRecord[]
  [k: string]: unknown
}
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
type Env = {
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

// Threshold del watchdog: si el snapshot del Ministerio es mas viejo que esto,
// /api/health devuelve 503 para activar alertas de monitorizacion.
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000  // 24 horas

const MINISTRY = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'

// APP_VERSION se importa desde ./lib/version para romper el ciclo de imports
// con ./html/shell. Se expone via /api/health.
export { APP_VERSION }

// ---- LOGGER estructurado (captado por Cloudflare Logpush / `wrangler tail`) ----
type LogLevel = 'info' | 'warn' | 'error'
function slog(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    version: APP_VERSION,
    ...fields,
  }
  // JSON de una sola linea → buscable con Logpush.
  try {
    const line = JSON.stringify(payload)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  } catch {
    console.log('log-serialize-error', event)
  }
}

// ---- LRU CACHE con tope (evita DoS por memoria) ----
const srvCache      = new LRU<unknown>(200)
const snapshotCache = new LRU<unknown>(10)
const geoCache      = new LRU<unknown>(500)      // Nominatim: cache agresivo, las direcciones cambian poco
const routeCache    = new LRU<unknown>(300)      // OSRM: cache muy agresivo, las carreteras no cambian
const SRV_TTL_FRESH = 4 * 60 * 60 * 1000         // 4h: datos fresquisimos
const SRV_TTL_STALE = 30 * 24 * 60 * 60 * 1000   // 30d: ultimo recurso en memoria
const SNAP_TTL      = 10 * 60 * 1000             // 10 min en memoria, luego re-leer del asset
const GEO_TTL_FRESH = 60 * 60 * 1000             // 1h geocode fresco
const GEO_TTL_STALE = 7  * 24 * 60 * 60 * 1000   // 7d si Nominatim cae
const GEO_UPSTREAM_TIMEOUT = 5000                 // 5s corte al upstream para evitar slowloris
// User-Agent identificable exigido por la Nominatim Usage Policy.
// https://operations.osmfoundation.org/policies/nominatim/
// El hostname se construye en runtime desde el request para evitar hardcode del
// deployment URL.
function buildUserAgent(host: string): string {
  const h = (host && /^[a-zA-Z0-9.-]+$/.test(host)) ? host : 'pages.dev'
  return 'gasolineras-espana/' + APP_VERSION + ' (+https://' + h + '/privacidad)'
}

// ---- CLOUDFLARE CACHE API (cache global compartido entre instancias) ----
// El LRU in-memory es por-instancia: cada Worker arranca vacio. El Cache API
// sobrevive entre fries y es compartido dentro de un colo → absorbe el grueso
// del trafico sin golpear ni a la LRU ni al upstream. Se combina con el LRU:
// LRU (instance-local, microsegundos) → Cache (colo, milisegundos) → upstream.
// Las claves son URLs sinteticas para no chocar con recursos reales.
function cfCache(): Cache | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (caches as any)?.default
    return c && typeof c.match === 'function' ? c : null
  } catch { return null }
}

async function cachedJson<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const cache = cfCache()
  const cacheUrl = 'https://cache.internal/' + key
  const req = new Request(cacheUrl, { method: 'GET' })
  if (cache) {
    try {
      const hit = await cache.match(req)
      if (hit) {
        const body = await hit.json() as T
        return body
      }
    } catch { /* cache miss silencioso */ }
  }
  const data = await fn()
  if (cache) {
    try {
      const res = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=' + ttlSec,
        },
      })
      // No esperamos al put: respondemos al cliente ya y poblamos cache en background.
      cache.put(req, res).catch(() => {})
    } catch { /* put fallido: siguiente request lo intentara de nuevo */ }
  }
  return data
}

// Selecciona el schema zod apropiado segun la URL del Ministerio. Si no casa
// con ninguno conocido devuelve null → salta validacion (datos pasan tal cual
// pero no se validan, ej: endpoints nuevos que aun no hemos modelado).
function schemaFor(path: string) {
  if (path.includes('EstacionesTerrestres/'))       return MinistryResponseSchema
  if (path.includes('MunicipiosPorProvincia/'))     return MunicipioListSchema
  if (path.includes('Provincias'))                  return ProvinciaListSchema
  return null
}

async function proxiedFetch(path: string): Promise<unknown> {
  const cached = srvCache.get(path)
  if (cached && Date.now() - cached.ts < SRV_TTL_FRESH) return cached.data

  let lastErr: unknown
  const t0 = Date.now()
  for (let i = 0; i < 3; i++) {
    try {
      // Timeout duro: el Ministerio a veces se cuelga y no queremos que bloquee
      // el Worker indefinidamente (slowloris / agotar CPU time limit).
      const res = await fetch(MINISTRY + path, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) { lastErr = new Error('Ministry ' + res.status); continue }
      const raw = await res.json()

      // Validacion de esquema en la frontera. Fail-open pero con telemetria:
      // si el Ministerio cambia el shape, lo detectamos en los logs y podemos
      // reaccionar antes de que llegue basura a la UI. No bloqueamos la
      // respuesta para no rompernos por cambios menores (campos nuevos).
      const schema = schemaFor(path)
      if (schema) {
        const parsed = safeValidate(schema, raw)
        if (!parsed.ok) {
          slog('error', 'ministry.schema_drift', { path, issues: parsed.issues })
          // Fallback: si tenemos cache previa validable, preferimos eso.
          if (cached && Date.now() - cached.ts < SRV_TTL_STALE) return cached.data
        }
      }

      srvCache.set(path, { data: raw, ts: Date.now() })
      slog('info', 'ministry.ok', { path, attempt: i + 1, ms: Date.now() - t0 })
      return raw
    } catch (e) {
      lastErr = e
    }
  }

  if (cached && Date.now() - cached.ts < SRV_TTL_STALE) {
    slog('warn', 'ministry.stale', { path, ageMs: Date.now() - cached.ts })
    return cached.data
  }
  slog('error', 'ministry.fail', { path, err: String(lastErr), ms: Date.now() - t0 })
  throw lastErr || new Error('Ministry API unreachable')
}

// ---- SNAPSHOT ESTATICO (fallback cuando el Ministerio esta caido) ----
async function loadSnapshot<T>(origin: string, file: string, assets?: { fetch: (req: Request) => Promise<Response> }): Promise<T | null> {
  const hit = snapshotCache.get(file)
  if (hit && Date.now() - hit.ts < SNAP_TTL) return hit.data as T
  try {
    const url = new URL('/data/' + file, origin).toString()
    const req = new Request(url)
    const res = assets ? await assets.fetch(req) : await fetch(req)
    if (!res.ok) return null
    const data = await res.json() as T
    snapshotCache.set(file, { data, ts: Date.now() })
    return data
  } catch {
    return null
  }
}

function filterStations(snapshot: MinistryResponse | null, predicate: (s: StationRecord) => boolean): MinistryResponse | null {
  if (!snapshot || !Array.isArray(snapshot.ListaEESSPrecio)) return null
  return { ...snapshot, ListaEESSPrecio: snapshot.ListaEESSPrecio.filter(predicate) }
}

// ---- CORS / ANTI-HOTLINK ----
// El allowlist explicito quedaba redundante con la regla de originAllowed() que
// acepta cualquier subdominio *.pages.dev (dondoe vive el deploy) + localhost
// (dev) + el propio host. Mantenerlo vacio deja la logica canonica en pure.ts y
// evita hardcodear la URL de produccion en el codigo (todo derivable del request).
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set<string>()

// Resuelve el hostname del request. Priorizamos el header Host (Cloudflare lo
// inyecta siempre) y caemos a parsear c.req.url. El resultado se usa para
// construir URLs canonicas (security.txt, robots, sitemap) sin hardcodear el
// dominio de produccion.
function resolveHost(c: { req: { header: (h: string) => string | undefined; url: string } }): string {
  const h = c.req.header('host')
  if (h && /^[a-zA-Z0-9.:\-]+$/.test(h)) return h
  try { return new URL(c.req.url).host } catch { return 'localhost' }
}
function resolveScheme(c: { req: { header: (h: string) => string | undefined; url: string } }): string {
  const proto = c.req.header('x-forwarded-proto')
  if (proto === 'http' || proto === 'https') return proto
  try { return new URL(c.req.url).protocol.replace(':', '') || 'https' } catch { return 'https' }
}

// ---- RATE LIMITING ----
// Protege endpoints de consumo (evita que alguien martillee y agote el free tier
// de Workers). En memoria por instancia de Worker: no es distribuido, pero anade
// friccion real sin depender de KV. Ingest tiene un limite mas bajo porque es
// escritura potencial.
const apiLimiter    = new SlidingWindowLimiter(120, 60_000)  // 120 req/min por IP
const ingestLimiter = new SlidingWindowLimiter(20,  60_000)  // 20 errores/min por IP
// Geocoding hace fetch upstream a Nominatim (policy: 1 req/s global). Un atacante
// con muchos IPs podria convertirnos en su amplificador de DDoS contra OSM, asi
// que aqui somos mas estrictos: cache cubre el trafico normal y aun asi cada IP
// puede pedir 15/min de cache-miss antes de ser bloqueada.
const geoLimiter    = new SlidingWindowLimiter(15,  60_000)  // 15 req/min por IP
// CSP report-uri: los navegadores pueden mandar muchos reports en rafaga
// (varios por pageload si hay un XSS encadenado). Rate-limit agresivo para
// evitar DoS via spam de informes desde navegador malicioso.
const cspLimiter    = new SlidingWindowLimiter(30,  60_000)  // 30 reports/min por IP
// Client errors: el navegador deduplica client-side a 10s por fingerprint, asi
// que este limite sirve solo para cortar IPs maliciosas que intentan llenar la
// tabla D1 con basura. 20/min es generoso para un usuario real (imposible
// provocar 20 errores distintos en un minuto sin romper algo serio).
const errLimiter    = new SlidingWindowLimiter(20,  60_000)  // 20 errores/min por IP
// Historico de precios: cada popup de gasolinera hace 1 call. Un usuario que
// pasea el mapa puede abrir 10 popups en un minuto tranquilamente; 60 deja
// margen ancho y aun asi frena scrapers que intenten paginar todas las
// gasolineras (11k estaciones / 60 req-min = 3 horas de scrapeo visible).
const histLimiter   = new SlidingWindowLimiter(60,  60_000)  // 60 req/min por IP
// Routing: OSRM demo server tiene policy propia (~1 req/s). Limitamos la
// misma IP a 10/min de cache-miss. El cache global absorbe re-fetches del
// mismo par origen/destino. Un atacante con muchas IPs podria convertirnos en
// amplificador, pero el payload es pequeno (~1-5 KB) y la policy no castiga
// volumen moderado.
const routeLimiter  = new SlidingWindowLimiter(20,  60_000)  // 20 req/min por IP
                                                              // (cada plan hace 2 llamadas: ruta directa + ruta con waypoints)
// Export CSV: payload grande (hasta ~12k filas, varios MB sin filtros). Un
// periodista / blogger / investigador lo descarga una vez al dia — 6/min es
// generoso para uso legitimo y hace inviable el scraping continuo.
const exportLimiter = new SlidingWindowLimiter(6,   60_000)  // 6 req/min por IP
// Ship 8: reportes de precio. 10/min/IP — margen holgado para un usuario
// legitimo reportando varias estaciones de una ruta o reintentando tras errores
// de validacion (formato de precio, etc). Bajo suficiente para frenar un bot
// que intente inflar reports sobre una sola estacion. La dedupe aplicativa
// (mismo ip_hash+ideess+fuel en 1h → 409) complementa este limite: el primer
// reporte pasa, los siguientes sobre la misma (estacion,fuel) se rechazan
// antes de tocar DB.
// Historia: empezamos con 5/min, pero humanos rellenando un form y corrigiendo
// errores de formato (coma vs punto, locale ES) agotaban la ventana en 2-3
// reintentos y quedaban bloqueados con un mensaje confuso. 10/min da oxigeno.
const reportLimiter = new SlidingWindowLimiter(10,  60_000)  // 10 reports/min por IP
// Ship 12: Real User Monitoring (Web Vitals LCP/INP/CLS/TTFB/FCP). El cliente
// manda UN beacon por sesion (en visibilitychange=hidden) con los 5 valores
// agregados. Un usuario normal no genera > 1-2 beacons / hora; 30/min deja
// margen para SPAs que reinstalen el SW o abran multiples tabs y frena bots
// que intenten inflar la telemetria sin impactar UX real.
const vitalsLimiter = new SlidingWindowLimiter(30,  60_000)  // 30 req/min por IP

function clientKey(c: { req: { header: (h: string) => string | undefined } }): string {
  // En Cloudflare Workers, `cf-connecting-ip` lo inyecta el edge CF y no se
  // puede spoofar desde el cliente — es la fuente autoritativa de la IP del
  // peticionario. `x-forwarded-for` y `x-real-ip` SI son spoofables en un
  // request directo, asi que los omitimos como fallback: preferimos rate-limitar
  // contra 'unknown' (bucket compartido, mas agresivo) que dejar un bypass
  // trivial si alguna vez el Worker se sirviera fuera del edge CF.
  return c.req.header('cf-connecting-ip') || 'unknown'
}

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

// ---- CSP con nonce por request ----
function genNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function buildCsp(nonce: string, turnstile = false, googleAuth = false): string {
  const scriptSrc  = ["'self'", "'nonce-" + nonce + "'", 'https://unpkg.com']
  // style-src con nonce + allowlist de CDNs. Ya NO llevamos 'unsafe-inline':
  //   - Los <style> inline (shell.ts / legalPage) emiten nonce="${nonce}" que
  //     coincide con este valor — el navegador ejecuta solo los que llevan el
  //     nonce valido.
  //   - Los stylesheets externos siguen permitidos por URL (unpkg, jsdelivr).
  //   - Mutaciones programaticas element.style.x = valor son CSSOM y no
  //     dependen de style-src, asi que no se rompe nada del cliente.
  //   - No hay bloque style-src-attr — si en el futuro se necesitase permitir
  //     style="..." inline en algun componente third-party se documentaria y
  //     evaluaria usar 'unsafe-hashes' antes que reintroducir 'unsafe-inline'.
  const styleSrc   = ["'self'", "'nonce-" + nonce + "'", 'https://unpkg.com', 'https://cdn.jsdelivr.net']
  const frameSrc   = ["'self'"]
  // connect-src: sin nominatim. Todo el geocoding pasa por /api/geocode/* (mismo
  // origen) → no expone la IP del usuario a OSM y reduce superficie de CSP.
  const connectSrc = ["'self'"]
  const imgSrc     = ["'self'", 'data:', 'blob:', 'https:']
  if (turnstile) {
    scriptSrc.push('https://challenges.cloudflare.com')
    frameSrc.push('https://challenges.cloudflare.com')
    connectSrc.push('https://challenges.cloudflare.com')
  }
  if (googleAuth) {
    // GIS necesita cargar el SDK + embedar un iframe de login + postMessage al
    // backend (/api/auth/google pasa por 'self', pero el SDK inicializa via
    // accounts.google.com). Solo anadimos los hosts estrictamente necesarios.
    scriptSrc.push('https://accounts.google.com/gsi/client')
    frameSrc.push('https://accounts.google.com/gsi/')
    connectSrc.push('https://accounts.google.com/gsi/')
    styleSrc.push('https://accounts.google.com/gsi/style')
    // Avatar del usuario sale de lh3.googleusercontent.com — img-src ya es https: asi
    // que no hace falta anadirlo explicito, pero lo dejamos documentado.
  }
  // tiles.openfreemap.org sirve vector tiles, sprites y glyphs PBF para el
  // estilo Liberty de MapLibre GL (render vectorial con toponimia name:es).
  // Necesita estar en connect-src (fetch del style.json + /planet + /sprites/*)
  // y en font-src (glyphs .pbf). Los tiles raster caen bajo img-src 'https:'.
  // worker-src necesita blob: porque MapLibre crea Web Workers a partir de
  // blob URLs (optimizacion de cold start del motor vectorial).
  connectSrc.push('https://tiles.openfreemap.org')
  // unpkg / jsdelivr: Chrome DevTools intenta fetchear los source maps .js.map
  // de los scripts que cargamos desde esos CDN (Leaflet, MarkerCluster, MapLibre,
  // bridge). Son fetch del navegador, caen bajo connect-src — bloquearlos
  // produce errores "Refused to connect" en consola. Permitirlos NO amplia la
  // superficie de ataque: script-src sigue exigiendo SRI en cada JS, asi que
  // aunque unpkg sirviera un .map malicioso Chrome lo parsea como JSON y no
  // lo ejecuta. Solo quita ruido de la consola del usuario.
  connectSrc.push('https://unpkg.com', 'https://cdn.jsdelivr.net')
  return [
    "default-src 'self'",
    "script-src " + scriptSrc.join(' '),
    "style-src " + styleSrc.join(' '),
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net https://tiles.openfreemap.org",
    "connect-src " + connectSrc.join(' '),
    "frame-src " + frameSrc.join(' '),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    // Report-uri es legacy pero aun lo usan la mayoria de navegadores; report-to
    // requiere un header Reporting-Endpoints complementario que tambien emitimos.
    // Cualquier violacion (XSS intentado, recurso no autorizado) llega a nuestro
    // endpoint /api/csp-report donde se lo loguea estructuradamente.
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')
}

// ---- Turnstile (opcional) ----
// Verifica un token de Cloudflare Turnstile contra la API /siteverify.
// Politica tri-estado:
//   - Ni siteKey ni secret configurados → modo dev puro, fail-open (true).
//   - Ambos configurados                  → verifica token, fail-closed si invalido.
//   - Solo uno de los dos                 → MISCONFIG. Fail-closed + log de error.
//
// El tercer caso es critico: antes el codigo devolvia true cuando faltaba el
// secret, lo que significaba que un despliegue que perdiera el secret por error
// (secret rotado y no re-pusheado, env limpiada por accidente, etc.) dejaba
// /api/ingest abierto sin que nadie se enterase. Ahora rompemos el payload y
// emitimos 'turnstile.misconfig' para que salte en alertas de logs.
async function verifyTurnstile(
  token: string | undefined,
  secret: string | undefined,
  siteKey: string | undefined,
  ip: string,
): Promise<boolean> {
  const hasSecret  = !!secret
  const hasSiteKey = !!siteKey
  if (!hasSecret && !hasSiteKey) return true   // dev puro → permisivo
  if (hasSecret !== hasSiteKey) {
    slog('error', 'turnstile.misconfig', { hasSiteKey, hasSecret })
    return false                                // misconfig → fail-closed
  }
  // A partir de aqui hasSecret === hasSiteKey === true. El type narrowing de TS
  // no propaga a traves del flag derivado, asi que comprobamos `secret` directo.
  if (!secret || !token) return false
  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    form.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (!res.ok) { slog('warn', 'turnstile.network', { status: res.status }); return false }
    const data = await res.json() as { success?: boolean; 'error-codes'?: string[] }
    if (!data.success) slog('warn', 'turnstile.reject', { codes: data['error-codes'] })
    return !!data.success
  } catch (e) {
    slog('warn', 'turnstile.error', { err: String(e) })
    return false
  }
}

// ---- HTML pages ----
// Headers compartidos (CSP + seguridad + preconnect). Factorizado porque los
// usan tanto la home como las rutas provinciales.
function pageHeaders(nonce: string, turnstile: boolean, googleAuth = false): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': buildCsp(nonce, turnstile, googleAuth),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    // GIS abre un popup cross-origin y espera un postMessage de vuelta del
    // opener. Con 'same-origin' el navegador desconecta window.opener -> el
    // popup recibe null y falla. 'same-origin-allow-popups' mantiene el canal
    // abierto solo para popups que abrimos nosotros, sin empeorar el aislamiento
    // frente a terceros. Solo lo activamos si googleAuth esta configurado.
    'Cross-Origin-Opener-Policy': googleAuth ? 'same-origin-allow-popups' : 'same-origin',
    // CORP: impide que terceros embeban nuestras respuestas via <img>/<script>/
    // etc desde otro origen. Reduce clases de side-channel como Spectre-web.
    'Cross-Origin-Resource-Policy': 'same-origin',
    // HSTS: pages.dev ya fuerza HTTPS pero publicamos este header para que
    // navegadores y scanners de cumplimiento confirmen la postura. 2 anios +
    // subdominios. Sin preload porque eso afectaria a todo pages.dev.
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    // Reporting API: el mapa de endpoints para que los navegadores envien
    // violaciones de CSP (v3). Complementa report-uri (v2 legacy).
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    'Cache-Control': 'no-store',
    'Link': [
      '<https://sedeaplicaciones.minetur.gob.es>; rel=preconnect',
      '<https://a.basemaps.cartocdn.com>; rel=preconnect; crossorigin',
      '<https://unpkg.com>; rel=preconnect; crossorigin',
    ].join(', '),
  }
}

app.get('/', async c => {
  const nonce = genNonce()
  const turnstile = !!c.env.TURNSTILE_SITE_KEY
  const googleAuth = !!c.env.GOOGLE_CLIENT_ID
  // Ship 15: exponer Fecha del snapshot para que el cliente pinte badge
  // "Precios de hace Xm". Si falla la carga, seguimos sin badge.
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

// ---- security.txt (RFC 9116) ----
// Canal publico estandar para que investigadores de seguridad sepan donde
// reportar vulnerabilidades de forma privada. Se sirve en dos rutas (con y
// sin .well-known) por compatibilidad con scanners antiguos.
function buildSecurityTxt(host: string, scheme: string): string {
  const base = scheme + '://' + host
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  return [
    '# Canal privado de reporte de vulnerabilidades',
    'Contact: https://github.com/ioritzarroyuelos-ai/gasolineras-espana/security/advisories/new',
    'Contact: https://github.com/ioritzarroyuelos-ai/gasolineras-espana/issues',
    'Expires: ' + expires,
    'Preferred-Languages: es, en',
    'Policy: ' + base + '/privacidad',
    'Canonical: ' + base + '/.well-known/security.txt',
    '',
  ].join('\n')
}
app.get('/.well-known/security.txt', c => {
  const host   = resolveHost(c)
  const scheme = resolveScheme(c)
  return c.text(buildSecurityTxt(host, scheme), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  })
})
app.get('/security.txt', c => c.redirect('/.well-known/security.txt', 301))

// ---- SEO: robots.txt ----
app.get('/robots.txt', c => {
  const host = resolveHost(c)
  const scheme = resolveScheme(c)
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    'Sitemap: ' + scheme + '://' + host + '/sitemap.xml',
    '',
  ].join('\n')
  return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
})

// ---- SEO: sitemap.xml (home + 52 provincias + TODOS los municipios >=5 + privacidad) ----
// Ship 11: se añaden los top-10 municipios por provincia (filtrados a
// estaciones >=5 para no contaminar el indice con aldeas).
// Ship 18: expandimos a TODOS los municipios que pasen el minStations=5 (no
// solo top-10). El dataset tiene ~2500 municipios con >=5 estaciones — muy
// por debajo del limite de 50k URLs por sitemap, asi que cabe de sobra. El
// motivo: dejabamos ~90% de las urls municipio sin indexar por el slicing,
// y esas son justamente las paginas long-tail donde esta la mayor parte del
// trafico SEO potencial ("gasolineras en [mi pueblo]").
// Ship 18: `lastmod` usa la fecha real del snapshot (Ministerio) en vez de
// `today`. Asi Googlebot solo re-crawlea cuando el contenido cambia
// efectivamente — mejor crawl budget.
app.get('/sitemap.xml', async c => {
  const host = resolveHost(c)
  const scheme = resolveScheme(c)
  const base = scheme + '://' + host
  const today = new Date().toISOString().slice(0, 10)
  const entries: string[] = []
  // Para agregar municipios al sitemap necesitamos el snapshot. Si falla,
  // seguimos emitiendo el sitemap basico — mejor parcialmente indexado que
  // vacio.
  let snap: MinistryResponse | null = null
  try {
    snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  } catch (err) {
    slog('warn', 'sitemap.snapshot_failed', { err: String(err).slice(0, 200) })
  }
  // lastmod preferido: fecha del snapshot del Ministerio (formato
  // "DD/MM/YYYY HH:mm:SS"). Fallback: hoy. Parseo defensivo — si el formato
  // cambia, caemos a `today` sin romper el sitemap.
  let snapLastmod = today
  if (snap && typeof snap.Fecha === 'string') {
    const m = snap.Fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) snapLastmod = `${m[3]}-${m[2]}-${m[1]}`
  }
  entries.push(`  <url><loc>${base}/</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`)
  for (const p of PROVINCIAS) {
    entries.push(`  <url><loc>${base}/gasolineras/${p.slug}</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
    if (snap) {
      // Ship 18: todos los municipios con >=5 estaciones, no solo top-10.
      // Usamos el limit alto (10k) efectivamente para decir "sin limite por
      // provincia". Sigue aplicando minStations=5.
      const munis = topMunicipiosInProvincia(snap, p.id, { limit: 10000, minStations: 5 })
      for (const m of munis) {
        entries.push(`  <url><loc>${base}/gasolineras/${p.slug}/${m.slug}</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`)
      }
    }
  }
  entries.push(`  <url><loc>${base}/privacidad</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`)
  entries.push(`  <url><loc>${base}/status</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>0.2</priority></url>`)
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  return c.text(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

// ---- Paginas legales (HTML simple, sin JS) ----
// El nonce debe coincidir con el del header CSP — sin el atributo el <style>
// inline es bloqueado (style-src no lleva ya 'unsafe-inline'). El caller de
// la ruta es quien genera el nonce via genNonce() y lo pasa a ambos sitios.
function legalPage(title: string, bodyHtml: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Gasolineras España</title>
<meta name="robots" content="index,follow"/>
<meta name="description" content="${title} de Gasolineras España"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26FD;</text></svg>"/>
<style nonce="${nonce}">
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;color:#1f2937;line-height:1.6}
  h1{color:#14532d;border-bottom:2px solid #16a34a;padding-bottom:8px}
  h2{color:#15803d;margin-top:28px}
  a{color:#16a34a}
  code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
  .back{display:inline-block;margin-bottom:16px;color:#64748b;text-decoration:none}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;color:#64748b}
</style>
</head><body>
<a class="back" href="/">← Volver</a>
${bodyHtml}
<footer>Gasolineras España · v${APP_VERSION} · Datos: Ministerio para la Transición Ecológica y el Reto Demográfico.</footer>
</body></html>`
}

// ---- /status: pagina publica de estado del servicio ----
// Expone los mismos datos que /api/health (publico) pero renderizados en HTML
// con auto-refresh 60s. Objetivo: cualquier usuario (o external monitor
// tipo uptimerobot) puede ver a simple vista si el servicio esta vivo y si
// el snapshot del Ministerio es fresco.
//
// No depende de JS del cliente — HTML puro para que funcione incluso si la
// CSP es excesivamente estricta o si el user-agent es un crawler/monitor
// sin JS. Datos se calculan server-side en cada request.
app.get('/status', async c => {
  const nonce = genNonce()
  const meta = await loadSnapshot<SnapshotMeta>(c.req.url, 'snapshot-meta.json', c.env.ASSETS)
  const now = Date.now()
  let ageMs: number | null = null
  let fetchedAtFmt = '—'
  let stale = true   // sin meta = stale por precaucion
  if (meta?.fetchedAt) {
    const t = Date.parse(meta.fetchedAt)
    if (Number.isFinite(t)) {
      ageMs = now - t
      stale = ageMs > SNAPSHOT_STALE_MS
      fetchedAtFmt = new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    }
  }
  const ageTxt = ageMs == null ? '—'
    : ageMs < 60_000       ? Math.round(ageMs / 1000) + 's'
    : ageMs < 3_600_000    ? Math.round(ageMs / 60_000) + ' min'
    : ageMs < 86_400_000   ? Math.round(ageMs / 3_600_000) + ' h'
    : Math.round(ageMs / 86_400_000) + ' d'
  const statusLabel = stale ? 'DEGRADADO' : 'OPERATIVO'
  const statusClass = stale ? 'down' : 'up'
  const stationCount = typeof meta?.stationCount === 'number' ? meta.stationCount.toLocaleString('es-ES') : '—'
  const ministryDate = meta?.ministryDate ?? '—'
  // Esc HTML muy simple — las piezas vienen de nuestro meta JSON y son strings
  // muy cortas (fechas, numeros), pero defensivo por si el snapshot cambia.
  const esc = (v: string): string => v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const bodyHtml = `
<style nonce="${nonce}">
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:32px 20px;color:#1f2937;line-height:1.6}
  h1{color:#14532d;border-bottom:2px solid #16a34a;padding-bottom:8px;margin-bottom:8px}
  h2{color:#15803d;margin-top:28px;font-size:18px}
  a{color:#16a34a}
  .back{display:inline-block;margin-bottom:16px;color:#64748b;text-decoration:none}
  .status-hero{display:flex;align-items:center;gap:14px;padding:20px;border-radius:10px;border:2px solid;margin:8px 0 24px}
  .status-hero.up{background:#dcfce7;border-color:#16a34a;color:#14532d}
  .status-hero.down{background:#fef2f2;border-color:#b91c1c;color:#7f1d1d}
  .status-dot{width:14px;height:14px;border-radius:50%;display:inline-block}
  .status-dot.up{background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.2)}
  .status-dot.down{background:#b91c1c;box-shadow:0 0 0 4px rgba(185,28,28,.2)}
  .status-label{font-size:22px;font-weight:700;letter-spacing:.02em}
  .status-sub{font-size:13px;opacity:.8;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}
  th{color:#64748b;font-weight:500;width:40%}
  td{font-family:ui-monospace,Consolas,Menlo,monospace;color:#0f172a}
  .foot{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#64748b}
  .muted{color:#64748b;font-size:13px}
</style>
<a class="back" href="/">← Volver</a>
<h1>Estado del servicio</h1>
<p class="muted">Esta pagina se actualiza automaticamente cada 60 segundos.</p>

<div class="status-hero ${statusClass}">
  <span class="status-dot ${statusClass}" aria-hidden="true"></span>
  <div>
    <div class="status-label">${statusLabel}</div>
    <div class="status-sub">${stale ? 'Snapshot del Ministerio desactualizado — el servicio sigue respondiendo con los ultimos datos disponibles.' : 'Todos los sistemas operativos. Datos actualizados.'}</div>
  </div>
</div>

<h2>Datos del ultimo snapshot</h2>
<table>
  <tbody>
    <tr><th>Ultima ingesta</th><td>${esc(fetchedAtFmt)}</td></tr>
    <tr><th>Edad del snapshot</th><td>${esc(ageTxt)}</td></tr>
    <tr><th>Fecha Ministerio</th><td>${esc(ministryDate)}</td></tr>
    <tr><th>Estaciones cargadas</th><td>${esc(stationCount)}</td></tr>
    <tr><th>Version</th><td>v${APP_VERSION}</td></tr>
  </tbody>
</table>

<h2>Endpoints de salud</h2>
<table>
  <tbody>
    <tr><th><code>/api/health</code></th><td>JSON publico (ok, stale, version)</td></tr>
    <tr><th><code>/data/snapshot-meta.json</code></th><td>Meta del ultimo snapshot</td></tr>
    <tr><th><code>/api/export</code></th><td>CSV publico de precios</td></tr>
  </tbody>
</table>

<p class="foot">Datos origen: <a href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help">API oficial del Ministerio</a>.
El snapshot se re-ingesta 1 vez al dia (20:00 UTC) por cron en GitHub Actions.
Si ves "DEGRADADO" mas de 48h seguidas, hay un problema — abre una issue.</p>
`
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Estado · Gasolineras España</title>
<meta name="robots" content="index,follow"/>
<meta name="description" content="Estado del servicio Gasolineras España: health, freshness del snapshot del Ministerio, numero de estaciones cargadas."/>
<meta http-equiv="refresh" content="60"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${stale ? '&#x26A0;' : '&#x2705;'}</text></svg>"/>
</head><body>
${bodyHtml}
</body></html>`
  return c.html(html, stale ? 503 : 200, {
    ...pageHeaders(nonce, false),
    // Cache muy corto: la pagina misma necesita recomputarse en cada req con
    // el meta fresco, pero 30s de edge ayuda ante un hit masivo de monitors.
    'Cache-Control': 'public, max-age=30',
  })
})

app.get('/privacidad', c => {
  // Generamos nonce por request igual que en la home, y emitimos CSP completa
  // (antes /privacidad respondia sin Content-Security-Policy — un XSS en la
  // pagina legal habria tenido ejecucion libre). turnstile=false porque no hay
  // widget en la pagina legal.
  const nonce = genNonce()
  const html = legalPage('Privacidad', `
<h1>Política de privacidad</h1>
<p><strong>Última actualización:</strong> ${new Date().toISOString().slice(0,10)}</p>

<h2>Qué datos tratamos</h2>
<p>Esta aplicación <strong>no almacena</strong> datos personales en nuestros servidores. Todos los ajustes (provincia, combustible, favoritos, perfil de vehículo) se guardan exclusivamente en el <code>localStorage</code> de tu navegador y nunca salen de tu dispositivo.</p>

<h2>Geolocalización</h2>
<p>Si concedes permiso de ubicación, tus coordenadas se usan <strong>solo en el navegador</strong> para calcular la distancia a las gasolineras. No se envían a ningún servidor.</p>

<h2>Servicios de terceros</h2>
<ul>
  <li><strong>Ministerio para la Transición Ecológica</strong>: origen oficial de los precios. Las peticiones pasan por nuestro servidor, tu IP no llega al Ministerio.</li>
  <li><strong>OpenStreetMap Nominatim</strong>: geocodificación de direcciones. Las peticiones pasan por nuestro servidor (endpoint <code>/api/geocode/*</code>), tu IP no llega a OpenStreetMap.</li>
  <li><strong>CartoDB / unpkg</strong>: CDN de tiles de mapa y librerías. Estos servicios sí reciben tu IP directamente porque los recursos se cargan desde el navegador.</li>
</ul>

<h2>Informes de errores</h2>
<p>Si se produce un fallo en JavaScript, se puede enviar un informe técnico mínimo (mensaje, stack, URL, user-agent) al endpoint <code>/api/ingest</code>. No se incluye contenido introducido por el usuario ni cookies. Puedes desactivarlo bloqueando <code>/api/ingest</code> en tu navegador.</p>

<h2>Cookies</h2>
<p>No usamos cookies de seguimiento ni publicidad.</p>

<h2>Contacto</h2>
<p>Incidencias: issue en el repositorio.</p>
`, nonce)
  return c.html(html, 200, {
    ...pageHeaders(nonce, false),
    // pageHeaders fija Cache-Control: no-cache para rutas dinamicas con Turnstile,
    // pero la pagina legal es estatica y cacheable por 1h — sobreescribimos despues.
    'Cache-Control': 'public, max-age=3600',
  })
})

// ---- API ----

// ---- Auth (Google OAuth + session JWT + KV sync) ----
// Flujo completo:
//   1) Cliente carga GIS (accounts.google.com/gsi/client).
//   2) Usuario firma y recibe un ID token (JWT RS256 de Google).
//   3) POST /api/auth/google { credential } con el ID token.
//   4) Server verifica firma contra el JWKS de Google y emite una cookie de
//      sesion firmada con HMAC-SHA256 (SESSION_SECRET, 30d, HttpOnly+Secure+Lax).
//   5) GET /api/me devuelve { user } si hay sesion valida, o { user: null }.
//   6) /api/sync/* lee/escribe datos en USER_DATA KV con key `u:${sub}:${dataKey}`.
//   7) POST /api/auth/logout limpia la cookie.
//
// Degradacion:
//   - Sin GOOGLE_CLIENT_ID o SESSION_SECRET: /api/auth/google -> 503.
//   - Sin USER_DATA: /api/sync/* -> 503, pero el login funciona.
async function getSessionUser(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const secret = c.env.SESSION_SECRET
  if (!secret) return null
  const token = parseSessionCookie(c.req.header('cookie'))
  if (!token) return null
  return verifySessionJWT(token, secret)
}

app.post('/api/auth/google', async c => {
  const rl = ingestLimiter.check(clientKey(c))
  if (!rl.allowed) return c.json({ error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  const clientId = c.env.GOOGLE_CLIENT_ID
  const secret = c.env.SESSION_SECRET
  if (!clientId || !secret) return c.json({ error: 'auth_not_configured' }, 503)

  let body: { credential?: string }
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_request' }, 400) }
  const credential = typeof body?.credential === 'string' ? body.credential : ''
  if (!credential || credential.length > 4000) return c.json({ error: 'bad_request' }, 400)

  let payload: { sub: string; email?: string; name?: string; picture?: string } | null
  try {
    payload = await verifyGoogleIdToken(credential, clientId)
  } catch (e) {
    slog('warn', 'auth.google_verify_fail', { err: String(e).slice(0, 200) })
    return c.json({ error: 'invalid_token' }, 401)
  }
  if (!payload) return c.json({ error: 'invalid_token' }, 401)

  const token = await signSessionJWT({
    sub: payload.sub,
    email: payload.email || '',
    name: payload.name || '',
    picture: payload.picture || '',
  }, secret)

  return c.json(
    { user: { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture } },
    200,
    { 'Set-Cookie': buildSessionCookie(token), 'Cache-Control': 'no-store' },
  )
})

app.post('/api/auth/logout', c => {
  return c.json({ ok: true }, 200, { 'Set-Cookie': buildLogoutCookie(), 'Cache-Control': 'no-store' })
})

app.get('/api/me', async c => {
  const secret = c.env.SESSION_SECRET
  if (!secret) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store' })
  const token = parseSessionCookie(c.req.header('cookie'))
  if (!token) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store' })
  const payload = await verifySessionJWT(token, secret)
  if (!payload) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': buildLogoutCookie() })
  return c.json({
    user: { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture },
  }, 200, { 'Cache-Control': 'no-store' })
})

app.get('/api/sync', async c => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const kv = c.env.USER_DATA
  if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
  const prefix = 'u:' + user.sub + ':'
  const list = await kv.list({ prefix, limit: 100 })
  const out: Record<string, unknown> = {}
  for (const { name } of list.keys) {
    const key = name.slice(prefix.length)
    if (!isSyncableKey(key)) continue
    const val = await kv.get(name, { type: 'json' })
    if (val !== null) out[key] = val
  }
  return c.json({ data: out }, 200, { 'Cache-Control': 'no-store' })
})

app.put('/api/sync/:key', async c => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const kv = c.env.USER_DATA
  if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
  const dataKey = c.req.param('key')
  if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
  let body: unknown
  try { body = await c.req.json() } catch { return c.json({ error: 'bad_request' }, 400) }
  // Cap al valor para evitar abuso del KV (256 KB por entrada). Si alguien
  // mete algo gordo lo rechazamos antes de persistir.
  const serialized = JSON.stringify(body)
  if (serialized.length > 256 * 1024) return c.json({ error: 'payload_too_large' }, 413)
  await kv.put('u:' + user.sub + ':' + dataKey, serialized)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

app.delete('/api/sync/:key', async c => {
  const user = await getSessionUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  const kv = c.env.USER_DATA
  if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
  const dataKey = c.req.param('key')
  if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
  await kv.delete('u:' + user.sub + ':' + dataKey)
  return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
})

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

// Bbox: devuelve todas las estaciones dentro de un rectangulo geografico.
// Para la feature "ruta A->B", el cliente necesita estaciones de multiples
// provincias simultaneamente (un Madrid->Barcelona cruza 5+ provincias). Ir
// provincia por provincia seria lento y fragil; leemos directamente del
// snapshot estatico (ya en memoria del Worker) y filtramos por lat/lng.
//
// Limites de seguridad:
//   - bbox maxima 6°x6° (~660x660 km) — cubre con holgura la diagonal de
//     Espana peninsular (Coruna-Cartagena ~950 km, pero en pedazos de 600 km
//     podemos paginar si hiciera falta).
//   - rechaza coordenadas fuera de Espana (bbox nominal 27-44N, -19 a 5E).
//   - cap blando: si el filtro devuelve mas de MAX_STATIONS_PER_BBOX, truncamos.
app.get('/api/estaciones/bbox', async c => {
  const minLat = Number(c.req.query('minLat'))
  const maxLat = Number(c.req.query('maxLat'))
  const minLng = Number(c.req.query('minLng'))
  const maxLng = Number(c.req.query('maxLng'))
  if (![minLat, maxLat, minLng, maxLng].every(v => Number.isFinite(v))) {
    return c.json({ error: 'bbox invalido' }, 400)
  }
  if (minLat >= maxLat || minLng >= maxLng) {
    return c.json({ error: 'bbox invertido' }, 400)
  }
  // Spain nominal bbox (peninsula + Baleares + Canarias). Rechaza todo fuera
  // con margen para evitar que un atacante fuerce filtros absurdos (N Pole, etc).
  if (minLat < 26 || maxLat > 45 || minLng < -20 || maxLng > 6) {
    return c.json({ error: 'bbox fuera de Espana' }, 400)
  }
  // Area maxima razonable: 10°x10° (cubre Peninsula Iberica completa). Un
  // Durango-Cadiz (~7°x4°) cabe comodamente. Para queries absurdos (Canarias
  // + Pirineos), 10° es el hard-cap. La proteccion real la da
  // MAX_STATIONS_PER_BBOX sobre el payload.
  if ((maxLat - minLat) > 10 || (maxLng - minLng) > 10) {
    return c.json({ error: 'bbox demasiado grande (max 10 grados por lado)' }, 400)
  }

  const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  if (!snap) return c.json({ error: 'snapshot no disponible' }, 503)

  // Snapshot de Espana: ~12k estaciones totales. Con el cap a 12000 no hay
  // truncado silencioso en rutas largas; 12000 * ~300 B = ~3.6 MB sin gzip
  // (~500 KB con gzip). Aceptable para una feature deliberada (route planner).
  const MAX_STATIONS_PER_BBOX = 12000
  const filtered = filterStations(snap, s => {
    // Ministerio devuelve lat/lng como string con coma decimal. Fail-safe:
    // si no parsea, se descarta (no cuenta).
    const lat = Number(String(s['Latitud'] ?? '').replace(',', '.'))
    const lng = Number(String(s['Longitud (WGS84)'] ?? '').replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
    return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
  })
  if (!filtered) return c.json({ error: 'snapshot corrupto' }, 503)
  if (Array.isArray(filtered.ListaEESSPrecio) && filtered.ListaEESSPrecio.length > MAX_STATIONS_PER_BBOX) {
    filtered.ListaEESSPrecio = filtered.ListaEESSPrecio.slice(0, MAX_STATIONS_PER_BBOX)
  }
  // Cacheable 1h: el snapshot se regenera cada mananas, un bbox que devuelve
  // las mismas estaciones durante todo el dia es razonable. Los precios
  // dentro del snapshot pueden estar desactualizados pero esto es aceptable
  // para una feature de planificacion de ruta (precios cambian pocas veces/dia).
  return c.json(filtered, 200, {
    'Cache-Control': 'public, max-age=3600',
    'X-Data-Source': 'snapshot',
  })
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
//      distintos clientes (cada 'Madrid' buscado una vez y ya).
//   3. Hardening: saneamos la entrada, timeoutamos el upstream, y solo dejamos
//      pasar un conjunto explicito de campos (pick-list) en la respuesta.
// Nominatim Usage Policy (https://operations.osmfoundation.org/policies/nominatim/)
// exige User-Agent identificable, bounded rate, y que cacheemos respuestas.
function pickSearchItem(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lat = typeof r.lat === 'string' ? r.lat : typeof r.lat === 'number' ? String(r.lat) : null
  const lon = typeof r.lon === 'string' ? r.lon : typeof r.lon === 'number' ? String(r.lon) : null
  const displayName = typeof r.display_name === 'string' ? r.display_name : null
  if (!lat || !lon || !displayName) return null
  const out: Record<string, unknown> = {
    lat, lon,
    display_name: displayName.length > 300 ? displayName.slice(0, 300) : displayName,
  }
  if (typeof r.type === 'string')  out.type  = r.type
  if (typeof r.class === 'string') out.class = r.class
  if (Array.isArray(r.boundingbox) && r.boundingbox.length === 4
      && r.boundingbox.every(v => typeof v === 'string')) {
    out.boundingbox = r.boundingbox
  }
  return out
}

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

app.get('/api/geocode/search', async c => {
  const rl = geoLimiter.check(clientKey(c))
  if (!rl.allowed) {
    return c.json({ error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }
  const q = sanitizeGeocodeQuery(c.req.query('q'))
  if (!q) return c.json({ error: 'query invalida' }, 400)

  const cacheKey = 's:' + q.toLowerCase()
  const hit = geoCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < GEO_TTL_FRESH) {
    return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'HIT' })
  }

  const host = c.req.header('host') || ''
  // cachedJson wrappea el Cache API de Cloudflare: la siguiente peticion al
  // mismo colo se resuelve sin volver a golpear Nominatim aunque el Worker se
  // haya reiniciado. TTL 1h es suficiente para direcciones espanolas.
  const safe = await cachedJson('geo-search-' + encodeURIComponent(cacheKey), 3600, async () => {
    const url = 'https://nominatim.openstreetmap.org/search?'
      + 'format=json&limit=5&countrycodes=es&q=' + encodeURIComponent(q)
    const raw = await upstreamGeo<unknown>(url, host)
    if (!Array.isArray(raw)) return null
    return raw.map(pickSearchItem).filter(x => x !== null).slice(0, 5)
  })

  if (!safe) {
    // Fallback stale: mejor una respuesta vieja que nada si Nominatim cae.
    if (hit && Date.now() - hit.ts < GEO_TTL_STALE) {
      return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=600', 'X-Cache': 'STALE' })
    }
    return c.json([], 200, { 'Cache-Control': 'no-store' })
  }

  geoCache.set(cacheKey, { data: safe, ts: Date.now() })
  return c.json(safe, 200, { 'Cache-Control': 'public, max-age=3600', 'X-Cache': 'MISS' })
})

// ---- Routing proxy (OSRM public demo) ----
// Feature "ruta A->B": el cliente necesita la geometria real por carretera
// (no linea recta) para: (1) dibujarla en el mapa, (2) proyectar estaciones
// sobre el trayecto real al planificar paradas.
//
// Usamos el demo publico de OSRM (router.project-osrm.org). Policy: "light
// use"; tenemos rate limit (10/min por IP) + cache agresivo (24h en LRU + 30d
// en Cache API). Las carreteras no cambian en 24h, asi que los TTL largos son
// seguros.
//
// Seguridad:
//   - Validacion estricta de lat/lng (sanitizeLatLng) para evitar
//     inyectar '?foo=bar' o query strings en el URL de OSRM.
//   - Timeout 8s al upstream.
//   - Respuesta filtrada: solo exponemos distance/duration + coordinates
//     simplificadas (nada de metadata de OSRM que pudiera cambiar).
const ROUTE_TTL_FRESH = 24 * 60 * 60 * 1000       // 24h en memoria
const ROUTE_TTL_STALE = 30 * 24 * 60 * 60 * 1000  // 30d fallback
const ROUTE_UPSTREAM_TIMEOUT = 8000                // OSRM suele responder <2s

interface RouteResponse {
  distanceKm: number
  durationSec: number
  coordinates: [number, number][]  // [lng, lat]
}

async function upstreamRoute(url: string): Promise<RouteResponse | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ROUTE_UPSTREAM_TIMEOUT),
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) {
      slog('warn', 'route.upstream_status', { status: res.status })
      return null
    }
    const raw = await res.json() as Record<string, unknown>
    if (raw.code !== 'Ok') return null
    const routes = raw.routes as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(routes) || routes.length === 0) return null
    const r = routes[0]
    const distMeters = typeof r.distance === 'number' ? r.distance : 0
    const durSeconds = typeof r.duration === 'number' ? r.duration : 0
    const geom = r.geometry as Record<string, unknown> | undefined
    if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return null
    // Passthrough restrictivo: validamos cada coord. Capamos a 20000 puntos
    // como safety net. Con overview=simplified una ruta peninsular completa
    // (Durango-Cadiz ~1000 km) devuelve ~300-800 puntos; con overview=full
    // puede superar 8000 y alcanzaba el cap anterior, truncando la ruta a
    // medio camino. 20000 da margen amplio para cualquier caso.
    const coords: [number, number][] = []
    const raw_coords = geom.coordinates as unknown[]
    for (let i = 0; i < raw_coords.length && i < 20000; i++) {
      const p = raw_coords[i]
      if (!Array.isArray(p) || p.length < 2) continue
      const lng = Number(p[0])
      const lat = Number(p[1])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
      coords.push([lng, lat])
    }
    if (coords.length < 2) return null
    return {
      distanceKm: distMeters / 1000,
      durationSec: Math.round(durSeconds),
      coordinates: coords,
    }
  } catch (e) {
    slog('warn', 'route.upstream_err', { err: String(e).slice(0, 200) })
    return null
  }
}

// Parsea el parametro `stops` = "lat1,lng1;lat2,lng2;..." con validaciones.
// Devuelve array de {lat,lng} formateados con sanitizeLatLng o null si el
// input es invalido. Limita a MAX_STOPS puntos intermedios (rutas reales
// nunca necesitan muchos; 8 cubre hasta 4000-5000 km peninsula con holgura).
const MAX_ROUTE_STOPS = 8
function parseStops(raw: string | undefined): { lat: string; lng: string }[] | null {
  if (!raw) return []
  if (raw.length > 400) return null  // limite duro al query string
  const out: { lat: string; lng: string }[] = []
  const parts = raw.split(';')
  if (parts.length > MAX_ROUTE_STOPS) return null
  for (const p of parts) {
    const [latStr, lngStr] = p.split(',')
    const ll = sanitizeLatLng(latStr, lngStr)
    if (!ll) return null
    out.push(ll)
  }
  return out
}

app.get('/api/route', async c => {
  const rl = routeLimiter.check(clientKey(c))
  if (!rl.allowed) {
    return c.json({ error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }
  const from = sanitizeLatLng(c.req.query('fromLat'), c.req.query('fromLng'))
  const to   = sanitizeLatLng(c.req.query('toLat'),   c.req.query('toLng'))
  if (!from || !to) return c.json({ error: 'coordenadas invalidas' }, 400)
  const stops = parseStops(c.req.query('stops'))
  if (stops === null) return c.json({ error: 'parametro stops invalido' }, 400)
  // Validacion extra: bounds de Espana (nominal con margen generoso). OSRM
  // funciona globalmente pero aqui acotamos al caso de uso del producto.
  const inSpain = (lat: number, lng: number) =>
    lat >= 26 && lat <= 45 && lng >= -20 && lng <= 6
  if (!inSpain(Number(from.lat), Number(from.lng))) return c.json({ error: 'origen fuera de Espana' }, 400)
  if (!inSpain(Number(to.lat), Number(to.lng)))     return c.json({ error: 'destino fuera de Espana' }, 400)
  for (const s of stops) {
    if (!inSpain(Number(s.lat), Number(s.lng))) return c.json({ error: 'parada fuera de Espana' }, 400)
  }
  if (from.lat === to.lat && from.lng === to.lng)   return c.json({ error: 'origen = destino' }, 400)

  // Clave de cache: incluye paradas para que rutas con distintos waypoints
  // no colisionen con la ruta directa.
  const stopsKey = stops.map(s => s.lat + ',' + s.lng).join(';')
  const cacheKey = from.lat + ',' + from.lng + '-' + to.lat + ',' + to.lng + (stopsKey ? '|' + stopsKey : '')
  const hit = routeCache.get(cacheKey)
  if (hit && Date.now() - hit.ts < ROUTE_TTL_FRESH) {
    return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'HIT' })
  }

  // v3 en la clave para invalidar rutas cacheadas con simplificacion agresiva
  // (overview=simplified dibujaba lineas rectas que cortaban las curvas de la
  // carretera). Con overview=full + cap 20k puntos, las rutas peninsulares
  // renderizan a escala calle sin perder fidelidad.
  const out = await cachedJson('route-v3-' + encodeURIComponent(cacheKey), 86400, async () => {
    // OSRM: coordenadas en orden lng,lat (GeoJSON convention).
    // Cadena de waypoints: from;stop1;stop2;...;to. OSRM devuelve una sola
    // polilinea que pasa por todos ellos, con la distancia/duracion totales.
    // overview=full: geometria sin simplificar. Para rutas peninsulares devuelve
    // 3k-15k puntos que caben bajo el cap de 20k en upstreamRoute(). Necesario
    // para que la polilinea siga las curvas reales de la carretera a cualquier
    // zoom (con 'simplified' Leaflet conectaba puntos espaciados con rectas
    // que cruzaban autovias en diagonal).
    const waypoints: { lat: string; lng: string }[] = [from, ...stops, to]
    const coordsStr = waypoints
      .map(w => encodeURIComponent(w.lng) + ',' + encodeURIComponent(w.lat))
      .join(';')
    const url = 'https://router.project-osrm.org/route/v1/driving/' + coordsStr
      + '?overview=full&geometries=geojson&alternatives=false&steps=false'
    return await upstreamRoute(url)
  })

  if (!out) {
    if (hit && Date.now() - hit.ts < ROUTE_TTL_STALE) {
      return c.json(hit.data, 200, { 'Cache-Control': 'public, max-age=600', 'X-Cache': 'STALE' })
    }
    return c.json({ error: 'routing no disponible' }, 503)
  }

  routeCache.set(cacheKey, { data: out, ts: Date.now() })
  return c.json(out, 200, { 'Cache-Control': 'public, max-age=86400', 'X-Cache': 'MISS' })
})

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

  if (!c.env.DB) {
    // Dev sin binding D1: 503 explicito para que el cliente muestre UI de
    // "historial no disponible" en lugar de error generico.
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  // Cutoff = hoy - days. Usamos el mismo formato YYYY-MM-DD que usa la tabla
  // para evitar conversiones timezone-sensitive.
  const today = new Date()
  const cutoffDate = new Date(today.getTime())
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  try {
    const stmt = c.env.DB
      .prepare('SELECT fuel_code, date, price_cents FROM price_history WHERE station_id = ? AND date >= ? ORDER BY date ASC')
      .bind(stationId, cutoff)
    const { results } = await stmt.all<{ fuel_code: string; date: string; price_cents: number }>()

    // Agrupamos por fuel_code para devolver un objeto { '95': [...], 'diesel': [...] }
    // comodo de consumir desde el cliente sin logica extra de agrupacion.
    const series: Record<string, Array<{ date: string; price: number }>> = {}
    for (const f of FUEL_CODES) series[f] = []
    for (const r of results) {
      const arr = series[r.fuel_code]
      if (!arr) continue  // combustible no mapeado (defensivo)
      arr.push({ date: r.date, price: centsToEuros(r.price_cents) })
    }

    return c.json(
      { station_id: stationId, days, series },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  } catch (err) {
    slog('error', 'history.query_failed', {
      stationId,
      days,
      err: String(err).slice(0, 300),
    })
    return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
  }
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

  if (!c.env.DB) {
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  // Para filtrar por provincia necesitamos la lista de stationIds de ella. La
  // derivamos del snapshot estatico (ya cacheado en memoria por loadSnapshot),
  // evitando duplicar metadata de estacion en D1.
  const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  if (!snap || !Array.isArray(snap.ListaEESSPrecio)) {
    return c.json({ error: 'snapshot_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }
  const stationIds = snap.ListaEESSPrecio
    .filter(s => s.IDProvincia === id && typeof s['IDEESS'] === 'string' && /^\d{1,10}$/.test(s['IDEESS']))
    .map(s => s['IDEESS'] as string)

  if (stationIds.length === 0) {
    return c.json(
      { provincia_id: id, fuel, days, median: [] },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  }

  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  // D1 limita a 100 parametros bound por query. Con 2 fijos (fuel, cutoff)
  // podemos meter como mucho 98 station_ids por sub-query. Paginamos en
  // chunks de 90 (margen) y consultamos en paralelo — Madrid (~900 estaciones)
  // sale en 10 sub-queries, milisegundos en total.
  const CHUNK = 90
  const sqlTemplate = (n: number) =>
    `SELECT date, price_cents FROM price_history WHERE fuel_code = ? AND date >= ? AND station_id IN (${new Array(n).fill('?').join(',')})`

  try {
    const chunkResults: Array<{ date: string; price_cents: number }> = []
    // Array de promises de sub-queries; D1 las ejecuta concurrentemente
    // (Workers runtime soporta fetch concurrency nativo).
    const queries: Promise<{ results: Array<{ date: string; price_cents: number }> }>[] = []
    for (let i = 0; i < stationIds.length; i += CHUNK) {
      const slice = stationIds.slice(i, i + CHUNK)
      const sql = sqlTemplate(slice.length)
      queries.push(
        c.env.DB.prepare(sql).bind(fuel, cutoff, ...slice)
          .all<{ date: string; price_cents: number }>()
      )
    }
    const subResults = await Promise.all(queries)
    for (const sr of subResults) for (const r of sr.results) chunkResults.push(r)
    // Mantenemos 'results' para que el resto de la funcion (agregacion por
    // fecha + mediana) no cambie.
    const results = chunkResults

    // Agrupa por dia y calcula la mediana (valor central). Para un numero
    // par de observaciones tomamos el de indice n/2 (no la media de los dos
    // centrales) — es mas barato y la diferencia practica es invisible en un
    // sparkline a resolucion pixel.
    const byDate = new Map<string, number[]>()
    for (const r of results) {
      let arr = byDate.get(r.date)
      if (!arr) { arr = []; byDate.set(r.date, arr) }
      arr.push(r.price_cents)
    }
    const median: Array<{ date: string; price: number }> = []
    const dates = Array.from(byDate.keys()).sort()
    for (const date of dates) {
      const arr = byDate.get(date)!
      arr.sort((a, b) => a - b)
      const mid = arr[Math.floor(arr.length / 2)]
      median.push({ date, price: centsToEuros(mid) })
    }

    return c.json(
      { provincia_id: id, fuel, days, median },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  } catch (err) {
    slog('error', 'history.province_median_failed', {
      provinciaId: id,
      fuel,
      days,
      err: String(err).slice(0, 300),
    })
    return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
  }
})

// ---- STATS NACIONALES (Ship 15) ----
// Precio medio nacional por dia para los dos combustibles mas consumidos
// (gasolina 95 + gasoleo A). Devuelve, para cada fuel:
//
//   - today     : media del ultimo dia disponible en price_history
//   - avg30d    : media simple de las medias diarias del periodo
//   - delta_pct : (today - avg30d) / avg30d * 100 — positivo = mas caro hoy
//   - samples   : cuantas estaciones aportaron hoy (sanity check / confianza)
//
// Usamos AVG(price_cents) via SQL (30 filas × 2 fuels = 60 filas transferidas,
// independiente del numero de estaciones). La mediana seria mas robusta a
// outliers pero requiere traer todas las filas (600k/mes peor caso) y SQLite
// no tiene PERCENTILE nativo. A escala nacional con ~11k estaciones/dia, el
// 5% de outliers raramente desplaza la media > 1 cent — acceptable.
//
// Motivacion: el usuario abre la app en la home sin saber si el precio que ve
// en su ciudad es "bueno" o "malo" en contexto. Un "precio medio nacional
// hoy: 1.48 € ↓ 0.2% vs. 30d" da contexto inmediato.
//
// Cache-Control: public, max-age=3600 — igual que history/*. Tras el cron
// diario los valores cambian, pero dentro del dia son constantes.
app.get('/api/stats/national', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  // days: clamp [7, 90]. Minimo 7 para que "avg30d" tenga sentido estadistico;
  // maximo 90 para acotar el coste y porque tendencias > 3 meses no son utiles
  // como contexto de "¿esta caro hoy?".
  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 7 || n > 90) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  if (!c.env.DB) {
    return c.json({ error: 'stats_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  // Solo 2 combustibles: gasolina 95 y diesel A — cubren ~90% del uso civil.
  // Si en futuro anadimos 98/diesel_plus, basta con extender FUELS (y la UI).
  const FUELS = ['95', 'diesel'] as const
  type FuelCode = typeof FUELS[number]

  try {
    const stmt = c.env.DB
      .prepare(
        'SELECT date, fuel_code, AVG(price_cents) AS avg_cents, COUNT(*) AS n ' +
        'FROM price_history WHERE fuel_code IN (?, ?) AND date >= ? ' +
        'GROUP BY date, fuel_code ORDER BY date ASC'
      )
      .bind(FUELS[0], FUELS[1], cutoff)
    const { results } = await stmt.all<{ date: string; fuel_code: string; avg_cents: number; n: number }>()

    // Agrupamos por fuel_code. Clave: solo entran FUELS reconocidos (ya filtra
    // el WHERE, pero defensivo por si el esquema cambia).
    const byFuel = new Map<string, Array<{ date: string; avg_cents: number; n: number }>>()
    for (const f of FUELS) byFuel.set(f, [])
    for (const r of results) {
      const arr = byFuel.get(r.fuel_code)
      if (!arr) continue
      arr.push({ date: r.date, avg_cents: r.avg_cents, n: r.n })
    }

    const out: Record<string, {
      today: number | null
      avg30d: number | null
      delta_pct: number | null
      samples_today: number
      days_available: number
      last_date: string | null
    }> = {}

    for (const fuel of FUELS) {
      const arr = byFuel.get(fuel) || []
      if (arr.length === 0) {
        out[fuel] = { today: null, avg30d: null, delta_pct: null, samples_today: 0, days_available: 0, last_date: null }
        continue
      }
      // Ultimo dia disponible (ya viene ORDER BY date ASC).
      const last = arr[arr.length - 1]
      const todayEur = centsToEuros(Math.round(last.avg_cents))
      // Media de medias diarias (simple, no ponderada por count — todos los dias
      // pesan igual independientemente de cuantas estaciones reportaran).
      let sum = 0
      for (const r of arr) sum += r.avg_cents
      const avgCents = sum / arr.length
      const avgEur = centsToEuros(Math.round(avgCents))
      const deltaPct = avgCents > 0 ? ((last.avg_cents - avgCents) / avgCents) * 100 : 0
      out[fuel] = {
        today: todayEur,
        avg30d: avgEur,
        delta_pct: Math.round(deltaPct * 100) / 100,  // 2 decimales
        samples_today: last.n,
        days_available: arr.length,
        last_date: last.date,
      }
    }

    return c.json(
      { days, fuels: out },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  } catch (err) {
    slog('error', 'stats.national_failed', {
      days,
      err: String(err).slice(0, 300),
    })
    return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
  }
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

  if (!c.env.DB) {
    return c.json({ error: 'predict_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  const now = new Date()
  const weekday = now.getUTCDay()      // 0=Dom .. 6=Sab (UTC — consistente con date UTC en D1)
  const cutoff = new Date(now.getTime())
  cutoff.setUTCDate(cutoff.getUTCDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  try {
    // Lee los precios del mismo weekday en los ultimos 90d. SQLite no tiene
    // DAYOFWEEK pero podemos usar strftime('%w', date) que devuelve 0-6 (0=Dom).
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
      .bind(stationId, fuel, cutoffStr, weekday)
    const { results } = await stmt.all<{ date: string; price_cents: number }>()

    const weekdaySamples = results.map(r => centsToEuros(r.price_cents))

    // Si no dieron precio actual, intentamos deducirlo de la ultima muestra
    // cualquiera (no solo del weekday). Query separada para no contaminar las
    // muestras del predictor.
    if (currentEurL == null) {
      const last = await c.env.DB
        .prepare('SELECT price_cents FROM price_history WHERE station_id = ? AND fuel_code = ? ORDER BY date DESC LIMIT 1')
        .bind(stationId, fuel)
        .all<{ price_cents: number }>()
      if (last.results.length > 0) {
        currentEurL = centsToEuros(last.results[0].price_cents)
      }
    }

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
async function authorizeCron(c: { req: { header: (h: string) => string | undefined }; env: Env }): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const cfg = c.env.CRON_TOKEN
  if (!cfg) {
    return { ok: false, status: 503, body: { error: 'cron_not_configured' } }
  }
  const auth = c.req.header('authorization') || ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!provided || !tokensEqualConstTime(provided, cfg)) {
    return { ok: false, status: 401, body: { error: 'unauthorized' } }
  }
  return { ok: true }
}

// POST /api/cron/ingest — ingesta diaria del snapshot a D1.
// Idempotente via INSERT OR REPLACE: si GHA hace retry no duplica datos.
app.post('/api/cron/ingest', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  const result = await runDailyIngest(c.env)
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
  const { tgSendMessage, tgEscapeHtml } = await import('./lib/telegram')
  // Comandos soportados:
  //   /start <token> — vincula la web con este chat_id
  //   /start (sin token) — welcome con link a la web
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
        `💰 Te avisare en cuanto el precio baje <b>1 centimo por litro</b> o mas.\n` +
        `😎 Tu a lo tuyo — yo me ocupo de mirar los precios.\n\n` +
        `<i>Para pararlas en cualquier momento: /stop</i>`
      : `✅ <b>Vinculado</b>, pero no habia gasolineras marcadas como favoritas.\n\n` +
        `Vuelve a la web, marca alguna con la estrella, y pulsa "Activar alertas" de nuevo.`
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply)
    slog('info', 'telegram_bind', { ok: true, chat_id: chatId, subscribed: inserted })
    return c.json({ ok: true }, 200)
  }
  if (text === '/start') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `👋 ¡Hola! Este bot te avisa cuando baja el precio de tus gasolineras favoritas.\n\n` +
      `Para activarlo:\n` +
      `1. Abre ${tgEscapeHtml(c.env.PUBLIC_ORIGIN || 'la web')}\n` +
      `2. Marca como favoritas las estaciones que quieras vigilar\n` +
      `3. En el panel de favoritos, pulsa "Activar alertas por Telegram"\n\n` +
      `Yo te avisare cuando alguna baje ≥1.5 ct/L (configurable).`,
    )
    return c.json({ ok: true }, 200)
  }
  if (text === '/help') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `<b>Comandos:</b>\n` +
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
  if (row.expires_at < Date.now() && !row.confirmed_at) {
    return c.json({ ok: true, confirmed: false, expired: true }, 200, { 'Cache-Control': 'no-store' })
  }
  if (row.confirmed_at && row.chat_id) {
    return c.json({ ok: true, confirmed: true, chat_id: row.chat_id }, 200, { 'Cache-Control': 'no-store' })
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
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
  const chatId = typeof body?.chat_id === 'number' && Number.isFinite(body.chat_id) ? body.chat_id : NaN
  if (!Number.isFinite(chatId)) return c.json({ ok: false, error: 'missing_chat_id' }, 400)
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
  const chatIdStr = c.req.query('chat_id') || ''
  const chatId = Number(chatIdStr)
  if (!Number.isFinite(chatId) || chatId <= 0) {
    return c.json({ ok: false, error: 'invalid_chat_id' }, 400, { 'Cache-Control': 'no-store' })
  }
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
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
  const chatId = typeof body?.chat_id === 'number' && Number.isFinite(body.chat_id) ? body.chat_id : NaN
  const stationId = typeof body?.station_id === 'string' ? body.station_id.trim() : ''
  const fuelCode = typeof body?.fuel_code === 'string' ? body.fuel_code.trim() : ''
  const enabled = !!body?.enabled
  if (!Number.isFinite(chatId) || chatId <= 0) return c.json({ ok: false, error: 'invalid_chat_id' }, 400)
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
        `🔔 <b>Alerta añadida</b>\n\n` +
        `Vigilo <b>${rotuloEsc}</b>${munEsc ? ' <i>(' + munEsc + ')</i>' : ''} — ${lbl}.\n\n` +
        `💰 Te avisare en cuanto el precio baje <b>1 centimo por litro</b> o mas.`
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

// POST /api/cron/telegram-check — iterador server-side.
// Mismo patron que el antiguo /api/cron/push-check: lee snapshot, compara
// precio actual vs baseline, envia sendMessage si la caida supera threshold.
// Requiere CRON_TOKEN. Se invoca desde GHA cada 2h (cron-telegram-check.yml).
app.post('/api/cron/telegram-check', async c => {
  const authz = await authorizeCron(c)
  if (!authz.ok) return c.json(authz.body, authz.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  // Housekeeping: purga pending_tokens caducados (con 1h de colchon). El
  // webhook ya no los borra (ver nota en /start) — este cron cada 2h es el
  // sitio natural para hacerlo.
  try {
    const cutoff = Date.now() - 60 * 60 * 1000
    await c.env.DB.prepare('DELETE FROM telegram_pending_tokens WHERE expires_at < ?').bind(cutoff).run()
  } catch { /* no-op: un fallo aqui no debe bloquear la comprobacion */ }
  const origin = c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin
  // Snapshot actual
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
  const fuelCol: Record<string, string> = {
    '95':          'Precio Gasolina 95 E5',
    '98':          'Precio Gasolina 98 E5',
    'diesel':      'Precio Gasoleo A',
    'diesel_plus': 'Precio Gasoleo Premium',
  }
  const fuelLabel: Record<string, string> = {
    '95':          'Gasolina 95',
    '98':          'Gasolina 98',
    'diesel':      'Diesel',
    'diesel_plus': 'Diesel Premium',
  }
  function parsePrice(s: string | undefined): number | null {
    if (!s) return null
    const n = parseFloat(String(s).replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const COOLDOWN_MS = 12 * 60 * 60 * 1000
  const now = Date.now()
  const all = await c.env.DB.prepare(
    'SELECT chat_id, station_id, fuel_code, threshold_cents, baseline_cents, last_notified_at FROM telegram_subscriptions'
  ).all<{
    chat_id: number; station_id: string; fuel_code: string;
    threshold_cents: number; baseline_cents: number | null; last_notified_at: number | null
  }>()
  const subs = all.results || []
  const { tgSendMessage, tgEscapeHtml } = await import('./lib/telegram')
  let sent = 0, purged = 0, skipped = 0, errors = 0
  for (const sub of subs) {
    const st = byStation.get(sub.station_id)
    if (!st) { skipped++; continue }
    const col = fuelCol[sub.fuel_code]
    if (!col) { skipped++; continue }
    const p = parsePrice(st[col])
    if (!p) { skipped++; continue }
    const pCents = Math.round(p * 1000)
    if (sub.baseline_cents == null) {
      await c.env.DB.prepare(
        'UPDATE telegram_subscriptions SET baseline_cents = ? WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
      ).bind(pCents, sub.chat_id, sub.station_id, sub.fuel_code).run()
      skipped++; continue
    }
    const dropCents = sub.baseline_cents - pCents
    if (dropCents < sub.threshold_cents) {
      if (pCents > sub.baseline_cents) {
        await c.env.DB.prepare(
          'UPDATE telegram_subscriptions SET baseline_cents = ? WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
        ).bind(pCents, sub.chat_id, sub.station_id, sub.fuel_code).run()
      }
      skipped++; continue
    }
    if (sub.last_notified_at && (now - sub.last_notified_at) < COOLDOWN_MS) {
      skipped++; continue
    }
    // Construir el mensaje
    const rotulo = tgEscapeHtml(String(st['Rotulo'] || 'Gasolinera'))
    const direccion = tgEscapeHtml(String(st['Direccion'] || ''))
    const municipio = tgEscapeHtml(String(st['Municipio'] || ''))
    const fuelLbl = fuelLabel[sub.fuel_code] || sub.fuel_code
    const deltaEur = (dropCents / 1000).toFixed(3)
    const priceEur = (pCents / 1000).toFixed(3)
    const mapsUrl = `${origin}/?station=${encodeURIComponent(sub.station_id)}`
    const text = `⛽ <b>${rotulo}</b>\n` +
      `<i>${direccion}, ${municipio}</i>\n\n` +
      `<b>${fuelLbl}</b> ha bajado a <b>${priceEur} €/L</b>\n` +
      `(−${deltaEur} €/L desde la ultima referencia)\n\n` +
      `<a href="${tgEscapeHtml(mapsUrl)}">Ver en el mapa</a>`
    try {
      const result = await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, sub.chat_id, text)
      if (result.ok) {
        sent++
        await c.env.DB.prepare(
          'UPDATE telegram_subscriptions SET baseline_cents = ?, last_notified_at = ? WHERE chat_id = ? AND station_id = ? AND fuel_code = ?'
        ).bind(pCents, now, sub.chat_id, sub.station_id, sub.fuel_code).run()
      } else if (result.gone) {
        // User bloqueo al bot o borro el chat — purgar todas sus subs.
        await c.env.DB.prepare('DELETE FROM telegram_subscriptions WHERE chat_id = ?').bind(sub.chat_id).run()
        purged++
      } else {
        errors++
        slog('warn', 'telegram_send_failed', { status: result.status, description: result.description })
      }
    } catch (e) {
      errors++
      slog('error', 'telegram_send_exception', { message: (e as Error).message })
    }
  }
  // Purga de tokens pendientes caducados — oportunistico.
  try {
    await c.env.DB.prepare('DELETE FROM telegram_pending_tokens WHERE expires_at < ?').bind(now).run()
  } catch {}
  slog('info', 'telegram_check_done', { total: subs.length, sent, purged, skipped, errors })
  return c.json({ ok: true, total: subs.length, sent, purged, skipped, errors },
    200, { 'Cache-Control': 'no-store' })
})

// ---- CSP violation report endpoint ----
// Navegadores envian aqui cada violacion de Content-Security-Policy. Es la
// senal mas temprana que tenemos de: (a) intentos de XSS, (b) extensiones
// del usuario inyectando scripts, (c) errores en nuestra propia CSP.
// Aceptamos ambos formatos: CSP Level 2 (content-type application/csp-report)
// y CSP Level 3 (content-type application/reports+json). Rate-limit propio
// para evitar DoS por spam de reports.
app.post('/api/csp-report', async c => {
  const key = clientKey(c)
  const rl = cspLimiter.check(key)
  if (!rl.allowed) return new Response(null, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })

  const ct = (c.req.header('content-type') || '').toLowerCase()
  const raw = await c.req.text()
  if (raw.length === 0 || raw.length > 8192) {
    slog('warn', 'csp.oversize_or_empty', { key, bytes: raw.length })
    return new Response(null, { status: 204 })
  }
  let evt: unknown
  try { evt = JSON.parse(raw) } catch { return new Response(null, { status: 204 }) }

  // Extraemos solo los campos relevantes. Los navegadores incluyen mas
  // metadata pero no la necesitamos y abulta logs.
  const pick = (o: unknown, keys: string[]): Record<string, unknown> => {
    if (!o || typeof o !== 'object') return {}
    const src = o as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      const v = src[k]
      if (typeof v === 'string') out[k] = v.slice(0, 500)
      else if (typeof v === 'number') out[k] = v
    }
    return out
  }
  const interesting = ['document-uri','referrer','violated-directive','effective-directive','original-policy','disposition','blocked-uri','source-file','line-number','column-number','status-code']
  let report: Record<string, unknown> = {}
  if (ct.includes('csp-report') && evt && typeof evt === 'object' && 'csp-report' in (evt as Record<string, unknown>)) {
    report = pick((evt as Record<string, unknown>)['csp-report'], interesting)
  } else if (Array.isArray(evt)) {
    // Reporting API v1 manda un array de reports
    const first = evt.find(e => e && typeof e === 'object' && (e as Record<string, unknown>).type === 'csp-violation')
    if (first) report = pick((first as Record<string, unknown>).body, interesting)
  }

  slog('warn', 'csp.violation', { key, ...report })
  return new Response(null, { status: 204 })
})

// ============================================================================
// CLIENT ERROR TRACKING (Nivel 1: deteccion)
// ============================================================================
// /api/client-error: endpoint publico que recibe errores del navegador y los
// persiste en D1 con dedup por fingerprint. Complementa /api/ingest (que solo
// emite slog) con persistencia real: sin D1 no hay forma de preguntar "que
// errores hay abiertos" desde fuera. El cron de GitHub Actions (cada 8h) hace
// GET /api/admin/errors con CRON_TOKEN y notifica los nuevos a Telegram.
//
// Diseno:
// - Fingerprint = sha256(message + primera linea stack) -> 16 chars hex.
//   Calculado server-side para que el cliente no pueda crear filas separadas
//   para el mismo error variando el hash.
// - Upsert: mismo fingerprint -> count++, last_seen = now. Distinta ->
//   insert. Nunca crece linealmente con el volumen de errores.
// - Size caps: message 500, stack 4000, url 200, ua 200. Total <5KB por fila.
// - NO persiste cookies, ni IP, ni ningun identificador que correlacione con
//   un usuario concreto. El user-agent truncado es suficiente para debugging.

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}

app.post('/api/client-error', async c => {
  const key = clientKey(c)
  const rl = errLimiter.check(key)
  if (!rl.allowed) return c.json({ ok: false }, 429, { 'Retry-After': String(rl.retryAfterSec) })

  const ct = c.req.header('content-type') || ''
  if (!ct.includes('application/json')) return c.json({ ok: false }, 415)

  const raw = await c.req.text()
  if (raw.length === 0 || raw.length > 8192) return c.json({ ok: false }, 413)

  let evt: Record<string, unknown>
  try { evt = JSON.parse(raw) } catch { return c.json({ ok: false }, 400) }

  const trim = (v: unknown, max: number): string => {
    if (typeof v !== 'string') return ''
    const s = v.trim()
    return s.length > max ? s.slice(0, max) : s
  }
  const message = trim(evt.message, 500)
  if (!message) return c.json({ ok: false, error: 'message required' }, 400)

  const stack = trim(evt.stack, 4000)
  const url = trim(evt.url, 200)
  const userAgent = trim(c.req.header('user-agent'), 200)
  const version = trim(evt.version, 30) || 'unknown'

  // Ship 13: campos enriquecidos. Todos opcionales y saneados.
  //  - module: enum cerrado — rechaza strings raros para evitar explosion de
  //    cardinalidad en el index; fuera de la whitelist → null.
  //  - breadcrumbs y context: strings JSON que el cliente ya ha serializado y
  //    truncado. El server NO los re-valida: son datos de debug opacos. Solo
  //    aplicamos un trim defensivo final. Si no son JSON valido no importa —
  //    solo el admin los lee, y el fingerprint ignora estos campos asi que no
  //    afectan el dedupe.
  const ALLOWED_MODULES = new Set(['map', 'list', 'ui', 'features', 'core', 'unknown'])
  const moduleRaw = trim(evt.module, 20)
  const moduleVal = ALLOWED_MODULES.has(moduleRaw) ? moduleRaw : null
  const breadcrumbs = trim(evt.breadcrumbs, 500) || null
  const context     = trim(evt.context, 200) || null

  // Fingerprint autoritativo: primera linea del stack + message. Si no hay
  // stack, usamos solo message. Hash completo con sha256 y cogemos 16 chars
  // (64 bits) -> probabilidad de colision despreciable.
  //
  // NOTA: module/breadcrumbs/context NO entran en el fingerprint — un mismo
  // bug puede dispararse desde rutas distintas o tras interacciones distintas,
  // y queremos verlo como UNA entrada. El upsert actualiza los campos con la
  // ultima ocurrencia (mas util para reproducir).
  const firstStackLine = stack.split('\n')[0] || ''
  const fp = (await sha256Hex(message + '|' + firstStackLine)).slice(0, 16)

  const now = Date.now()
  if (!c.env.DB) {
    slog('warn', 'client_error.no_db', { key })
    return c.json({ ok: false, error: 'db not configured' }, 503)
  }

  try {
    // INSERT OR CONFLICT DO UPDATE: D1 (SQLite) soporta ON CONFLICT completo.
    // Si la primera vez, inserta. Si ya existia, incrementa count y actualiza
    // last_seen/message/stack/version/module/breadcrumbs/context (los campos
    // pueden haber cambiado tras un deploy, queremos el mas reciente).
    await c.env.DB.prepare(`
      INSERT INTO client_errors (fingerprint, message, stack, url, user_agent, version, module, breadcrumbs, context, count, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        count = count + 1,
        last_seen = excluded.last_seen,
        message = excluded.message,
        stack = excluded.stack,
        url = excluded.url,
        version = excluded.version,
        module = excluded.module,
        breadcrumbs = excluded.breadcrumbs,
        context = excluded.context
    `).bind(fp, message, stack, url, userAgent, version, moduleVal, breadcrumbs, context, now, now).run()
  } catch (e) {
    slog('error', 'client_error.db_fail', { key, fp, err: (e as Error).message })
    return c.json({ ok: false }, 500)
  }
  return c.json({ ok: true, fingerprint: fp })
})

// GET /api/admin/errors?unnotified=1 — lista errores persistidos. Solo CRON_TOKEN.
// El cron de GitHub Actions llama a este endpoint cada 8h para saber si hay
// errores nuevos que notificar. unnotified=1 filtra notified_at IS NULL.
app.get('/api/admin/errors', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!c.env.DB) return c.json({ error: 'db not configured' }, 503)

  const unnotified = c.req.query('unnotified') === '1'
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500)
  const minCount = Math.max(parseInt(c.req.query('min_count') || '1', 10) || 1, 1)
  const autofixFilter = c.req.query('autofix_status') // 'null', 'queued', 'pr_opened', etc.
  // Ship 13: filtro opcional por modulo.
  const moduleFilter = c.req.query('module')  // map|list|ui|features|core|unknown

  let sql = `SELECT fingerprint, message, stack, url, user_agent, version, count,
                    first_seen, last_seen, notified_at, autofix_status, autofix_pr, autofix_notes,
                    module, breadcrumbs, context
             FROM client_errors WHERE count >= ?`
  const binds: Array<string | number> = [minCount]
  if (unnotified) sql += ' AND notified_at IS NULL'
  if (autofixFilter === 'null') sql += ' AND autofix_status IS NULL'
  else if (autofixFilter) { sql += ' AND autofix_status = ?'; binds.push(autofixFilter) }
  if (moduleFilter) { sql += ' AND module = ?'; binds.push(moduleFilter) }
  sql += ' ORDER BY last_seen DESC LIMIT ?'
  binds.push(limit)

  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ errors: results || [], ts: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' })
})

// POST /api/admin/errors/ack?fingerprints=a,b,c — marca fingerprints como
// notificados (set notified_at = now). El cron lo invoca tras enviar a
// Telegram para que el siguiente tick no reenvie los mismos.
app.post('/api/admin/errors/ack', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!c.env.DB) return c.json({ error: 'db not configured' }, 503)

  const fpsParam = c.req.query('fingerprints') || ''
  const fps = fpsParam.split(',').map(s => s.trim()).filter(s => /^[a-f0-9]{1,16}$/.test(s))
  if (fps.length === 0) return c.json({ acknowledged: 0 })

  const placeholders = fps.map(() => '?').join(',')
  const now = Date.now()
  const res = await c.env.DB.prepare(
    `UPDATE client_errors SET notified_at = ? WHERE fingerprint IN (${placeholders})`
  ).bind(now, ...fps).run()
  return c.json({ acknowledged: res.meta?.changes ?? 0 }, 200, { 'Cache-Control': 'no-store' })
})

// POST /api/admin/errors/autofix?fingerprint=XXX&status=YYY[&pr=URL][&notes=TEXT]
// Endpoint para el agente auto-fix de Nivel 3. Permite actualizar el estado de
// autofix de una firma: 'queued', 'in_progress', 'pr_opened' (+pr URL),
// 'resolved', 'skipped' (+notes).
app.post('/api/admin/errors/autofix', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!c.env.DB) return c.json({ error: 'db not configured' }, 503)

  const fp = (c.req.query('fingerprint') || '').trim()
  const status = (c.req.query('status') || '').trim()
  const pr = (c.req.query('pr') || '').trim() || null
  const notes = (c.req.query('notes') || '').trim() || null
  const validStatuses = ['queued', 'in_progress', 'pr_opened', 'resolved', 'skipped']
  if (!/^[a-f0-9]{1,16}$/.test(fp)) return c.json({ error: 'bad fingerprint' }, 400)
  if (!validStatuses.includes(status)) return c.json({ error: 'bad status', allowed: validStatuses }, 400)

  const res = await c.env.DB.prepare(
    `UPDATE client_errors SET autofix_status = ?, autofix_pr = ?, autofix_notes = ? WHERE fingerprint = ?`
  ).bind(status, pr, notes, fp).run()
  return c.json({ updated: res.meta?.changes ?? 0 }, 200, { 'Cache-Control': 'no-store' })
})

// ============================================================================
// ADMIN — REPORTES DE PRECIO INCORRECTO (digest diario a Telegram)
// ============================================================================
// GET  /api/admin/reports?unnotified=1&limit=100  → lista pendientes
// POST /api/admin/reports/ack?ids=1,2,3           → marca como vistos
//
// Replica el patron de /api/admin/errors: un cron corre 1 vez/dia, pregunta los
// reportes con reviewed_at=NULL, los formatea y los manda a Telegram, luego
// hace ACK para que el siguiente tick solo traiga los nuevos. Todo gated con
// CRON_TOKEN (mismo secret que cron-ingest, cron-purge, error-monitor).
app.get('/api/admin/reports', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!c.env.DB) return c.json({ error: 'db not configured' }, 503)

  const unnotified = c.req.query('unnotified') === '1'
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500)

  let sql = `SELECT id, ideess, fuel, official_price_eur, reported_price_eur,
                    reason, comment, created_at, reviewed_at
             FROM price_reports`
  if (unnotified) sql += ' WHERE reviewed_at IS NULL'
  sql += ' ORDER BY created_at DESC LIMIT ?'

  const { results } = await c.env.DB.prepare(sql).bind(limit).all()
  return c.json({ reports: results || [], ts: new Date().toISOString() }, 200, { 'Cache-Control': 'no-store' })
})

// POST /api/admin/reports/ack?ids=1,2,3 — marca reportes como vistos (reviewed).
// Idempotente: volver a ack-ear un id ya revisado no rompe nada (UPDATE vacio).
app.post('/api/admin/reports/ack', async c => {
  const auth = await authorizeCron(c)
  if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, { 'Cache-Control': 'no-store' })
  if (!c.env.DB) return c.json({ error: 'db not configured' }, 503)

  const idsParam = c.req.query('ids') || ''
  // Solo aceptamos enteros positivos (PK autoincrement). Cualquier otra cosa se
  // descarta silenciosamente — mismo patron que /api/admin/errors/ack.
  const ids = idsParam
    .split(',')
    .map(s => s.trim())
    .filter(s => /^\d{1,10}$/.test(s))
    .map(s => parseInt(s, 10))
  if (ids.length === 0) return c.json({ acknowledged: 0 })

  const placeholders = ids.map(() => '?').join(',')
  const now = Date.now()
  const res = await c.env.DB.prepare(
    `UPDATE price_reports SET reviewed_at = ? WHERE id IN (${placeholders}) AND reviewed_at IS NULL`
  ).bind(now, ...ids).run()
  return c.json({ acknowledged: res.meta?.changes ?? 0 }, 200, { 'Cache-Control': 'no-store' })
})

// ---- Ship 8: reportes de precio incorrecto ----
// POST /api/reports/price — recibe un report anonimo del cliente. El usuario
// llega a la gasolinera, ve un precio distinto al surtidor, y flagea aqui.
// El admin consume los agregados via /api/admin/reports (ver arriba) para
// decidir si ignora, marca la estacion como dudosa o fuerza refresh.
//
// Flujo:
//  1. Rate limit por IP (reportLimiter: 5/min).
//  2. Valida body (ideess, fuel, reason obligatorios; precio opcional).
//  3. Hashea IP+dia para almacenamiento anonimo.
//  4. Dedupe aplicativa: si ip_hash+ideess+fuel ya reporto en la ultima hora,
//     devuelve 409 (conflict) sin crear fila. Evita que el mismo usuario
//     inflije metricas haciendo click varias veces.
//  5. INSERT y devuelve ok + id del reporte.
//
// Fuentes de combustibles validos: los mismos codigos cortos que emite el
// cliente (REPORT_FUEL_CODES en map.ts) tras traducir la clave larga del
// Ministerio. Lista cerrada para evitar basura en la tabla.
const REPORT_REASONS = ['outdated', 'closed', 'wrong_fuel', 'other'] as const
const REPORT_FUELS = ['95', '98', 'diesel', 'diesel_plus', 'glp', 'gnc', 'gnl', 'hidrogeno', 'diesel_renov'] as const

app.post('/api/reports/price', async c => {
  const key = clientKey(c)
  const rl = reportLimiter.check(key)
  if (!rl.allowed) return c.json({ ok: false, error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })

  const ct = c.req.header('content-type') || ''
  if (!ct.includes('application/json')) return c.json({ ok: false, error: 'json required' }, 415)

  const raw = await c.req.text()
  if (raw.length === 0 || raw.length > 2048) return c.json({ ok: false, error: 'bad size' }, 413)

  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return c.json({ ok: false, error: 'bad json' }, 400) }

  // Validacion estricta. ideess se parsea como dgito-entero en string (asi lo
  // serializa el feed oficial); el regex permite 1-6 digitos — la BBDD actual
  // tiene ids <100000. fuel debe estar en la whitelist. reason tambien.
  const ideess = String(body.ideess || '').trim()
  if (!/^[0-9]{1,7}$/.test(ideess)) return c.json({ ok: false, error: 'bad ideess' }, 400)

  const fuel = String(body.fuel || '').trim()
  if (!REPORT_FUELS.includes(fuel as typeof REPORT_FUELS[number])) {
    return c.json({ ok: false, error: 'bad fuel' }, 400)
  }

  const reason = String(body.reason || '').trim()
  if (!REPORT_REASONS.includes(reason as typeof REPORT_REASONS[number])) {
    return c.json({ ok: false, error: 'bad reason' }, 400)
  }

  // Precios opcionales. Aceptamos numeros o null. Rango [0.1, 10] euros/litro
  // — cubre todos los combustibles reales con margen.
  const parsePriceOpt = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
    if (!isFinite(n) || n < 0.1 || n > 10) return null
    return Math.round(n * 1000) / 1000
  }
  const reportedPrice = parsePriceOpt(body.reportedPriceEur)
  const officialPrice = parsePriceOpt(body.officialPriceEur)

  // Comment: texto libre, trim, max 500 chars. Guardamos null si vacio para
  // no contar como "hay comentario" en queries.
  const commentRaw = typeof body.comment === 'string' ? body.comment.trim() : ''
  const comment = commentRaw.length > 0 ? (commentRaw.length > 500 ? commentRaw.slice(0, 500) : commentRaw) : null

  if (!c.env.DB) {
    slog('warn', 'report.no_db', { key })
    return c.json({ ok: false, error: 'db not configured' }, 503)
  }

  // IP hash: sha256(ip + YYYY-MM-DD). Asi un mismo IP genera el mismo bucket
  // dentro del dia pero no se puede correlar entre dias. Suficiente para
  // rate-limit + dedupe y preserva anonimato a largo plazo.
  const day = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD UTC
  const ipHash = (await sha256Hex(key + '|' + day)).slice(0, 32)

  const now = Date.now()
  const hourAgo = now - 60 * 60 * 1000

  try {
    // Dedupe: mismo (ip_hash, ideess, fuel) en la ultima hora -> 409. El
    // index idx_price_reports_dedupe resuelve esto en <1ms.
    const dup = await c.env.DB.prepare(
      `SELECT id FROM price_reports
       WHERE ip_hash = ? AND ideess = ? AND fuel = ? AND created_at >= ?
       LIMIT 1`
    ).bind(ipHash, ideess, fuel, hourAgo).all<{ id: number }>()
    if (dup.results && dup.results.length > 0) return c.json({ ok: false, error: 'duplicate' }, 409)

    const res = await c.env.DB.prepare(
      `INSERT INTO price_reports
         (ideess, fuel, official_price_eur, reported_price_eur, reason, comment, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ideess, fuel, officialPrice, reportedPrice, reason, comment, ipHash, now).run()

    slog('info', 'report.saved', { ideess, fuel, reason, hasPrice: reportedPrice != null })
    return c.json({ ok: true, id: res.meta?.last_row_id ?? null })
  } catch (e) {
    slog('error', 'report.db_fail', { key, err: (e as Error).message })
    return c.json({ ok: false, error: 'internal' }, 500)
  }
})

// ---- Ingest de errores del cliente ----
// Payload minimo, rate-limit aparte, size cap 4KB. No persistimos — solo emitimos log
// estructurado que Cloudflare Logpush puede recoger.
app.post('/api/ingest', async c => {
  const key = clientKey(c)
  const rl = ingestLimiter.check(key)
  if (!rl.allowed) return c.json({ ok: false }, 429, { 'Retry-After': String(rl.retryAfterSec) })

  const ct = c.req.header('content-type') || ''
  if (!ct.includes('application/json')) return c.json({ ok: false }, 415)

  const raw = await c.req.text()
  if (raw.length > 4096) {
    slog('warn', 'ingest.oversize', { key, bytes: raw.length })
    return c.json({ ok: false }, 413)
  }

  let evt: Record<string, unknown>
  try { evt = JSON.parse(raw) } catch { return c.json({ ok: false }, 400) }

  // Turnstile: token opcional en header (preferido) o body (ts). verifyTurnstile
  // decide politica: fail-open solo si NINGUNA key esta configurada (dev puro);
  // fail-closed si hay misconfig (solo site_key sin secret o viceversa); verifica
  // token si ambas estan configuradas.
  const tsToken = c.req.header('cf-turnstile-response')
    || (typeof evt.ts === 'string' ? evt.ts : undefined)
  const tsOk = await verifyTurnstile(
    tsToken,
    c.env.TURNSTILE_SECRET_KEY,
    c.env.TURNSTILE_SITE_KEY,
    key,
  )
  if (!tsOk) {
    slog('warn', 'ingest.turnstile_fail', { key })
    return c.json({ ok: false }, 403)
  }

  // Whitelist de campos + trim de strings largos
  const trim = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined
    return v.length > max ? v.slice(0, max) : v
  }
  slog('error', 'client.error', {
    key,
    msg:  trim(evt.msg, 500),
    src:  trim(evt.src, 300),
    line: typeof evt.line === 'number' ? evt.line : undefined,
    col:  typeof evt.col  === 'number' ? evt.col  : undefined,
    stk:  trim(evt.stk, 2000),
    url:  trim(evt.url, 500),
    ua:   trim(c.req.header('user-agent'), 300),
    ver:  trim(evt.ver, 20),
  })
  return c.json({ ok: true })
})

// ---- Ship 12: Real User Monitoring (Core Web Vitals) ----
// Endpoint POST /api/vitals que recibe el beacon de la pagina con las
// metricas LCP/INP/CLS/FCP/TTFB medidas en el navegador del usuario real.
// Se logea via slog('info', 'rum.sample', {...}) — sin DB, sin estado
// persistente. Cloudflare Logpush los captura y se pueden agregar con
// herramientas externas (Grafana/Logpush-to-R2/etc). La privacidad:
//   - No pedimos ni enviamos ningun identificador de usuario
//   - La IP solo se usa server-side como clave de rate-limit (no se logea)
//   - El user-agent se trunca a 300 chars para agregar "tipo de dispositivo"
// Validaciones: rango sano para cada metrica (mata bots / relojes rotos).
app.post('/api/vitals', async c => {
  const key = clientKey(c)
  const rl = vitalsLimiter.check(key)
  if (!rl.allowed) return c.json({ ok: false }, 429, { 'Retry-After': String(rl.retryAfterSec) })

  const ct = c.req.header('content-type') || ''
  if (!ct.includes('application/json')) return c.json({ ok: false }, 415)

  const raw = await c.req.text()
  if (raw.length > 2048) {
    slog('warn', 'vitals.oversize', { key, bytes: raw.length })
    return c.json({ ok: false }, 413)
  }

  let evt: Record<string, unknown>
  try { evt = JSON.parse(raw) } catch { return c.json({ ok: false }, 400) }

  // Sanitiza cada metrica: debe ser number finito, positivo (excepto CLS que
  // es un ratio adimensional pero tambien positivo), y dentro de un rango
  // sano. Fuera de rango = descartamos el campo pero seguimos registrando
  // los demas (degradacion elegante). Rangos escogidos para pillar ruido:
  //   - LCP/FCP/TTFB: ms desde navigation, real-world 0-30000 es el 99.9th %ile
  //   - INP: ms real-world 0-5000 (un INP > 5s es un freeze total y raro)
  //   - CLS: ratio adimensional, 0-5 (un CLS > 5 es practicamente imposible)
  const numInRange = (v: unknown, lo: number, hi: number): number | undefined => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
    if (v < lo || v > hi) return undefined
    // Truncamos a 3 decimales para CLS, 0 para tiempos (enteros).
    return v
  }
  const lcp  = numInRange(evt.lcp,  0, 30_000)
  const inp  = numInRange(evt.inp,  0,  5_000)
  const cls  = numInRange(evt.cls,  0,      5)
  const fcp  = numInRange(evt.fcp,  0, 30_000)
  const ttfb = numInRange(evt.ttfb, 0, 30_000)

  // Si TODAS las metricas son undefined, el beacon no tiene valor — 400.
  if (lcp === undefined && inp === undefined && cls === undefined && fcp === undefined && ttfb === undefined) {
    return c.json({ ok: false }, 400)
  }

  const trim = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined
    return v.length > max ? v.slice(0, max) : v
  }
  // Metadatos contextuales para poder segmentar: navtype, conexion, ruta.
  // Todos opcionales y saneados. path viene del cliente (pathname) — nunca
  // aceptamos query strings (evita logar PII en URLs compartidas).
  const path = trim(evt.path, 200)
  const navType = trim(evt.navType, 20)   // 'navigate' | 'reload' | 'back_forward' | 'prerender'
  const connType = trim(evt.conn, 20)     // '4g' | '3g' | 'wifi' | ...
  const ver = trim(evt.ver, 20)
  const ua  = trim(c.req.header('user-agent'), 300)

  slog('info', 'rum.sample', {
    // key: omitida a proposito — no queremos correlacionar beacons con IPs
    lcp, inp, cls: cls !== undefined ? Number(cls.toFixed(3)) : undefined,
    fcp, ttfb,
    path,
    navType, conn: connType, ua, ver,
  })
  return c.json({ ok: true })
})

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
