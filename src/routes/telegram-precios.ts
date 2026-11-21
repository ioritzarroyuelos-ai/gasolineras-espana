import type { Hono } from 'hono'
import type { Env } from '../index'
import { authorizeCron, jsonBodyLimit, slog } from '../lib/runtime'
import { PRECIOS_CONSENTIMIENTO, PRECIOS_UMBRALES, PRECIOS_PREFIX, preciosChat, preciosPreferencia, preciosPreferenciaKey, preciosUsuario, cargaPreciosComparacion, mensajesPrecios, preciosMadrid, preciosLeer, preciosHash, preciosCursor, preciosLeeCursor, preciosPlanValido, preciosReciboValido, enviarPreciosTelegram, borrarPreferenciaPrecios } from '../lib/telegram-precios'
import type { PreciosPreferencia, PreciosPlan, PreciosRecibo, PreciosTrabajo, PreciosFila } from '../lib/telegram-precios'
import { borrarItvTelegram } from '../lib/telegram-itv'

const configured = (env: Env) => !!(env.USER_DATA && env.DB && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET)
const publicPreference = (value: PreciosPreferencia | null) => ({ modo: value?.modo || 'resumen', umbralMilesimas: value?.umbralMilesimas || 10, consentimiento: value?.consentimiento || null, actualizado: value?.actualizado || null })
const noStore = { 'Cache-Control': 'no-store' }
const receiptOptions = { expirationTtl: 3 * 86400 }
type Subscription = { station_id: string; fuel_code: string; last_notified_at?: number | null }
async function subscriptions(env: Env, chat: number): Promise<Subscription[]> {
  const data = await env.DB!.prepare('SELECT station_id, fuel_code, last_notified_at FROM telegram_subscriptions WHERE chat_id = ? ORDER BY station_id, fuel_code LIMIT 101').bind(chat).all<Subscription>()
  if (!Array.isArray(data.results) || data.results.length > 100 || data.results.some(row => typeof row.station_id !== 'string' || !/^\d{1,10}$/.test(row.station_id) || !/^[1-9]\d{0,8}$/.test(String(Number(row.station_id))) || !['95', '98', 'diesel', 'diesel_plus'].includes(row.fuel_code))) throw new Error('invalid_subscriptions')
  return data.results
}
const signature = (rows: Subscription[]) => rows.map(row => row.station_id + ':' + row.fuel_code).sort().join('|')
type PreciosPreparacion = { version: 1; id: string; snapshot: string; offset: number; filas: PreciosFila[]; creado: number }
function preparacionValida(value: PreciosPreparacion, id: string, snapshot: string, ids: string[], buckets: string[]): boolean {
  if (!value || value.version !== 1 || value.id !== id || value.snapshot !== snapshot || !Number.isInteger(value.offset) || value.offset < 1 || value.offset > buckets.length || !Number.isFinite(value.creado) || !Array.isArray(value.filas) || value.filas.length > ids.length) return false
  const seen = new Set<string>()
  return value.filas.every(row => {
    if (!Array.isArray(row) || row.length !== 5 || !ids.includes(row[0]) || seen.has(row[0]) || !buckets.slice(0, value.offset).includes(String(Number(row[0]) % 32).padStart(2, '0')) || typeof row[1] !== 'string' || row[1].length > 160 || typeof row[2] !== 'string' || row[2].length > 120 || [row[3], row[4]].some(vector => !Array.isArray(vector) || vector.length !== 4 || vector.some(n => n !== null && (!Number.isInteger(n) || n < 1 || n > 9999)))) return false
    seen.add(row[0]); return true
  })
}

