import gtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { APP_VERSION } from './version'

const { transit_realtime } = gtfsRealtimeBindings

export const METRO_RT_URL = 'https://ctb-gtfs-rt.s3.eu-south-2.amazonaws.com/metro-bilbao-trip-updates.pb'
export const METRO_FUENTE = 'https://data.ctb.eus/dataset/metro-bilbao-online'
export const METRO_STATIC_FUENTE = 'https://data.ctb.eus/dataset/horario-metro-bilbao'
export const METRO_RT_MAX_AGE = 120000
export const METRO_STATIC_MAX_AGE = 72 * 3600000
type Station = { id: string; nombre: string; lat: number; lon: number }
type Service = { inicio: string | null; fin: string | null; dias: string; excepciones: Record<string, number> }
export type MetroCatalogo = {
  schema: 1; redId: 'metro-bilbao'; ts: string; fechaDatos: string; inicio: string; fin: string
  estaciones: Record<string, Station>; paradas: Record<string, string>
  viajes: Record<string, unknown>; servicios: Record<string, Service>
}
export type MetroAssets = { fetch: (request: Request) => Promise<Response> }
type Store = { match: (key: string) => Promise<Response | undefined>; put: (key: string, value: Response) => Promise<void> }
export type MetroIO = { fetch?: typeof fetch; cache?: Store; now?: number; timeoutMs?: number }
type RealtimeCopy = { raw: Uint8Array<ArrayBuffer>; modified: string; checked: string; at: number }
// Respaldo acotado (una copia por función de transporte, normalmente una por
// isolate). Sólo guarda bytes validados; no conserva promesas ni peticiones.
const realtimeMemory = new WeakMap<typeof fetch, RealtimeCopy>()
type Llegada = { viajeId: string; paradaId: string; destino: string; llegada: string; tipo: 'llegada_estimada'; fechaParte: string }
type Aviso = { viajeId: string; destino: string; estado: 'cancelado' | 'sin_parada'; paradaId?: string }
const fail = (): never => { throw Error('No se pudo comprobar Metro Bilbao') }
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const madridFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
const compareNames = new Intl.Collator('es').compare
function record(value: unknown, max: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > max) return fail()
  return value as Record<string, unknown>
}
const text = (v: unknown, max = 150): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
function timestamp(value: unknown, now: number) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return fail()
  const n = Date.parse(value)
  if (!Number.isFinite(n) || n > now || !new Date(n).toISOString().startsWith(value.slice(0, 19))) return fail()
  return n
}
function day(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{6}$/.test(value)) return false
  const formatted = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8)
  const n = Date.parse(formatted + 'T12:00:00Z')
  return Number.isFinite(n) && new Date(n).toISOString().startsWith(formatted)
}
export function validaCatalogoMetro(value: unknown, now = Date.now()): MetroCatalogo {
  const d = record(value, 25)
  if (d.schema !== 1 || d.redId !== 'metro-bilbao' || d.fuenteUrl !== METRO_STATIC_FUENTE || d.datosUrl !== 'https://ctb-gtfs.s3.eu-south-2.amazonaws.com/metrobilbao.zip' || d.licencia !== 'CC-BY-4.0' || !day(d.inicio) || !day(d.fin) || d.inicio > d.fin) return fail()
  if (timestamp(d.fechaDatos, now) > timestamp(d.ts, now)) return fail()
  const stations = record(d.estaciones, 100), stops = record(d.paradas, 300), services = record(d.servicios, 200), trips = record(d.viajes, 20000)
  if (!Object.keys(stations).length || !Object.keys(stops).length || !Object.keys(trips).length) return fail()
  for (const [id, value] of Object.entries(stations)) {
    const s = record(value, 8)
    if (!/^\d{1,6}$/.test(id) || s.id !== 'metro-bilbao-' + id || !text(s.nombre) || typeof s.lat !== 'number' || typeof s.lon !== 'number' || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || s.lat < 43.1 || s.lat > 43.5 || s.lon < -3.2 || s.lon > -2.7) return fail()
  }
  for (const [id, station] of Object.entries(stops)) if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(id) || typeof station !== 'string' || !own(stations, station)) return fail()
  for (const [id, value] of Object.entries(services)) {
    const s = record(value, 4), exceptions = record(s.excepciones, 2000)
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(id) || typeof s.dias !== 'string' || !/^[01]{7}$/.test(s.dias) || !((s.inicio === null && s.fin === null) || day(s.inicio) && day(s.fin) && s.inicio <= s.fin)) return fail()
    for (const [date, kind] of Object.entries(exceptions)) if (!day(date) || ![1, 2].includes(kind as number)) return fail()
  }
  // El robot valida todos los viajes. El Worker valida cada viaje que realmente
  // usa al unir el parte; no recorre miles de viajes ajenos a esta consulta.
  return d as unknown as MetroCatalogo
}
async function bytes(response: Response, max: number) {
  const length = response.headers.get('Content-Length')
  if (!response.ok || !response.body || length !== null && (!/^\d+$/.test(length) || +length > max)) { if (response.body) void response.body.cancel().catch(() => {}); return fail() }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > max) { void reader.cancel().catch(() => {}); return fail() } chunks.push(next.value) }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}
