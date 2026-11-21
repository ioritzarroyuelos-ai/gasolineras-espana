import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error SQLite de Node sólo se usa para probar las sentencias D1 reales.
import { DatabaseSync } from 'node:sqlite'
import type { Env } from '../src/index'
import { signTelegramToken } from '../src/lib/auth'
import { registerTelegramRoutes } from '../src/routes/telegram'
import { construyePreciosComparacion } from '../scripts/lib/precios-comparacion.mjs'

const NOW = Date.parse('2026-11-21T09:00:00.000Z'), databases: Array<{ close: () => void }> = []
function fixture(count = 0) {
  const db = new DatabaseSync(':memory:'); databases.push(db)
  db.exec(`CREATE TABLE telegram_subscriptions (chat_id INTEGER NOT NULL, station_id TEXT NOT NULL, fuel_code TEXT NOT NULL, threshold_cents INTEGER NOT NULL, baseline_cents INTEGER, created_at INTEGER NOT NULL, last_notified_at INTEGER, PRIMARY KEY(chat_id,station_id,fuel_code));
    CREATE TABLE telegram_pending_tokens (token TEXT PRIMARY KEY, chat_id INTEGER, confirmed_at INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, favs_json TEXT, threshold_cents INTEGER);`)
  for (let i = 0; i < count; i++) db.prepare('INSERT INTO telegram_subscriptions VALUES (101, ?, ?, 20, 1499, ?, ?)').run(String(i + 1), '95', NOW - 86400000, NOW - 1000)
  const prepare = vi.fn((sql: string) => {
    let args: unknown[] = []
    const statement = { bind: (...values: unknown[]) => { args = values; return statement },
      all: async () => ({ results: db.prepare(sql).all(...args), success: true }),
      execute: () => { const result = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } } },
      run: async () => statement.execute() }
    return statement
  })
  const batch = vi.fn(async (statements: Array<{ execute: () => unknown }>) => {
    db.exec('BEGIN')
    try { const results = statements.map(s => s.execute()); db.exec('COMMIT'); return results }
    catch (error) { db.exec('ROLLBACK'); throw error }
  })
  const app = new Hono<{ Bindings: Env }>(); registerTelegramRoutes(app)
  const env = { DB: { prepare, batch }, TELEGRAM_BOT_TOKEN: 'test-bot-only', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-only', SESSION_SECRET: 'test-session-only', PUBLIC_ORIGIN: 'https://local.test' } as unknown as Env
  const messages: string[] = []
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) === 'https://api.telegram.org/bottest-bot-only/sendMessage') { messages.push(JSON.parse(String(init?.body)).text); return Response.json({ ok: true }) }
    throw Error('La prueba prohíbe red real: ' + input)
  })
  const toggle = async (id: unknown, enabled = true, fuel = '95') => app.request('/api/telegram/toggle-fav', { method: 'POST', headers: { Authorization: 'Bearer ' + await signTelegramToken(101, env.SESSION_SECRET!), 'Content-Type': 'application/json' }, body: JSON.stringify({ station_id: id, fuel_code: fuel, enabled }) }, env)
  const start = (favs: unknown[]) => app.request('/api/telegram/start-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favs }) }, env)
  const bind = async (favs: unknown[], token = 'token-test') => {
    db.prepare('INSERT INTO telegram_pending_tokens VALUES (?, NULL, NULL, ?, ?, ?, 10)').run(token, NOW, NOW + 600000, JSON.stringify(favs))
    return app.request('/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': env.TELEGRAM_WEBHOOK_SECRET! }, body: JSON.stringify({ message: { chat: { id: 101 }, text: '/start ' + token } }) }, env)
  }
  return { db, prepare, batch, toggle, start, bind, messages, fetcher, env, count: () => Number(db.prepare('SELECT COUNT(*) AS n FROM telegram_subscriptions').get().n) }
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW) })
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close() })

