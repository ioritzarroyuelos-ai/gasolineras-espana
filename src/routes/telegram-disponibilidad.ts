import type { Hono } from 'hono'
import type { Env } from '../index'
import { jsonBodyLimit } from '../lib/runtime'
import { itvChatAutorizado as telegramChatAutorizado } from '../lib/telegram-itv'
import type { DisponibilidadRespuesta } from '../lib/disponibilidad-telegram'
import { disponibilidadSolicitud } from '../../scripts/lib/disponibilidad.mjs'

export function registerTelegramDisponibilidadRoutes(app: Hono<{ Bindings: Env }>) {
  const path = '/api/telegram/disponibilidad'
  app.use(path + '*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.get(path + '/config', async c => {
    let service = null
    try { service = c.env.DISPONIBILIDAD ? await c.env.DISPONIBILIDAD.estado() : null } catch {}
    const reachable = service?.schema === 1 && service.revision === 'disponibilidad-v1'
    const healthy = reachable && service?.gatewayRevision === 'disponibilidad-gateway-v1' && service?.habilitado && service?.configurado
    return c.json({ manageAvailable: reachable, available: !!(healthy && c.env.DISPONIBILIDAD_ENABLED === 'true' && c.env.TELEGRAM_BOT_TOKEN && c.env.TELEGRAM_BOT_USERNAME && c.env.TELEGRAM_WEBHOOK_SECRET),
      serviceVersion: service?.versionId || null, serviceEnabled: reachable && typeof service?.habilitado === 'boolean' ? service.habilitado : null,
      linkAvailable: !!c.env.DB, modos: ['diario', 'temporal'], zona: 'Europe/Madrid', intervaloMinutos: 5, temporalMinutos: 60, maximoPorModo: 1 })
  })
  const respond = (result: DisponibilidadRespuesta) => {
    const { status, ...body } = result
    return Response.json(body, { status: [200, 400, 401, 409, 429, 503].includes(status) ? status : 503, headers: { 'Cache-Control': 'no-store' } })
  }
  app.get(path, async c => {
    const chat = await telegramChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    if (!c.env.DISPONIBILIDAD) return c.json({ ok: false, error: 'availability_disabled' }, 503)
    try { return respond(await c.env.DISPONIBILIDAD.leer(chat)) }
    catch { return c.json({ ok: false, error: 'availability_unavailable' }, 503) }
  })
  app.put(path + '/:modo', jsonBodyLimit(2048), async c => {
    const chat = await telegramChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    if (!c.env.DISPONIBILIDAD || c.env.DISPONIBILIDAD_ENABLED !== 'true') return c.json({ ok: false, error: 'availability_disabled' }, 503)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ ok: false, error: 'invalid_json' }, 400) }
    const mode = c.req.param('modo') || ''
    if (!disponibilidadSolicitud(body, mode)) return c.json({ ok: false, error: 'invalid_subscription' }, 400)
    try { return respond(await c.env.DISPONIBILIDAD.guardar(chat, mode, body)) }
    catch { return c.json({ ok: false, error: 'availability_unavailable' }, 503) }
  })
  app.delete(path + '/:modo', async c => {
    const chat = await telegramChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    const mode = c.req.param('modo') || ''
    if (!['diario', 'temporal'].includes(mode)) return c.json({ ok: false, error: 'invalid_mode' }, 400)
    if (!c.env.DISPONIBILIDAD) return c.json({ ok: false, error: 'availability_disabled' }, 503)
    try { return respond(await c.env.DISPONIBILIDAD.cancelar(chat, mode)) }
    catch { return c.json({ ok: false, error: 'availability_unavailable' }, 503) }
  })
  app.post(path + '/dry-run', async c => {
    const chat = await telegramChatAutorizado(c.req.header('Authorization'), c.env)
    if (chat === null) return c.json({ ok: false, error: 'unauthorized' }, 401)
    if (!c.env.DISPONIBILIDAD) return c.json({ ok: false, error: 'availability_disabled' }, 503)
    try { return respond(await c.env.DISPONIBILIDAD.comprobar(chat)) }
    catch { return c.json({ ok: false, error: 'availability_unavailable' }, 503) }
  })
}