const catalogues = new WeakMap<MetroAssets, { value?: MetroCatalogo; at: number; version: string; pending?: Promise<MetroCatalogo> }>()
export async function cargaCatalogoMetro(assets: MetroAssets, now = Date.now()) {
  let entry = catalogues.get(assets)
  if (entry?.value && entry.version === APP_VERSION && now >= entry.at && now - entry.at < 300000) return entry.value
  if (entry?.pending) return entry.pending
  entry = { at: now, version: APP_VERSION }; catalogues.set(assets, entry)
  const current = entry
  current.pending = (async () => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Catálogo de Metro Bilbao no disponible')) }, 6000) })
    try {
      const value = await Promise.race([timeout, (async () => {
        const response = await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/transporte/metro-bilbao.json', { signal: controller.signal }))
        return validaCatalogoMetro(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(response, 1500000))), now)
      })()])
      current.value = value; current.at = now
      return value
    } finally { if (timer !== undefined) clearTimeout(timer) }
  })()
  try { return await current.pending } finally { current.pending = undefined }
}
function madridDay(time: number) { return madridFormatter.format(time).replaceAll('-', '') }
function serviceActive(service: Service, date: string) {
  if (own(service.excepciones, date)) return service.excepciones[date] === 1
  if (!service.inicio || !service.fin || date < service.inicio || date > service.fin) return false
  const weekday = new Date(date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8) + 'T12:00:00Z').getUTCDay()
  return service.dias[(weekday + 6) % 7] === '1'
}
function seconds(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : typeof value === 'object' && 'toNumber' in value && typeof value.toNumber === 'function' ? value.toNumber() : Number(String(value))
  return Number.isSafeInteger(n) && n > 0 ? n * 1000 : null
}
export function normalizaMetroRealtime(catalog: MetroCatalogo, raw: Uint8Array, modified: string, consultado: string, now = Date.now()) {
  if (raw.length > 512000) return fail()
  const feed = transit_realtime.FeedMessage.decode(raw), stamp = seconds(feed.header?.timestamp), modifiedStamp = Date.parse(modified)
  if (feed.header?.gtfsRealtimeVersion !== '2.0' || feed.header.incrementality !== 0 || stamp === null || stamp > now || !Number.isFinite(modifiedStamp) || modifiedStamp > now || feed.entity.length > 1000) return fail()
  const published = Math.min(stamp, modifiedStamp), fresh = now - published < METRO_RT_MAX_AGE
  const today = madridDay(now), yesterday = madridDay(now - 86400000)
  const directoryFresh = now - timestamp(catalog.fechaDatos, now) < METRO_STATIC_MAX_AGE && now - timestamp(catalog.ts, now) < 30 * 3600000 && today >= catalog.inicio && today <= catalog.fin
  const arrivals = new Map<string, Llegada[]>(), notices = new Map<string, Aviso[]>(), warnings: string[] = [], cancellations: Aviso[] = []
  let rejected = 0, skew = 0, updates = 0
  const seen = new Set<string>()
  if (fresh && directoryFresh) for (const entity of feed.entity) {
    if (entity.isDeleted) continue
    const update = entity.tripUpdate, id = update?.trip?.tripId
    if (id && seen.has(id)) return fail()
    if (!update || !id || !own(catalog.viajes, id)) { rejected++; continue }
    seen.add(id)
    const trip = record(catalog.viajes[id], 3)
    if (!/^\d{1,12}$/.test(id) || !text(trip.destino) || typeof trip.servicio !== 'string' || !own(catalog.servicios, trip.servicio)) { rejected++; continue }
    const service = catalog.servicios[trip.servicio], tripDate = update.trip?.startDate
    if (update.trip?.routeId && update.trip.routeId !== 'MB' || tripDate && (!day(tripDate) || ![today, yesterday].includes(tripDate) || !serviceActive(service, tripDate)) || !tripDate && ![today, yesterday].some(date => serviceActive(service, date))) { rejected++; continue }
    const observed = seconds(update.timestamp)
    if (observed !== null && (observed > now + 60000 || now - observed >= METRO_RT_MAX_AGE)) { rejected++; continue }
    if (observed !== null && observed > now) skew++
    const relation = update.trip?.scheduleRelationship ?? 0
    if (relation === 3 || relation === 7) {
      if (!tripDate) { rejected++; continue }
      cancellations.push({ viajeId: id, destino: trip.destino, estado: 'cancelado' }); continue
    }
    if (relation !== 0) { rejected++; continue }
    const stopUpdates = update.stopTimeUpdate || []
    if (stopUpdates.length > 500) return fail()
    const stopSeen = new Set<string>()
    for (const stop of stopUpdates) {
      if (++updates > 20000) return fail()
      const stopId = stop.stopId
      if (!stopId || !own(catalog.paradas, stopId) || stopSeen.has(stopId)) { rejected++; continue }
      stopSeen.add(stopId)
      const station = catalog.paradas[stopId]
      if (stop.scheduleRelationship === 1) {
        const list = notices.get(station) || []; list.push({ viajeId: id, paradaId: stopId, destino: trip.destino, estado: 'sin_parada' }); notices.set(station, list); continue
      }
      if (stop.scheduleRelationship !== 0) continue
      const arrival = seconds(stop.arrival?.time)
      // CTB publica llegada, no salida. No se calcula un andén ni retraso desde
      // directionId, que usa numeración distinta al GTFS estático de esta red.
      if (arrival === null || arrival < now || arrival > now + 7200000) continue
      const list = arrivals.get(station) || []
      list.push({ viajeId: id, paradaId: stopId, destino: trip.destino, llegada: new Date(arrival).toISOString(), tipo: 'llegada_estimada', fechaParte: new Date(published).toISOString() })
      arrivals.set(station, list)
    }
  }
  if (!fresh) warnings.push('El parte de llegadas ha caducado. No se muestran predicciones hasta poder comprobarlas.')
  if (!directoryFresh) warnings.push('El catálogo de estaciones y destinos necesita actualizarse. No se unen llegadas con un catálogo antiguo.')
  if (skew) warnings.push('La fuente presenta un pequeño desfase en algunos relojes. La hora mostrada corresponde a la publicación completa del parte.')
  if (rejected) warnings.push('Algunas actualizaciones no se han podido unir con seguridad al catálogo y no se muestran.')
  warnings.push('Son llegadas estimadas publicadas por CTB, no horas de salida ni el horario completo. Una lista vacía no confirma que no haya trenes.')
  const items = Object.entries(catalog.estaciones).map(([id, station]) => {
    const list = (arrivals.get(id) || []).sort((a, b) => a.llegada.localeCompare(b.llegada))
    return { ...station, llegadas: list.slice(0, 5), llegadasTotal: list.length, limitado: list.length > 5, avisos: notices.get(id) || [] }
  }).sort((a, b) => compareNames(a.nombre, b.nombre))
  return { schema: 1, redId: 'metro-bilbao', red: 'Metro Bilbao', consultado, fechaDatos: new Date(published).toISOString(), caduca: new Date(published + METRO_RT_MAX_AGE).toISOString(),
    estado: !fresh || !directoryFresh ? 'sin_actualizar' : rejected ? 'parcial' : 'actual', directorioActual: directoryFresh, fechaDirectorio: catalog.fechaDatos, directorioConsultado: catalog.ts,
    fuenteUrl: METRO_FUENTE, datosUrl: METRO_RT_URL, directorioUrl: METRO_STATIC_FUENTE, licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/', atribucion: 'Consorcio de Transportes de Bizkaia (CTB) · Metro Bilbao · CC-BY4.0',
    total: items.length, llegadasTotal: items.reduce((sum, item) => sum + item.llegadasTotal, 0), rechazadas: rejected, avisos: cancellations, warnings, items }
}
export async function cargaMetroBilbao(assets: MetroAssets, io: MetroIO = {}) {
  const now = io.now ?? Date.now(), catalog = await cargaCatalogoMetro(assets, now), key = 'https://webapp-3ft.pages.dev/__cache/metro-bilbao/v1/rt'
  const fetcher = io.fetch || fetch, memory = realtimeMemory.get(fetcher)
  if (memory && now >= memory.at && now - memory.at < 30000) return normalizaMetroRealtime(catalog, memory.raw, memory.modified, memory.checked, now)
  if (io.cache) try {
    const hit = await io.cache.match(key)
    if (hit) {
      const checked = hit.headers.get('X-EU-Consultado') || '', age = now - Date.parse(checked)
      if (Number.isFinite(age) && age >= 0 && age < 30000) {
        const raw = await bytes(hit, 512000), modified = hit.headers.get('Last-Modified') || ''
        const data = normalizaMetroRealtime(catalog, raw, modified, checked, now)
        realtimeMemory.set(fetcher, { raw, modified, checked, at: Date.parse(checked) })
        return data
      }
      if (hit.body) void hit.body.cancel().catch(() => {})
    }
  } catch {}
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Metro Bilbao no respondió a tiempo')) }, io.timeoutMs ?? 6000) })
  try {
    const result = await Promise.race([timeout, (async () => { const response = await fetcher(METRO_RT_URL, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/x-protobuf' } }); return { raw: await bytes(response, 512000), modified: response.headers.get('Last-Modified') || '' } })()])
    const checked = new Date(io.now ?? Date.now()).toISOString(), data = normalizaMetroRealtime(catalog, result.raw, result.modified, checked, io.now ?? Date.now())
    realtimeMemory.set(fetcher, { ...result, checked, at: Date.parse(checked) })
    if (io.cache) try { await io.cache.put(key, new Response(result.raw, { headers: { 'Cache-Control': 'public, max-age=30', 'Last-Modified': result.modified, 'X-EU-Consultado': checked, 'Content-Type': 'application/x-protobuf' } })) } catch {}
    return data
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