describe('límite atómico de avisos por chat, con SQL real', () => {
  it('no acepta el aviso101 ni envía una confirmación falsa', async () => {
    const f = fixture(100), response = await f.toggle('101')
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: 'subscription_limit', limit: 100, message: expect.stringContaining('Desactiva alguno') })
    expect(f.count()).toBe(100); expect(f.messages).toEqual([])
  })
  it('dos altas concurrentes compiten por una única plaza sin superar100', async () => {
    const f = fixture(99), responses = await Promise.all([f.toggle('100'), f.toggle('101')])
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]); expect(f.count()).toBe(100); expect(f.messages).toHaveLength(1)
  })
  it('dos altas de la misma identidad sólo insertan y confirman una vez', async () => {
    const f = fixture(99), responses = await Promise.all([f.toggle('100'), f.toggle('100')])
    expect(responses.map(r => r.status)).toEqual([200, 200]); expect(f.count()).toBe(100); expect(f.messages).toHaveLength(1)
    expect((await Promise.all(responses.map(r => r.json()))).map(x => x.status).sort()).toEqual(['already_enabled', 'enabled'])
  })
  it('la idempotencia al límite conserva el último envío y todos los campos existentes', async () => {
    const f = fixture(100), before = f.db.prepare('SELECT * FROM telegram_subscriptions WHERE station_id = ?').get('1')
    expect(await (await f.toggle('1')).json()).toMatchObject({ status: 'already_enabled' })
    expect(f.db.prepare('SELECT * FROM telegram_subscriptions WHERE station_id = ?').get('1')).toEqual(before); expect(f.messages).toEqual([])
  })
  it('pausar libera una plaza y cambiar de combustible ocupa otra suscripción', async () => {
    const f = fixture(100); expect((await f.toggle('1', true, '98')).status).toBe(409)
    expect((await f.toggle('1', false)).status).toBe(200); expect((await f.toggle('1', true, '98')).status).toBe(200); expect(f.count()).toBe(100)
  })
  it('revincular conserva las filas anteriores y explica exactamente las omitidas', async () => {
    const f = fixture(99), before = f.db.prepare('SELECT * FROM telegram_subscriptions WHERE station_id = ?').get('1')
    const result = await f.bind([{ station_id: '1', fuel_code: '95' }, { station_id: '100', fuel_code: '95' }, { station_id: '101', fuel_code: '95' }])
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ added: 1, alreadyActive: 1, limited: 1, failed: 0 })
    expect(f.count()).toBe(100); expect(f.db.prepare('SELECT * FROM telegram_subscriptions WHERE station_id = ?').get('1')).toEqual(before)
    expect(f.messages[0]).toContain('1 avisos añadidos y 1 que ya estaban activos'); expect(f.messages[0]).toContain('No se han añadido 1 avisos')
  })
  it('dos vinculaciones simultáneas tampoco ocupan a la vez la última plaza', async () => {
    const f = fixture(99), results = await Promise.all([f.bind([{ station_id: '100', fuel_code: '95' }], 'token-a'), f.bind([{ station_id: '101', fuel_code: '95' }], 'token-b')])
    expect(f.count()).toBe(100); expect((await Promise.all(results.map(r => r.json()))).map(x => x.limited).sort()).toEqual([0, 1])
    expect(f.messages.filter(text => text.includes('No se han añadido'))).toHaveLength(1)
  })
})
describe('identificadores y cola de vinculación', () => {
  it('toggle lee sólo índice y un cubo validado, sin cargar el catálogo completo', async () => {
    const f = fixture(), bundle = await construyePreciosComparacion({ Fecha: '21/11/2026 10:00:00', ListaEESSPrecio: [{ IDEESS: '100', 'Rótulo': 'Nombre oficial <seguro>', Municipio: 'Bilbao', 'Precio Gasolina 95 E5': '1,399' }] }, { now: new Date(NOW) })
    const files = new Map([['index.json', JSON.stringify(bundle.index)], ...bundle.artifacts.map(a => [a.archivo, a.content] as [string, string])])
    const assets = vi.fn(async (request: Request) => new Response(files.get(new URL(request.url).pathname.replace('/data/precios-comparacion/', ''))))
    f.env.ASSETS = { fetch: assets } as unknown as Env['ASSETS']
    expect((await f.toggle('100')).status).toBe(200); expect(assets).toHaveBeenCalledTimes(2)
    expect(f.messages[0]).toContain('Nombre oficial &lt;seguro&gt;'); expect(f.messages[0]).toContain('Bilbao')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['0', '-1', '1.5', '1e3', '1000000000', 'abc', '', 100, null])('rechazaID fuera del contrato %j sin mutar ni enviar', async id => {
    const f = fixture(); expect((await f.toggle(id)).status).toBe(400); expect((await f.start([{ station_id: id, fuel_code: '95' }])).status).toBe(400)
    expect(f.count()).toBe(0); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled()
  })
  it('normaliza y deduplica antes de vincular sin reutilizar precio del navegador', async () => {
    const f = fixture(), response = await f.start([{ station_id: '00123', fuel_code: '95', baseline_cents: 1 }, { station_id: '123', fuel_code: '95' }])
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ favs_queued: 1 })
    expect(JSON.parse(f.db.prepare('SELECT favs_json FROM telegram_pending_tokens').get().favs_json)).toEqual([{ station_id: '123', fuel_code: '95', baseline_cents: null }]); expect(f.messages).toEqual([])
  })
  it('rechaza una cola inicial mayor de100 antes de crear token', async () => {
    const f = fixture(), response = await f.start(Array.from({ length: 101 }, (_, i) => ({ station_id: String(i + 1), fuel_code: '95' })))
    expect(response.status).toBe(409); expect(f.prepare).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('una confirmación de100 avisos permanece dentro del tamaño de Telegram', async () => {
    const f = fixture(), response = await f.bind(Array.from({ length: 100 }, (_, i) => ({ station_id: String(i + 1), fuel_code: '95' })))
    expect(await response.json()).toMatchObject({ added: 100, limited: 0 }); expect(f.messages[0].length).toBeLessThanOrEqual(4096); expect(f.messages[0]).toContain('lista completa en la web')
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    expect(f.batch).toHaveBeenCalledTimes(1); expect(f.batch.mock.calls[0][0]).toHaveLength(100)
  })
})
