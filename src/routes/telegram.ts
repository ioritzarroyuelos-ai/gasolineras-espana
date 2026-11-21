// Alertas por Telegram (Ship 25) + su cron de comprobación. Extraido de index.tsx (B1).
// 8 rutas /api/telegram/* + POST /api/cron/telegram-check. Importa slog+authorizeCron de
// runtime. Seguridad movida VERBATIM: webhook secret (tokensEqualConstTime) y el fix IDOR
// (tgChatFromAuth: chat_id solo desde Bearer verificado). Helpers privados anidados.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { slog, authorizeCron, jsonBodyLimit } from '../lib/runtime'
import { tokensEqualConstTime } from '../lib/pure'
import { signTelegramToken, verifyTelegramToken } from '../lib/auth'
import { borrarItvTelegram } from '../lib/telegram-itv'
import { borrarDisponibilidadTelegram } from '../lib/disponibilidad-telegram'
import { borrarPreferenciaPrecios, cargaPreciosComparacion, mensajesPrecios, enviarPreciosTelegram, PRECIOS_COMBUSTIBLES } from '../lib/telegram-precios'
import { registerTelegramPreciosRoutes } from './telegram-precios'
import { escapeHtml } from '../html/html'

const TELEGRAM_SUBSCRIPTION_LIMIT = 100
const LIMIT_MESSAGE = 'Puedes tener hasta 100 avisos de gasolineras y combustibles. Desactiva alguno antes de añadir otro.'
function canonicalStationId(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value.trim())) return null
  const id = String(Number(value.trim()))
  return /^[1-9]\d{0,8}$/.test(id) ? id : null
}
function subscriptionStatement(env: Env, chat: number, station: string, fuel: string, threshold: number, now: number) {
  // El límite y la inserción pertenecen a la misma sentencia SQLite. Dos
  // peticiones concurrentes no pueden ocupar a la vez la última plaza.
  return env.DB!.prepare(`INSERT INTO telegram_subscriptions
    (chat_id, station_id, fuel_code, threshold_cents, baseline_cents, created_at)
    SELECT ?, ?, ?, ?, NULL, ?
    WHERE (SELECT COUNT(*) FROM telegram_subscriptions WHERE chat_id = ?) < ?
    ON CONFLICT(chat_id, station_id, fuel_code) DO NOTHING`)
    .bind(chat, station, fuel, threshold, now, chat, TELEGRAM_SUBSCRIPTION_LIMIT)
}
async function addSubscription(env: Env, chat: number, station: string, fuel: string, threshold: number, now: number): Promise<'added' | 'existing' | 'limit'> {
  const result = await subscriptionStatement(env, chat, station, fuel, threshold, now).run()
  if (result.success === false || ![0, 1].includes(result.meta?.changes as number)) throw Error('subscription_write_failed')
  if (result.meta?.changes === 1) return 'added'
  const existing = await env.DB!.prepare('SELECT 1 FROM telegram_subscriptions WHERE chat_id = ? AND station_id = ? AND fuel_code = ?').bind(chat, station, fuel).all()
  if (!Array.isArray(existing.results)) throw Error('subscription_read_failed')
  return existing.results.length ? 'existing' : 'limit'
}