export function registerTelegramPreciosRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/telegram/precios*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.get('/api/telegram/precios', async c => {
    if (!configured(c.env)) return c.json({ ok: false, error: 'price_preferences_unavailable' }, 503)
    const chat = await preciosChat(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    try { return c.json({ ok: true, preferencia: publicPreference(await preciosPreferencia(c.env.USER_DATA!, chat)) }) }
    catch { return c.json({ ok: false, error: 'price_preferences_unavailable' }, 503) }
  })
  app.put('/api/telegram/precios', jsonBodyLimit(1024), async c => {
    if (!configured(c.env)) return c.json({ ok: false, error: 'price_preferences_unavailable' }, 503)
    const chat = await preciosChat(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(k => !['modo', 'umbralMilesimas', 'consentimiento'].includes(k))) return c.json({ ok: false, error: 'invalid_price_preference' }, 400)
    const input = body as Record<string, unknown>
    if (typeof input.modo !== 'string' || !['resumen', 'bajadas'].includes(input.modo) || !PRECIOS_UMBRALES.includes(input.umbralMilesimas as 10) || input.consentimiento !== PRECIOS_CONSENTIMIENTO) return c.json({ ok: false, error: 'invalid_price_preference' }, 400)
    try {
      const previous = await preciosPreferencia(c.env.USER_DATA!, chat)
      if (previous && previous.modo === input.modo && previous.umbralMilesimas === input.umbralMilesimas) return c.json({ ok: true, preferencia: publicPreference(previous) })
      const next: PreciosPreferencia = { version: 1, chat, modo: input.modo as 'resumen' | 'bajadas', umbralMilesimas: input.umbralMilesimas as number, consentimiento: PRECIOS_CONSENTIMIENTO, actualizado: new Date().toISOString() }
      await c.env.USER_DATA!.put(preciosPreferenciaKey(await preciosUsuario(chat)), JSON.stringify(next))
      return c.json({ ok: true, preferencia: publicPreference(next) })
    } catch { return c.json({ ok: false, error: 'price_preferences_unavailable' }, 503) }
  })

  app.post('/api/cron/telegram-check', async c => {
    const authorized = await authorizeCron(c)
    if (!authorized.ok) return c.json(authorized.body, authorized.status as 401 | 503, noStore)
    if (c.req.query('force') !== undefined) return c.json({ ok: false, error: 'force_not_supported' }, 400, noStore)
    if (!configured(c.env)) return c.json({ ok: false, error: 'price_preferences_unavailable' }, 503, noStore)
    const now = Date.now(), { fecha, hora } = preciosMadrid(now), dryRun = c.req.query('dry_run') === '1', inWindow = hora >= 8 && hora < 12
    const stats = { ok: true, dryRun, inWindow, chats: 0, processed: 0, work: 0, eligible: 0, sentChats: 0, sentMsgs: 0, purged: 0, skipped: 0, errors: 0, uncertain: 0, deferred: 0, nextCursor: null as string | null }
    if (!dryRun && !inWindow) return c.json({ ...stats, skipped: 'not_digest_window' }, 200, noStore)
    const kv = c.env.USER_DATA!, checkpointKey = PRECIOS_PREFIX + 'checkpoint:' + fecha, secret = c.env.CRON_TOKEN!
    let after = 0, previousFailure = false, work: PreciosTrabajo | undefined
    const explicitCursor = c.req.query('cursor')
    try {
      let cursor = explicitCursor
      if (!cursor && !dryRun) {
        let raw: unknown
        try { raw = await kv.get(checkpointKey) } catch { return c.json({ ...stats, ok: false, errors: 1, error: 'checkpoint_unavailable' }, 503, noStore) }
        if (raw !== null) {
          try {
            if (typeof raw !== 'string' || raw.length > 1024) throw Error('invalid_checkpoint')
            const checkpoint = JSON.parse(raw)
            if (!checkpoint || typeof checkpoint !== 'object' || checkpoint.cursor !== null && typeof checkpoint.cursor !== 'string') throw Error('invalid_checkpoint')
            cursor = checkpoint.cursor || undefined
          } catch { stats.errors++; previousFailure = true }
        }
      }
      const decoded = await preciosLeeCursor(cursor, secret, fecha)
      after = decoded.after; previousFailure ||= decoded.failed; work = decoded.trabajo
    } catch {
      if (explicitCursor !== undefined) return c.json({ ...stats, ok: false, error: 'invalid_cursor' }, 400, noStore)
      // Una rotación del secreto invalida el checkpoint, pero los recibos
      // siguen evitando duplicados. Recupera desde el principio y registra fallo.
      stats.errors++; previousFailure = true
    }
    let lastProcessed = after, more = false, nextWork: PreciosTrabajo | undefined
    try {
      // Nunca se purgan datos en dry-run. El límite hace acotado cada paso.
      if (!dryRun) {
        const cleanup = await c.env.DB!.prepare('DELETE FROM telegram_pending_tokens WHERE token IN (SELECT token FROM telegram_pending_tokens WHERE expires_at < ? ORDER BY expires_at LIMIT 100)').bind(now - 3600000).run()
        if (cleanup.success === false) throw new Error('pending_cleanup_failed')
      }
      const result = await c.env.DB!.prepare('SELECT chat_id, MAX(last_notified_at) AS last_notified_at FROM telegram_subscriptions WHERE chat_id > ? GROUP BY chat_id ORDER BY chat_id LIMIT 2').bind(after).all<{ chat_id: number; last_notified_at: number | null }>()
      const chats = result.results
      if (!Array.isArray(chats) || chats.length > 2 || chats.some((row, i) => !Number.isSafeInteger(row.chat_id) || row.chat_id <= (i ? chats[i - 1].chat_id : after))) throw new Error('invalid_chat_page')
      more = chats.length > 1
      let prices: Awaited<ReturnType<typeof cargaPreciosComparacion>> | null = null
      for (const [position, chatRow] of chats.slice(0, 1).entries()) {
        const chat = chatRow.chat_id
        stats.chats++
        let partial = false, expensive = false
        try {
          if (chatRow.last_notified_at && preciosMadrid(chatRow.last_notified_at).fecha === fecha) { stats.skipped++; stats.processed++; lastProcessed = chat; continue }
          const preference = await preciosPreferencia(kv, chat), subs = await subscriptions(c.env, chat)
          if (!subs.length) { stats.skipped++; stats.processed++; lastProcessed = chat; continue }
          prices ||= await cargaPreciosComparacion(c.env, now)
          const mode = preference?.modo || 'resumen', meta = prices.pareja
          if (mode === 'bajadas' && !meta.anterior) throw new Error('price_reference_unavailable')
          const usuario = await preciosUsuario(chat), comparison = mode === 'bajadas' ? await preciosHash(meta.actual.fechaFuente + '|' + meta.anterior!.fechaFuente) : fecha
          const eventKey = PRECIOS_PREFIX + 'evento:' + usuario + ':' + comparison, dayKey = PRECIOS_PREFIX + 'dia:' + usuario + ':' + fecha, doneKey = eventKey + ':completo', sourceId = mode + ':' + comparison
          const done = await preciosLeer<{ enviado: true }>(kv, doneKey)
          if (done !== null && done.enviado !== true) throw new Error('invalid_receipt')
          if (done) { stats.skipped++; stats.processed++; lastProcessed = chat; continue }
          const dayPlan = await preciosLeer<{ evento: string }>(kv, dayKey)
          if (dayPlan !== null && (!dayPlan || typeof dayPlan.evento !== 'string')) throw new Error('invalid_delivery_plan')
          if (dayPlan && dayPlan.evento !== sourceId) { stats.uncertain++; stats.processed++; lastProcessed = chat; continue }
          // La identidad une versión oficial + favoritas + consentimiento.
          // Un cambio reinicia la preparación; nunca mezcla fotos ni permisos.
          const identity = await preciosHash(prices.snapshotId + '|' + signature(subs) + '|' + JSON.stringify(preference)), preparationKey = PRECIOS_PREFIX + 'preparacion:' + usuario + ':' + fecha + ':' + identity
          const ids = [...new Set(subs.map(row => String(Number(row.station_id))))], buckets = [...new Set(ids.map(id => String(Number(id) % 32).padStart(2, '0')))].sort()
          const currentWork = work?.chat === chat && work.id === identity ? work : undefined
          let preparation: PreciosPreparacion | null = null
          if (!dryRun) {
            preparation = await preciosLeer<PreciosPreparacion>(kv, preparationKey)
            if (preparation !== null && !preparacionValida(preparation, identity, prices.snapshotId, ids, buckets)) throw new Error('invalid_preparation')
          }
          const offset = dryRun ? currentWork?.offset || 0 : preparation?.offset || 0
          expensive = true
          if (offset < buckets.length) {
            // Dos cubos como máximo: también con 100 favoritas repartidas.
            const selected = buckets.slice(offset, offset + 2), selectedIds = ids.filter(id => selected.includes(String(Number(id) % 32).padStart(2, '0')))
            const pair = await prices.estaciones(selectedIds), nextOffset = offset + selected.length
            stats.work += selected.length
            if (!dryRun) {
              preparation = { version: 1, id: identity, snapshot: prices.snapshotId, offset: nextOffset, filas: [...(preparation?.filas || []), ...pair.filas], creado: preparation?.creado || now }
              await kv.put(preparationKey, JSON.stringify(preparation), { expirationTtl: 86400 })
              nextWork = { chat, fase: nextOffset < buckets.length ? 'preparar' : 'enviar', offset: nextOffset < buckets.length ? nextOffset : 0, id: identity }; partial = true
            } else if (nextOffset < buckets.length) {
              nextWork = { chat, fase: 'preparar', offset: nextOffset, id: identity }; partial = true
            }
          } else if (!dryRun && preparation) {
            // La última lectura y el envío usan peticiones distintas. No se
            // necesita escribir ni enviar ninguna muestra para un dry-run.
            const pair = { ...meta, filas: preparation.filas }, messages = mensajesPrecios(pair, subs.map(row => ({ ...row, station_id: String(Number(row.station_id)) })), preference)
            stats.work++
            if (!messages.length) stats.skipped++
            else {
              const hashes = await Promise.all(messages.map(message => preciosHash(message))), oldPlan = await preciosLeer<PreciosPlan>(kv, eventKey)
              if (oldPlan !== null && !preciosPlanValido(oldPlan)) throw new Error('invalid_delivery_plan')
              if (oldPlan && (oldPlan.fuente !== sourceId || JSON.stringify(oldPlan.partes) !== JSON.stringify(hashes))) stats.uncertain++
              else {
                stats.eligible++
                if (!dayPlan) await kv.put(dayKey, JSON.stringify({ evento: sourceId }), receiptOptions)
                if (!oldPlan) await kv.put(eventKey, JSON.stringify({ version: 1, fuente: sourceId, partes: hashes, creado: now } satisfies PreciosPlan), receiptOptions)
                let completed = true, sentThisChat = 0, attempts = 0
                // Recibos confirmados permiten retomar tras un corte incluso
                // si el caller conservó un cursor anterior al último envío.
                for (let i = 0; i < messages.length; i++) {
                  const receiptKey = eventKey + ':' + hashes[i], intentKey = receiptKey + ':intento'
                  const receipt = await preciosLeer<PreciosRecibo>(kv, receiptKey), intent = await preciosLeer<{ intento: number }>(kv, intentKey)
                  if (receipt !== null && !preciosReciboValido(receipt) || intent !== null && !Number.isFinite(intent?.intento)) throw new Error('invalid_receipt')
                  if (receipt?.estado === 'enviado') continue
                  if (receipt?.estado === 'incierto' || intent && (!receipt || intent.intento > receipt.intento)) { stats.uncertain++; completed = false; break }
                  if (receipt?.reintentarDesde && receipt.reintentarDesde > Date.now()) { stats.errors++; completed = false; break }
                  if (attempts >= 2) { nextWork = { chat, fase: 'enviar', offset: i, id: identity }; partial = true; completed = false; break }
                  const latest = await preciosPreferencia(kv, chat), active = await subscriptions(c.env, chat)
                  if (JSON.stringify(latest) !== JSON.stringify(preference) || signature(active) !== signature(subs)) { stats.skipped++; completed = false; break }
                  const intento = Date.now()
                  await kv.put(intentKey, JSON.stringify({ intento }), receiptOptions)
                  attempts++
                  const delivery = await enviarPreciosTelegram(c.env.TELEGRAM_BOT_TOKEN!, chat, messages[i])
                  if (delivery.estado === 'baja') {
                    const deleted = await c.env.DB!.prepare('DELETE FROM telegram_subscriptions WHERE chat_id = ?').bind(chat).run()
                    if (deleted.success === false) throw new Error('cancel_failed')
                    await borrarPreferenciaPrecios(c.env, chat); await borrarItvTelegram(c.env, chat)
                    stats.purged++; completed = false; break
                  }
                  if (delivery.estado === 'enviado') { stats.sentMsgs++; sentThisChat++ }
                  await kv.put(receiptKey, JSON.stringify({ estado: delivery.estado, intento, ...(delivery.estado === 'reintentar' ? { reintentarDesde: Date.now() + (delivery.espera || 3600) * 1000 } : {}) } satisfies PreciosRecibo), receiptOptions)
                  if (delivery.estado !== 'enviado') { if (delivery.estado === 'incierto') stats.uncertain++; else stats.errors++; completed = false; break }
                }
                if (completed) {
                  await kv.put(doneKey, JSON.stringify({ enviado: true }), receiptOptions)
                  const updated = await c.env.DB!.prepare('UPDATE telegram_subscriptions SET last_notified_at = ? WHERE chat_id = ?').bind(Date.now(), chat).run()
                  if (updated.success === false) throw new Error('delivery_stamp_failed')
                }
                if (sentThisChat && completed) stats.sentChats++
              }
            }
          } else if (!dryRun) throw new Error('missing_preparation')
        } catch { stats.errors++ }
        if (!partial) { stats.processed++; lastProcessed = chat }
        // Sólo un chat consume lecturas/creación de mensajes en cada petición.
        if (expensive || partial) { more = partial || position + 1 < chats.length; break }
      }
      const failed = previousFailure || stats.errors > 0 || stats.uncertain > 0
      if (more) { stats.nextCursor = await preciosCursor(lastProcessed, secret, fecha, failed, nextWork); stats.deferred = 1 }
      if (!dryRun) await kv.put(checkpointKey, JSON.stringify({ cursor: stats.nextCursor }), receiptOptions)
      stats.ok = !failed
    } catch { stats.errors++; stats.ok = false }
    if (!stats.ok) slog('warn', 'telegram_prices_batch_failed', { errors: stats.errors, uncertain: stats.uncertain, dryRun })
    return c.json(stats, stats.ok ? 200 : 503, noStore)
  })
}
