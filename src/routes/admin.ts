// Rutas de telemetría/admin: /api/csp-report, /api/client-error, /api/admin/errors[/ack
// /autofix], /api/admin/reports[/ack], /api/reports/price, /api/ingest, /api/vitals.
// Extraido de index.tsx (B1). Importa infra de runtime. verifyTurnstile es privado
// (solo lo usa /api/ingest); sha256Hex y REPORT_* viven anidados con sus rutas.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { clientKey, slog, authorizeCron, cspLimiter, errLimiter, reportLimiter, vitalsLimiter, ingestLimiter } from '../lib/runtime'
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

export function registerAdminRoutes(app: Hono<{ Bindings: Env }>): void {
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
}