export function registerTelegramRoutes(app: Hono<{ Bindings: Env }>): void {
registerTelegramPreciosRoutes(app)
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
//      (d) conserva el pending_token hasta que expire para el polling
//      (e) manda sendMessage al user listando las gasolineras ya vigiladas.
//   4. La web hace polling a GET /api/telegram/confirm?token=... cada 2s.
//      Devuelve un Bearer firmado; chat_id es sólo informativo y no autoriza.
//
// Flow de alertas:
//   - El reloj GHA (.github/workflows/cron-telegram-check.yml) invoca cada mañana
//     POST /api/cron/telegram-check con Authorization Bearer CRON_TOKEN.
//   - El cron prepara cada chat por bloques de precios acotados y verificados.
//   - Envía resumen o bajadas según el permiso separado, con deduplicación.
//     ITV mantiene su propio consentimiento y cron.
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
  { command: 'precios', description: 'Últimos precios publicados, con fecha y páginas' },
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
  const { tgSetMyCommands } = await import('../lib/telegram')
  const r = await tgSetMyCommands(c.env.TELEGRAM_BOT_TOKEN!, TELEGRAM_BOT_COMMANDS)
  if (!r.ok) {
    slog('warn', 'telegram_set_commands_failed', {})
    return c.json({ ok: false, error: 'set_commands_failed', description: r.description }, 502, { 'Cache-Control': 'no-store' })
  }
  slog('info', 'telegram_set_commands_ok', { count: TELEGRAM_BOT_COMMANDS.length })
  return c.json({ ok: true, count: TELEGRAM_BOT_COMMANDS.length }, 200, { 'Cache-Control': 'no-store' })
})

const PENDING_TOKEN_TTL_MS = 10 * 60 * 1000  // 10 min

