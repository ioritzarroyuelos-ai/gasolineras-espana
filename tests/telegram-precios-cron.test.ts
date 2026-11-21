import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/index'
import { registerTelegramPreciosRoutes } from '../src/routes/telegram-precios'
import { cargaPreciosComparacion, PRECIOS_CONSENTIMIENTO, PRECIOS_PREFIX, preciosPreferenciaKey, preciosUsuario } from '../src/lib/telegram-precios'
import { construyePreciosComparacion } from '../scripts/lib/precios-comparacion.mjs'

const NOW = Date.parse('2026-11-21T08:30:00Z')
type Row = { chat_id: number; station_id: string; fuel_code: string; last_notified_at: number | null }
async function fixture(options: { chats?: number[]; stations?: number; long?: boolean; samePrice?: boolean; previous?: boolean } = {}) {
  const values = new Map<string, string>(), rows: Row[] = []
  const kv = { values, get: vi.fn(async (name: string) => values.get(name) ?? null), put: vi.fn(async (name: string, value: string, _options?: { expirationTtl?: number }) => { values.set(name, value) }), delete: vi.fn(async (name: string) => { values.delete(name) }), list: vi.fn(async () => ({ keys: [], list_complete: true })) }
  const list = Array.from({ length: options.stations || 1 }, (_, i) => ({ IDEESS: String(100 + i), 'Rótulo': options.long ? ('Estación prueba ' + i + ' ').repeat(10).slice(0, 160) : 'Estación prueba ' + i, Municipio: options.long ? 'Municipio de prueba '.repeat(7).slice(0, 120) : 'Madrid', 'Precio Gasolina 95 E5': '1,500' }))
  const source = { Fecha: '21/11/2026 09:00:05', ListaEESSPrecio: list }, previous = { Fecha: '20/11/2026 21:00:05', ListaEESSPrecio: list.map(row => ({ ...row, 'Precio Gasolina 95 E5': options.samePrice ? '1,500' : '1,520' })) }
  const bundle = await construyePreciosComparacion(source, { now: new Date(NOW), ...(options.previous === false ? {} : { previousSnapshot: previous, previousMeta: { ministryDate: previous.Fecha, fetchedAt: '2026-11-20T20:10:00.000Z' } }) })
  const assets = new Map(bundle.artifacts.map(row => [row.archivo, row.content])); assets.set('index.json', JSON.stringify(bundle.index))
  const readAsset = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname.replace('/data/precios-comparacion/', '')
    const raw = assets.get(path)
    return raw === undefined ? new Response('not found', { status: 404 }) : new Response(raw, { headers: { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(raw).byteLength) } })
  })
  for (const chat of options.chats || [101]) for (const station of list) rows.push({ chat_id: chat, station_id: station.IDEESS, fuel_code: '95', last_notified_at: null })
  const run = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('UPDATE telegram_subscriptions')) for (const row of rows) if (row.chat_id === args[1]) row.last_notified_at = Number(args[0])
    if (sql.startsWith('DELETE FROM telegram_subscriptions')) for (let i = rows.length - 1; i >= 0; i--) if (rows[i].chat_id === args[0]) rows.splice(i, 1)
    return { success: true, meta: { changes: 1 } }
  })
  const prepare = vi.fn((sql: string) => {
    let args: unknown[] = []
    const statement = { bind: (...values: unknown[]) => { args = values; return statement }, run: () => run(sql, args), all: async () => {
      if (sql.startsWith('SELECT chat_id, MAX')) return { results: [...new Set(rows.filter(row => row.chat_id > Number(args[0])).map(row => row.chat_id))].sort((a, b) => a - b).slice(0, 2).map(chat_id => ({ chat_id, last_notified_at: Math.max(...rows.filter(row => row.chat_id === chat_id).map(row => row.last_notified_at || 0)) || null })) }
      if (sql.startsWith('SELECT station_id')) return { results: rows.filter(row => row.chat_id === args[0]).map(row => ({ station_id: row.station_id, fuel_code: row.fuel_code, last_notified_at: row.last_notified_at })).slice(0, 101) }
      throw Error('Consulta de prueba inesperada')
    } }
    return statement
  })
  const app = new Hono<{ Bindings: Env }>(); registerTelegramPreciosRoutes(app)
  const env = { ASSETS: { fetch: readAsset }, USER_DATA: kv, DB: { prepare }, CRON_TOKEN: 'test-cron-only', SESSION_SECRET: 'test-session-only', TELEGRAM_BOT_TOKEN: 'test-bot-only', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-only' } as unknown as Env
  const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    expect(input).toBe('https://api.telegram.org/bottest-bot-only/sendMessage'); expect(init).toMatchObject({ method: 'POST', redirect: 'manual' }); expect(init?.signal).toBeDefined()
    return Response.json({ ok: true, result: { message_id: 1 } })
  })
  const step = (query = '') => app.request('/api/cron/telegram-check' + query, { method: 'POST', headers: { Authorization: 'Bearer test-cron-only' } }, env)
  const cron = async (query = '') => {
    let suffix = query, failed = false; const totals: Record<string, any> = {}
    for (let n = 0; n < 200; n++) {
      const response = await step(suffix), data = await response.json()
      if (![200, 503].includes(response.status) || typeof data.skipped === 'string') return Response.json(data, { status: response.status })
      failed ||= response.status === 503
      for (const key of ['processed', 'work', 'eligible', 'sentChats', 'sentMsgs', 'skipped', 'errors', 'uncertain', 'purged']) totals[key] = (totals[key] || 0) + data[key]
      if (!data.nextCursor) return Response.json({ ...data, ...totals, ok: !failed }, { status: failed ? 503 : 200 })
      suffix = (query.includes('dry_run=1') ? '?dry_run=1&' : '?') + 'cursor=' + encodeURIComponent(data.nextCursor)
      vi.setSystemTime(Date.now() + 1100)
    }
    throw Error('La prueba no avanzó en200pasos')
  }
  const drops = async (chat = 101) => values.set(preciosPreferenciaKey(await preciosUsuario(chat)), JSON.stringify({ version: 1, chat, modo: 'bajadas', umbralMilesimas: 10, consentimiento: PRECIOS_CONSENTIMIENTO, actualizado: new Date(NOW).toISOString() }))
  return { env, kv, rows, run, prepare, assets, readAsset, bundle, send, cron, step, drops }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('lector acotado de precios con integridad', () => {
  it('sólo descarga el índice y cubos necesarios y reutiliza cada cubo en el lote', async () => {
    const f = await fixture({ stations: 100 }), reader = await cargaPreciosComparacion(f.env)
    const found = await reader.estaciones(['100', '132'])
    expect(found.filas.map(row => row[0])).toEqual(['100', '132']); expect(f.readAsset).toHaveBeenCalledTimes(2)
    await reader.estaciones(['100']); expect(f.readAsset).toHaveBeenCalledTimes(2); expect(f.send).not.toHaveBeenCalled()
  })
  it('acepta un intento posterior sin convertirlo en nueva fecha de la captura', async () => {
    const f = await fixture(), index = structuredClone(f.bundle.index); index.consultado = new Date(NOW + 60000).toISOString(); f.assets.set('index.json', JSON.stringify(index))
    const data = await (await cargaPreciosComparacion(f.env, NOW + 60000)).estaciones(['100'])
    expect(data.actual.consultado).toBe(f.bundle.index.actual.consultado); expect(data.actual.fechaFuente).toBe('2026-11-21T08:00:05.000Z')
  })
  it('rechaza mezcla de versión, hash incorrecto, fichero ausente y rutas externas', async () => {
    const f = await fixture(), descriptor = f.bundle.index.shards['04'], original = f.assets.get(descriptor.archivo)!
    f.assets.set(descriptor.archivo, original.replace('1500', '1499'))
    await expect((await cargaPreciosComparacion(f.env)).estaciones(['100'])).rejects.toThrow()
    f.assets.delete(descriptor.archivo)
    await expect((await cargaPreciosComparacion(f.env)).estaciones(['100'])).rejects.toThrow()
    const index = structuredClone(f.bundle.index); index.shards['04'].archivo = 'https://evil.test/precios'; f.assets.set('index.json', JSON.stringify(index))
    await expect(cargaPreciosComparacion(f.env)).rejects.toThrow(); expect(f.send).not.toHaveBeenCalled()
  })
  it('corta índice excesivo y no retoma una fecha vieja como precio de hoy', async () => {
    const f = await fixture(); await expect(cargaPreciosComparacion(f.env, NOW + 40 * 3600000)).rejects.toThrow()
    f.assets.set('index.json', 'x'.repeat(33000)); await expect(cargaPreciosComparacion(f.env)).rejects.toThrow()
    expect(f.send).not.toHaveBeenCalled()
  })
})

