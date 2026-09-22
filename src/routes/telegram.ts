// Alertas por Telegram (Ship 25) + su cron de comprobación. Extraido de index.tsx (B1).
// 8 rutas /api/telegram/* + POST /api/cron/telegram-check. Importa slog+authorizeCron de
// runtime. Seguridad movida VERBATIM: webhook secret (tokensEqualConstTime) y el fix IDOR
// (tgChatFromAuth: chat_id solo desde Bearer verificado). Helpers privados anidados.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { slog, authorizeCron, jsonBodyLimit } from '../lib/runtime'
import { tokensEqualConstTime } from '../lib/pure'
import { signTelegramToken, verifyTelegramToken } from '../lib/auth'

export function registerTelegramRoutes(app: Hono<{ Bindings: Env }>): void {
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
  const { tgSetMyCommands } = await import('../lib/telegram')
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
    slog('error', 'telegram_start_link_error', { message: (e as Error).message })
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
  const { tgSendMessage, tgEscapeHtml, buildPreciosMessages } = await import('../lib/telegram')
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
app.post('/api/telegram/toggle-fav', jsonBodyLimit(4 * 1024), async c => {
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
  const { tgSendMessage, buildPreciosMessages } = await import('../lib/telegram')
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
}
