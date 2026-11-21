import { parseSctXml, sctOne, sctText, type SctXmlNode } from './trafico-sct-xml'
import { fechaSct, SCT_LICENCIA } from './trafico-sct'

export const CAMARAS_SCT_XML = 'https://www.gencat.cat/transit/opendata/cameres.xml'
export const CAMARAS_SCT_FUENTE = 'https://analisi.transparenciacatalunya.cat/Transport/C-meres-de-tr-nsit-a-les-carreteres-de-Catalunya/3tzz-6b9y'
export const CAMARAS_MAX_BYTES = 512 * 1024
export const CAMARAS_MAX_AGE = 30 * 60 * 60 * 1000
type Fetcher = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
type Store = { match: (key: string) => Promise<Response | undefined>; put: (key: string, value: Response) => Promise<void> }
export type CamarasIO = { fetch?: Fetcher; cache?: Store; now?: number; timeoutMs?: number }
export type CamaraSct = {
  id: string; nombre: string; carretera?: string; municipio?: string; pk?: string
  lat: number | null; lon: number | null; ubicacion: 'publicada' | 'por_confirmar'
  urlCamara: string; fuenteImagen: 'SCT' | 'Ajuntament de Terrassa'; horaImagen: null
}
const fail = (): never => { throw Error('No se pudo comprobar el directorio de cámaras del SCT') }
const cancel = (body: ReadableStream<Uint8Array> | null) => { if (body) void body.cancel().catch(() => {}) }
function cameraUrl(raw: string, source: string): Pick<CamaraSct, 'id' | 'urlCamara' | 'fuenteImagen'> | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || u.hash) return null
  if (source === 'SCT' && u.hostname === 'mct.gencat.cat' && u.pathname === '/mct2bo/RenderService') {
    const id = u.searchParams.get('sctidcam')
    if (u.searchParams.size !== 1 || !id || !/^[a-zA-Z0-9_-]{1,40}\.gif$/.test(id)) return null
    return { id: 'camara-sct-' + id.slice(0, -4), fuenteImagen: 'SCT', urlCamara: 'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=' + encodeURIComponent(id) }
  }
  if (source === 'Terrassa' && u.hostname === 'emap.terrassa.cat' && /^\/it_terrassa\/cam\d{2}\.jpeg$/.test(u.pathname) &&
      [...u.searchParams].every(([k, v]) => k === 'a' && /^\d{1,4}$/.test(v)) && u.searchParams.size <= 1) {
    return { id: 'camara-terrassa-' + u.pathname.split('/').at(-1)!.slice(0, -5), fuenteImagen: 'Ajuntament de Terrassa', urlCamara: 'https://emap.terrassa.cat' + u.pathname + u.search }
  }
  return null
}
export function normalizaCamarasSct(xml: string, modified: string, consultado: string, now = Date.now()) {
  const root = parseSctXml(xml), fecha = fechaSct(modified, now)
  if (root.tag !== 'wfs:FeatureCollection' || root.attrs['xmlns:gml'] !== 'http://www.opengis.net/gml') return fail()
  const rows = root.children.filter(n => n.tag === 'gml:featureMember')
  if (!rows.length || rows.length > 500) return fail()
  const optional = (row: SctXmlNode, tag: string, max: number) => row.children.some(n => n.tag === tag) ? sctText(row, tag, max) || undefined : undefined
  const cameras = new Map<string, CamaraSct>()
  let excluidas = 0, duplicadas = 0
  for (const member of rows) {
    if (member.children.length !== 1 || member.children[0].tag !== 'cite:cameres') return fail()
    const row = member.children[0], source = sctText(row, 'cite:font', 100)
    // El catálogo mezcla una cámara de Andorra. La región de esta capa sólo
    // incluye los operadores catalanes comprobados; no amplía cobertura sola.
    if (!['SCT', 'Terrassa'].includes(source)) { excluidas++; continue }
    const official = cameraUrl(sctText(row, 'cite:link', 500), source)
    if (!official) { excluidas++; continue }
    const point = sctOne(sctOne(row, 'cite:geom'), 'gml:Point'), coordinates = sctOne(point, 'gml:coordinates')
    const value = coordinates.value.trim()
    if (point.attrs.srsName !== 'http://www.opengis.net/gml/srs/epsg.xml#4326' || coordinates.attrs.decimal !== '.' || coordinates.attrs.cs !== ',' || coordinates.children.length || !/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value)) return fail()
    const [lon, lat] = value.split(',').map(Number), located = Number.isFinite(lat) && Number.isFinite(lon) && lat >= 40.4 && lat <= 42.9 && lon >= .1 && lon <= 3.4
    const carretera = optional(row, 'cite:carretera', 150), municipio = optional(row, 'cite:municipi', 150), pk = optional(row, 'cite:pk', 40)
    const item: CamaraSct = { ...official, nombre: [carretera, pk ? 'km ' + pk : '', municipio].filter(Boolean).join(' · ') || 'Cámara ' + official.fuenteImagen,
      carretera, municipio, pk, lat: located ? lat : null, lon: located ? lon : null, ubicacion: located ? 'publicada' : 'por_confirmar', horaImagen: null }
    const previous = cameras.get(item.id)
    if (previous) {
      duplicadas++
      if (previous.lat !== item.lat || previous.lon !== item.lon || previous.carretera !== item.carretera || previous.municipio !== item.municipio || previous.pk !== item.pk) {
        cameras.set(item.id, { ...official, nombre: 'Cámara ' + official.fuenteImagen + ' · ubicación por confirmar', lat: null, lon: null, ubicacion: 'por_confirmar', horaImagen: null })
      }
    } else cameras.set(item.id, item)
  }
  const items = [...cameras.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  if (!items.length) return fail()
  return { schema: 1, region: 'Cataluña', regionId: 'cataluna', consultado, fechaDirectorio: new Date(fecha).toISOString(),
    estado: now - fecha < CAMARAS_MAX_AGE ? 'actual' : 'sin_actualizar', caduca: new Date(fecha + CAMARAS_MAX_AGE).toISOString(),
    fuenteUrl: CAMARAS_SCT_FUENTE, datosUrl: CAMARAS_SCT_XML, licenciaUrl: SCT_LICENCIA,
    atribucion: 'Generalitat de Catalunya. Departament d’Interior i Seguretat Pública. Servei Català de Trànsit.',
    atribucionImagenes: 'Las imágenes se consultan en el sitio de su fuente original: SCT o Ajuntament de Terrassa. No se copian ni se atribuye una licencia de imagen.',
    total: items.length, conCoordenadas: items.filter(item => item.lat !== null && item.lon !== null).length, excluidas, duplicadas,
    warnings: ['La fecha corresponde al directorio de ubicaciones, no a las imágenes. La hora de cada imagen no está publicada en este catálogo.',
      'Ver cámara oficial abre la web de la fuente en otra pestaña. España Útil no descarga ni muestra imágenes automáticamente.',
      ...(now - fecha >= CAMARAS_MAX_AGE ? ['El directorio lleva más de 30 horas sin una actualización comprobable. Confirma la ubicación y disponibilidad en la fuente.'] : []),
    ], items,
  }
}
async function boundedText(response: Response): Promise<string> {
  const length = response.headers.get('Content-Length')
  if (!response.ok || !response.body || length !== null && (!/^\d+$/.test(length) || +length > CAMARAS_MAX_BYTES)) { cancel(response.body); return fail() }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > CAMARAS_MAX_BYTES) { void reader.cancel().catch(() => {}); return fail() }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}
