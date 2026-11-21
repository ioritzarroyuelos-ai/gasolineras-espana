import type { Hono } from 'hono'
import type { Env } from '../index'
import { authorizeCron, jsonBodyLimit, slog } from '../lib/runtime'
import { ITV_CONSENTIMIENTO, ITV_PREFIX, borrarItvTelegram, enviarItvTelegram, itvAvisoKey, itvAvisoValido, itvChatAutorizado, itvEventoKey, itvEventoValido, itvEventos, itvFechaAdmitida, itvFechaDesplazada, itvIntentoKey, itvLeer, itvMadrid, itvReciboKey, itvReciboValido, itvTtl, itvUsuario, itvVentanas } from '../lib/telegram-itv'
import type { ItvAviso, ItvEvento, ItvRecibo } from '../lib/telegram-itv'

const noStore = { 'Cache-Control': 'no-store' }
const configured = (env: Env) => !!(env.USER_DATA && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME && env.TELEGRAM_WEBHOOK_SECRET)
const publicReminder = (item: ItvAviso | null, delivered: number[] = []) => item ? { fecha: item.fecha, consentimiento: item.consentimiento, actualizado: item.actualizado, dias: [7, 1], ventanas: itvVentanas(item.fecha).filter(window => !delivered.includes(window.dias)) } : null

