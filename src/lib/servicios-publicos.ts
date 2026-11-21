import { APP_VERSION } from './version'
import { zonaValida } from './servicios'
import { servicioTileBbox } from '../../scripts/lib/servicios.mjs'
import { SERVICIOS_PUBLICOS_FUENTES, SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES, SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES, validaManifestPublicos, validaBusquedaPublicos, normalizaBusquedaPublica, validaIndicePublicos, validaServicioPublico, type ManifestPublicos, type DescriptorPublico, type FuentePublicaId, type IndicePublicos, type ServicioPublico } from '../../scripts/lib/servicios-publicos.mjs'
import { identidadPublicaValida, validaIdentidadesPublicas, SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES } from '../../scripts/lib/servicios-publicos.mjs'

export type PublicosAssets = { fetch: (request: Request) => Promise<Response> }
export const PUBLICOS_PAGE_SIZE = 50
export const PUBLICOS_MAP_SIZE = 200
const SEARCH_PAGE_SIZE = 25
const definitions = new Map(SERVICIOS_PUBLICOS_FUENTES.map(f => [f.id, f]))
const fail = (): never => { throw Error('No se puede comprobar el directorio oficial') }
export class PublicosLookupPendiente extends Error {}
const indexCache = new WeakMap<PublicosAssets, { version: string; until: number; pending: Promise<IndicePublicos> }>()
// Acotada por binding y despliegue: los bloques nunca crecen con el número de
// zonas visitadas. La identidad incluye el hash del contenido inmutable.
const assetCache = new WeakMap<PublicosAssets, Map<string, { until: number; pending: Promise<unknown> }>>()

export function fuentePublicaId(value: string): FuentePublicaId | null { return definitions.has(value as FuentePublicaId) ? value as FuentePublicaId : null }
export function consultaPublicos(url: URL, api = false) {
  for (const key of url.searchParams.keys()) if (!(api ? ['zona', 'pagina'] : ['q', 'pagina']).includes(key) || url.searchParams.getAll(key).length !== 1) return null
  const page = url.searchParams.get('pagina') || '0', q = (url.searchParams.get('q') || '').trim(), zone = url.searchParams.get('zona')
  if (!/^(0|[1-9]\d{0,3})$/.test(page) || q.length > 70 || /[\u0000-\u001f\u007f]/.test(q) || zone !== null && (!/^\d{1,3}-\d{1,4}$/.test(zone) || !zonaValida(zone))) return null
  return { pagina: Number(page), q, zona: zone }
}
async function readAsset(assets: PublicosAssets, file: string, max: number): Promise<Uint8Array> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('El directorio no respondió a tiempo')) }, 6000) })
  try {
    return await Promise.race([timeout, (async () => {
      const response = await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/servicios-publicos/' + file, { signal: controller.signal }))
      const length = response.headers.get('Content-Length')
      if (!response.ok || !response.body || length !== null && (!/^\d+$/.test(length) || +length > max)) { if (response.body) void response.body.cancel().catch(() => {}); return fail() }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0
      try { while (true) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > max) { void reader.cancel().catch(() => {}); return fail() } chunks.push(next.value) } }
      finally { reader.releaseLock() }
      const bytes = new Uint8Array(total); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return bytes
    })()])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
