// Runtime compartido del servidor (B1). Infra que antes vivía en index.tsx y que
// consumen tanto index como los módulos de ruta (src/routes/*): logger, cachés LR
// + Cloudflare Cache API, fetch al Ministerio con validación, carga de snapshots e
// histórico estático, CORS/host helpers, rate-limiters, nonce/CSP y cabeceras HTML.
//
// Movido VERBATIM desde index.tsx — comportamiento idéntico. Los singletons (cachés
// y limiters) son const de módulo: un módulo ES se evalúa una vez, así que todos los
// importadores comparten la MISMA instancia (igual que cuando index las creaba una
// vez). runtime NO importa de index (queda por debajo): los tipos MinistryResponse/
// StationRecord se DEFINEN aquí y index los re-exporta.
import { LRU, SlidingWindowLimiter, tokensEqualConstTime } from './pure'
import { APP_VERSION } from './version'
import { MinistryResponseSchema, MunicipioListSchema, ProvinciaListSchema, safeValidate } from './schemas'
import type { FilaHistorico } from './observatorio'

type StationRecord = Record<string, string> & {
  IDProvincia?: string
  IDMunicipio?: string
}
type MinistryResponse = {
  Fecha?: string
  ListaEESSPrecio?: StationRecord[]
  [k: string]: unknown
}

// Threshold del watchdog: si el snapshot del Ministerio es mas viejo que esto,
// /api/health devuelve 503 para activar alertas de monitorizacion.
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000  // 24 horas

const MINISTRY = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'

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
const SRV_TTL_FRESH = 4 * 60 * 60 * 1000         // 4h: datos fresquisimos
const SRV_TTL_STALE = 30 * 24 * 60 * 60 * 1000   // 30d: ultimo recurso en memoria
const SNAP_TTL      = 10 * 60 * 1000             // 10 min en memoria, luego re-leer del asset
// TTL de los indices de municipios (autocompletado de farmacias/itv/tiempo). Lo
// consumen los registerXRoutes (src/routes/*) que lo importan de aqui.
const MUNI_INDEX_TTL = 30 * 60 * 1000
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
          // NO cacheamos NI devolvemos datos invalidos (antes caian abajo y se
          // hacia srvCache.set(raw)+return raw -> se publicaba y cacheaba basura).
          // Preferimos cache stale valida; si no hay, marcamos el intento como
          // fallo: se reintenta y, si todo falla, el handler cae al snapshot
          // estatico (ultimo dato valido conocido).
          if (cached && Date.now() - cached.ts < SRV_TTL_STALE) return cached.data
          lastErr = new Error('ministry schema_drift on ' + path)
          continue
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

// ---- HISTORICO ESTATICO (servido por CDN, al dia por el bot) ----
type StaticHistoryFile = {
  v: number
  provincia_id: string
  from: string                    // YYYY-MM-DD primer dia
  to: string                      // YYYY-MM-DD ultimo dia incluido
  days: number
  generated_at: string
  // stations[stationId][fuelCode] = [[date, cents], ...] solo en cambios.
  stations: Record<string, Record<string, Array<[string, number]>>>
}
type StaticMedianFile = {
  v: number
  provincia_id: string
  from: string
  to: string
  days: number
  generated_at: string
  // median[fuelCode] = [[date, cents], ...] (sin dedupe — son <365 puntos por fuel).
  median: Record<string, Array<[string, number]>>
}

// Suma 1 dia a una fecha YYYY-MM-DD. Lo hacemos via Date.UTC para no caer en
// quirks de timezone (el endpoint razona siempre en UTC, igual que la columna
// `date` de price_history).
function incrementIsoDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// Devuelve la fecha ISO mayor de las dos (YYYY-MM-DD compara bien como texto).
function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b
}

