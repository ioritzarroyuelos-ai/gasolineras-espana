const BASE = 'https://zaragoza.publicbikesystem.net/customer/gbfs/v3.0/'
export const BICIS_ZARAGOZA_FUENTE = 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad'
export const BICIS_ZARAGOZA_LICENCIA = 'https://www.zaragoza.es/sede/portal/aviso-legal'
export const BICIS_MAX_BYTES = 1024 * 1024
export const BICIS_MAX_AGE = 5 * 60 * 1000
const MAX_STATIONS = 1000
const ID = /^[a-zA-Z0-9_-]{1,100}$/
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type BicisCache = { match: (key: string) => Promise<Response | undefined>; put: (key: string, response: Response) => Promise<void> }
export type BicisIO = { fetch?: Fetcher; cache?: BicisCache; now?: number; timeoutMs?: number }
type Envelope = { last_updated: string; ttl: number; version: '3.0'; data: { stations: Record<string, unknown>[] } }
type Station = { station_id: string; nombre: string; direccion?: string; lat: number; lon: number; capacidad: number }
export interface BiciEstacion extends Omit<Station, 'station_id'> {
  id: string
  bicis: number | null
  anclajes: number | null
  estado: 'operativa' | 'cerrada' | 'sin_actualizar'
  actualizado: string | null
  caduca: string | null
  permiteAlquiler: boolean | null
  permiteDevolucion: boolean | null
}
const fail = (): never => { throw Error('No se pudo comprobar la red Bizi Zaragoza') }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000
// Una respuesta clonada puede tener otra rama sin consumir: su cancelación no
// debe bloquear la petición mientras esa rama permanece en la caché.
const cancel = (body: ReadableStream<Uint8Array> | null) => { if (body) void body.cancel().catch(() => {}) }
function timestamp(v: unknown, now: number): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v)) return null
  const n = Date.parse(v)
  return Number.isFinite(n) && n >= Date.UTC(2020, 0, 1) && n <= now ? n : null
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get('Content-Length')
  if (!response.ok || !response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > BICIS_MAX_BYTES))) { cancel(response.body); return fail() }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, raw = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > BICIS_MAX_BYTES) { void reader.cancel().catch(() => {}); return fail() }
      raw += decoder.decode(value, { stream: true })
    }
    return JSON.parse(raw + decoder.decode()) as unknown
  } finally { reader.releaseLock() }
}
function envelope(value: unknown, now: number): Envelope {
  if (!object(value) || value.version !== '3.0' || timestamp(value.last_updated, now) === null || !count(value.ttl) || !object(value.data) || !Array.isArray(value.data.stations) || value.data.stations.length > MAX_STATIONS) return fail()
  const ids = new Set<string>()
  for (const item of value.data.stations) {
    if (!object(item) || typeof item.station_id !== 'string' || !ID.test(item.station_id) || ids.has(item.station_id)) return fail()
    ids.add(item.station_id)
  }
  return value as Envelope
}
function station(value: Record<string, unknown>): Station {
  const localized = Array.isArray(value.name) ? value.name.find(v => object(v) && v.language === 'es') || value.name.find(v => object(v) && v.language === 'en') : null
  if (!object(localized) || !text(localized.text) || !count(value.capacity) ||
    typeof value.lat !== 'number' || typeof value.lon !== 'number' || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) ||
    value.lat < 41.4 || value.lat > 41.9 || value.lon < -1.2 || value.lon > -.6 ||
    value.address !== undefined && !text(value.address, 300)) return fail()
  return { station_id: value.station_id as string, nombre: localized.text, lat: value.lat, lon: value.lon, capacidad: value.capacity, ...(value.address ? { direccion: value.address as string } : {}) }
}
type Loaded = { feed: Envelope; consultado: string }
async function readFeed(kind: 'station_information' | 'station_status', io: BicisIO): Promise<Loaded> {
  const now = io.now ?? Date.now(), seconds = kind === 'station_information' ? 86400 : 30
  // Sólo dos claves internas fijas: no dependen del visitante ni de su posición.
  const key = 'https://webapp-3ft.pages.dev/__cache/bicis-zaragoza/v1/' + kind
  if (io.cache) {
    try {
      const cached = await io.cache.match(key)
      if (cached) {
        const checked = cached.headers.get('X-EU-Consultado'), checkedMs = timestamp(checked, now)
        if (checkedMs !== null && now - checkedMs < seconds * 1000) return { feed: envelope(await readJson(cached), now), consultado: checked! }
        cancel(cached.body)
      }
    } catch { /* Una caché no disponible no impide consultar el origen. */ }
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Bizi no respondió a tiempo')) }, io.timeoutMs ?? 6000) })
  try {
    const feed = await Promise.race([timeout, (async () => {
      const response = await (io.fetch || fetch)(BASE + kind, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } })
      // Un reloj fijo facilita las pruebas; en producción se valida tras recibir
      // el cuerpo, para no rechazar una publicación de los segundos de descarga.
      return envelope(await readJson(response), io.now ?? Date.now())
    })()])
    if (kind === 'station_information') {
      if (!feed.data.stations.length) return fail()
      feed.data.stations.forEach(station)
    }
    const consultado = new Date(io.now ?? Date.now()).toISOString()
    if (io.cache) {
      try { await io.cache.put(key, Response.json(feed, { headers: { 'Cache-Control': 'public, max-age=' + seconds, 'X-EU-Consultado': consultado } })) }
      catch { /* Mantiene la respuesta verificada si el edge no admite caché. */ }
    }
    return { feed, consultado }
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
export function normalizaBicisZaragoza(information: unknown, status: unknown, now = Date.now()): BiciEstacion[] {
  const info = envelope(information, now), state = envelope(status, now)
  if (!info.data.stations.length) return fail()
  const feedDate = timestamp(state.last_updated, now)!
  const statuses = new Map(state.data.stations.map(row => [row.station_id as string, row]))
  return info.data.stations.map<BiciEstacion>(raw => {
    const { station_id, ...item } = station(raw), row = statuses.get(station_id)
    const reported = row ? timestamp(row.last_reported, now) : null
    const validFlags = row && ['is_installed', 'is_renting', 'is_returning'].every(key => typeof row[key] === 'boolean')
    const validCounts = row && count(row.num_vehicles_available) && count(row.num_docks_available) && row.num_vehicles_available <= item.capacidad && row.num_docks_available <= item.capacidad && row.num_vehicles_available + row.num_docks_available <= item.capacidad
    const expiry = reported === null ? null : Math.min(reported, feedDate) + BICIS_MAX_AGE
    const fresh = expiry !== null && now < expiry && validFlags && validCounts
    const installed = fresh ? row!.is_installed === true : null
    const renting = fresh ? installed === true && row!.is_renting === true : null
    const returning = fresh ? installed === true && row!.is_returning === true : null
    return { ...item, id: 'gbfs-zaragoza-' + station_id,
      bicis: fresh && renting ? row!.num_vehicles_available as number : fresh ? 0 : null,
      anclajes: fresh && returning ? row!.num_docks_available as number : fresh ? 0 : null,
      estado: !fresh ? 'sin_actualizar' : !installed || !renting && !returning ? 'cerrada' : 'operativa',
      actualizado: reported === null ? null : new Date(reported).toISOString(),
      caduca: expiry === null ? null : new Date(expiry).toISOString(),
      permiteAlquiler: renting, permiteDevolucion: returning,
    }
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}
export async function cargaBicisZaragoza(io: BicisIO = {}) {
  const results = await Promise.allSettled([readFeed('station_information', io), readFeed('station_status', io)])
  // Espera ambas consultas acotadas aunque una falle: el Worker no deja una
  // descarga de la otra fuente trabajando después de responder al visitante.
  if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') return fail()
  const information = results[0].value, status = results[1].value
  const now = io.now ?? Date.now(), items = normalizaBicisZaragoza(information.feed, status.feed, now)
  const current = items.filter(item => item.estado !== 'sin_actualizar').length
  return { schema: 1, red: 'Bizi Zaragoza', redId: 'zaragoza', consultado: status.consultado,
    directorioConsultado: information.consultado, fechaDatos: status.feed.last_updated,
    estado: current === items.length ? 'actual' : current ? 'parcial' : 'sin_actualizar',
    caduca: new Date(Date.parse(status.feed.last_updated) + BICIS_MAX_AGE).toISOString(),
    fuenteUrl: BICIS_ZARAGOZA_FUENTE, datosUrl: BASE + 'gbfs.json', licenciaUrl: BICIS_ZARAGOZA_LICENCIA,
    atribucion: 'Origen de los datos: Ayuntamiento de Zaragoza · Bizi Zaragoza',
    warnings: ['La disponibilidad puede cambiar durante el trayecto. Consulta las condiciones y tarifas del servicio Bizi.',
      ...(current < items.length ? ['Hay estaciones sin un estado reciente comprobable. Sus cifras de disponibilidad se han ocultado.'] : [])],
    total: items.length, items,
  }
}
