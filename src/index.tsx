import { Hono } from 'hono'
import { buildPage } from './html/shell'
import {
  LRU,
  validateId,
  originAllowed,
  SlidingWindowLimiter,
} from './lib/pure'
import { APP_VERSION } from './lib/version'
import {
  MinistryResponseSchema,
  MunicipioListSchema,
  ProvinciaListSchema,
  safeValidate,
} from './lib/schemas'
import { PROVINCIAS, provinciaBySlug } from './lib/provincias'

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
type Env = {
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
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
const SRV_TTL_FRESH = 4 * 60 * 60 * 1000        // 4h: datos fresquisimos
const SRV_TTL_STALE = 30 * 24 * 60 * 60 * 1000  // 30d: ultimo recurso en memoria
const SNAP_TTL      = 10 * 60 * 1000             // 10 min en memoria, luego re-leer del asset

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
      const res = await fetch(MINISTRY + path)
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
const ALLOWED_ORIGINS = new Set<string>([
  'https://gasolineras.pages.dev',
])

// ---- RATE LIMITING ----
// Protege endpoints de consumo (evita que alguien martillee y agote el free tier
// de Workers). En memoria por instancia de Worker: no es distribuido, pero anade
// friccion real sin depender de KV. Ingest tiene un limite mas bajo porque es
// escritura potencial.
const apiLimiter    = new SlidingWindowLimiter(120, 60_000)  // 120 req/min por IP
const ingestLimiter = new SlidingWindowLimiter(20,  60_000)  // 20 errores/min por IP

function clientKey(c: { req: { header: (h: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
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

function buildCsp(nonce: string, turnstile = false): string {
  const scriptSrc  = ["'self'", "'nonce-" + nonce + "'", 'https://unpkg.com']
  const frameSrc   = ["'self'"]
  const connectSrc = ["'self'", 'https://nominatim.openstreetmap.org']
  if (turnstile) {
    scriptSrc.push('https://challenges.cloudflare.com')
    frameSrc.push('https://challenges.cloudflare.com')
    connectSrc.push('https://challenges.cloudflare.com')
  }
  return [
    "default-src 'self'",
    "script-src " + scriptSrc.join(' '),
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net",
    "connect-src " + connectSrc.join(' '),
    "frame-src " + frameSrc.join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

// ---- Turnstile (opcional) ----
// Verifica un token de Cloudflare Turnstile contra la API /siteverify. Si no
// hay secret configurado, fail-open (util en dev). Si hay secret, fail-closed.
async function verifyTurnstile(token: string | undefined, secret: string | undefined, ip: string): Promise<boolean> {
  if (!secret) return true           // no configurado → modo permisivo
  if (!token)  return false
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
function pageHeaders(nonce: string, turnstile: boolean): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': buildCsp(nonce, turnstile),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
    'Link': [
      '<https://sedeaplicaciones.minetur.gob.es>; rel=preconnect',
      '<https://a.basemaps.cartocdn.com>; rel=preconnect; crossorigin',
      '<https://unpkg.com>; rel=preconnect; crossorigin',
      '<https://nominatim.openstreetmap.org>; rel=preconnect; crossorigin',
    ].join(', '),
  }
}

app.get('/', c => {
  const nonce = genNonce()
  const turnstile = !!c.env.TURNSTILE_SITE_KEY
  return new Response(buildPage(nonce, c.req.url, {
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
  }), { headers: pageHeaders(nonce, turnstile) })
})

// ---- Rutas SEO por provincia ----
// /gasolineras/madrid, /gasolineras/barcelona, ... → pre-renderizamos la app
// con meta tags especificos y el cliente auto-selecciona esa provincia via
// window.__SEO__. Si el slug no existe (ej. /gasolineras/atlantida), 404
// pra evitar que Google indexe URLs inventadas.
app.get('/gasolineras/:slug', c => {
  const slug = c.req.param('slug')
  const prov = provinciaBySlug(slug)
  if (!prov) return c.notFound()
  const nonce = genNonce()
  const turnstile = !!c.env.TURNSTILE_SITE_KEY
  return new Response(buildPage(nonce, c.req.url, {
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
    seo: {
      provinciaId: prov.id,
      provinciaSlug: prov.slug,
      provinciaName: prov.name,
    },
  }), { headers: pageHeaders(nonce, turnstile) })
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
    'Contact: ' + base + '/.well-known/security.txt',
    'Contact: https://github.com/YOUR_USER/YOUR_REPO/security/advisories/new',
    'Expires: ' + expires,
    'Preferred-Languages: es, en',
    'Policy: ' + base + '/privacidad',
    'Canonical: ' + base + '/.well-known/security.txt',
    '',
  ].join('\n')
}
app.get('/.well-known/security.txt', c => {
  const host   = c.req.header('host') || 'gasolineras.pages.dev'
  const scheme = c.req.header('x-forwarded-proto') || 'https'
  return c.text(buildSecurityTxt(host, scheme), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  })
})
app.get('/security.txt', c => c.redirect('/.well-known/security.txt', 301))

// ---- SEO: robots.txt ----
app.get('/robots.txt', c => {
  const host = c.req.header('host') || 'gasolineras.pages.dev'
  const scheme = c.req.header('x-forwarded-proto') || 'https'
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

// ---- SEO: sitemap.xml (home + 52 provincias + privacidad) ----
app.get('/sitemap.xml', c => {
  const host = c.req.header('host') || 'gasolineras.pages.dev'
  const scheme = c.req.header('x-forwarded-proto') || 'https'
  const base = scheme + '://' + host
  const today = new Date().toISOString().slice(0, 10)
  const entries: string[] = []
  entries.push(`  <url><loc>${base}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`)
  for (const p of PROVINCIAS) {
    entries.push(`  <url><loc>${base}/gasolineras/${p.slug}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
  }
  entries.push(`  <url><loc>${base}/privacidad</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`)
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  return c.text(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

// ---- Paginas legales (HTML simple, sin JS) ----
function legalPage(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · Gasolineras España</title>
<meta name="robots" content="index,follow"/>
<meta name="description" content="${title} de Gasolineras España"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26FD;</text></svg>"/>
<style>
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

app.get('/privacidad', c => {
  const html = legalPage('Privacidad', `
<h1>Política de privacidad</h1>
<p><strong>Última actualización:</strong> ${new Date().toISOString().slice(0,10)}</p>

<h2>Qué datos tratamos</h2>
<p>Esta aplicación <strong>no almacena</strong> datos personales en nuestros servidores. Todos los ajustes (provincia, combustible, favoritos, perfil de vehículo) se guardan exclusivamente en el <code>localStorage</code> de tu navegador y nunca salen de tu dispositivo.</p>

<h2>Geolocalización</h2>
<p>Si concedes permiso de ubicación, tus coordenadas se usan <strong>solo en el navegador</strong> para calcular la distancia a las gasolineras. No se envían a ningún servidor.</p>

<h2>Servicios de terceros</h2>
<ul>
  <li><strong>Ministerio para la Transición Ecológica</strong>: origen oficial de los precios.</li>
  <li><strong>OpenStreetMap Nominatim</strong>: geocodificación de direcciones introducidas por el usuario.</li>
  <li><strong>CartoDB / unpkg</strong>: CDN de tiles de mapa y librerías.</li>
</ul>
<p>Estos servicios pueden registrar la IP del visitante según sus propias políticas.</p>

<h2>Informes de errores</h2>
<p>Si se produce un fallo en JavaScript, se puede enviar un informe técnico mínimo (mensaje, stack, URL, user-agent) al endpoint <code>/api/ingest</code>. No se incluye contenido introducido por el usuario ni cookies. Puedes desactivarlo bloqueando <code>/api/ingest</code> en tu navegador.</p>

<h2>Cookies</h2>
<p>No usamos cookies de seguimiento ni publicidad.</p>

<h2>Contacto</h2>
<p>Incidencias: issue en el repositorio.</p>
`)
  return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600' })
})

// ---- API ----
app.get('/api/provincias', async c => {
  try {
    return c.json(await proxiedFetch('/Listados/Provincias/'), 200, { 'Cache-Control': 'public, max-age=3600' })
  } catch {
    return c.json({ error: 'No se pudo conectar con el Ministerio' }, 503)
  }
})

app.get('/api/municipios/:idProv', async c => {
  const idProv = validateId(c.req.param('idProv'))
  if (!idProv) return c.json({ error: 'ID de provincia invalido' }, 400)
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
  if (!idProv) return c.json({ error: 'ID de provincia invalido' }, 400)
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

// ---- Health check (para monitorizacion sintetica) ----
// Devuelve 503 si el snapshot del Ministerio es mas viejo que SNAPSHOT_STALE_MS
// (24h). Esto permite que Cloudflare Health Checks / UptimeRobot / etc
// dispare alertas cuando el Action de fetch falla en silencio.
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

  const body = {
    ok: !stale,
    version: APP_VERSION,
    ts: new Date().toISOString(),
    caches: {
      srv: (srvCache as unknown as { size: number }).size,
      snapshot: (snapshotCache as unknown as { size: number }).size,
    },
    snapshot: meta ?? null,
    snapshotAgeMs,
    stale,
    staleThresholdMs: SNAPSHOT_STALE_MS,
  }

  if (stale) {
    slog('error', 'health.stale', { ageMs: snapshotAgeMs, meta })
    return c.json(body, 503, { 'Cache-Control': 'no-store' })
  }
  return c.json(body, 200, { 'Cache-Control': 'no-store' })
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

  // Turnstile: token opcional en header (preferido) o body (ts). Si no hay
  // TURNSTILE_SECRET_KEY configurado, verifyTurnstile hace fail-open (true)
  // para no romper dev. Si esta configurado y falta o es invalido → 403.
  const tsToken = c.req.header('cf-turnstile-response')
    || (typeof evt.ts === 'string' ? evt.ts : undefined)
  const tsOk = await verifyTurnstile(tsToken, c.env.TURNSTILE_SECRET_KEY, key)
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

export default app
