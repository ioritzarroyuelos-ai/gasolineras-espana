import { APP_VERSION } from './version'
import { APARCAMIENTOS_FUENTES, normalizaParkingMadrid, normalizaParkingVigo, parkingSinDisponibilidad, parkingSoloFicha, parkingTimestamp, validaCatalogoParking, type Aparcamiento, type ParkingCatalogo, type ParkingFuente } from './aparcamientos-datos'

export type ParkingAssets = { fetch: (request: Request) => Promise<Response> }
export type ParkingCache = { match: (key: string) => Promise<Response | undefined>; put: (key: string, response: Response) => Promise<void> }
export type ParkingIO = { fetch?: typeof fetch; cache?: ParkingCache; now?: number; timeoutMs?: number }
const fail = (): never => { throw Error('No se pudo comprobar la fuente de aparcamientos') }
const cancel = (body: ReadableStream<Uint8Array> | null) => { if (body) void body.cancel().catch(() => {}) }
export async function parkingReadText(response: Response, max: number, signal?: AbortSignal): Promise<string> {
  const length = response.headers.get('Content-Length')
  if (!response.ok || !response.body || length !== null && (!/^\d+$/.test(length) || +length > max)) { cancel(response.body); return fail() }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  let size = 0, text = ''
  try {
    while (true) {
      if (signal?.aborted) return fail()
      const next = await reader.read()
      if (signal?.aborted) return fail()
      if (next.done) break
      size += next.value.byteLength
      if (size > max) { abort(); return fail() }
      text += decoder.decode(next.value, { stream: true })
    }
    return text + decoder.decode()
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock() }
}
async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, timeout: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Tiempo de consulta agotado')) }, timeout) })])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
export function parkingSoapBody(detailId?: string, now = Date.now()) {
  if (detailId !== undefined && !/^[1-9]\d{0,8}$/.test(detailId)) return fail()
  const content = detailId === undefined ? '<GetListParking xmlns="http://tempuri.org/"><language>ES</language></GetListParking>' : `<GetDetailParking xmlns="http://tempuri.org/"><parametersDetailParking xmlns:i="http://schemas.datacontract.org/2004/07/InfoParking"><i:date>${new Date(now).toISOString()}</i:date><i:family>001</i:family><i:id>${detailId}</i:id><i:language>ES</i:language><i:publicData>true</i:publicData></parametersDetailParking></GetDetailParking>`
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${content}</soap:Body></soap:Envelope>`
}
export async function descargaParking(city: ParkingFuente, io: ParkingIO = {}, detailId?: string): Promise<{ raw: string; consultado: string }> {
  if (city === 'vigo' && detailId !== undefined) return fail()
  const source = APARCAMIENTOS_FUENTES[city]
  return bounded(async signal => {
    const init: RequestInit = { redirect: 'manual', signal, headers: { Accept: city === 'madrid' ? 'text/xml' : 'application/json' } }
    if (city === 'madrid') {
      init.method = 'POST'
      init.headers = { Accept: 'text/xml', 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/iInfoParking/' + (detailId === undefined ? 'GetListParking' : 'GetDetailParking') }
      init.body = parkingSoapBody(detailId, io.now ?? Date.now())
    }
    const response = await (io.fetch ?? fetch)(source.datosUrl, init)
    const raw = await parkingReadText(response, source.maxBytes, signal)
    return { raw, consultado: new Date(io.now ?? Date.now()).toISOString() }
  }, io.timeoutMs ?? 6000)
}
type Copy = { raw: string; consultado: string }
const pending = new WeakMap<typeof fetch, Map<ParkingFuente, Promise<Copy>>>()
const parse = (city: ParkingFuente, raw: string, now: number) => city === 'madrid' ? normalizaParkingMadrid(raw, now) : normalizaParkingVigo(raw, now)
async function live(city: ParkingFuente, io: ParkingIO): Promise<Copy> {
  const now = io.now ?? Date.now(), source = APARCAMIENTOS_FUENTES[city]
  const key = 'https://webapp-3ft.pages.dev/__cache/aparcamientos/v1/' + city
  if (io.cache) {
    try {
      const cached = await io.cache.match(key)
      if (cached) {
        const checked = cached.headers.get('X-EU-Consultado'), at = parkingTimestamp(checked)
        if (at !== null && at <= now && now - at < 60000) {
          const raw = await parkingReadText(cached, source.maxBytes)
          parse(city, raw, now)
          return { raw, consultado: checked! }
        }
        cancel(cached.body)
      }
    } catch {}
  }
  const fetcher = io.fetch ?? fetch
  let entries = pending.get(fetcher)
  if (!entries) { entries = new Map(); pending.set(fetcher, entries) }
  const waiting = entries.get(city)
  if (waiting) return waiting
  const job = (async () => {
    const copy = await descargaParking(city, io)
    parse(city, copy.raw, io.now ?? Date.now())
    if (io.cache) {
      try { await io.cache.put(key, new Response(copy.raw, { headers: { 'Cache-Control': 'public, max-age=60', 'X-EU-Consultado': copy.consultado } })) } catch {}
    }
    return copy
  })()
  entries.set(city, job)
  try { return await job } finally { if (entries.get(city) === job) entries.delete(city) }
}
type CatalogueEntry = { value: ParkingCatalogo; sourceState: string; at: number; version: string }
const catalogues = new WeakMap<ParkingAssets, Map<ParkingFuente, CatalogueEntry>>()
async function catalogue(assets: ParkingAssets, city: ParkingFuente, now: number): Promise<CatalogueEntry> {
  let entries = catalogues.get(assets)
  if (!entries) { entries = new Map(); catalogues.set(assets, entries) }
  const cached = entries.get(city)
  if (cached && cached.version === APP_VERSION && now >= cached.at && now - cached.at < 60000) return cached
  return bounded(async signal => {
    const request = (path: string) => assets.fetch(new Request('https://webapp-3ft.pages.dev/data/aparcamientos/' + path, { signal }))
    const index = JSON.parse(await parkingReadText(await request('index.json'), 8192, signal))
    const checked = parkingTimestamp(index?.consultado)
    if (index?.schema !== 1 || checked === null || checked > now || !Array.isArray(index.fuentes) || index.fuentes.length !== 2 || index.fuentes.filter((s: { id?: string }) => s?.id === city).length !== 1) return fail()
    const source = index.fuentes.find((s: { id?: string }) => s?.id === city)
    if (!['actual', 'parcial', 'conservada'].includes(source.estado) || !Number.isInteger(source.bytes) || source.bytes <= 0 || source.bytes > 524288 || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) return fail()
    const raw = await parkingReadText(await request(city + '.json'), 524288, signal), bytes = new TextEncoder().encode(raw)
    if (bytes.byteLength !== source.bytes) return fail()
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
    if (hash !== source.sha256) return fail()
    const value = validaCatalogoParking(JSON.parse(raw), city, now)
    if (source.ultimoExito !== value.consultado || source.total !== value.total || Date.parse(value.consultado) > checked) return fail()
    const entry = { value, sourceState: source.estado as string, at: now, version: APP_VERSION }
    entries!.set(city, entry)
    return entry
  }, 6000)
}
export async function cargaAparcamientos(city: ParkingFuente, assets?: ParkingAssets, io: ParkingIO = {}) {
  const start = io.now ?? Date.now(), source = APARCAMIENTOS_FUENTES[city]
  const [copied, saved] = await Promise.allSettled([live(city, io), assets ? catalogue(assets, city, start) : Promise.reject(Error('Sin catálogo'))])
  const now = io.now ?? Date.now(), store = saved.status === 'fulfilled' ? saved.value : null
  let items: Aparcamiento[], consulted: string | null = null
  const warnings: string[] = []
  if (copied.status === 'fulfilled') { items = parse(city, copied.value.raw, now); consulted = copied.value.consultado }
  else if (store) { items = store.value.items.map(parkingSinDisponibilidad); warnings.push('No se pudo consultar la ocupación. Se conserva el directorio, sin cifras de plazas libres.') }
  else return fail()
  if (store && copied.status === 'fulfilled') {
    const details = new Map(store.value.items.map(item => [item.id, item]))
    items = items.map(item => {
      const detail = details.get(item.id)
      if (!detail || city !== 'madrid') return item
      const combined = { ...item, capacidad: detail.capacidad, plazasPmr: detail.plazasPmr, horarioTexto: detail.horarioTexto, detalleConsultado: detail.detalleConsultado }
      // Un cambio de capacidad contradictorio no produce disponibilidad inventada.
      if (combined.plazasLibres !== null && combined.capacidad !== null && combined.plazasLibres > combined.capacidad) return { ...combined, plazasLibres: null, caduca: null, estado: 'sin_confirmar' as const }
      return combined
    })
    // Si un parte omite un lugar, conservar la ficha diaria no significa
    // conservar sus cifras: sólo se incorpora sin disponibilidad comprobable.
    const present = new Set(items.map(item => item.id))
    for (const detail of store.value.items) if (!present.has(detail.id)) items.push(parkingSinDisponibilidad(detail))
  }
  const current = items.filter(item => item.estado === 'actual').length
  if (current < items.length) warnings.push(`${items.length - current} aparcamientos no ofrecen una cifra de plazas libres vigente y comprobable.`)
  if (!store) warnings.push('El catálogo de servicios no está disponible. La capacidad y las plazas PMR pueden figurar sin confirmar.')
  else if (now - Date.parse(store.value.consultado) >= 30 * 3600000 || store.sourceState !== 'actual') warnings.push('La actualización del catálogo está pendiente; los detalles conservan su fecha de consulta anterior.')
  if (items.some(item => item.lat === null)) warnings.push('Algunos aparcamientos no tienen coordenadas verificables y sólo aparecen en el listado.')
  warnings.push('Las plazas PMR indican capacidad reservada, no plazas libres. La fuente no confirma gratuidad, apertura ni reservas.')
  return { fuenteId: city, nombre: source.nombre, consultado: consulted, evaluadoEn: new Date(now).toISOString(), catalogoConsultado: store?.value.consultado ?? null, fechaDatos: null,
    fuenteUrl: source.fuenteUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion,
    estado: current === items.length ? 'actual' as const : current ? 'parcial' as const : 'sin_actualizar' as const,
    total: items.length, conDisponibilidad: current, items: items.map(item => ({ ...parkingSoloFicha(item), plazasLibres: item.plazasLibres, fechaOcupacion: item.fechaOcupacion, caduca: item.caduca, estado: item.estado })), warnings }
}