describe('cron consentido, paginado y sin falsas entregas', () => {
  it('mantiene resumen del usuario antiguo y excluye bajadas hasta permiso explícito', async () => {
    const f = await fixture(), response = await f.cron()
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true, sentChats: 1, sentMsgs: 1 })
    const body = JSON.parse(String(f.send.mock.calls[0][1]?.body)); expect(body.text).toContain('Tus gasolineras'); expect(body.text).not.toContain('Bajadas')
    expect([...f.kv.values.keys()].some(name => name.startsWith(PRECIOS_PREFIX + 'preferencia:'))).toBe(false)
    expect(await (await f.cron()).json()).toMatchObject({ sentMsgs: 0, skipped: 1 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('avisa sólo de una bajada real y no repite la pareja de capturas al día siguiente', async () => {
    const f = await fixture(); await f.drops(); expect((await f.cron()).status).toBe(200)
    expect(JSON.parse(String(f.send.mock.calls[0][1]?.body)).text).toContain('Antes 1,520')
    vi.setSystemTime(NOW + 23 * 3600000)
    expect(await (await f.cron()).json()).toMatchObject({ sentMsgs: 0 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('una igualdad no crea recibos ni mensaje; sólo se guarda avance de la revisión', async () => {
    const f = await fixture({ samePrice: true }); await f.drops()
    expect(await (await f.cron()).json()).toMatchObject({ eligible: 0, sentMsgs: 0, skipped: 1 })
    expect(f.kv.put.mock.calls.every(([key]) => key.includes(':preparacion:') || key.includes(':checkpoint:'))).toBe(true)
    expect(f.send).not.toHaveBeenCalled()
  })
  it('sin referencia, el resumen funciona pero sólo bajadas devuelve pendiente sin base inventada', async () => {
    const f = await fixture({ previous: false }); await f.drops()
    expect((await f.cron()).status).toBe(503); expect(f.send).not.toHaveBeenCalled()
    f.kv.values.delete(preciosPreferenciaKey(await preciosUsuario(101))); vi.setSystemTime(NOW + 2000)
    expect((await f.cron()).status).toBe(200); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('dry-run fuera de ventana no envía, no escribe y no usa checkpoint normal', async () => {
    const f = await fixture(); f.kv.values.set(PRECIOS_PREFIX + 'checkpoint:2026-11-21', '{invalid'); vi.setSystemTime(NOW + 8 * 3600000)
    const response = await f.cron('?dry_run=1')
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ dryRun: true, inWindow: false, processed: 1, sentMsgs: 0 })
    expect(f.kv.put).not.toHaveBeenCalled(); expect(f.kv.delete).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })
  it('rechaza force y no carga fuentes ni entrega fuera del horario', async () => {
    const f = await fixture(); expect((await f.cron('?force=1')).status).toBe(400)
    vi.setSystemTime(NOW + 8 * 3600000); expect(await (await f.cron()).json()).toMatchObject({ skipped: 'not_digest_window' })
    expect(f.readAsset).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.kv.put).not.toHaveBeenCalled()
  })
  it('recorre más de un lote sin perder los destinatarios posteriores al primer límite', async () => {
    const f = await fixture({ chats: Array.from({ length: 12 }, (_, i) => 101 + i) })
    const first = await (await f.step()).json(); expect(first).toMatchObject({ sentChats: 0, processed: 0, work: 1, deferred: 1 }); expect(first.nextCursor).toEqual(expect.any(String))
    vi.setSystemTime(NOW + 2000)
    // Simula que el primer workflow se interrumpió y el siguiente no trae cursor.
    const second = await (await f.cron()).json(); expect(second).toMatchObject({ sentChats: 12, nextCursor: null })
    expect(new Set(f.send.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).chat_id)).size).toBe(12)
  })
  it('un fallo de una página persiste al continuar desde checkpoint y no tapa al resto', async () => {
    const f = await fixture({ chats: [101, 102, 103, 104, 105, 106] }); f.send.mockResolvedValueOnce(Response.json({ ok: false, error_code: 429, parameters: { retry_after: 3600 } }, { status: 429 }))
    expect((await f.step()).status).toBe(200); vi.setSystemTime(NOW + 2000)
    expect((await f.step()).status).toBe(503); vi.setSystemTime(NOW + 4000)
    const next = await f.cron(); expect(next.status).toBe(503); expect(await next.json()).toMatchObject({ sentChats: 5, nextCursor: null })
    expect(f.send).toHaveBeenCalledTimes(6)
  })
  it('no reenvía la primera parte si la segunda recibe rechazo inequívoco', async () => {
    const f = await fixture({ stations: 40, long: true }); f.send.mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: false, error_code: 429, parameters: { retry_after: 60 } }, { status: 429 }))
    const first = await f.cron(); expect(first.status).toBe(503); expect(f.send).toHaveBeenCalledTimes(2)
    const initialText = JSON.parse(String(f.send.mock.calls[0][1]?.body)).text
    vi.setSystemTime(Date.now() + 61000); expect((await f.cron()).status).toBe(200)
    expect(f.send.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).text === initialText)).toHaveLength(1)
  })
  it('timeout o HTTP200 ilegible deja entrega incierta y no se reenvía', async () => {
    const f = await fixture(); f.send.mockRejectedValueOnce(new Error('resultado incierto de prueba'))
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, uncertain: 1 }); vi.setSystemTime(NOW + 3600000)
    expect(await (await f.cron()).json()).toMatchObject({ ok: false, uncertain: 1 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('no envía si falla la escritura previa y no repite si falla guardar el recibo posterior', async () => {
    const f = await fixture(), original = f.kv.put.getMockImplementation()!
    f.kv.put.mockImplementation(async (name, value, options) => { if (name.endsWith(':intento')) throw Error('fallo anterior'); return original(name, value, options) })
    expect((await f.cron()).status).toBe(503); expect(f.send).not.toHaveBeenCalled()
    f.kv.put.mockImplementation(async (name, value, options) => { if (name.includes(':evento:') && !name.endsWith(':intento') && JSON.parse(value).estado) throw Error('fallo posterior'); return original(name, value, options) })
    vi.setSystemTime(NOW + 2000); expect((await f.cron()).status).toBe(503); expect(f.send).toHaveBeenCalledTimes(1)
    f.kv.put.mockImplementation(original); vi.setSystemTime(NOW + 4000)
    expect(await (await f.cron()).json()).toMatchObject({ uncertain: 1 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('un fallo al sellar D1 no repite mensajes con recibo confirmado', async () => {
    const f = await fixture(), original = f.run.getMockImplementation()!
    f.run.mockImplementation(async (sql, args) => { if (sql.startsWith('UPDATE')) throw Error('fallo del sello'); return original(sql, args) })
    expect((await f.cron()).status).toBe(503); vi.setSystemTime(NOW + 2000)
    expect(await (await f.cron()).json()).toMatchObject({ sentMsgs: 0 }); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('baja definitiva borra suscripciones de combustible y permisos sin nuevos envíos', async () => {
    const f = await fixture(); await f.drops(); f.send.mockResolvedValueOnce(Response.json({ ok: false, error_code: 403 }, { status: 403 }))
    expect(await (await f.cron()).json()).toMatchObject({ purged: 1, sentMsgs: 0 })
    expect(f.rows).toHaveLength(0); expect(f.kv.values.has(preciosPreferenciaKey(await preciosUsuario(101)))).toBe(false)
  })
  it('mantiene presupuesto con100 favoritas y5chats, sin abandonar una cola grande', async () => {
    const f = await fixture({ chats: [101, 102, 103, 104, 105], stations: 100, long: true })
    let cursor: string | null = null, totalMessages = 0
    for (let i = 0; i < 150; i++) {
      f.readAsset.mockClear(); f.prepare.mockClear(); f.kv.get.mockClear(); f.kv.put.mockClear(); f.send.mockClear()
      const result: Record<string, any> = await (await f.step(cursor ? '?cursor=' + cursor : '')).json()
      expect(result.sentMsgs).toBeLessThanOrEqual(2); expect(result.work).toBeLessThanOrEqual(2)
      expect(f.readAsset.mock.calls.length).toBeLessThanOrEqual(3)
      expect(f.kv.get.mock.calls.length + f.kv.put.mock.calls.length + f.prepare.mock.calls.length + f.readAsset.mock.calls.length + f.send.mock.calls.length).toBeLessThanOrEqual(50)
      totalMessages += result.sentMsgs; cursor = result.nextCursor
      if (!cursor) break
      vi.setSystemTime(Date.now() + 1100)
    }
    expect(cursor).toBeNull(); expect(totalMessages).toBeGreaterThan(12)
  })
  it('no entrega un plan si cambian favoritas o consentimiento durante la preparación', async () => {
    const f = await fixture({ stations: 100 }); await f.step(); expect(f.send).not.toHaveBeenCalled()
    f.rows.splice(1); await f.drops(); vi.setSystemTime(Date.now() + 1100)
    expect((await f.cron()).status).toBe(200)
    expect(f.send).toHaveBeenCalledTimes(1)
    const text = JSON.parse(String(f.send.mock.calls[0][1]?.body)).text
    expect(text).toContain('Bajadas'); expect(text).toContain('Estación prueba 0'); expect(text).not.toContain('Estación prueba 1')
  })
  it('cancelar tras preparar impide que la continuación o el plan envíen nada', async () => {
    const f = await fixture(); const first = await (await f.step()).json(); expect(first.nextCursor).toEqual(expect.any(String))
    f.rows.splice(0); vi.setSystemTime(Date.now() + 1100)
    expect(await (await f.step('?cursor=' + first.nextCursor)).json()).toMatchObject({ sentMsgs: 0, nextCursor: null })
    expect(f.send).not.toHaveBeenCalled()
  })
  it('preparación corrupta o una captura caducada fallan antes de enviar', async () => {
    const f = await fixture(); await f.step()
    const key = [...f.kv.values.keys()].find(key => key.includes(':preparacion:'))!
    const saved = JSON.parse(f.kv.values.get(key)!); saved.filas[0][3][0] = 0; f.kv.values.set(key, JSON.stringify(saved))
    vi.setSystemTime(Date.now() + 1100); expect((await f.cron()).status).toBe(503); expect(f.send).not.toHaveBeenCalled()
    vi.setSystemTime(NOW + 48 * 3600000); expect((await f.cron('?dry_run=1')).status).toBe(503); expect(f.send).not.toHaveBeenCalled()
  })
  it('una redirección del bot nunca se sigue ni cuenta como entrega', async () => {
    const f = await fixture(); f.send.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.invalid' } }))
    expect(await (await f.cron()).json()).toMatchObject({ uncertain: 1, sentMsgs: 0 })
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('la purga de enlaces vencidos es acotada y sólo ocurre en modo normal', async () => {
    const f = await fixture(); await f.cron('?dry_run=1'); expect(f.run).not.toHaveBeenCalled()
    await f.step(); const cleanup = f.run.mock.calls.find(([sql]) => sql.startsWith('DELETE FROM telegram_pending_tokens'))!
    expect(cleanup[0]).toContain('LIMIT 100'); expect(cleanup[1][0]).toBe(Date.now() - 3600000)
  })
  it('cambiar la captura reinicia el plan y no mezcla precios anteriores', async () => {
    const f = await fixture({ stations: 100 }); await f.step()
    vi.setSystemTime(NOW + 3600000)
    const rows = f.bundle.bloques.flatMap(block => block.filas).map(row => ({ IDEESS: row[0], 'Rótulo': row[1], Municipio: row[2], 'Precio Gasolina 95 E5': '1,400' }))
    const next = await construyePreciosComparacion({ Fecha: '21/11/2026 10:00:05', ListaEESSPrecio: rows }, { now: new Date(Date.now()), previousBundle: f.bundle })
    f.assets.clear(); f.assets.set('index.json', JSON.stringify(next.index)); for (const artifact of next.artifacts) f.assets.set(artifact.archivo, artifact.content)
    expect((await f.cron()).status).toBe(200)
    const text = f.send.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text).join('\n')
    expect(text).toContain('1,400'); expect(text).not.toContain('1,500'); expect(text.match(/Gasolina 95/g)).toHaveLength(100)
  })
  it('dry-run recorre32cubos sin guardar la preparación ni enviar', async () => {
    const f = await fixture({ stations: 100 })
    const result = await (await f.cron('?dry_run=1')).json()
    expect(result).toMatchObject({ processed: 1, work: 32, eligible: 0, sentMsgs: 0 })
    expect(f.kv.put).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled()
  })
  it('recupera checkpoint corrupto sin éxito silencioso ni duplicar una entrega', async () => {
    const f = await fixture(); f.kv.values.set(PRECIOS_PREFIX + 'checkpoint:2026-11-21', '{invalid')
    expect((await f.cron()).status).toBe(503); expect(f.send).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 2000); expect((await f.cron()).status).toBe(200); expect(f.send).toHaveBeenCalledTimes(1)
  })
})
