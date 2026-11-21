import { afterEach, describe, expect, it, vi } from 'vitest'
import { transit_realtime as gtfs } from 'gtfs-realtime-bindings'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { validaCatalogoMetro, normalizaMetroRealtime, cargaCatalogoMetro, cargaMetroBilbao, METRO_FUENTE, METRO_STATIC_FUENTE, METRO_RT_URL, type MetroIO } from '../src/lib/metro-bilbao'
import { registerTransporteRoutes } from '../src/routes/transporte'

const now = Date.parse('2026-11-21T00:30:00Z'), iso = (n = now) => new Date(n).toISOString(), http = (n = now) => new Date(n).toUTCString()
function catalog() {
  return { schema: 1 as const, redId: 'metro-bilbao' as const, ts: iso(), fechaDatos: iso(now - 3600000), inicio: '20261119', fin: '20261219',
    fuenteUrl: METRO_STATIC_FUENTE, datosUrl: 'https://ctb-gtfs.s3.eu-south-2.amazonaws.com/metrobilbao.zip', licencia: 'CC-BY-4.0',
    estaciones: { '7': { id: 'metro-bilbao-7', nombre: 'Abando', lat: 43.26, lon: -2.92 }, '8': { id: 'metro-bilbao-8', nombre: 'Eliptikoa', lat: 43.263, lon: -2.935 } },
    paradas: { '7.0': '7', '8.0': '8' }, viajes: { '123': { destino: 'Plentzia', servicio: 'viernes' } },
    servicios: { viernes: { inicio: '20261119', fin: '20261219', dias: '0000100', excepciones: {} as Record<string, number> } } }
}
function entity(tripId = '123', time = now + 300000): gtfs.IFeedEntity {
  return { id: 'trip-' + tripId, tripUpdate: { trip: { tripId, routeId: 'MB', directionId: 2, scheduleRelationship: 0 }, timestamp: now / 1000,
    stopTimeUpdate: [{ stopId: '7.0', arrival: { time: time / 1000 } }] } }
}
function feed(entities = [entity()], stamp = now, incrementality = 0) {
  return gtfs.FeedMessage.encode(gtfs.FeedMessage.create({ header: { gtfsRealtimeVersion: '2.0', timestamp: stamp / 1000, incrementality }, entity: entities })).finish()
}
const normalized = (entries = [entity()], c = catalog(), stamp = now) => normalizaMetroRealtime(validaCatalogoMetro(c, now), feed(entries, stamp), http(stamp), iso(), now)
const assets = (c = catalog()) => ({ fetch: vi.fn(async (_req: Request) => new Response(JSON.stringify(c))) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Metro Bilbao: llegadas verificadas sin inventar salidas', () => {
  it('une parada con estación padre y destino por viaje; respeta el servicio de ayer después de medianoche', () => {
    const data = normalized()
    expect(data).toMatchObject({ estado: 'actual', total: 2, llegadasTotal: 1, directorioActual: true, fechaDatos: iso(), caduca: iso(now + 120000) })
    expect(data.items[0]).toMatchObject({ id: 'metro-bilbao-7', nombre: 'Abando', llegadasTotal: 1, llegadas: [{ viajeId: '123', paradaId: '7.0', destino: 'Plentzia', llegada: iso(now + 300000), tipo: 'llegada_estimada' }] })
    expect(JSON.stringify(data)).not.toContain('salidaEstimada'); expect(data.items[0].llegadas[0]).not.toHaveProperty('anden')
    expect(data.items[0].llegadas[0]).not.toHaveProperty('linea'); expect(data.licenciaUrl).toContain('by/4.0')
  })
  it('una red sin predicciones no significa que no haya trenes', () => {
    const data = normalized([])
    expect(data.estado).toBe('actual'); expect(data.total).toBe(2); expect(data.llegadasTotal).toBe(0)
    expect(data.warnings.join(' ')).toContain('no confirma que no haya trenes')
  })
  it.each(['parte', 'directorio', 'consulta', 'calendario'])('oculta predicciones con datos antiguos: %s', mode => {
    const c = catalog()
    if (mode === 'directorio') c.fechaDatos = iso(now - 72 * 3600000)
    if (mode === 'consulta') { c.ts = iso(now - 30 * 3600000); c.fechaDatos = iso(now - 31 * 3600000) }
    if (mode === 'calendario') c.fin = '20261120'
    const data = normalized([entity()], c, mode === 'parte' ? now - 120000 : now)
    expect(data.estado).toBe('sin_actualizar'); expect(data.llegadasTotal).toBe(0); expect(data.items).toHaveLength(2)
  })
  it.each(['pasada', 'lejana', 'sin_hora', 'no_data', 'futuro', 'viaje_viejo', 'viaje_ajeno', 'parada_ajena', 'otro_operador'])('no fabrica una llegada incomprobable: %s', mode => {
    const e = entity(), t = e.tripUpdate!, s = t.stopTimeUpdate![0]
    if (mode === 'pasada') s.arrival!.time = (now - 1000) / 1000
    if (mode === 'lejana') s.arrival!.time = (now + 7201000) / 1000
    if (mode === 'sin_hora') s.arrival = { delay: 60 }
    if (mode === 'no_data') s.scheduleRelationship = 2
    if (mode === 'futuro') t.timestamp = (now + 61000) / 1000
    if (mode === 'viaje_viejo') t.trip!.startDate = '20261119'
    if (mode === 'viaje_ajeno') t.trip!.tripId = '999'
    if (mode === 'parada_ajena') s.stopId = '99.0'
    if (mode === 'otro_operador') t.trip!.routeId = 'other'
    expect(normalized([e]).llegadasTotal).toBe(0)
  })
  it('tolera un desfase individual menor a60s con aviso y fecha del parte; nunca la fecha futura', () => {
    const e = entity(); e.tripUpdate!.timestamp = (now + 15000) / 1000
    const data = normalized([e]); expect(data.llegadasTotal).toBe(1)
    expect(data.items[0].llegadas[0].fechaParte).toBe(iso()); expect(data.warnings.join(' ')).toContain('desfase')
  })
  it('una cancelación sólo se identifica si incluye un día de servicio comprobado; no genera llegada', () => {
    const e = entity(); e.tripUpdate!.trip!.scheduleRelationship = 3; e.tripUpdate!.trip!.startDate = '20261120'
    const data = normalized([e]); expect(data.llegadasTotal).toBe(0)
    expect(data.avisos).toEqual([{ viajeId: '123', destino: 'Plentzia', estado: 'cancelado' }])
    delete e.tripUpdate!.trip!.startDate; expect(normalized([e]).avisos).toEqual([])
    e.tripUpdate!.trip!.startDate = '20261119'; expect(normalized([e]).avisos).toEqual([])
  })
  it('una parada saltada es un aviso, no una llegada', () => {
    const e = entity(); e.tripUpdate!.stopTimeUpdate![0].scheduleRelationship = 1
    const data = normalized([e]); expect(data.llegadasTotal).toBe(0)
    expect(data.items[0].avisos[0]).toMatchObject({ estado: 'sin_parada', paradaId: '7.0' })
  })
  it('respeta las excepciones del calendario y no deduce servicio por ser viernes', () => {
    const c = catalog(); c.servicios.viernes.excepciones['20261120'] = 2
    expect(normalized([entity()], c).llegadasTotal).toBe(0)
    c.servicios.viernes.excepciones['20261121'] = 1
    expect(normalized([entity()], c).llegadasTotal).toBe(1)
  })
  it('limita la presentación a5 con recuento explícito y orden cronológico', () => {
    const c = catalog(), entries: gtfs.IFeedEntity[] = []
    for (let i = 0; i < 7; i++) { const id = String(123 + i); (c.viajes as Record<string, typeof c.viajes['123']>)[id] = c.viajes['123']; entries.push(entity(id, now + (7 - i) * 60000)) }
    const data = normalized(entries, c), stop = data.items[0]
    expect(stop).toMatchObject({ limitado: true, llegadasTotal: 7 }); expect(stop.llegadas).toHaveLength(5)
    expect(stop.llegadas[0].llegada).toBe(iso(now + 60000)); expect(data.llegadasTotal).toBe(7)
  })
  it('no acepta duplicados ambiguos, deltas, futuro delparte o protobuf roto', () => {
    const c = validaCatalogoMetro(catalog(), now)
    expect(() => normalized([entity(), entity('123', now + 400000)])).toThrow()
    expect(() => normalizaMetroRealtime(c, feed([], now, 1), http(), iso(), now)).toThrow()
    expect(() => normalizaMetroRealtime(c, feed([], now + 1000), http(), iso(), now)).toThrow()
    expect(() => normalizaMetroRealtime(c, new Uint8Array([255]), http(), iso(), now)).toThrow()
  })
  it.each(['0,0', 'fecha_futura', 'sin_licencia', 'sin_padre'])('rechaza un catálogo inseguro: %s', mode => {
    const c = catalog()
    if (mode === '0,0') c.estaciones['7'].lat = 0
    if (mode === 'fecha_futura') c.fechaDatos = iso(now + 1000)
    if (mode === 'sin_licencia') c.licencia = ''
    if (mode === 'sin_padre') c.paradas['7.0'] = '999'
    expect(() => validaCatalogoMetro(c, now)).toThrow()
  })
  it('valida el viaje utilizado antes de leer su destino y calendario', () => {
    const c = catalog(); c.viajes['123'].servicio = 'missing'
    expect(normalized([entity()], c)).toMatchObject({ estado: 'parcial', llegadasTotal: 0, rechazadas: 1 })
  })
  it('el catálogo se comparte sólo por binding, coalesce la lectura y caduca a5min', async () => {
    const a = assets(), b = assets()
    await Promise.all([cargaCatalogoMetro(a, now), cargaCatalogoMetro(a, now)])
    expect(a.fetch).toHaveBeenCalledTimes(1)
    await cargaCatalogoMetro(a, now + 299999); expect(a.fetch).toHaveBeenCalledTimes(1)
    await cargaCatalogoMetro(a, now + 300000); expect(a.fetch).toHaveBeenCalledTimes(2)
    await cargaCatalogoMetro(b, now); expect(b.fetch).toHaveBeenCalledTimes(1)
  })
  it('una lectura del catálogo bloqueada caduca y permite reintentar', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined
    const a = { fetch: vi.fn((request: Request) => { signal = request.signal; return new Promise<Response>(() => {}) }) }
    const check = expect(cargaCatalogoMetro(a, now)).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(6000); await check; expect(signal?.aborted).toBe(true)
    a.fetch.mockImplementation(async () => new Response(JSON.stringify(catalog())))
    expect((await cargaCatalogoMetro(a, now)).redId).toBe('metro-bilbao')
  })
  it('RT caché30s mantiene el timestamp y no consulta GPS, cookies ni imágenes', async () => {
    const a = assets(), entries = new Map<string, Response>()
    const cache: NonNullable<MetroIO['cache']> = { match: async k => entries.get(k)?.clone(), put: async (k, v) => { entries.set(k, v.clone()) } }
    const fetcher = vi.fn(async (_u: string | Request | URL, _o?: RequestInit) => new Response(new Uint8Array(feed()), { headers: { 'Last-Modified': http() } }))
    const first = await cargaMetroBilbao(a, { fetch: fetcher, cache, now })
    const second = await cargaMetroBilbao(a, { fetch: fetcher, cache, now: now + 29000 })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(second.consultado).toBe(first.consultado)
    await cargaMetroBilbao(a, { fetch: fetcher, cache, now: now + 30000 }); expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][0]).toBe(METRO_RT_URL)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Accept: 'application/x-protobuf' } })
  })
  it('un fallo de Cache API conserva respaldo acotado30s sin rejuvenecer el parte', async () => {
    const a = assets(), cache: NonNullable<MetroIO['cache']> = { match: async () => { throw Error('cache down') }, put: async () => { throw Error('cache down') } }
    const fetcher = vi.fn(async () => new Response(new Uint8Array(feed()), { headers: { 'Last-Modified': http() } }))
    const first = await cargaMetroBilbao(a, { fetch: fetcher, cache, now })
    const second = await cargaMetroBilbao(a, { fetch: fetcher, cache, now: now + 29000 })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(second.fechaDatos).toBe(first.fechaDatos); expect(second.consultado).toBe(first.consultado)
    await cargaMetroBilbao(a, { fetch: fetcher, cache, now: now + 30000 }); expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each(['redirect', 'oversize', 'sin_fecha'])('falla con descargas no comprobables: %s', async mode => {
    const fetcher = async () => mode === 'redirect' ? new Response(null, { status: 302 }) : mode === 'oversize' ? new Response(new Uint8Array(512001), { headers: { 'Last-Modified': http() } }) : new Response(new Uint8Array(feed()))
    await expect(cargaMetroBilbao(assets(), { fetch: fetcher, now })).rejects.toThrow()
  })
  it('aborta una consulta RT sin respuesta', async () => {
    let signal: AbortSignal | null | undefined
    const fetcher = (_u: string | Request | URL, opts?: RequestInit) => { signal = opts?.signal; return new Promise<Response>(() => {}) }
    await expect(cargaMetroBilbao(assets(), { fetch: fetcher, now, timeoutMs: 10 })).rejects.toThrow()
    expect(signal?.aborted).toBe(true)
  })
  it('API no requiere GPS y falla de forma visible sin catálogo', async () => {
    const app = new Hono<{ Bindings: Env }>(); registerTransporteRoutes(app)
    expect((await app.request('/api/transporte/metro-bilbao?lat=43')).status).toBe(400)
    const r = await app.request('/api/transporte/metro-bilbao')
    expect(r.status).toBe(503); expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect((await r.json()).fuenteUrl).toBe(METRO_FUENTE)
  })
  it('la página de transporte es accesible y conserva las cabeceras estrictas incluso si falla la fuente', async () => {
    const app = new Hono<{ Bindings: Env }>(); registerTransporteRoutes(app)
    const index = await app.request('/transporte/')
    expect(index.status).toBe(200); expect(await index.text()).toContain('/transporte/metro-bilbao')
    expect((await app.request('/transporte')).headers.get('Location')).toBe('/transporte/')
    expect((await app.request('/transporte/metro-bilbao/')).headers.get('Location')).toBe('/transporte/metro-bilbao')
    const page = await app.request('/transporte/metro-bilbao')
    expect(page.status).toBe(503); expect(page.headers.get('Cache-Control')).toBe('no-store')
    expect(page.headers.get('Content-Security-Policy')).toContain("connect-src 'self'")
    expect(page.headers.get('Content-Security-Policy')).not.toContain("'unsafe-inline'")
    const html = await page.text(); expect(html).toContain('No se pueden comprobar las llegadas ahora'); expect(html).toContain('Buscar una estación')
  })
  it('API sirve llegadas actuales y no reenvía credenciales del visitante', async () => {
    vi.setSystemTime(now); vi.stubGlobal('caches', undefined)
    const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(new Uint8Array(feed()), { headers: { 'Last-Modified': http() } }))
    vi.stubGlobal('fetch', fetcher)
    const app = new Hono<{ Bindings: Env }>(); registerTransporteRoutes(app)
    const a = assets(), env = { ASSETS: a } as Env
    const response = await app.request('/api/transporte/metro-bilbao', { headers: { Cookie: 'private=true', Authorization: 'Bearer secret' } }, env)
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ estado: 'actual', llegadasTotal: 1, total: 2 })
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/x-protobuf' })
    expect(a.fetch.mock.calls[0][0].headers.has('Cookie')).toBe(false)
  })
})