const parse = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
export async function cargaIndicePublicos(assets: PublicosAssets | undefined, now = Date.now()): Promise<IndicePublicos> {
  if (!assets) return fail()
  const saved = indexCache.get(assets)
  if (saved && saved.version === APP_VERSION && saved.until > now && saved.until - now <= 30000) return saved.pending
  const entry = { version: APP_VERSION, until: now + 30000, pending: readAsset(assets, 'index.json', 16000).then(raw => validaIndicePublicos(parse(raw), now)) }
  entry.pending = entry.pending.catch(error => { if (indexCache.get(assets) === entry) indexCache.delete(assets); throw error })
  indexCache.set(assets, entry); return entry.pending
}
async function checkedAsset<T>(assets: PublicosAssets, file: string, descriptor: { bytes: number; sha256: string }, max: number, validate: (data: unknown) => T, now: number): Promise<T> {
  if (descriptor.bytes < 2 || descriptor.bytes > max || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) return fail()
  let saved = assetCache.get(assets)
  if (!saved) { saved = new Map(); assetCache.set(assets, saved) }
  const key = APP_VERSION + ':' + file + ':' + descriptor.sha256 + ':' + descriptor.bytes, cached = saved.get(key)
  if (cached && cached.until > now && cached.until - now <= 300000) return cached.pending as Promise<T>
  const pending = (async () => {
    const bytes = await readAsset(assets, file, descriptor.bytes)
    if (bytes.byteLength !== descriptor.bytes) return fail()
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(b => b.toString(16).padStart(2, '0')).join('')
    if (hash !== descriptor.sha256) return fail()
    return validate(parse(bytes))
  })()
  const entry = { until: now + 300000, pending }
  entry.pending = pending.catch(error => { if (saved.get(key) === entry) saved.delete(key); throw error })
  saved.delete(key)
  while (saved.size >= 32) saved.delete(saved.keys().next().value!)
  saved.set(key, entry); return entry.pending
}
async function cargaManifest(assets: PublicosAssets, id: FuentePublicaId, index: IndicePublicos, now: number): Promise<ManifestPublicos> {
  const row = index.fuentes.find(f => f.id === id)
  if (!row || row.estado === 'error' || !row.manifestSha256 || !row.manifestBytes) return fail()
  const data = await checkedAsset(assets, id + '/manifest.json', { bytes: row.manifestBytes, sha256: row.manifestSha256 }, SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES, raw => validaManifestPublicos(raw, now), now)
  if (data.id !== id || data.consultado !== row.ultimoExito || data.fechaDatos !== row.fechaDatos || data.total !== row.total || Date.parse(data.fechaDatos) > now || Date.parse(data.fechaDatos) > Date.parse(data.consultado)) return fail()
  return data
}
export function estadoPublicos(data: ManifestPublicos, index: IndicePublicos, now = Date.now()) {
  const row = index.fuentes.find(f => f.id === data.id)
  const desactualizado = row?.estado !== 'actual' || now - Date.parse(data.consultado) >= 30 * 3600000 || now - Date.parse(index.consultado) >= 30 * 3600000
  return { schema: 1, proveedor: 'servicios-publicos' as const, fuenteId: data.id, nombre: data.nombre, consultado: data.consultado, ultimoIntento: index.consultado, fechaDatos: data.fechaDatos,
    fuenteUrl: data.fuenteUrl, licenciaUrl: data.licenciaUrl, atribucion: data.atribucion, totalDirectorio: data.total, conCoordenadas: data.conCoordenadas, sinCoordenadas: data.sinCoordenadas,
    estado: desactualizado ? 'conservada' as const : 'actual' as const, desactualizado,
    favoritosDisponibles: data.identidades !== undefined,
    avisos: [...(desactualizado ? ['No se ha podido renovar este directorio. Se conserva la última copia comprobada y su fecha original.'] : []), ...data.avisos] }
}
async function cargaFilas(assets: PublicosAssets, manifest: ManifestPublicos, descriptor: DescriptorPublico, now: number): Promise<unknown[]> {
  return checkedAsset(assets, manifest.id + '/' + manifest.version + '/' + descriptor.archivo, descriptor, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES, raw => {
    if (!Array.isArray(raw) || raw.length !== descriptor.total) return fail()
    // La integridad del bloque completo se verifica antes de parsearlo. Las
    // filas seleccionadas se validan una a una antes de entregar la respuesta.
    return raw
  }, now)
}
function validaFilas(rows: unknown[], data: ManifestPublicos, zona: string | null, now: number): ServicioPublico[] {
  const bounds = zona ? servicioTileBbox(zona) : null, ids = new Set<string>()
  return rows.map(value => {
    const p = validaServicioPublico(value, data.id, now)
    if (ids.has(p.id) || bounds && (p.lat === null || p.lon === null || p.lon < bounds[0] || p.lon >= bounds[2] || p.lat < bounds[1] || p.lat >= bounds[3])) return fail()
    ids.add(p.id); return p
  })
}
type ResultadoBusqueda = { texto: string; pagina: number; posicion: number }
function gruposBusqueda(rows: ResultadoBusqueda[]): ResultadoBusqueda[][] {
  const groups: ResultadoBusqueda[][] = []; let group: ResultadoBusqueda[] = [], pages = new Set<number>()
  for (const row of rows) {
    if (group.length >= SEARCH_PAGE_SIZE || pages.size === 2 && !pages.has(row.pagina)) { groups.push(group); group = []; pages = new Set() }
    group.push(row); pages.add(row.pagina)
  }
  if (group.length) groups.push(group)
  return groups
}
async function seleccionaPublicos(assets: PublicosAssets, data: ManifestPublicos, query: { zona: string | null; pagina: number; q: string }, now: number) {
  let items: ServicioPublico[], total: number, totalPaginas: number
  if (query.q) {
    const rows = await checkedAsset(assets, data.id + '/' + data.version + '/' + data.busqueda.archivo, data.busqueda, SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES, raw => validaBusquedaPublicos(raw, data), now)
    const filter = normalizaBusquedaPublica(query.q), matches: ResultadoBusqueda[] = []
    let pagina = 0, posicion = 0
    for (const texto of rows) {
      if (texto.includes(filter)) matches.push({ texto, pagina, posicion })
      if (++posicion === data.listas[pagina].total) { pagina++; posicion = 0 }
    }
    const groups = gruposBusqueda(matches), selected = groups[query.pagina] || []
    const pages = new Map(await Promise.all([...new Set(selected.map(row => row.pagina))].map(async page => [page, await cargaFilas(assets, data, data.listas[page], now)] as const)))
    items = validaFilas(selected.map(row => pages.get(row.pagina)?.[row.posicion]), data, null, now)
    if (items.some((p, i) => normalizaBusquedaPublica(p.nombre + ' ' + p.municipio) !== selected[i].texto)) return fail()
    total = matches.length; totalPaginas = groups.length
  } else {
    const descriptors = query.zona ? data.mapa[query.zona] || [] : data.listas
    const descriptor = descriptors[query.pagina]
    items = descriptor ? validaFilas(await cargaFilas(assets, data, descriptor, now), data, query.zona, now) : []
    total = descriptors.reduce((sum, d) => sum + d.total, 0); totalPaginas = descriptors.length
  }
  return { pagina: query.pagina, tamanoPagina: query.zona ? PUBLICOS_MAP_SIZE : query.q ? SEARCH_PAGE_SIZE : PUBLICOS_PAGE_SIZE, total, totalPaginas, siguientePagina: query.pagina + 1 < totalPaginas ? query.pagina + 1 : null, items }
}
export async function consultaDirectorioPublico(assets: PublicosAssets | undefined, id: FuentePublicaId, query: { zona: string | null; pagina: number; q: string }, now = Date.now()) {
  if (!assets) return fail()
  const index = await cargaIndicePublicos(assets, now), data = await cargaManifest(assets, id, index, now)
  return { ...estadoPublicos(data, index, now), ...await seleccionaPublicos(assets, data, query, now), zona: query.zona, q: query.q }
}
export type ConsultaDirectorioPublico = Awaited<ReturnType<typeof consultaDirectorioPublico>>

