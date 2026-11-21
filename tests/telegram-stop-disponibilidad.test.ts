import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTelegramRoutes } from '../src/routes/telegram'
import type { Env } from '../src/index'

function fixture(failure = '') {
  const run = vi.fn(async () => { if (failure === 'db') throw Error('db-fallida'); return { meta: { changes: 1 } } })
  const statement = { bind: () => statement, run }
  const cancel = vi.fn(async () => { if (failure === 'do') throw Error('do-caido'); return { ok: true, status: 200, avisos: [] } })
  const del = vi.fn(async () => { if (failure === 'kv') throw Error('kv-caido') })
  const env = { DB: failure === 'sin-db' ? undefined : { prepare: () => statement }, USER_DATA: { get: async () => null, delete: del },
    DISPONIBILIDAD: { cancelar: cancel }, DISPONIBILIDAD_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 'fixture-stop', TELEGRAM_BOT_USERNAME: 'fixture', TELEGRAM_WEBHOOK_SECRET: 'fixture-secret' } as unknown as Env
  const sends = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    if (String(input) !== 'https://api.telegram.org/botfixture-stop/sendMessage') throw Error('La prueba prohíbe red real')
    return Response.json({ ok: true })
  })
  const app = new Hono<{ Bindings: Env }>(); registerTelegramRoutes(app)
  const stop = (secret = 'fixture-secret') => app.request('/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ message: { chat: { id: 10 }, text: '/stop' } }) }, env)
  return { stop, cancel, del, run, sends }
}
afterEach(() => vi.restoreAllMocks())
describe('/stop cancela cada servicio de forma independiente', () => {
  it('permite la baja con activación pausada', async () => {
    const f = fixture(); expect((await f.stop()).status).toBe(200)
    expect(f.cancel).toHaveBeenCalledWith(10); expect(f.run).toHaveBeenCalledOnce(); expect(f.del).toHaveBeenCalledTimes(2); expect(f.sends).toHaveBeenCalledOnce()
  })
  for (const failure of ['db', 'sin-db', 'kv', 'do']) it('intenta todas las bajas y no confirma falsamente ante ' + failure, async () => {
    const f = fixture(failure), response = await f.stop()
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: 'cancel_pending' })
    expect(f.cancel).toHaveBeenCalledWith(10); expect(f.del).toHaveBeenCalledTimes(2); expect(f.sends).not.toHaveBeenCalled()
    if (failure !== 'sin-db') expect(f.run).toHaveBeenCalledOnce()
  })
  it('un webhook falso no cancela ningún servicio', async () => {
    const f = fixture(); expect((await f.stop('falso')).status).toBe(401)
    expect(f.cancel).not.toHaveBeenCalled(); expect(f.del).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.sends).not.toHaveBeenCalled()
  })
})