// Carga el JSON estatico de la provincia a la que pertenece `stationId` y
// devuelve solo sus series dedupeadas (sin hidratar — el caller decide rango).
// Devuelve null si no encontramos la provincia o no hay archivo estatico.
async function loadStaticHistoryForStation(
  origin: string,
  stationId: string,
  assets?: { fetch: (req: Request) => Promise<Response> },
): Promise<{ to: string; from: string; byFuel: Record<string, Array<[string, number]>> } | null> {
  // 1) Resolvemos la provincia desde stations.json (snapshot estatico ya
  // cacheado en memoria por el resto de endpoints; coste marginal nulo).
  const snap = await loadSnapshot<MinistryResponse>(origin, 'stations.json', assets)
  if (!snap || !Array.isArray(snap.ListaEESSPrecio)) return null
  const station = snap.ListaEESSPrecio.find(s => s['IDEESS'] === stationId)
  if (!station || !station.IDProvincia || !/^\d{1,2}$/.test(station.IDProvincia)) return null
  const provKey = String(station.IDProvincia).padStart(2, '0')

  // 2) Cargamos history/{provKey}.json. Si no existe (provincia sin backfill,
  // o backfill todavia no aplicado), devolvemos null — el endpoint cae al
  // comportamiento solo-D1.
  const histFile = await loadSnapshot<StaticHistoryFile>(origin, 'history/' + provKey + '.json', assets)
  if (!histFile || !histFile.stations || !histFile.stations[stationId]) return null
  return {
    to: histFile.to,
    from: histFile.from,
    byFuel: histFile.stations[stationId],
  }
}

// Variante para la mediana provincial — carga el archivo pre-calculado.
async function loadStaticMedianForProvince(
  origin: string,
  provinciaId: string,
  fuel: string,
  assets?: { fetch: (req: Request) => Promise<Response> },
): Promise<{ to: string; from: string; points: Array<[string, number]> } | null> {
  const provKey = String(provinciaId).padStart(2, '0')
  const file = await loadSnapshot<StaticMedianFile>(origin, 'history/median/' + provKey + '.json', assets)
  if (!file || !file.median) return null
  const arr = file.median[fuel]
  if (!arr) return null
  return { to: file.to, from: file.from, points: arr }
}

// Serie diaria nacional (media de centimos y numero de estaciones por dia y
// combustible), la deja el bot en history/national.json.
type StaticNationalFile = {
  v: number
  from: string
  to: string
  days: number
  generated_at: string
  // series[fuelCode] = [[date, avg_cents, n], ...] un punto por dia.
  series: Record<string, Array<[string, number, number]>>
}

async function loadStaticNational(
  origin: string,
  assets?: { fetch: (req: Request) => Promise<Response> },
): Promise<FilaHistorico[] | null> {
  const file = await loadSnapshot<StaticNationalFile>(origin, 'history/national.json', assets)
  if (!file || file.v !== 1 || !file.series || typeof file.series !== 'object') return null
  const rows: FilaHistorico[] = []
  for (const fuel of Object.keys(file.series)) {
    const serie = file.series[fuel]
    if (!Array.isArray(serie)) continue
    for (const p of serie) {
      if (!Array.isArray(p) || typeof p[0] !== 'string' || typeof p[1] !== 'number') continue
      rows.push({ date: p[0], fuel_code: fuel, avg_cents: p[1], n: typeof p[2] === 'number' ? p[2] : undefined })
    }
  }
  if (!rows.length) return null
  rows.sort((a, b) => a.date.localeCompare(b.date))
  return rows
}

// ---- CORS / ANTI-HOTLINK ----
// Allowlist explicito (vacio): la logica canonica vive en originAllowed() de pure.ts.
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set<string>()

// Resuelve el hostname del request (header Host, fallback a c.req.url).
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

// ---- RATE LIMITING ---- (singletons de modulo; una instancia compartida)
const apiLimiter    = new SlidingWindowLimiter(120, 60_000)  // 120 req/min por IP
const ingestLimiter = new SlidingWindowLimiter(20,  60_000)  // 20 errores/min por IP
const geoLimiter    = new SlidingWindowLimiter(15,  60_000)  // 15 req/min por IP
const cspLimiter    = new SlidingWindowLimiter(30,  60_000)  // 30 reports/min por IP
const errLimiter    = new SlidingWindowLimiter(20,  60_000)  // 20 errores/min por IP
const histLimiter   = new SlidingWindowLimiter(60,  60_000)  // 60 req/min por IP
const exportLimiter = new SlidingWindowLimiter(6,   60_000)  // 6 req/min por IP
const reportLimiter = new SlidingWindowLimiter(10,  60_000)  // 10 reports/min por IP
const vitalsLimiter = new SlidingWindowLimiter(30,  60_000)  // 30 req/min por IP

