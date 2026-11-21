import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../src/index'
import { registerTelegramRoutes } from '../src/routes/telegram'
import { construyePreciosComparacion } from '../scripts/lib/precios-comparacion.mjs'

const NOW = Date.parse('2026-11-21T09:00:00.000Z')
type Subscription = { station_id: string; fuel_code: string }
async function fixture(count = 100, options: { stale?: boolean; corrupt?: boolean; missing?: boolean; largeNames?: boolean } = {}) {
  const subs: Subscription[] = Array.from({ length: count }, (_, i) => ({ station_id: String(i + 1), fuel_code: '95' }))
  const source = { Fecha: options.stale ? '19/11/2026 10:00:00' : '21/11/2026 10:00:00', ListaEESSPrecio: subs.filter(s => !options.missing || s.station_id !== '1').map(s => ({ IDEESS: s.station_id, 'Rótulo': options.largeNames ? '<&>'.repeat(53) : 'Estación ' + s.station_id, Municipio: options.largeNames ? '<&>'.repeat(40) : 'Bilbao', 'Precio Gasolina 95 E5': s.station_id === '2' ? '' : '1,399' })) }
  const bundle = await construyePreciosComparacion(source, { now: new Date(options.stale ? NOW - 48 * 3600000 : NOW) })
  const files = new Map<string, string>([['index.json', JSON.stringify(bundle.index)], ...bundle.artifacts.map(a => [a.archivo, a.content] as [string, string])])
  const assets = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname.replace('/data/precios-comparacion/', '')
    const body = files.get(path)
    return new Response(body === undefined ? null : options.corrupt && path !== 'index.json' ? body.replace('Estación', 'EstacioX') : body, { status: body === undefined ? 404 : 200 })
  })
  const prepare = vi.fn((_sql: string) => ({ bind: (..._args: unknown[]) => ({ all: async () => ({ success: true, results: subs.slice(0, 101) }) }) }))
  const env = { DB: { prepare }, ASSETS: { fetch: assets }, TELEGRAM_BOT_TOKEN: 'test-bot-only', TELEGRAM_BOT_USERNAME: 'test', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-only' } as unknown as Env
  const messages: string[] = []
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) !== 'https://api.telegram.org/bottest-bot-only/sendMessage') throw Error('Red real prohibida: ' + input)
    messages.push(JSON.parse(String(init?.body)).text); return Response.json({ ok: true })
  })
  const app = new Hono<{ Bindings: Env }>(); registerTelegramRoutes(app)
  const command = (text = '/precios', chat: unknown = 101, secret = 'test-webhook-only') => app.request('/api/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify({ message: { chat: { id: chat }, text } }) }, env)
  return { command, prepare, assets, fetcher, messages, subs }
}
beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW))
afterEach(() => vi.restoreAllMocks())

describe('consulta /precios paginada y acotada', () => {
  it('recorre los100 avisos sin saltos, máximo2 cubos y2 mensajes por petición', async () => {
    const f = await fixture(), seen = new Set<string>(); let totalPages = 1, shown = 0
    for (let page = 1; page <= totalPages; page++) {
      f.assets.mockClear(); const before = f.messages.length
      const response = await f.command(page === 1 ? '/precios' : '/precios ' + page), data = await response.json()
      expect(response.status).toBe(200); expect(data.ok).toBe(true); totalPages = data.pages; shown += data.shown
      expect(f.assets.mock.calls.length).toBeLessThanOrEqual(3)
      expect(f.messages.length - before).toBeLessThanOrEqual(2)
      const text = f.messages.slice(before).join('\n')
      expect(text).toContain(`Página ${page} de ${totalPages}`); expect(text).toContain('Precios de la fuente: 21/11/26, 10:00')
      for (const match of text.matchAll(/Estación (\d+)/g)) { expect(seen.has(match[1])).toBe(false); seen.add(match[1]) }
      expect(text).toContain(page < totalPages ? `/precios ${page + 1}` : 'Fin de la lista.')
    }
    expect(shown).toBe(100); expect(seen.size).toBe(100); expect(totalPages).toBeGreaterThan(1)
    expect(f.messages.every(m => m.length <= 4096)).toBe(true)
  })
  it('conserva en la lista una ficha ausente y un combustible sin precio', async () => {
    const f = await fixture(3, { missing: true }); await f.command()
    expect(f.messages[0]).toContain('Gasolinera 1 (sin ficha en la fuente)')
    expect(f.messages[0]).toContain('Estación 2'); expect(f.messages[0]).toContain('sin precio publicado'); expect(f.messages[0]).not.toContain('cerrado')
  })
  it.each([{ stale: true }, { corrupt: true }])('una fuente inválida %j no devuelve cifras ni afirma que no existan favoritos', async options => {
    const f = await fixture(3, options), response = await f.command()
    expect(await response.json()).toMatchObject({ ok: false, error: 'prices_unavailable' })
    expect(f.messages).toHaveLength(1); expect(f.messages[0]).toContain('No puedo confirmar'); expect(f.messages[0]).not.toContain('€/L'); expect(f.messages[0]).not.toContain('no tienes avisos')
  })
  it('muestra vacío sólo si la base de datos confirma cero avisos', async () => {
    const f = await fixture(1); f.subs.splice(0); await f.command()
    expect(f.messages[0]).toContain('no tienes avisos'); expect(f.assets).not.toHaveBeenCalled()
  })
  it('un límite legado excedido se explica sin truncar una lista silenciosamente', async () => {
    const f = await fixture(101), response = await f.command()
    expect(await response.json()).toMatchObject({ error: 'invalid_subscriptions' }); expect(f.messages[0]).toContain('No he omitido'); expect(f.assets).not.toHaveBeenCalled()
  })
  it('una página inexistente o un comando mal formado no descarga precios', async () => {
    const f = await fixture(3); await f.command('/precios 99'); await f.command('/precios 0'); await f.command('/precios 2e1')
    expect(f.assets).not.toHaveBeenCalled(); expect(f.messages).toHaveLength(3)
  })
  it('escapa nombres largos manteniendo menos de2 mensajes y el límite de Telegram', async () => {
    const f = await fixture(100, { largeNames: true }); await f.command()
    expect(f.messages.length).toBeLessThanOrEqual(2); expect(f.messages.every(m => m.length <= 4096)).toBe(true)
    expect(f.messages.join('')).toContain('&lt;&amp;&gt;'); expect(f.messages.join('')).not.toContain('<&>')
  })
  it('un secreto erróneo o chat no seguro no lee ni envía', async () => {
    const f = await fixture(1); expect((await f.command('/precios',101,'wrong')).status).toBe(401)
    for (const id of [-1, 'abc', 1.2, Number.MAX_SAFE_INTEGER + 1]) await f.command('/precios',id)
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.assets).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('rechazo de Telegram no queda marcado como entrega correcta ni se reintenta a ciegas', async () => {
    const f = await fixture(3); f.fetcher.mockResolvedValueOnce(Response.json({ ok: false, error_code: 429 },{status:429}))
    expect(await (await f.command()).json()).toMatchObject({ok:false,error:'telegram_send_failed'}); expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
})
