import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
afterEach(() => { vi.restoreAllMocks() })

describe('resumen diario seguro y comprobación sin mensajes reales', () => {
  const now = Date.parse('2026-11-21T07:30:00Z')
  function fixture(fecha = '21/11/2026 08:00:00', last: number | null = null, telegramStatus = 200) {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const run = vi.fn(async () => ({ success: true }))
    const all = vi.fn(async () => ({ results: [{ chat_id: 123, station_id: '100', fuel_code: '95', last_notified_at: last }] }))
    const prepare = vi.fn((sql: string) => ({ bind: () => ({ run }), all }))
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/data/stations.json')) return new Response(JSON.stringify({ Fecha: fecha,
        ListaEESSPrecio: [{ IDEESS: '100', Rotulo: 'Prueba local', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,500' }],
      }))
      if (url.startsWith('https://api.telegram.org/botfake-test-only/')) return new Response(JSON.stringify({ ok: telegramStatus === 200 }), { status: telegramStatus })
      throw new Error('Red no permitida en esta prueba')
    })
    const env = { CRON_TOKEN: 'test-cron', TELEGRAM_BOT_TOKEN: 'fake-test-only', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'fake-webhook-test', DB: { prepare } }
    const request = (query = '') => app.request('/api/cron/telegram-check' + query, { method: 'POST', headers: { Authorization: 'Bearer test-cron' } }, env)
    return { request, run, all, prepare, fetcher, telegramCalls: () => fetcher.mock.calls.filter(([url]) => new URL(url instanceof Request ? url.url : String(url)).origin === 'https://api.telegram.org') }
  }
  it('dry-run calcula elegibles fuera de ventana, sin enviar ni escribir D1', async () => {
    const f = fixture(); vi.mocked(Date.now).mockReturnValue(now + 10 * 3600000)
    const res = await f.request('?dry_run=1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true, inWindow: false, eligible: 1, sentChats: 0, sentMsgs: 0 })
    expect(f.run).not.toHaveBeenCalled(); expect(f.telegramCalls()).toHaveLength(0)
    expect(f.prepare.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
  })
  it.each(['19/11/2026 08:00:00', '22/11/2026 08:00:00', '', '31/11/2026 08:00:00'])('rechaza fecha de precios antigua, futura o inválida: %s', async fecha => {
    const f = fixture(fecha), res = await f.request('?dry_run=1')
    expect(res.status).toBe(503); expect(await res.json()).toMatchObject({ error: 'snapshot_stale' })
    expect(f.telegramCalls()).toHaveLength(0); expect(f.run).not.toHaveBeenCalled()
  })
  it('modo normal mantiene deduplicación aunque el workflow se dispare manualmente', async () => {
    const f = fixture('21/11/2026 08:00:00', now - 1000), res = await f.request()
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ sentChats: 0, skipped: 1 })
    expect(f.telegramCalls()).toHaveLength(0)
  })
  it('fuera de ventana no trata de enviar ni cargar el snapshot', async () => {
    const f = fixture(); vi.mocked(Date.now).mockReturnValue(now + 10 * 3600000)
    expect(await (await f.request()).json()).toMatchObject({ skipped: 'not_digest_window' })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('los errores de Telegram no se publican como ejecución exitosa', async () => {
    const f = fixture('21/11/2026 08:00:00', null, 429), res = await f.request()
    expect(res.status).toBe(503); expect(await res.json()).toMatchObject({ ok: false, errors: 1, sentChats: 0 })
    expect(f.telegramCalls()).toHaveLength(1)
    expect(f.prepare.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  })
  it('un fallo al guardar la entrega tampoco devuelve éxito', async () => {
    const f = fixture()
    f.run.mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('test: D1 unavailable'))
    const res = await f.request()
    expect(res.status).toBe(503); expect(await res.json()).toMatchObject({ ok: false, errors: 1, sentChats: 1 })
  })
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

  it('POST /api/telegram/toggle-fav -> 413 con cuerpo > límite (H4 bodyLimit)', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(5 * 1024) })  // > 4 KB
    const res = await app.request('/api/telegram/toggle-fav', { method: 'POST', body: big }, {})
    expect(res.status).toBe(413)
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
