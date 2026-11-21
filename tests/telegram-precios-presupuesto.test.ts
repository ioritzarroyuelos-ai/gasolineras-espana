import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/index'
import { registerTelegramPreciosRoutes } from '../src/routes/telegram-precios'
import { PRECIOS_CONSENTIMIENTO, PRECIOS_PREFIX, preciosPreferenciaKey, preciosUsuario } from '../src/lib/telegram-precios'
import { construyePreciosComparacion } from '../scripts/lib/precios-comparacion.mjs'

// Presupuesto conservador propio de50 operaciones mixtas. No equivale al
// límite oficial de50 externas: Workers distingue1000 a servicios internos.

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

describe('auditoría independiente del presupuesto', () => {
 it('cuenta todas las operaciones del peor tramo tras cuatro destinatarios sin envío',async()=>{
  const f=await fixture({chats:[101,102,103,104,105],stations:100,long:true})
  // Construye los planes y recibos a través del flujo real (Telegram simulado).
  await f.cron()
  for(const row of f.rows)row.last_notified_at=null
  const user=await preciosUsuario(105), base=PRECIOS_PREFIX+'evento:'+user+':2026-11-21'
  const plan=JSON.parse(f.kv.values.get(base)!)
  expect(plan.partes).toHaveLength(8); expect(f.send).toHaveBeenCalledTimes(40)
  f.kv.values.delete(base+':completo')
  for(const hash of plan.partes.slice(-2)){f.kv.values.delete(base+':'+hash);f.kv.values.delete(base+':'+hash+':intento')}
  for(const chat of [101,102,103,104]) {const who=await preciosUsuario(chat);f.kv.values.delete(PRECIOS_PREFIX+'evento:'+who+':2026-11-21:completo');f.kv.values.set(PRECIOS_PREFIX+'dia:'+who+':2026-11-21',JSON.stringify({evento:'bajadas:otra-pareja'}))}
  let cursor:string|null=null,sent=0;const evidence:unknown[]=[]
  for(let i=0;i<6;i++){
   f.readAsset.mockClear();f.prepare.mockClear();f.kv.get.mockClear();f.kv.put.mockClear();f.send.mockClear();f.kv.delete.mockClear()
   const response=await f.step(cursor?'?cursor='+cursor:''),data=await response.json()
   const counts={get:f.kv.get.mock.calls.length,put:f.kv.put.mock.calls.length,del:f.kv.delete.mock.calls.length,db:f.prepare.mock.calls.length,assets:f.readAsset.mock.calls.length,send:f.send.mock.calls.length},total=Object.values(counts).reduce((a,b)=>a+b,0)
   evidence.push({parts:plan.partes.length,status:response.status,data,counts,total});expect(total).toBeLessThanOrEqual(50)
   sent+=data.sentMsgs;cursor=data.nextCursor;if(!cursor)break
   vi.setSystemTime(Date.now()+1100)
  }

  expect(sent).toBe(2);expect(evidence).toHaveLength(5)
 })
})
