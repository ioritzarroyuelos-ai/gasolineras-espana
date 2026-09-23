import { Hono } from 'hono'
import { originAllowed } from './lib/pure'
import { APP_VERSION } from './lib/version'
import { snapshotToRows, buildInsertBatches, todayUtc, purgeCutoffDate } from './lib/history'
// Infra compartida del servidor en src/lib/runtime.ts. index solo usa lo del
// middleware /api/* (originAllowed/ALLOWED_ORIGINS/apiLimiter/clientKey/slog), el cron
// (authorizeCron) y el handler de errores (slog). El resto de la infra la importan
// directamente los modulos de ruta. Los tipos del snapshot se re-exportan para ellos.
import { slog, clientKey, apiLimiter, ALLOWED_ORIGINS, authorizeCron } from './lib/runtime'
import type { MinistryResponse } from './lib/runtime'
export type { MinistryResponse, StationRecord } from './lib/runtime'
// Sub-apps de ruta (src/routes/*): cada registerXRoutes registra su grupo sobre `app`.
import { registerTiempoRoutes } from './routes/tiempo'
import { registerItvRoutes } from './routes/itv'
import { registerFarmaciasRoutes } from './routes/farmacias'
import { registerGasolinerasRoutes } from './routes/gasolineras'
import { registerAuthRoutes } from './routes/auth'
import { registerHomeRoutes } from './routes/home'
import { registerMetaRoutes } from './routes/meta'
import { registerAdminRoutes } from './routes/admin'
import { registerDataRoutes } from './routes/data'
import { registerHistoryRoutes } from './routes/history'
import { registerTelegramRoutes } from './routes/telegram'
import { registerPoliticaRoutes } from './routes/politica'

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
registerGasolinerasRoutes(app)

// ---- Farmacias de guardia ----
// Rutas en src/routes/farmacias.ts: /farmacias, /farmacias/, /farmacias/guardia,
// /api/guardias/municipios, /farmacias/:prov, /farmacias/:prov/:mun. Orden interno
// critico (/farmacias/guardia ANTES de /farmacias/:prov); preservado en el modulo.
registerFarmaciasRoutes(app)

// Vertical del tiempo (AEMET + Open-Meteo). Rutas en src/routes/tiempo.ts:
// /api/tiempo/municipios, /tiempo, /tiempo/, /tiempo/:prov, /tiempo/:prov/:mun.
// Se registran aqui para preservar el orden relativo al resto de verticales.
registerTiempoRoutes(app)

// ---- ITV (datos del FeatureServer de la DGT) ----
// Rutas en src/routes/itv.ts: /api/itv/municipios, /itv/, /itv, /itv/precios,
// /itv/:prov, /itv/:prov/:mun. El orden interno importa (/itv/precios ANTES de
// /itv/:provinciaSlug); se preserva dentro del modulo.
registerItvRoutes(app)

// ---- Política (elecciones + sondeos de Wikipedia) ----
// Rutas en src/routes/politica.ts: /api/politica/elecciones, /politica, /politica/,
// /politica/autonomicas(/), /politica/autonomicas/:comunidad, /politica/:eleccionId.
// Orden interno crítico (/politica/autonomicas ANTES de /politica/:eleccionId);
// preservado en el módulo. La veda (LOREG 69.7) se evalúa por request.
registerPoliticaRoutes(app)

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
registerAuthRoutes(app)

// ---- Core de datos + histórico (API) ----
// Rutas en src/routes/data.ts (provincias/municipios/estaciones/geocode/health/tiles)
// y src/routes/history.ts (history/stats/predict/export). Orden data→history preservado.
registerDataRoutes(app)
registerHistoryRoutes(app)

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

// ---- Alertas Telegram (Ship 25) ----
// Rutas en src/routes/telegram.ts: /api/telegram/* (8) + /api/cron/telegram-check.
registerTelegramRoutes(app)

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
