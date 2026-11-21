import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/index'
import { signTelegramToken } from '../src/lib/auth'
import { registerTelegramPreciosRoutes } from '../src/routes/telegram-precios'
import { PRECIOS_CONSENTIMIENTO, mensajesPrecios, preciosCursor, preciosLeeCursor, preciosMadrid, preciosPreferenciaKey, preciosUsuario } from '../src/lib/telegram-precios'
import type { PreciosPareja, PreciosPreferencia } from '../src/lib/telegram-precios'

const NOW = Date.parse('2026-11-21T08:30:00Z')
const snapshot = (): PreciosPareja => ({ schema: 1, consultado: '2026-11-21T08:10:00.000Z', actual: { fechaFuente: '2026-11-21T08:00:05.000Z', fechaMinisterio: '21/11/2026 09:00:05', consultado: '2026-11-21T08:10:00.000Z' }, anterior: { fechaFuente: '2026-11-20T20:00:05.000Z', fechaMinisterio: '20/11/2026 21:00:05', consultado: '2026-11-20T20:10:00.000Z' }, filas: [['100', 'Estación de prueba', 'Municipio de prueba', [1500, 1600, 1400, null], [1520, 1590, 1400, null]]] })
const preference = (modo: 'resumen' | 'bajadas' = 'bajadas'): PreciosPreferencia => ({ version: 1, chat: 101, modo, umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO, actualizado: new Date(NOW).toISOString() })
function memoryKv() {
  const values = new Map<string, string>()
  return { values, get: vi.fn(async (key: string) => values.get(key) ?? null), put: vi.fn(async (key: string, value: string) => { values.set(key, value) }), delete: vi.fn(async (key: string) => { values.delete(key) }), list: vi.fn(async () => ({ keys: [], list_complete: true })) }
}
function fixture() {
  const kv = memoryKv(), app = new Hono<{ Bindings: Env }>()
  registerTelegramPreciosRoutes(app)
  const env = { USER_DATA: kv, SESSION_SECRET: 'test-only-secret', TELEGRAM_BOT_TOKEN: 'test-only-bot', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'test-only-webhook', CRON_TOKEN: 'test-only-cron', DB: { prepare: vi.fn() } } as unknown as Env
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('La prueba prohíbe cualquier red real'))
  const request = async (method: string, body?: unknown, chat = 101) => app.request('/api/telegram/precios', { method, headers: { Authorization: 'Bearer ' + await signTelegramToken(chat, env.SESSION_SECRET!), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  return { app, env, kv, request, fetcher }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('consentimiento separado para bajar precios', () => {
  it('el usuario antiguo mantiene resumen sin crear consentimiento ni enviar', async () => {
    const f = fixture(), response = await f.request('GET')
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ preferencia: { modo: 'resumen', consentimiento: null, umbralMilesimas: 10 } })
    expect(f.kv.put).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('elige bajadas con umbral sin Google ni base aportada por navegador', async () => {
    const f = fixture(), body = { modo: 'bajadas', umbralMilesimas: 20, consentimiento: PRECIOS_CONSENTIMIENTO }
    const response = await f.request('PUT', body)
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ preferencia: body })
    expect(f.kv.values.size).toBe(1); expect(f.fetcher).not.toHaveBeenCalled(); expect(f.env.DB!.prepare).not.toHaveBeenCalled()
    expect(JSON.stringify(await (await f.request('GET')).json())).not.toMatch(/chat|secret/)
    expect(await (await f.request('GET', undefined, 202)).json()).toMatchObject({ preferencia: { modo: 'resumen', consentimiento: null } })
    await f.request('PUT', body); expect(f.kv.put).toHaveBeenCalledTimes(1)
  })
  it.each([
    { modo: 'bajadas', umbralMilesimas: 10 }, { modo: 'bajadas', umbralMilesimas: 0, consentimiento: PRECIOS_CONSENTIMIENTO },
    { modo: 'bajadas', umbralMilesimas: 1.5, consentimiento: PRECIOS_CONSENTIMIENTO }, { modo: 'otro', umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO },
    { modo: 'bajadas', umbralMilesimas: 10, consentimiento: true }, { modo: 'bajadas', umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO, baseline_cents: 2000 },
    { modo: 'bajadas', umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO, chat_id: 202 },
    { modo: ['bajadas'], umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO },
  ])('rechaza preferencias no consentidas, bases y campos extra: %j', async body => {
    const f = fixture(); expect((await f.request('PUT', body)).status).toBe(400); expect(f.kv.put).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('no usa un chat arbitrario ni acepta token alterado', async () => {
    const f = fixture()
    expect((await f.app.request('/api/telegram/precios?chat_id=101', { headers: { Authorization: 'Bearer invalid' } }, f.env)).status).toBe(401)
    expect(f.kv.get).not.toHaveBeenCalled()
  })
  it('un KV ilegible nunca se interpreta como resumen autorizado ni sobrescribe el permiso', async () => {
    const f = fixture(), key = preciosPreferenciaKey(await preciosUsuario(101)); f.kv.values.set(key, '{invalid')
    expect((await f.request('GET')).status).toBe(503)
    expect((await f.request('PUT', { modo: 'resumen', umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO })).status).toBe(503)
    expect(f.kv.put).not.toHaveBeenCalled()
  })
  it('permite regresar al resumen por elección explícita, sin afectar ITV', async () => {
    const f = fixture(); f.kv.values.set('tg-itv:v1:prueba', 'conservado')
    for (const modo of ['bajadas', 'resumen']) { vi.setSystemTime(Date.now() + 2000); expect((await f.request('PUT', { modo, umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO })).status).toBe(200) }
    expect(f.kv.values.get('tg-itv:v1:prueba')).toBe('conservado'); expect(f.fetcher).not.toHaveBeenCalled()
  })
})
describe('comparación de precios sin bases falsas', () => {
  it('compara milésimas del mismo combustible y muestra ambas fechas', () => {
    const data = snapshot(), messages = mensajesPrecios(data, ['95', '98', 'diesel', 'diesel_plus'].map(fuel_code => ({ station_id: '100', fuel_code })), preference())
    expect(messages).toHaveLength(1); expect(messages[0]).toContain('Antes 1,520'); expect(messages[0]).toContain('1,500 €/L'); expect(messages[0]).toContain('2,0 céntimos/L')
    expect(messages[0]).toContain('20/11/26'); expect(messages[0]).toContain('21/11/26'); expect(messages[0]).not.toContain('Gasolina 98'); expect(messages[0]).not.toContain('Diesel')
  })
  it('sin bajada suficiente, igualdad, ausencia o subida no crea mensaje', () => {
    const data = snapshot(); expect(mensajesPrecios(data, [{ station_id: '100', fuel_code: '95' }], { ...preference(), umbralMilesimas: 50 })).toEqual([])
    for (const value of [null, 1520, 1530]) { data.filas[0][3][0] = value; expect(mensajesPrecios(data, [{ station_id: '100', fuel_code: '95' }], preference())).toEqual([]) }
  })
  it('sin segunda captura no supone precio cero y el resumen sigue disponible', () => {
    const data = snapshot(); data.anterior = null; data.filas[0][4] = [null, null, null, null]
    expect(() => mensajesPrecios(data, [{ station_id: '100', fuel_code: '95' }], preference())).toThrow('reference')
    expect(mensajesPrecios(data, [{ station_id: '100', fuel_code: '95' }], null)[0]).toContain('1,500')
  })
  it('agrupa y escapa textos, sin duplicar estaciones ni superar Telegram', () => {
    const data = snapshot(); data.filas = Array.from({ length: 100 }, (_, i) => [String(i + 1), '<Estación & ejemplo> '.repeat(8), 'Municipio '.repeat(12), [1500, 1600, 1400, null], [1520, 1590, 1400, null]])
    const subscriptions = data.filas.map(row => ({ station_id: row[0], fuel_code: '95' })), result = mensajesPrecios(data, subscriptions.concat(subscriptions), preference())
    expect(result.length).toBeGreaterThan(1); expect(result.every(x => x.length <= 4096)).toBe(true); expect(result.join('')).toContain('&lt;Estación &amp;'); expect(result.join('')).not.toContain('<Estación')
    expect(result.join('').match(/Antes/g)).toHaveLength(100)
  })
  it('respeta cambio de hora y no revela chat en cursor ni permite cambiarlo', async () => {
    expect(preciosMadrid(Date.parse('2026-03-29T06:00:00Z'))).toEqual({ fecha: '2026-03-29', hora: 8 })
    expect(preciosMadrid(Date.parse('2026-10-25T07:00:00Z'))).toEqual({ fecha: '2026-10-25', hora: 8 })
    const token = await preciosCursor(123456789, 'test-only-secret', '2026-11-21')
    expect(token).not.toContain('123456789'); expect(await preciosLeeCursor(token, 'test-only-secret', '2026-11-21')).toEqual({ after: 123456789, failed: false })
    await expect(preciosLeeCursor(token, 'otra-clave', '2026-11-21')).rejects.toThrow('cursor')
    await expect(preciosLeeCursor(token, 'test-only-secret', '2026-11-22')).rejects.toThrow('cursor')
  })
})