export async function cargaCamarasSct(io: CamarasIO = {}) {
  const now = io.now ?? Date.now(), key = 'https://webapp-3ft.pages.dev/__cache/camaras-sct/v1/directorio'
  if (io.cache) {
    try {
      const cached = await io.cache.match(key)
      if (cached) {
        const checked = cached.headers.get('X-EU-Consultado') || '', stamp = Date.parse(checked)
        if (Number.isFinite(stamp) && stamp <= now && now - stamp < 3600000) return normalizaCamarasSct(await boundedText(cached), cached.headers.get('Last-Modified') || '', checked, now)
        cancel(cached.body)
      }
    } catch {}
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('El directorio de cámaras no respondió a tiempo')) }, io.timeoutMs ?? 6000) })
  try {
    const { xml, modified } = await Promise.race([timeout, (async () => {
      const response = await (io.fetch || fetch)(CAMARAS_SCT_XML, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/xml' } })
      return { xml: await boundedText(response), modified: response.headers.get('Last-Modified') || '' }
    })()])
    const consultado = new Date(io.now ?? Date.now()).toISOString(), data = normalizaCamarasSct(xml, modified, consultado, io.now ?? Date.now())
    if (io.cache) try {
      await io.cache.put(key, new Response(xml, { headers: { 'Cache-Control': 'public, max-age=3600', 'Last-Modified': modified, 'X-EU-Consultado': consultado, 'Content-Type': 'application/xml' } }))
    } catch {}
    return data
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
