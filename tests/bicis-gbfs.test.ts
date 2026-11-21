import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { BICIS_MAX_BYTES, cargaBicisZaragoza, normalizaBicisZaragoza, type BicisCache } from '../src/lib/bicis-gbfs'
import { registerBicisRoutes } from '../src/routes/bicis'

const now = Date.parse('2026-11-21T12:00:00Z')
const stamp = (ago = 0) => new Date(now - ago * 1000).toISOString()
const infoRow = { station_id: '2', name: [{ language: 'en', text: 'Other name' }, { language: 'es', text: 'Palacio Congresos' }], lat: 41.669943, lon: -.903698, capacity: 19, address: 'Avenida Ranillas' }
const stateRow = { station_id: '2', last_reported: stamp(60), num_vehicles_available: 7, num_docks_available: 12, is_installed: true, is_renting: true, is_returning: true }
const feed = (stations: unknown[], last_updated = stamp()) => ({ version: '3.0', ttl: 0, last_updated, data: { stations } })
const info = () => feed([infoRow])
const status = (row = stateRow) => feed([row])
function mockedFeed(i: unknown = info(), s: unknown = status()) {
  return vi.fn(async (url: string | URL | Request, _options?: RequestInit) => Response.json(String(url).endsWith('station_information') ? i : s))
}
function app() { const instance = new Hono<{ Bindings: Env }>(); registerBicisRoutes(instance); return instance }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Bizi Zaragoza: estado actual con caducidad', () => {
  it('une las fuentes por ID, conserva coordenadas y atribución sin inventar licencia SPDX', async () => {
    const fetcher = mockedFeed(), data = await cargaBicisZaragoza({ fetch: fetcher, now })
    expect(data).toMatchObject({ redId: 'zaragoza', estado: 'actual', total: 1, fechaDatos: stamp(), consultado: stamp() })
    expect(data.items[0]).toEqual({ id: 'gbfs-zaragoza-2', nombre: 'Palacio Congresos', direccion: 'Avenida Ranillas', lat: infoRow.lat, lon: infoRow.lon, capacidad: 19,
      bicis: 7, anclajes: 12, estado: 'operativa', actualizado: stamp(60), caduca: stamp(-240), permiteAlquiler: true, permiteDevolucion: true })
    expect(data.atribucion).toContain('Ayuntamiento de Zaragoza')
    expect(data.licenciaUrl).toBe('https://www.zaragoza.es/sede/portal/aviso-legal')
    expect(data).not.toHaveProperty('license_id')
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/zaragoza\.publicbikesystem\.net\/customer\/gbfs\/v3\.0\/station_(information|status)$/)
      expect(options?.headers).toEqual({ Accept: 'application/json' }); expect(options?.redirect).toBe('manual')
    }
  })
  it('cero bicis y cero anclajes no equivale a estación cerrada', () => {
    expect(normalizaBicisZaragoza(info(), status({ ...stateRow, num_vehicles_available: 0, num_docks_available: 0 }), now)[0]).toMatchObject({ estado: 'operativa', bicis: 0, anclajes: 0 })
  })
  it.each(['is_installed', 'ambos'])('no ofrece disponibilidad al cerrar: %s', mode => {
    const row = mode === 'ambos' ? { ...stateRow, is_renting: false, is_returning: false } : { ...stateRow, is_installed: false }
    expect(normalizaBicisZaragoza(info(), status(row), now)[0]).toMatchObject({ estado: 'cerrada', bicis: 0, anclajes: 0, permiteAlquiler: false, permiteDevolucion: false })
  })
  it('distingue una estación que sólo permite devolver', () => {
    expect(normalizaBicisZaragoza(info(), status({ ...stateRow, is_renting: false }), now)[0]).toMatchObject({ estado: 'operativa', bicis: 0, anclajes: 12, permiteAlquiler: false, permiteDevolucion: true })
  })
  it.each(['feed', 'estacion', 'limite'])('oculta cifras cuando caduca el %s', mode => {
    const s = mode === 'feed' ? feed([stateRow], stamp(301)) : status({ ...stateRow, last_reported: stamp(mode === 'limite' ? 300 : 301) })
    expect(normalizaBicisZaragoza(info(), s, now)[0]).toMatchObject({ estado: 'sin_actualizar', bicis: null, anclajes: null, permiteAlquiler: null, permiteDevolucion: null })
  })
  it.each(['fecha', 'futura', 'flag', 'negativo', 'excesivo', 'suma'])('no afirma disponibilidad con información incomprobable: %s', mode => {
    const row: Record<string, unknown> = { ...stateRow }
    if (mode === 'fecha') delete row.last_reported
    if (mode === 'futura') row.last_reported = stamp(-1)
    if (mode === 'flag') row.is_renting = 1
    if (mode === 'negativo') row.num_vehicles_available = -1
    if (mode === 'excesivo') row.num_docks_available = 20
    if (mode === 'suma') row.num_docks_available = 13
    const result = normalizaBicisZaragoza(info(), feed([row]), now)[0]
    expect(result).toMatchObject({ estado: 'sin_actualizar', bicis: null, anclajes: null })
  })
  it('mantiene el directorio cuando falta una estación o todo el estado', () => {
    expect(normalizaBicisZaragoza(info(), feed([]), now)[0]).toMatchObject({ estado: 'sin_actualizar', actualizado: null, caduca: null, bicis: null })
  })
  it('una fecha antigua del directorio no rejuvenece ni invalida un estado reciente', () => {
    expect(normalizaBicisZaragoza(feed([infoRow], '2025-01-01T00:00:00Z'), status(), now)[0].estado).toBe('operativa')
  })
  it('señala estado parcial sin descartar estaciones cuyo estado falta', async () => {
    const data = await cargaBicisZaragoza({ fetch: mockedFeed(feed([infoRow, { ...infoRow, station_id: '3' }]), status()), now })
    expect(data.estado).toBe('parcial'); expect(data.total).toBe(2)
    expect(data.items[1].bicis).toBeNull(); expect(data.warnings.join(' ')).toContain('ocultado')
  })
  it.each(['fecha-futura', 'fecha-ausente', 'version', 'duplicada', 'lat', 'nombre', 'muchas'])('rechaza el conjunto corrupto: %s', mode => {
    const i: any = info(), s: any = status()
    if (mode === 'fecha-futura') s.last_updated = stamp(-1)
    if (mode === 'fecha-ausente') delete s.last_updated
    if (mode === 'version') s.version = '2.3'
    if (mode === 'duplicada') s.data.stations.push({ ...stateRow })
    if (mode === 'lat') i.data.stations = [{ ...infoRow, lat: 0 }]
    if (mode === 'nombre') i.data.stations = [{ ...infoRow, name: [] }]
    if (mode === 'muchas') i.data.stations = Array.from({ length: 1001 }, (_, n) => ({ ...infoRow, station_id: String(n) }))
    expect(() => normalizaBicisZaragoza(i, s, now)).toThrow()
  })
  it.each(['redirect', 'html', 'large-header', 'large-stream'])('controla descargas inválidas: %s', async mode => {
    const fetcher = async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } })
      : mode === 'html' ? new Response('<html>error</html>')
      : mode === 'large-header' ? new Response('{}', { headers: { 'Content-Length': String(BICIS_MAX_BYTES + 1) } })
      : new Response(new Uint8Array(BICIS_MAX_BYTES + 1))
    await expect(cargaBicisZaragoza({ fetch: fetcher, now })).rejects.toThrow()
  })
  it('aborta una fuente que no termina de responder', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetcher = (_url: string | URL | Request, options?: RequestInit) => { signals.push(options?.signal); return new Promise<Response>(() => {}) }
    await expect(cargaBicisZaragoza({ fetch: fetcher, now, timeoutMs: 10 })).rejects.toThrow()
    expect(signals.every(signal => signal?.aborted)).toBe(true)
  })
  it('reutiliza 30 s el estado y 24 h el directorio sin cambiar sus fechas', async () => {
    const entries = new Map<string, Response>()
    const cache: BicisCache = { match: async key => entries.get(key)?.clone(), put: async (key, value) => { entries.set(key, value.clone()) } }
    const fetcher = mockedFeed()
    const first = await cargaBicisZaragoza({ fetch: fetcher, cache, now })
    const second = await cargaBicisZaragoza({ fetch: fetcher, cache, now: now + 29_000 })
    expect(fetcher).toHaveBeenCalledTimes(2); expect(second.consultado).toBe(first.consultado)
    const third = await cargaBicisZaragoza({ fetch: fetcher, cache, now: now + 30_000 })
    expect(fetcher).toHaveBeenCalledTimes(3); expect(third.directorioConsultado).toBe(first.directorioConsultado)
    expect(third.consultado).toBe(new Date(now + 30_000).toISOString())
    const fourth = await cargaBicisZaragoza({ fetch: fetcher, cache, now: now + 301_000 })
    expect(fourth.estado).toBe('sin_actualizar'); expect(fourth.items[0].bicis).toBeNull()
  })
  it('sigue funcionando si el almacenamiento de caché falla', async () => {
    const cache: BicisCache = { match: async () => { throw Error('cache unavailable') }, put: async () => { throw Error('cache unavailable') } }
    expect((await cargaBicisZaragoza({ fetch: mockedFeed(), cache, now })).estado).toBe('actual')
  })
  it('la ruta rechaza GPS/query sin consultar el proveedor y no reenvía cookies', async () => {
    vi.setSystemTime(now)
    const fetcher = mockedFeed(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('caches', undefined)
    const instance = app()
    expect((await instance.request('/api/bicis/zaragoza?lat=41.6')).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await instance.request('/api/bicis/zaragoza', { headers: { Cookie: 'session=private', 'CF-Connecting-IP': '192.0.2.1' } })
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.json() as any).items[0].estado).toBe('operativa')
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' })
  })
  it('los fallos de la fuente responden 503 sin publicar detalles internos', async () => {
    vi.stubGlobal('fetch', async () => { throw Error('private details') }); vi.stubGlobal('caches', undefined)
    const response = await app().request('/api/bicis/zaragoza')
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('private details')
  })
  it('cada respuesta evalúa ahora sin rejuvenecer consulta ni comunicación guardadas en caché', async () => {
    vi.setSystemTime(now)
    const values = new Map<string, Response>(), cache = { match: async (key: string) => values.get(key)?.clone(), put: async (key: string, response: Response) => { values.set(key, response) } }
    const fetcher = mockedFeed(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('caches', { open: async () => cache })
    const instance = app(), first = await (await instance.request('/api/bicis/zaragoza')).json() as any
    vi.setSystemTime(now + 20000)
    const response = await instance.request('/api/bicis/zaragoza'), second = await response.json() as any
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(second.evaluadoEn).toBe(new Date(now + 20000).toISOString())
    expect(second.consultado).toBe(first.consultado)
    expect(second.items[0].actualizado).toBe(first.items[0].actualizado)
    expect(second.items[0].caduca).toBe(first.items[0].caduca)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
