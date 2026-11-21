import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/index'
import { signTelegramToken } from '../src/lib/auth'
import { registerTelegramItvRoutes } from '../src/routes/telegram-itv'
import { registerTelegramRoutes } from '../src/routes/telegram'
import { ITV_CONSENTIMIENTO, ITV_PREFIX, itvAvisoKey, itvEventos, itvEventoKey, itvFechaAdmitida, itvFechaDesplazada, itvIntentoKey, itvMadrid, itvReciboKey, itvUsuario } from '../src/lib/telegram-itv'

const NOW = Date.parse('2026-11-21T07:30:00Z'), DATE = '2026-11-28'
function memoryKv() {
  const values = new Map<string, string>(), writes = new Map<string, number>()
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
      // Faithfully catch the KV one-write-per-second-per-key limitation.
      if (writes.has(key) && Date.now() - writes.get(key)! < 1000) throw new Error('KV rate limit')
      expect(options?.expirationTtl).toBeGreaterThanOrEqual(60)
      writes.set(key, Date.now()); values.set(key, value)
    }),
    delete: vi.fn(async (key: string) => { values.delete(key) }),
    list: vi.fn(async (options?: { prefix?: string; limit?: number; cursor?: string }) => {
      const matching = [...values.keys()].sort().filter(key => key.startsWith(options?.prefix || '') && (!options?.cursor || key > options.cursor))
      const keys = matching.slice(0, options?.limit || 1000).map(name => ({ name }))
      return { keys, list_complete: keys.length === matching.length, cursor: keys.at(-1)?.name }
    }),
  }
}
function fixture() {
  const kv = memoryKv(), app = new Hono<{ Bindings: Env }>()
  registerTelegramItvRoutes(app); registerTelegramRoutes(app)
  const run = vi.fn(async () => ({ success: true, meta: { changes: 0 } }))
  const env = { USER_DATA: kv, SESSION_SECRET: 'only-test-secret', TELEGRAM_BOT_TOKEN: 'only-test-bot', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'only-test-webhook', CRON_TOKEN: 'only-test-cron', DB: { prepare: () => ({ bind: () => ({ run }) }) } } as unknown as Env
  const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect(String(input)).toBe('https://api.telegram.org/botonly-test-bot/sendMessage')
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
  })
  const request = async (method: string, body?: unknown, chat = 101) => app.request('/api/telegram/itv-recordatorio', {
    method, headers: { Authorization: 'Bearer ' + await signTelegramToken(chat, env.SESSION_SECRET!), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, env)
  const save = (fecha = DATE, chat = 101) => request('PUT', { fecha, consentimiento: ITV_CONSENTIMIENTO }, chat)
  const cron = (query = '') => app.request('/api/cron/telegram-itv' + query, { method: 'POST', headers: { Authorization: 'Bearer only-test-cron' } }, env)
  return { app, env, kv, request, save, cron, send, run }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('ITV: fechas aportadas, permiso y sesión Telegram independiente', () => {
  it.each([
    ['2026-03-29T06:00:00Z', '2026-03-29', 8], ['2026-10-25T07:00:00Z', '2026-10-25', 8],
    ['2026-06-01T21:59:59Z', '2026-06-01', 23], ['2026-06-01T22:00:00Z', '2026-06-02', 0],
  ])('calcula Madrid con DST: %s', (time, fecha, hora) => expect(itvMadrid(Date.parse(time))).toEqual({ fecha, hora }))
  it('resta días de calendario incluyendo febrero y cambio de año', () => {
    expect(itvFechaDesplazada('2028-03-01', -1)).toBe('2028-02-29')
    expect(itvFechaDesplazada('2027-01-03', -7)).toBe('2026-12-27')
    expect(itvFechaAdmitida('2026-11-21')).toBe(false); expect(itvFechaAdmitida('2099-01-01')).toBe(false)
  })
  it('guarda sin Google, sólo fecha y consentimiento, no expone identificadores ni secretos', async () => {
    const f = fixture(), res = await f.save()
    expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, recordatorio: { fecha: DATE, consentimiento: ITV_CONSENTIMIENTO, dias: [7, 1] } })
    expect(JSON.stringify(body)).not.toMatch(/chat|secret|only-test|usuario/)
    expect(f.kv.values.size).toBe(3); expect(f.send).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled()
    expect([...f.kv.values.keys()].every(key => !key.includes('101'))).toBe(true)
    expect(await (await f.request('GET')).json()).toMatchObject({ avisos: [{ dias: 7, fecha: '2026-11-21', estado: 'programado' }, { dias: 1, fecha: '2026-11-27', estado: 'programado' }] })
  })
  it.each([
    { fecha: DATE }, { fecha: DATE, consentimiento: true }, { fecha: '2027-02-29', consentimiento: ITV_CONSENTIMIENTO },
    { fecha: DATE, consentimiento: ITV_CONSENTIMIENTO, chat_id: 202 },
    { fecha: DATE, consentimiento: ITV_CONSENTIMIENTO, matricula: 'no-real' },
    { fecha: DATE, consentimiento: ITV_CONSENTIMIENTO, nombre: 'Mi coche' },
  ])('rechaza fechas y campos no autorizados %j', async input => {
    const f = fixture(); expect((await f.request('PUT', input)).status).toBe(400); expect(f.kv.put).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })
  it('chatId arbitrario o token alterado no autorizan ninguna lectura o borrado', async () => {
    const f = fixture(); await f.save()
    for (const method of ['GET', 'DELETE']) expect((await f.app.request('/api/telegram/itv-recordatorio?chat_id=101', { method, headers: { Authorization: 'Bearer invalid' } }, f.env)).status).toBe(401)
    expect(await (await f.request('GET', undefined, 202)).json()).toMatchObject({ recordatorio: null })
    expect(f.kv.delete).not.toHaveBeenCalled()
  })
  it('un PUT repetido conserva la versión y no reenvía un aviso ya entregado', async () => {
    const f = fixture(); await f.save(); await f.cron(); vi.setSystemTime(NOW + 2000)
    expect((await f.save()).status).toBe(200)
    expect(await (await f.cron()).json()).toMatchObject({ sent: 0 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('editar la fecha anula los índices anteriores; cancelar no toca gasolina ni calendario', async () => {
    const f = fixture(); await f.save(); vi.setSystemTime(NOW + 2000); await f.save('2026-12-01')
    expect(await (await f.cron()).json()).toMatchObject({ eligible: 0, sent: 0 })
    expect((await f.request('DELETE')).status).toBe(200); expect(f.kv.values.size).toBe(0); expect(f.run).not.toHaveBeenCalled()
  })
  it('un fallo al crear los índices no activa un permiso parcial', async () => {
    const f = fixture(); f.kv.put.mockRejectedValueOnce(new Error('test KV failure'))
    expect((await f.save()).status).toBe(503); expect(await (await f.request('GET')).json()).toMatchObject({ recordatorio: null })
  })
  it('un alta matinal posterior a una revisión puede entrar en la siguiente revisión de hoy', async () => {
    const f = fixture(); expect(await (await f.cron()).json()).toMatchObject({ processed: 0 })
    vi.setSystemTime(Date.parse('2026-11-21T08:10:00Z'))
    const response = await f.save('2026-11-22')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ recordatorio: { ventanas: [{ dias: 1, fecha: '2026-11-21', desde: '08:00', hasta: '11:59' }] } })
    vi.setSystemTime(Date.parse('2026-11-21T09:00:00Z'))
    expect(await (await f.cron()).json()).toMatchObject({ sent: 1 })
  })
  it('mañana a las13h ya no tiene ventana: rechaza el alta, sin cambiar un aviso previo', async () => {
    const f = fixture(); await f.save(); vi.setSystemTime(Date.parse('2026-11-21T12:00:00Z'))
    const response = await f.save('2026-11-22')
    expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ error: 'no_future_windows' })
    expect(await (await f.request('GET')).json()).toMatchObject({ recordatorio: { fecha: DATE, ventanas: [{ dias: 1, fecha: '2026-11-27' }] } })
  })
  it('el webhook /stop cancela ITV y gasolina sólo tras validar el secreto', async () => {
    const f = fixture(); await f.save()
    const body = JSON.stringify({ message: { text: '/stop', chat: { id: 101 } } })
    expect((await f.app.request('/api/telegram/webhook', { method: 'POST', body }, f.env)).status).toBe(401)
    expect(f.kv.values.size).toBe(3)
    expect((await f.app.request('/api/telegram/webhook', { method: 'POST', body, headers: { 'X-Telegram-Bot-Api-Secret-Token': 'only-test-webhook' } }, f.env)).status).toBe(200)
    expect(f.kv.values.size).toBe(0); expect(f.run).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce()
  })
  it.each(['/help', '/start'])('la ayuda %s explica ITV, permiso separado y baja común', async command => {
    const f = fixture()
    const response = await f.app.request('/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'only-test-webhook' }, body: JSON.stringify({ message: { text: command, chat: { id: 101 } } }) }, f.env)
    expect(response.status).toBe(200)
    const sent = JSON.parse(String(f.send.mock.calls[0][1]?.body))
    expect(sent.text).toContain('ITV'); expect(sent.text).toContain('/stop'); expect(sent.text).toMatch(/no (?:se )?activa/i)
    expect(f.kv.put).not.toHaveBeenCalled()
  })
  it('rotar el secreto invalida el Bearer anterior pero /stop aún encuentra y borra la fecha', async () => {
    const f = fixture(); await f.save()
    const oldToken = await signTelegramToken(101, f.env.SESSION_SECRET!)
    f.env.SESSION_SECRET = 'only-test-rotated-secret'
    expect((await f.app.request('/api/telegram/itv-recordatorio', { headers: { Authorization: 'Bearer ' + oldToken } }, f.env)).status).toBe(401)
    const response = await f.app.request('/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'only-test-webhook' }, body: JSON.stringify({ message: { text: '/stop', chat: { id: 101 } } }) }, f.env)
    expect(response.status).toBe(200); expect(f.kv.values.size).toBe(0)
  })
  it('si falla la baja KV no confirma /stop y permite el reintento del webhook', async () => {
    const f = fixture(); await f.save(); f.kv.delete.mockRejectedValueOnce(new Error('test failure'))
    const request = () => f.app.request('/api/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'only-test-webhook' }, body: JSON.stringify({ message: { text: '/stop', chat: { id: 101 } } }) }, f.env)
    expect((await request()).status).toBe(503); expect(f.send).not.toHaveBeenCalled()
    expect((await request()).status).toBe(200); expect(f.send).toHaveBeenCalledOnce(); expect(f.kv.values.size).toBe(0)
  })
})

describe('cron ITV separado, sin tocar datos o mensajes reales', () => {
  it('dry-run fuera de ventana sólo lee, sin enviar ni escribir ni borrar', async () => {
    const f = fixture(); await f.save(); f.kv.put.mockClear(); vi.setSystemTime(NOW + 12 * 3600000)
    expect(await (await f.cron('?dry_run=1')).json()).toMatchObject({ ok: true, dryRun: true, inWindow: false, eligible: 1, sent: 0 })
    expect(f.send).not.toHaveBeenCalled(); expect(f.kv.put).not.toHaveBeenCalled(); expect(f.kv.delete).not.toHaveBeenCalled()
  })
  it('ignora force y no envía fuera de 08:00–11:59 Madrid', async () => {
    const f = fixture(); await f.save(); vi.setSystemTime(NOW + 5 * 3600000)
    expect(await (await f.cron('?force=1')).json()).toMatchObject({ skipped: 'not_reminder_window', sent: 0 }); expect(f.send).not.toHaveBeenCalled()
  })
  it('un cron sin credencial no lee las suscripciones', async () => {
    const f = fixture(); expect((await f.app.request('/api/cron/telegram-itv', { method: 'POST' }, f.env)).status).toBe(401); expect(f.kv.list).not.toHaveBeenCalled()
  })
  it('entrega 7 y 1 días antes, no más días ni renovación automática, aun sin D1 ni precios', async () => {
    const f = fixture(); delete f.env.DB; await f.save()
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, sent: 1 })
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, sent: 0 })
    vi.setSystemTime(Date.parse('2026-11-27T07:15:00Z'))
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, sent: 1 })
    vi.setSystemTime(Date.parse('2027-11-21T07:15:00Z'))
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, sent: 0 })
    expect(f.send).toHaveBeenCalledTimes(2)
  })
  it('el tope de una corrida no deja bloqueados los siguientes usuarios', async () => {
    const f = fixture(); for (let i = 1; i <= 12; i++) expect((await f.save(DATE, i)).status).toBe(200)
    const first = await (await f.cron()).json(); expect(first).toMatchObject({ sent: 5 }); expect(first.nextCursor).toBeTruthy()
    const second = await (await f.cron()).json(); expect(second).toMatchObject({ sent: 5 })
    const last = await (await f.cron()).json(); expect(last).toMatchObject({ sent: 2, nextCursor: null }); expect(f.send).toHaveBeenCalledTimes(12)
  })
  it('pagina con cursor aunque se hayan retirado índices entregados', async () => {
    const f = fixture(); for (let i = 1; i <= 6; i++) await f.save(DATE, i)
    const first = await (await f.cron()).json()
    expect(await (await f.cron('?cursor=' + encodeURIComponent(first.nextCursor))).json()).toMatchObject({ sent: 1, nextCursor: null })
  })
  it('un rechazo confirmado429 se reintenta después del plazo y no se declara éxito', async () => {
    const f = fixture(); await f.save(); f.send.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 120 } }), { status: 429 }))
    expect((await f.cron()).status).toBe(503); expect((await f.cron()).status).toBe(503); expect(f.send).toHaveBeenCalledOnce()
    vi.setSystemTime(NOW + 121000)
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, sent: 1 }); expect(f.send).toHaveBeenCalledTimes(2)
  })
  it.each(['throw', 'invalid-json', 'false-success'])('una entrega ambigua no se repite: %s', async mode => {
    const f = fixture(); await f.save()
    if (mode === 'throw') f.send.mockRejectedValueOnce(new Error('test timeout'))
    else f.send.mockResolvedValueOnce(new Response(mode === 'invalid-json' ? '<html>error</html>' : JSON.stringify({ message: 'not Telegram' })))
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, uncertain: 1, sent: 0 })
    vi.setSystemTime(NOW + 3600000)
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, uncertain: 1, sent: 0 }); expect(f.send).toHaveBeenCalledOnce()
  })
  it('si se pierde el recibo tras el envío, conserva intención y evita duplicar', async () => {
    const f = fixture(); await f.save()
    const normal = f.kv.put.getMockImplementation()!
    f.kv.put.mockImplementation(async (key, value, opts) => { if (key.startsWith(ITV_PREFIX + 'recibo:') && !key.endsWith(':intento')) throw new Error('test receipt failure'); return normal(key, value, opts) })
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, errors: 1, sent: 1 })
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, uncertain: 1, sent: 0 }); expect(f.send).toHaveBeenCalledOnce()
  })
  it('un bot bloqueado elimina el permiso y ambos índices', async () => {
    const f = fixture(); await f.save(); f.send.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 403 }), { status: 403 }))
    expect(await (await f.cron()).json()).toMatchObject({ ok: true, skipped: 1, sent: 0 })
    expect(await (await f.request('GET')).json()).toMatchObject({ recordatorio: null })
    expect([...f.kv.values.keys()].some(key => key.startsWith(ITV_PREFIX + 'dia:'))).toBe(false)
  })
  it('un índice de una versión antigua nunca reactiva el aviso', async () => {
    const f = fixture(); await f.save()
    const usuario = await itvUsuario(101), item = JSON.parse(f.kv.values.get(itvAvisoKey(usuario))!)
    const event = itvEventos(usuario, item)[0]
    f.kv.values.set(itvAvisoKey(usuario), JSON.stringify({ ...item, id: crypto.randomUUID() }))
    expect(await (await f.cron()).json()).toMatchObject({ sent: 0, skipped: 1 }); expect(f.send).not.toHaveBeenCalled(); expect(f.kv.values.has(itvEventoKey(event))).toBe(false)
    expect(itvReciboKey(event)).not.toBe(itvIntentoKey(event))
  })
})