// Tamaños de las 3 LRU para /api/health (las caches viven aqui; el endpoint las
// consulta via este getter en vez de acceder a las instancias por su cuenta).
function cacheSizes(): { srv: number; snapshot: number; geo: number } {
  const sz = (c: unknown) => (c as { size: number }).size
  return { srv: sz(srvCache), snapshot: sz(snapshotCache), geo: sz(geoCache) }
}

function clientKey(c: { req: { header: (h: string) => string | undefined } }): string {
  // cf-connecting-ip lo inyecta el edge CF y no es spoofable; x-forwarded-for/
  // x-real-ip si lo son -> los omitimos (mejor bucket 'unknown' compartido).
  return c.req.header('cf-connecting-ip') || 'unknown'
}

// Autoriza rutas de cron/admin: exige Authorization: Bearer <CRON_TOKEN> comparado
// en tiempo constante. env se genericiza a { CRON_TOKEN? } para no acoplar runtime a
// Env (index/routes lo llaman con el `c` completo, que lo satisface estructuralmente).
async function authorizeCron(c: { req: { header: (h: string) => string | undefined }; env: { CRON_TOKEN?: string } }): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
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

// ---- CSP con nonce por request ----
function genNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function buildCsp(nonce: string, turnstile = false, googleAuth = false): string {
  const scriptSrc  = ["'self'", "'nonce-" + nonce + "'"]
  const styleSrc   = ["'self'", "'nonce-" + nonce + "'", 'https://cdn.jsdelivr.net']
  const frameSrc   = ["'self'"]
  const connectSrc = ["'self'"]
  if (turnstile) {
    scriptSrc.push('https://challenges.cloudflare.com')
    frameSrc.push('https://challenges.cloudflare.com')
    connectSrc.push('https://challenges.cloudflare.com')
  }
  if (googleAuth) {
    scriptSrc.push('https://accounts.google.com/gsi/client')
    frameSrc.push('https://accounts.google.com/gsi/')
    connectSrc.push('https://accounts.google.com/gsi/')
    styleSrc.push('https://accounts.google.com/gsi/style')
  }
  connectSrc.push('https://tiles.openfreemap.org')
  connectSrc.push('https://tms-pnoa-ma.idee.es')
  connectSrc.push('https://cdn.jsdelivr.net')
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
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')
}

// ---- HTML pages ----
// Headers compartidos (CSP + seguridad + preconnect).
function pageHeaders(nonce: string, turnstile: boolean, googleAuth = false): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': buildCsp(nonce, turnstile, googleAuth),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': googleAuth ? 'same-origin-allow-popups' : 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    'Cache-Control': 'no-store',
    'Link': [
      '<https://sedeaplicaciones.minetur.gob.es>; rel=preconnect',
      '<https://a.basemaps.cartocdn.com>; rel=preconnect; crossorigin',
      '<https://unpkg.com>; rel=preconnect; crossorigin',
    ].join(', '),
  }
}

export {
  slog, srvCache, snapshotCache, geoCache, buildUserAgent, cachedJson, proxiedFetch,
  loadSnapshot, filterStations, incrementIsoDate, maxIsoDate,
  loadStaticHistoryForStation, loadStaticMedianForProvince, loadStaticNational,
  ALLOWED_ORIGINS, resolveHost, resolveScheme,
  apiLimiter, ingestLimiter, geoLimiter, cspLimiter, errLimiter, histLimiter,
  exportLimiter, reportLimiter, vitalsLimiter, clientKey, authorizeCron, cacheSizes,
  genNonce, pageHeaders,
  SNAPSHOT_STALE_MS, MUNI_INDEX_TTL, GEO_TTL_FRESH, GEO_TTL_STALE, GEO_UPSTREAM_TIMEOUT,
}
export type { MinistryResponse, StationRecord }