export async function consultaLugarPublico(assets: PublicosAssets | undefined, fuente: FuentePublicaId, id: string, now = Date.now()) {
  if (!assets || !identidadPublicaValida(id, fuente)) return fail()
  const index = await cargaIndicePublicos(assets, now), manifest = await cargaManifest(assets, fuente, index, now)
  if (!manifest.identidades) throw new PublicosLookupPendiente('La consulta individual se está preparando. Vuelve a intentarlo más tarde.')
  const metadata = estadoPublicos(manifest, index, now)
  const descriptor = manifest.identidades.find(d => d.desde <= id && id <= d.hasta)
  if (!descriptor) return { ...metadata, item: null }
  const rows = await checkedAsset(assets, fuente + '/' + manifest.version + '/' + descriptor.archivo, descriptor, SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES,
    raw => validaIdentidadesPublicas(raw, manifest, descriptor), now)
  const reference = rows.find(row => row[0] === id)
  if (!reference) return { ...metadata, item: null }
  const page = await cargaFilas(assets, manifest, manifest.listas[reference[1]], now)
  const item = validaServicioPublico(page[reference[2]], fuente, now)
  // Una referencia mal enlazada o un bloque de otra versión es un fallo de
  // integridad, no prueba de que la ficha haya desaparecido.
  if (item.id !== id) return fail()
  return { ...metadata, item }
}