// POST /api/telegram/start-link — genera token + deepLink para iniciar el flow.
// Body: { favs: [{station_id, fuel_code}], threshold_cents? }
// Almacenamos los favoritos serializados en el pending_token: asi el webhook
// puede insertarlos en telegram_subscriptions y listarlos en el mensaje de
// confirmacion en una sola transaccion (ver migracion 0008).
app.post('/api/telegram/start-link', jsonBodyLimit(16 * 1024), async c => {
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
  if (favsRaw.length > TELEGRAM_SUBSCRIPTION_LIMIT) return c.json({ ok: false, error: 'subscription_limit', limit: TELEGRAM_SUBSCRIPTION_LIMIT, message: LIMIT_MESSAGE }, 409)
  // Sanitiza el array de favs antes de serializar (evita meter basura en D1).
  const favsClean: Array<{ station_id: string; fuel_code: string; baseline_cents: number | null }> = []
  const identities = new Set<string>()
  for (const f of favsRaw) {
    const stationId = canonicalStationId(f?.station_id)
    const fuelCode  = typeof f?.fuel_code  === 'string' ? f.fuel_code.trim()  : ''
    if (!stationId || !['95', '98', 'diesel', 'diesel_plus'].includes(fuelCode)) return c.json({ ok: false, error: 'invalid_favorite' }, 400)
    const identity = stationId + ':' + fuelCode
    if (identities.has(identity)) continue
    identities.add(identity)
    // La referencia sólo procede de dos capturas oficiales; nunca del navegador.
    favsClean.push({ station_id: stationId, fuel_code: fuelCode, baseline_cents: null })
  }
  const { generateLinkToken } = await import('../lib/telegram')
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
    slog('error', 'telegram_start_link_error', {})
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// POST /api/telegram/webhook — recibe updates del bot. Validamos el secret
// para estar seguros de que el request viene de Telegram (seteamos el secret
// con setWebhook y Telegram nos lo devuelve en el header). Responde SIEMPRE
// 200 si el secret es valido, incluso si el update no es procesable — asi
// Telegram no reintenta indefinidamente.
app.post('/api/telegram/webhook', jsonBodyLimit(64 * 1024), async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
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
  if (!Number.isSafeInteger(chatId) || chatId <= 0) return c.json({ ok: true, ignored: 'invalid_chat' }, 200)
  const text = String(msg.text).trim()
  const { tgSendMessage, tgEscapeHtml } = await import('../lib/telegram')
  // Cada baja es independiente: una avería de D1 o KV no deja sin intentar
  // la cancelación de disponibilidad. Sólo confirmamos cuando terminan todas.
  if (text === '/stop') {
    const results = await Promise.allSettled([
      (async () => {
        if (!c.env.DB) throw Error('db_not_available')
        return c.env.DB.prepare('DELETE FROM telegram_subscriptions WHERE chat_id = ?').bind(chatId).run()
      })(),
      borrarPreferenciaPrecios(c.env, chatId),
      borrarItvTelegram(c.env, chatId),
      borrarDisponibilidadTelegram(c.env, chatId),
    ])
    if (results.some(result => result.status === 'rejected')) {
      slog('warn', 'telegram_stop_cancel_pending', {})
      return c.json({ ok: false, error: 'cancel_pending' }, 503)
    }
    const prices = results[0], itv = results[2], disponibilidad = results[3]
    const n = prices.status === 'fulfilled' ? prices.value.meta?.changes ?? 0 : 0
    const itvRemoved = itv.status === 'fulfilled' && itv.value
    const availabilityRemoved = disponibilidad.status === 'fulfilled' && disponibilidad.value
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      n > 0 || itvRemoved || availabilityRemoved
        ? `🗑️ Cancelados tus avisos de precios, ITV y disponibilidad. Un mensaje que ya había empezado a enviarse podría llegar todavía. Para activarlos de nuevo, elígelos expresamente en la web.`
        : `No tenías alertas activas. Nada que borrar.`)
    slog('info', 'telegram_stop', { removed: n, itvRemoved })
    return c.json({ ok: true }, 200)
  }
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  // Comandos soportados:
  //   /start <token> — vincula la web con este chat_id
  //   /start (sin token) — welcome con link a la web
  //   /precios [página] — últimas cifras publicadas, con su fecha real
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
      slog('info', 'telegram_bind', { ok: false })
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
    let inserted = 0, alreadyActive = 0, limited = 0, failed = 0
    const accepted: typeof favs = [], candidates: typeof favs = [], identities = new Set<string>()
    failed += Math.max(0, favs.length - TELEGRAM_SUBSCRIPTION_LIMIT)
    for (const f of favs.slice(0, TELEGRAM_SUBSCRIPTION_LIMIT)) {
      const stationId = canonicalStationId(f?.station_id)
      if (!stationId || !['95', '98', 'diesel', 'diesel_plus'].includes(f?.fuel_code)) { failed++; continue }
      const identity = stationId + ':' + f.fuel_code
      if (identities.has(identity)) continue
      identities.add(identity)
      candidates.push({ station_id: stationId, fuel_code: f.fuel_code, baseline_cents: null })
    }
    if (candidates.length) {
      try {
        // Un lote D1 mantiene el límite atómico sin consumir una subpetición
        // por cada favorito. El lote completo se confirma o se revierte.
        const raw = await c.env.DB.batch(candidates.map(f => subscriptionStatement(c.env, chatId, f.station_id, f.fuel_code, thresholdCents, now)))
        const results = raw as Array<{ success?: boolean; meta?: { changes?: number } }>
        if (results.length !== candidates.length || results.some(r => !r || r.success === false || ![0, 1].includes(r.meta?.changes as number))) throw Error('subscription_batch_failed')
        const existing = results.some(r => r.meta?.changes === 0)
          ? await c.env.DB.prepare('SELECT station_id, fuel_code FROM telegram_subscriptions WHERE chat_id = ? LIMIT 101').bind(chatId).all<{ station_id: string; fuel_code: string }>() : { results: [] }
        if (!Array.isArray(existing.results)) throw Error('subscription_read_failed')
        const active = new Set(existing.results.map(f => f.station_id + ':' + f.fuel_code))
        for (let i = 0; i < candidates.length; i++) {
          const f = candidates[i]
          if (results[i].meta?.changes === 1) inserted++
          else if (active.has(f.station_id + ':' + f.fuel_code)) alreadyActive++
          else { limited++; continue }
          accepted.push(f)
        }
      } catch (e) {
        failed += candidates.length
        slog('error', 'telegram_bind_insert_error', {})
      }
    }
    // 4) NO borramos el token aqui: el cliente sigue haciendo polling a
    //    /api/telegram/confirm?token=... durante unos segundos y necesita
    //    encontrar la fila con chat_id + confirmed_at seteados. El cron
    //    telegram-check purga filas con expires_at caducado (+1h grace).
    // La confirmación cuenta las altas confirmadas por D1. No descarga el
    // catálogo nacional sólo para decorar el mensaje con nombres.
    const accountUrl = escapeHtml((c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin) + '/gasolineras/')
    const reply = accepted.length > 0
      ? `🔔 <b>Alertas activas</b>\n\n` +
        `${inserted} avisos añadidos y ${alreadyActive} que ya estaban activos.\n` +
        `<a href="${accountUrl}">Consulta la lista completa en la web</a> o escribe /precios.\n\n` +
        `📅 Revisamos los precios por la mañana, entre las 8:00 y las 11:59 (hora peninsular). En la web puedes elegir resumen diario o sólo bajadas comprobadas.\n` +
        `⚡ /precios muestra la fecha de los últimos precios publicados.\n\n` +
        `<i>Para pararlas en cualquier momento: /stop</i>`
      : `✅ <b>Telegram vinculado</b>.\n\n` +
        `Vuelve a la página donde empezaste y elige los avisos que quieres activar. Vincular el bot no activa recordatorios de ITV por sí solo.`
    const notices = (limited ? `\n\n⚠️ No se han añadido ${limited} avisos porque alcanzaste el límite de 100. Desactiva alguno en la web antes de añadir otro.` : '') +
      (failed ? `\n\n⚠️ No se ha podido confirmar la activación de ${failed} avisos. Revisa la lista en la web y vuelve a intentarlo.` : '')
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply + notices)
    slog('info', 'telegram_bind', { ok: true, subscribed: inserted, limited, failed })
    return c.json({ ok: true, added: inserted, alreadyActive, limited, failed }, 200)
  }
  if (text === '/start') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `👋 ¡Hola! Te mando cada manana el precio de las gasolineras que elijas.\n\n` +
      `Para activarlo:\n` +
      `1. Abre ${tgEscapeHtml(c.env.PUBLIC_ORIGIN || 'la web')}\n` +
      `2. Toca una gasolinera en el mapa\n` +
      `3. Pulsa "Activar alerta"\n\n` +
      `Cada mañana revisamos los últimos precios publicados. Escribe /precios para verlos con su fecha.\n\n` +
      `📅 También puedes activar un recordatorio de ITV en https://webapp-3ft.pages.dev/itv/ con tu fecha y un permiso separado. No se activa al vincular el bot.\n` +
      (c.env.DISPONIBILIDAD_ENABLED === 'true' && c.env.DISPONIBILIDAD ? `🚲 En Cerca de ti puedes elegir avisos de disponibilidad con otro permiso separado.\n` : '') +
      `/stop cancela precios, ITV y disponibilidad.`,
    )
    return c.json({ ok: true }, 200)
  }
  if (/^\/precios(?:\s|$)/.test(text)) {
    const command = /^\/precios(?:\s+([1-9]\d{0,2}))?$/.exec(text)
    const send = (message: string) => enviarPreciosTelegram(c.env.TELEGRAM_BOT_TOKEN!, chatId, message)
    if (!command) { await send('Escribe /precios para empezar o /precios 2 para consultar la segunda página.'); return c.json({ ok: true }, 200) }
    const page = Number(command[1] || 1)
    try {
      const subsR = await c.env.DB.prepare('SELECT station_id, fuel_code FROM telegram_subscriptions WHERE chat_id = ? LIMIT 101')
        .bind(chatId).all<{ station_id: string; fuel_code: string }>()
      if (!Array.isArray(subsR.results) || subsR.results.length > TELEGRAM_SUBSCRIPTION_LIMIT
        || subsR.results.some(s => canonicalStationId(s.station_id) !== s.station_id || !PRECIOS_COMBUSTIBLES.includes(s.fuel_code as '95'))) {
        await send('No puedo preparar toda tu lista de avisos. Revísala en la web; el máximo es 100. No he omitido avisos para mostrar una lista incompleta.')
        return c.json({ ok: false, error: 'invalid_subscriptions' }, 200)
      }
      const subscriptions = subsR.results.sort((a, b) => Number(a.station_id) % 32 - Number(b.station_id) % 32 || Number(a.station_id) - Number(b.station_id) || a.fuel_code.localeCompare(b.fuel_code))
      if (!subscriptions.length) { await send('Todavía no tienes avisos de gasolineras activos. Elige una gasolinera en la web y pulsa Activar alerta.'); return c.json({ ok: true }, 200) }
      // Todas las suscripciones tienen página: como máximo10 filas y2 cubos.
      // Esto acota lectura y mensajes incluso si los100 avisos están dispersos.
      const pages: typeof subscriptions[] = []; let part: typeof subscriptions = [], buckets = new Set<number>()
      for (const sub of subscriptions) {
        const bucket = Number(sub.station_id) % 32
        if (part.length >= 10 || !buckets.has(bucket) && buckets.size >= 2) { pages.push(part); part = []; buckets = new Set() }
        part.push(sub); buckets.add(bucket)
      }
      if (part.length) pages.push(part)
      if (page > pages.length) { await send(`Tu lista tiene ${pages.length} páginas. Escribe /precios para empezar.`); return c.json({ ok: true, pages: pages.length }, 200) }
      const selected = pages[page - 1], reader = await cargaPreciosComparacion(c.env), pair = await reader.estaciones(selected.map(s => s.station_id))
      const known = new Set(pair.filas.map(row => row[0]))
      for (const sub of selected) if (!known.has(sub.station_id)) {
        known.add(sub.station_id)
        pair.filas.push([sub.station_id, `Gasolinera ${sub.station_id} (sin ficha en la fuente)`, '', [null, null, null, null], [null, null, null, null]])
      }
      const first = pages.slice(0, page - 1).reduce((n, p) => n + p.length, 0) + 1
      const heading = `Página ${page} de ${pages.length} · Avisos ${first}–${first + selected.length - 1} de ${subscriptions.length}.\n\n`
      const navigation = (page < pages.length ? `\n\nSiguiente: /precios ${page + 1}` : '\n\nFin de la lista.') + (page > 1 ? `\nAnterior: /precios ${page - 1}` : '')
      const messages = mensajesPrecios(pair, selected, null).map((m, i, all) => (i === 0 ? heading : '') + m + (i === all.length - 1 ? navigation : ''))
      if (!messages.length || messages.length > 2 || messages.some(m => m.length > 4096)) throw Error('price_page_too_large')
      for (const message of messages) if ((await send(message)).estado !== 'enviado') return c.json({ ok: false, error: 'telegram_send_failed' }, 200)
      return c.json({ ok: true, page, pages: pages.length, subscriptions: subscriptions.length, shown: selected.length }, 200)
    } catch {
      await send('No puedo confirmar los últimos precios publicados. No mostraré una copia antigua como si fuera actual. Inténtalo en un rato con /precios' + (page > 1 ? ` ${page}` : '') + '.')
      return c.json({ ok: false, error: 'prices_unavailable' }, 200)
    }
  }
  if (text === '/help') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId,
      `<b>Comandos:</b>\n` +
      `/precios — últimos precios publicados, con fecha\n` +
      `/precios 2 — siguiente página de tu lista\n` +
      `/start — volver a empezar\n` +
      `/stop — cancelar precios, ITV y disponibilidad\n` +
      `/help — esta ayuda\n\n` +
      `📅 ITV: elige tu fecha y activa su permiso independiente en https://webapp-3ft.pages.dev/itv/. Vincular el bot no activa el recordatorio.\n` +
      (c.env.DISPONIBILIDAD_ENABLED === 'true' && c.env.DISPONIBILIDAD ? `🚲 Disponibilidad: elige lugar y modalidad en https://webapp-3ft.pages.dev/cerca. Vincular el bot no activa estos avisos.` : ''),
    )
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
// Body: { station_id?, fuel_code? }; el Bearer aporta el chat. Sin estación,
// borra las suscripciones de gasolina de ese chat, no el permiso separado ITV.
app.post('/api/telegram/unsubscribe', jsonBodyLimit(4 * 1024), async c => {
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
      await borrarPreferenciaPrecios(c.env, chatId)
    }
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    slog('error', 'telegram_unsubscribe_error', {})
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// GET /api/telegram/subscriptions — lista las suscripciones de gasolina del
// chat autorizado por Bearer firmado. Un chat_id del cliente no autoriza nada.
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
    slog('error', 'telegram_list_subs_error', {})
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

// POST /api/telegram/toggle-fav — activa o pausa la alerta de UNA favorita.
// Body: { station_id, fuel_code, enabled }; chat sólo desde el Bearer.
// - enabled=true:  inserta en telegram_subscriptions (threshold copiado del
//                  primer sub del mismo chat; default 15 si el chat no tiene
//                  subs) y manda al bot "🔔 Alerta añadida". Idempotente:
//                  si ya existia, devolvemos status=already_enabled sin
//                  duplicar mensaje.
// - enabled=false: borra la sub y manda "🔕 Alerta pausada". Idempotente
//                  igual (status=already_disabled si no existia).
// El nombre procede de un único bloque validado del catálogo de precios.
app.post('/api/telegram/toggle-fav', jsonBodyLimit(4 * 1024), async c => {
  if (!isTelegramConfigured(c.env)) return c.json({ ok: false, error: 'telegram_not_configured' }, 503)
  if (!c.env.DB) return c.json({ ok: false, error: 'db_not_available' }, 503)
  const chatId = await tgChatFromAuth(c)
  if (chatId == null) return c.json({ ok: false, error: 'unauthorized' }, 401, { 'Cache-Control': 'no-store' })
  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
  const stationId = canonicalStationId(body?.station_id)
  const fuelCode = typeof body?.fuel_code === 'string' ? body.fuel_code.trim() : ''
  const enabled = !!body?.enabled
  if (!stationId) return c.json({ ok: false, error: 'invalid_station_id' }, 400)
  if (!['95', '98', 'diesel', 'diesel_plus'].includes(fuelCode)) {
    return c.json({ ok: false, error: 'invalid_fuel_code' }, 400)
  }
  const { tgSendMessage, tgEscapeHtml } = await import('../lib/telegram')
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

    // 2) Un solo cubo. Si no se puede verificar, identifica el aviso por ID.
    let rotulo = 'Gasolinera ' + stationId
    let municipio = ''
    try {
      const reader = await cargaPreciosComparacion(c.env), pair = await reader.estaciones([stationId])
      const row = pair.filas.find(row => row[0] === stationId)
      if (row) { rotulo = row[1].slice(0, 90); municipio = row[2].slice(0, 70) }
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
      const added = await addSubscription(c.env, chatId, stationId, fuelCode, threshold, Date.now())
      if (added === 'limit') return c.json({ ok: false, error: 'subscription_limit', limit: TELEGRAM_SUBSCRIPTION_LIMIT, message: LIMIT_MESSAGE }, 409, { 'Cache-Control': 'no-store' })
      if (added === 'existing') return c.json({ ok: true, status: 'already_enabled' }, 200, { 'Cache-Control': 'no-store' })
      const reply =
        `🔔 <b>Alerta activada</b>\n\n` +
        `Vigilo <b>${rotuloEsc}</b>${munEsc ? ' <i>(' + munEsc + ')</i>' : ''} — ${lbl}.\n\n` +
        `📅 Revisamos los avisos por la mañana (8:00–11:59, hora peninsular), según tu elección de resumen o bajadas en la web. Pide el precio cuando quieras con /precios.`
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN!, chatId, reply)
      slog('info', 'telegram_toggle_fav', { enabled: true })
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
      slog('info', 'telegram_toggle_fav', { enabled: false })
      return c.json({ ok: true, status: 'disabled' }, 200, { 'Cache-Control': 'no-store' })
    }
  } catch (e) {
    slog('error', 'telegram_toggle_fav_error', {})
    return c.json({ ok: false, error: 'db_error' }, 500)
  }
})

}
