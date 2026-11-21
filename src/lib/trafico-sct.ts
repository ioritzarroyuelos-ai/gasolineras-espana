import { parseSctXml, sctOne, sctText, type SctXmlNode } from './trafico-sct-xml'

export const SCT_RSS = 'https://www.gencat.cat/transit/opendata/incidenciesRSS.xml'
export const SCT_GML = 'https://www.gencat.cat/transit/opendata/incidenciesGML.xml'
export const SCT_FUENTE = 'https://cit.transit.gencat.cat/'
export const SCT_LICENCIA = 'https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies'
export const SCT_MAX_BYTES = 2 * 1024 * 1024
export const SCT_MAX_AGE = 10 * 60 * 1000
const MAX_ITEMS = 2000
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type CacheStore = { match: (key: string) => Promise<Response | undefined>; put: (key: string, value: Response) => Promise<void> }
export type SctIO = { fetch?: Fetcher; cache?: CacheStore; now?: number; timeoutMs?: number }
type SctDownload = { text: string; consultado: string; modificado: string }
export type IncidenciaSct = {
  id: string; nombre: string; descripcion: string; fechaIncidencia: string
  estado: 'publicada'; lat: number | null; lon: number | null
  carretera?: string; pkInicio?: string; pkFin?: string; sentido?: string; hacia?: string; tipo?: string; causa?: string
}
const fail = (): never => { throw Error('No se pudo comprobar el tráfico de Cataluña') }
const cancel = (body: ReadableStream<Uint8Array> | null) => { if (body) void body.cancel().catch(() => {}) }
export function fechaSct(value: string, now: number): number {
  const m = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (GMT|UTC|CET|CEST)$/.exec(value)
  if (!m) return fail()
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[2])
  const day = +m[1], year = +m[3], hour = +m[4], minute = +m[5], second = +m[6]
  if (year < 2000 || hour > 23 || minute > 59 || second > 59 || day < 1 || new Date(Date.UTC(year, month + 1, 0)).getUTCDate() < day) return fail()
  const n = Date.UTC(year, month, day, hour, minute, second) - (m[7] === 'CET' ? 3600000 : m[7] === 'CEST' ? 7200000 : 0)
  if (n > now) return fail()
  return n
}
const iso = (n: number) => new Date(n).toISOString()
async function readText(response: Response): Promise<string> {
  const length = response.headers.get('Content-Length')
  if (!response.ok || !response.body || length !== null && (!/^\d+$/.test(length) || +length > SCT_MAX_BYTES)) { cancel(response.body); return fail() }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, raw = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > SCT_MAX_BYTES) { void reader.cancel().catch(() => {}); return fail() }
      raw += decoder.decode(value, { stream: true })
    }
    return raw + decoder.decode()
  } finally { reader.releaseLock() }
}
async function download(url: typeof SCT_RSS | typeof SCT_GML, io: SctIO): Promise<SctDownload> {
  const now = io.now ?? Date.now(), key = 'https://webapp-3ft.pages.dev/__cache/sct/v1/' + (url === SCT_RSS ? 'rss' : 'gml')
  if (io.cache) {
    try {
      const cached = await io.cache.match(key)
      if (cached) {
        const consultado = cached.headers.get('X-EU-Consultado') || '', checked = Date.parse(consultado)
        const modificado = cached.headers.get('Last-Modified') || ''
        if (Number.isFinite(checked) && checked <= now && now - checked < 60000) {
          fechaSct(modificado, now)
          return { text: await readText(cached), consultado, modificado }
        }
        cancel(cached.body)
      }
    } catch {}
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('SCT no respondió a tiempo')) }, io.timeoutMs ?? 6000) })
  try {
    const result = await Promise.race([timeout, (async () => {
      const response = await (io.fetch || fetch)(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/xml, application/rss+xml' } })
      const modificado = response.headers.get('Last-Modified') || ''
      fechaSct(modificado, io.now ?? Date.now())
      const text = await readText(response)
      parseSctXml(text)
      return { text, modificado, consultado: iso(io.now ?? Date.now()) }
    })()])
    if (io.cache) try {
      await io.cache.put(key, new Response(result.text, { headers: { 'Cache-Control': 'public, max-age=60', 'Last-Modified': result.modificado, 'X-EU-Consultado': result.consultado, 'Content-Type': 'application/xml' } }))
    } catch {}
    return result
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
function rssIncidencias(root: SctXmlNode, now: number) {
  if (root.tag !== 'rss' || root.attrs.version !== '2.0') return fail()
  const channel = sctOne(root, 'channel'), date = fechaSct(sctText(channel, 'pubDate'), now)
  const rows = channel.children.filter(n => n.tag === 'item')
  if (rows.length > MAX_ITEMS) return fail()
  const ids = new Set<string>()
  const items = rows.map<IncidenciaSct>(row => {
    const id = sctText(row, 'guid', 16), nombre = sctText(row, 'title'), descripcion = sctText(row, 'description', 1200)
    if (!/^\d{1,16}$/.test(id) || ids.has(id) || !nombre || !descripcion) return fail()
    ids.add(id)
    return { id: 'sct-' + id, nombre, descripcion, fechaIncidencia: iso(fechaSct(sctText(row, 'pubDate'), now)), estado: 'publicada', lat: null, lon: null }
  })
  return { items, date }
}
function gmlIncidencias(root: SctXmlNode) {
  if (root.tag !== 'wfs:FeatureCollection' || root.attrs['xmlns:gml'] !== 'http://www.opengis.net/gml') return fail()
  const rows = root.children.filter(n => n.tag === 'gml:featureMember')
  if (rows.length > MAX_ITEMS) return fail()
  const items = new Map<string, Partial<IncidenciaSct>>()
  const optional = (row: SctXmlNode, tag: string, max: number) => row.children.some(n => n.tag === tag) ? sctText(row, tag, max) || undefined : undefined
  for (const member of rows) {
    if (member.children.length !== 1) return fail()
    const row = member.children[0]
    if (row.tag !== 'cite:mct2_v_afectacions_data') return fail()
    const id = sctText(row, 'cite:identificador', 16)
    if (!/^\d{1,16}$/.test(id) || items.has('sct-' + id)) return fail()
    const point = sctOne(sctOne(row, 'cite:geom'), 'gml:Point')
    if (point.attrs.srsName !== 'http://www.opengis.net/gml/srs/epsg.xml#4326') return fail()
    const coordinates = sctOne(point, 'gml:coordinates'), value = coordinates.value.trim()
    if (coordinates.children.length || coordinates.attrs.decimal !== '.' || coordinates.attrs.cs !== ',' || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return fail()
    const [lon, lat] = value.split(',').map(Number)
    // El SCT publica un punto, no el trazado de la vía. No dibujamos un tramo
    // inventado a partir del punto o de sus kilómetros de inicio y fin.
    const located = Number.isFinite(lat) && Number.isFinite(lon) && lat >= 40.4 && lat <= 42.9 && lon >= .1 && lon <= 3.4
    const item: Partial<IncidenciaSct> = { lat: located ? lat : null, lon: located ? lon : null,
      carretera: optional(row, 'cite:carretera', 60), pkInicio: optional(row, 'cite:pk_inici', 30), pkFin: optional(row, 'cite:pk_fi', 30),
      sentido: optional(row, 'cite:sentit', 100), hacia: optional(row, 'cite:cap_a', 400), tipo: optional(row, 'cite:descripcio_tipus', 100), causa: optional(row, 'cite:causa', 400),
    }
    items.set('sct-' + id, item)
  }
  return items
}
export function normalizaTraficoSct(rss: SctDownload, gml: SctDownload, now = Date.now()) {
  const source = rssIncidencias(parseSctXml(rss.text), now), locations = gmlIncidencias(parseSctXml(gml.text))
  const rssDate = fechaSct(rss.modificado, now), gmlDate = fechaSct(gml.modificado, now)
  const fecha = Math.min(source.date, rssDate, gmlDate), caduca = fecha + SCT_MAX_AGE
  const fresh = now < caduca
  // Las dos distribuciones se publican casi a la vez. Si divergen más de dos
  // minutos, conserva el listado pero no une ubicaciones de otra actualización.
  const synchronized = Math.abs(gmlDate - rssDate) <= 120000
  const items = fresh ? source.items.map(item => ({ ...item, ...(synchronized ? locations.get(item.id) : {}) })) : []
  const located = items.filter(item => item.lat !== null && item.lon !== null).length
  return { schema: 1, region: 'Cataluña', regionId: 'cataluna', consultado: [rss.consultado, gml.consultado].sort()[0],
    fechaDatos: iso(fecha), estado: fresh ? 'actual' : 'sin_actualizar', caduca: iso(caduca),
    atribucion: 'Generalitat de Catalunya. Departament d’Interior i Seguretat Pública. Servei Català de Trànsit.',
    licenciaUrl: SCT_LICENCIA, fuenteUrl: SCT_FUENTE, datosUrl: SCT_GML,
    total: items.length, conCoordenadas: located, sinCoordenadas: items.length - located,
    warnings: [
      'Cobertura: carreteras de Cataluña publicadas por el SCT. No incluye el estado del tráfico del resto de España.',
      'Se muestran incidencias presentes en el listado actual del SCT. Su fecha original puede ser anterior; una ausencia no confirma que la vía esté libre.',
      'Los puntos indican una ubicación de referencia, no el tramo completo afectado. Los textos de la fuente se mantienen en catalán.',
      ...(!fresh ? ['La fuente lleva más de 10 minutos sin una publicación comprobable. Se han ocultado las incidencias hasta poder actualizarla.'] : []),
      ...(fresh && items.length !== located ? ['Algunas incidencias no tienen coordenadas comprobables y sólo aparecen en el listado.'] : []),
    ], items,
  }
}
export async function cargaTraficoSct(io: SctIO = {}) {
  const results = await Promise.allSettled([download(SCT_RSS, io), download(SCT_GML, io)])
  if (results[0].status !== 'fulfilled' || results[1].status !== 'fulfilled') return fail()
  return normalizaTraficoSct(results[0].value, results[1].value, io.now ?? Date.now())
}
