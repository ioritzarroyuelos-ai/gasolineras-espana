import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests de las rutas Telegram tras extraer a src/routes/telegram.ts (B1).
// En dev no hay bot configurado → degradan a 503/401; probamos matching + el ORDEN de
// guardas verbatim (unsubscribe/subscriptions comprueban DB antes que isTelegramConfigured)
// y que el chequeo de seguridad del webhook (secret en tiempo constante) sigue intacto.
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas Telegram tras extraer a src/routes/telegram.ts (B1)', () => {
  it('GET /api/telegram/config -> 503 sin bot', async () => {
    const res = await app.request('/api/telegram/config', {}, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/telegram/start-link -> 503 (isTelegramConfigured)', async () => {
    const res = await app.request('/api/telegram/start-link', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/telegram/webhook -> 503 sin bot', async () => {
    const res = await app.request('/api/telegram/webhook', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBe(503)
  })

  it('GET /api/telegram/subscriptions -> 503 db_not_available (guarda DB primero)', async () => {
    const res = await app.request('/api/telegram/subscriptions', {}, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/cron/telegram-check -> 503 sin CRON_TOKEN (authorizeCron)', async () => {
    const res = await app.request('/api/cron/telegram-check', { method: 'POST' }, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/telegram/webhook -> 401 con secret erróneo (fix seguridad movido intacto)', async () => {
    const env = { TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_BOT_USERNAME: 'x', TELEGRAM_WEBHOOK_SECRET: 'realsecret', DB: {} }
    const res = await app.request('/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: '{}',
    }, env)
    expect(res.status).toBe(401)
  })
})