export function registerTelegramItvRoutes(app: Hono<{ Bindings: Env }>): void {
  app.use('/api/telegram/itv-recordatorio*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.get('/api/telegram/itv-recordatorio/config', c => c.json({ available: configured(c.env), linkAvailable: configured(c.env) && !!c.env.DB }))

  app.get('/api/telegram/itv-recordatorio', async c => {
    if (!configured(c.env)) return c.json({ ok: false, error: 'itv_telegram_not_configured' }, 503)
    const chat = await itvChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    try {
      const usuario = await itvUsuario(chat), item = await itvLeer<ItvAviso>(c.env.USER_DATA!, itvAvisoKey(usuario))
      if (item !== null && (!itvAvisoValido(item) || item.chat !== chat)) throw new Error('invalid_reminder')
      const avisos = item ? await Promise.all(itvEventos(usuario, item).map(async event => {
        const receipt = await itvLeer<ItvRecibo>(c.env.USER_DATA!, itvReciboKey(event))
        const intent = await itvLeer<ItvRecibo>(c.env.USER_DATA!, itvIntentoKey(event))
        if ((receipt !== null && !itvReciboValido(receipt)) || (intent !== null && !itvReciboValido(intent))) throw new Error('invalid_receipt')
        const estado = receipt?.estado === 'enviado' ? 'enviado' : intent && (!receipt || intent.intento > receipt.intento) ? 'incierto' : receipt?.estado || 'programado'
        return { dias: event.dias, fecha: itvFechaDesplazada(item.fecha, -event.dias), estado }
      })) : []
      return c.json({ ok: true, recordatorio: publicReminder(item, avisos.filter(event => event.estado === 'enviado').map(event => event.dias)), avisos })
    } catch { return c.json({ ok: false, error: 'reminder_unavailable' }, 503) }
  })

  app.put('/api/telegram/itv-recordatorio', jsonBodyLimit(1024), async c => {
    if (!configured(c.env)) return c.json({ ok: false, error: 'itv_telegram_not_configured' }, 503)
    const chat = await itvChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['fecha', 'consentimiento'].includes(key))) return c.json({ ok: false, error: 'invalid_reminder' }, 400)
    const input = body as { fecha?: unknown; consentimiento?: unknown }
    if (input.consentimiento !== ITV_CONSENTIMIENTO || !itvFechaAdmitida(input.fecha)) return c.json({ ok: false, error: 'invalid_date_or_consent' }, 400)
    const windows = itvVentanas(input.fecha)
    if (!windows.length) return c.json({ ok: false, error: 'no_future_windows' }, 400)
    try {
      const kv = c.env.USER_DATA!, usuario = await itvUsuario(chat), key = itvAvisoKey(usuario)
      const old = await itvLeer<ItvAviso>(kv, key)
      if (old !== null && (!itvAvisoValido(old) || old.chat !== chat)) throw new Error('invalid_reminder')
      // Repeating the same explicit consent must not generate fresh event IDs.
      if (old?.fecha === input.fecha) {
        const delivered: number[] = []
        for (const event of itvEventos(usuario, old)) if ((await itvLeer<ItvRecibo>(kv, itvReciboKey(event)))?.estado === 'enviado') delivered.push(event.dias)
        return c.json({ ok: true, recordatorio: publicReminder(old, delivered) })
      }
      const item: ItvAviso = { version: 1, id: crypto.randomUUID(), chat, fecha: input.fecha, consentimiento: ITV_CONSENTIMIENTO, actualizado: new Date().toISOString() }
      const expirationTtl = itvTtl(item.fecha)
      for (const event of itvEventos(usuario, item)) if (windows.some(window => window.dias === event.dias)) {
        await kv.put(itvEventoKey(event), JSON.stringify(event), { expirationTtl })
      }
      // A partially written index never activates consent. Existing consent
      // remains intact if either of the queue writes fails.
      await kv.put(key, JSON.stringify(item), { expirationTtl })
      if (old) for (const event of itvEventos(usuario, old)) {
        try { await kv.delete(itvEventoKey(event)) } catch { /* mismatched revision cannot send; TTL removes orphan */ }
      }
      return c.json({ ok: true, recordatorio: publicReminder(item) })
    } catch { return c.json({ ok: false, error: 'reminder_unavailable' }, 503) }
  })

  app.delete('/api/telegram/itv-recordatorio', async c => {
    const chat = await itvChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    if (!c.env.USER_DATA) return c.json({ ok: false, error: 'reminder_unavailable' }, 503)
    try { await borrarItvTelegram(c.env, chat); return c.json({ ok: true, recordatorio: null }) }
    catch { return c.json({ ok: false, error: 'reminder_unavailable' }, 503) }
  })

  app.post('/api/cron/telegram-itv', async c => {
    const auth = await authorizeCron(c)
    if (!auth.ok) return c.json(auth.body, auth.status as 401 | 503, noStore)
    if (!configured(c.env)) return c.json({ ok: false, error: 'itv_telegram_not_configured' }, 503, noStore)
    const dryRun = c.req.query('dry_run') === '1', cursor = c.req.query('cursor')
    if (cursor && cursor.length > 2048) return c.json({ ok: false, error: 'invalid_cursor' }, 400, noStore)
    const { fecha, hora } = itvMadrid(), inWindow = hora >= 8 && hora < 12
    const stats = { ok: true, dryRun, inWindow, processed: 0, eligible: 0, sent: 0, skipped: 0, errors: 0, uncertain: 0, nextCursor: null as string | null }
    if (!dryRun && !inWindow) return c.json({ ...stats, skipped: 'not_reminder_window' }, 200, noStore)
    const kv = c.env.USER_DATA!
    try {
      const listed = await kv.list({ prefix: ITV_PREFIX + 'dia:' + fecha + ':', limit: 5, ...(cursor ? { cursor } : {}) })
      if (!listed.list_complete) {
        if (!listed.cursor || listed.cursor === cursor) throw new Error('invalid_cursor')
        stats.nextCursor = listed.cursor
      }
      for (const key of listed.keys.slice(0, 5)) {
        stats.processed++
        try {
          const event = await itvLeer<ItvEvento>(kv, key.name)
          if (!itvEventoValido(event) || itvEventoKey(event) !== key.name || itvFechaDesplazada(event.fecha, -event.dias) !== fecha) { stats.skipped++; continue }
          const item = await itvLeer<ItvAviso>(kv, itvAvisoKey(event.usuario))
          if (!itvAvisoValido(item) || item.id !== event.id || item.fecha !== event.fecha || await itvUsuario(item.chat) !== event.usuario) {
            stats.skipped++; if (!dryRun) await kv.delete(key.name); continue
          }
          const receiptKey = itvReciboKey(event), receipt = await itvLeer<ItvRecibo>(kv, receiptKey)
          const intent = await itvLeer<ItvRecibo>(kv, itvIntentoKey(event))
          if ((receipt !== null && !itvReciboValido(receipt)) || (intent !== null && !itvReciboValido(intent))) throw new Error('invalid_receipt')
          if (receipt?.estado === 'enviado') { stats.skipped++; if (!dryRun) await kv.delete(key.name); continue }
          if (intent && (!receipt || intent.intento > receipt.intento)) { stats.uncertain++; continue }
          if (receipt?.estado === 'pendiente' || receipt?.estado === 'incierto') { stats.uncertain++; continue }
          if (receipt?.reintentarDesde && receipt.reintentarDesde > Date.now()) { stats.errors++; continue }
          stats.eligible++
          if (dryRun) continue
          // Await the intent before any external side effect. The workflow is
          // serialized; KV itself is eventually consistent, not an atomic lock.
          const intento = Date.now(), options = { expirationTtl: 30 * 86400 }
          await kv.put(itvIntentoKey(event), JSON.stringify({ estado: 'pendiente', intento } satisfies ItvRecibo), options)
          const result = await enviarItvTelegram(c.env.TELEGRAM_BOT_TOKEN!, item, event.dias)
          if (result.estado === 'baja') { await borrarItvTelegram(c.env, item.chat); stats.skipped++; continue }
          if (result.estado === 'enviado') stats.sent++
          const next: ItvRecibo = { estado: result.estado, intento, ...(result.estado === 'reintentar' ? { reintentarDesde: Date.now() + (result.espera || 3600) * 1000 } : {}) }
          await kv.put(receiptKey, JSON.stringify(next), options)
          if (result.estado === 'enviado') { await kv.delete(key.name) }
          else if (result.estado === 'incierto') stats.uncertain++
          else stats.errors++
        } catch { stats.errors++ }
      }
    } catch { stats.errors++ }
    stats.ok = stats.errors === 0 && stats.uncertain === 0
    if (!stats.ok) slog('warn', 'telegram_itv_batch_failed', { errors: stats.errors, uncertain: stats.uncertain, dryRun })
    return c.json(stats, stats.ok ? 200 : 503, noStore)
  })
}
