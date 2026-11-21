import { disponibilidadIdentidad } from './disponibilidad.mjs'

const ORIGIN = 'https://webapp-3ft.pages.dev'
const sources = {
  'aparcamientos-madrid': { path: '/api/aparcamientos/madrid', city: 'madrid', ttl: 300000, bytes: 524288, maxItems: 500, bounds: [40.2, 40.7, -3.9, -3.4], url: 'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios' },
  'aparcamientos-vigo': { path: '/api/aparcamientos/vigo', city: 'vigo', ttl: 360000, bytes: 524288, maxItems: 200, bounds: [42.1, 42.4, -8.9, -8.5], url: 'https://datos-ckan.vigo.org/dataset/t-parking-real' },
  'bicis-zaragoza': { path: '/api/bicis/zaragoza', city: 'zaragoza', ttl: 300000, bytes: 1048576, maxItems: 1000, bounds: [41.4, 41.9, -1.2, -.6], url: 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad' },
}
export class DisponibilidadFuenteError extends Error {
  constructor(codigo) { super(codigo); this.name = 'DisponibilidadFuenteError'; this.codigo = codigo }
}
const fail = codigo => { throw new DisponibilidadFuenteError(codigo) }
const object = v => !!v && typeof v === 'object' && !Array.isArray(v)
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f\ufffd]/.test(v)
const count = (v, max = 100000) => Number.isSafeInteger(v) && v >= 0 && v <= max
function timestamp(v) {
  if (typeof v !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) return null
  const time = Date.parse(v), canonical = v.includes('.') ? v : v.slice(0, -1) + '.000Z'
  return Number.isFinite(time) && time >= Date.UTC(2020, 0, 1) && new Date(time).toISOString() === canonical ? time : null
}
const cancel = body => { if (body) void body.cancel().catch(() => {}) }
async function readJson(response, max, signal) {
  const length = response.headers.get('content-length')
  if (!response.ok || !response.body) { cancel(response.body); return fail('fuente_no_disponible') }
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { cancel(response.body); return fail('respuesta_invalida') }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let raw = '', bytes = 0
  const onAbort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) return fail('fuente_no_disponible')
      const { done, value } = await reader.read()
      if (signal.aborted) return fail('fuente_no_disponible')
      if (done) break
      bytes += value.byteLength
      if (bytes > max) { void reader.cancel().catch(() => {}); return fail('respuesta_invalida') }
      raw += decoder.decode(value, { stream: true })
    }
    try { return JSON.parse(raw + decoder.decode()) } catch { return fail('respuesta_invalida') }
  } finally { signal.removeEventListener('abort', onAbort); reader.releaseLock() }
}
function coordinates(row, source, bici) {
  if (!bici && row.lat === null && row.lon === null) return { lat: null, lon: null }
  const [minLat, maxLat, minLon, maxLon] = source.bounds
  if (typeof row.lat !== 'number' || typeof row.lon !== 'number' || !Number.isFinite(row.lat) || !Number.isFinite(row.lon) || row.lat < minLat || row.lat > maxLat || row.lon < minLon || row.lon > maxLon) return fail('respuesta_invalida')
  return { lat: row.lat, lon: row.lon }
}
function selected(data, source, input, now) {
  const bici = input.fuente === 'bicis-zaragoza', evaluated = timestamp(data?.evaluadoEn), checked = timestamp(data?.consultado)
  // Los dos servidores pueden diferir unos milisegundos. Sólo evaluadoEn,
  // calculado por nuestra API, admite hasta1s: jamás las fechas de la fuente.
  if (!object(data) || (bici ? data.schema !== 1 || data.redId !== source.city : data.fuenteId !== source.city) || data.fuenteUrl !== source.url || !['actual', 'parcial', 'sin_actualizar'].includes(data.estado) || evaluated === null || evaluated > now + 1000 || !Array.isArray(data.items) || data.items.length > source.maxItems || data.total !== data.items.length) return fail('respuesta_invalida')
  // consultado usa ese mismo reloj propio y sigue acotado por evaluadoEn.
  if (data.consultado !== null && (checked === null || checked > evaluated)) return fail('respuesta_invalida')
  const expiryClock = Math.max(now, evaluated)
  const ids = new Set()
  let row
  for (const item of data.items) {
    if (!object(item) || !disponibilidadIdentidad(input.fuente, item.id, input.objetivo) || ids.has(item.id)) return fail('respuesta_invalida')
    ids.add(item.id)
    if (item.id === input.lugarId) row = item
  }
  if (!row) return fail('lugar_no_encontrado')
  if (!text(row.nombre) || !bici && row.fuenteUrl !== source.url) return fail('respuesta_invalida')
  const point = coordinates(row, source, bici)
  const query = new URLSearchParams({ categorias: input.fuente })
  if (point.lat !== null) { query.set('servicio', row.id); query.set('lat', String(point.lat)); query.set('lon', String(point.lon)) }
  const date = timestamp(bici ? row.actualizado : row.fechaOcupacion), expiry = timestamp(row.caduca), feedDate = bici ? timestamp(data.fechaDatos) : date
  // Una consulta reciente no renueva el dato individual; los tres relojes
  // (parte, ficha y recepción) se comprueban después de terminar la descarga.
  const datesValid = date !== null && feedDate !== null && checked !== null && date <= now && feedDate <= now && date <= evaluated && feedDate <= checked && date <= checked && expiry !== null && expiry > date && expiry <= Math.min(date, feedDate) + source.ttl
  // Elegir el reloj más adelantado sólo acorta vigencia, nunca la prolonga.
  const temporal = datesValid && expiry > expiryClock && expiryClock - evaluated < source.ttl && data.estado !== 'sin_actualizar'
  let quantity = null
  if (bici) {
    const countsValid = count(row.capacidad, 10000) && count(row.bicis, 10000) && count(row.anclajes, 10000) && row.bicis + row.anclajes <= row.capacidad
    const flagsValid = typeof row.permiteAlquiler === 'boolean' && typeof row.permiteDevolucion === 'boolean'
    const allowed = input.objetivo === 'bicis' ? row.permiteAlquiler === true : row.permiteDevolucion === true
    if (temporal && row.estado === 'operativa' && countsValid && flagsValid && allowed) quantity = input.objetivo === 'bicis' ? row.bicis : row.anclajes
  } else if (temporal && row.estado === 'actual' && count(row.plazasLibres) && (row.capacidad === null || count(row.capacidad) && row.plazasLibres <= row.capacidad)) quantity = row.plazasLibres
  const knownDate = date !== null && date <= evaluated && date <= now
  return { id: row.id, nombre: row.nombre.trim(), fuente: input.fuente, objetivo: input.objetivo, ...point, cantidad: quantity,
    fechaDato: knownDate ? new Date(date).toISOString() : null,
    caduca: datesValid ? new Date(expiry).toISOString() : null,
    estado: quantity === null ? 'sin_confirmar' : 'actual', fuenteUrl: source.url, enlace: ORIGIN + '/cerca?' + query,
  }
}
/** Lee una sola red, sin coordenadas de visitantes ni datos de cuenta.
 * No persiste la disponibilidad ni conserva cifras tras un fallo. */
export async function cargaDisponibilidad(input, io = {}) {
  if (!object(input) || !disponibilidadIdentidad(input.fuente, input.lugarId, input.objetivo)) return fail('solicitud_invalida')
  const source = sources[input.fuente], clock = () => typeof io.now === 'function' ? io.now() : io.now ?? Date.now()
  if (!Number.isFinite(clock())) return fail('solicitud_invalida')
  const controller = new AbortController(), timeoutMs = Number.isFinite(io.timeoutMs) ? Math.max(1, Math.min(io.timeoutMs, 10000)) : 8000
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DisponibilidadFuenteError('fuente_no_disponible')) }, timeoutMs) })
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (io.fetch ?? fetch)(ORIGIN + source.path, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json' } })
      if (controller.signal.aborted) { cancel(response.body); return fail('fuente_no_disponible') }
      const data = await readJson(response, source.bytes, controller.signal)
      const now = clock()
      if (!Number.isFinite(now)) return fail('respuesta_invalida')
      return selected(data, source, input, now)
    })()])
  } catch (error) {
    if (error instanceof DisponibilidadFuenteError) throw error
    return fail('fuente_no_disponible')
  } finally { clearTimeout(timer) }
}
