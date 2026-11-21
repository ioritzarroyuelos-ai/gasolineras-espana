import { SERVICIOS_CATEGORIAS, SERVICIOS_IDS } from '../../scripts/lib/servicios-catalogo.mjs'
import { SERVICIOS_MAX_TILE_BYTES, SERVICIOS_TILE_RE, validaServiciosIndex, validaServiciosTile, type ServicioPoi, type ServiciosIndex } from '../../scripts/lib/servicios.mjs'
export type { ServicioPoi, ServiciosIndex } from '../../scripts/lib/servicios.mjs'

// Sólo se consulta una cuadrícula pública: el punto GPS y las distancias
// permanecen en el navegador. Nunca se construyen rutas con texto arbitrario.
export const SERVICIOS_PAGINA = 200
export const SERVICIOS_TILE_MAX = SERVICIOS_MAX_TILE_BYTES
export const SERVICIOS_INDEX_MAX = 2 * 1024 * 1024
export const SERVICIOS_FRESCURA_HORAS = 72
export { SERVICIOS_CATEGORIAS }
type ServicioTileMeta = ServiciosIndex['tiles'][number]
type Assets = { fetch: (req: Request) => Promise<Response> }
const indexCache = new WeakMap<Assets, { checkedAt: number; expires: number; promise: Promise<ServiciosIndex> }>()
export class ServiciosError extends Error {}
const fail = (): never => { throw new ServiciosError('No se puede comprobar el directorio de esta zona') }
export function zonaValida(zona: string): boolean {
  if (!SERVICIOS_TILE_RE.test(zona) || !/^\d{3}-\d{3}$/.test(zona.split('.')[0])) return false
  const [lat, lon] = zona.split('.')[0].split('-').map(Number)
  // Canarias y territorio peninsular/Baleares/Ceuta/Melilla; esta caja acotada
  // admite también cuadrículas vacías de costa, sin atribuirles cobertura.
  return (lat >= 500 && lat <= 538 && lon >= 680 && lon <= 738) || (lat >= 468 && lat <= 480 && lon >= 644 && lon <= 668)
}
export function zonasAlternativasServicios(index: ServiciosIndex, zona: string) {
  // Incluye el padre si la división cambió entre dos actualizaciones; nunca
  // convierte un cambio del índice en un falso «aquí no hay lugares».
  return index.tiles.filter(tile => tile.id.startsWith(zona + '.') || zona.startsWith(tile.id + '.')).map(tile => ({ id: tile.id, bbox: tile.bbox }))
}
export function consultaServicios(url: URL) {
  for (const key of url.searchParams.keys()) if (!['zona', 'categorias', 'pagina'].includes(key) || url.searchParams.getAll(key).length !== 1) return null
  const zona = url.searchParams.get('zona') || ''
  const raw = url.searchParams.get('categorias')
  const categorias = raw === null ? [] : raw.split(',')
  const paginaRaw = url.searchParams.get('pagina') || '0'
  if (!zonaValida(zona) || categorias.length > SERVICIOS_IDS.size || categorias.some(c => !SERVICIOS_IDS.has(c)) || !/^(0|[1-9]\d{0,3})$/.test(paginaRaw)) return null
  return { zona, categorias: [...new Set(categorias)], pagina: Number(paginaRaw) }
}

// Limita el flujo antes de parsearlo, aunque falte Content-Length o sea falso.
async function readAsset(path: string, assets: Assets | undefined, max: number): Promise<Uint8Array> {
  if (!assets) return fail()
  const response = await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/servicios/' + path, { signal: AbortSignal.timeout(10000) }))
  if (!response.ok || !response.body) return fail()
  const length = response.headers.get('Content-Length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) { await response.body.cancel(); return fail() }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) { await reader.cancel(); return fail() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
function parse(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { return fail() }
}
export async function cargaIndiceServicios(assets: Assets | undefined, now = Date.now()) {
  if (!assets) return fail()
  const cached = indexCache.get(assets)
  if (cached && cached.checkedAt <= now && cached.expires > now) return cached.promise
  const promise = readAsset('index.json', assets, SERVICIOS_INDEX_MAX).then(bytes => validaServiciosIndex(parse(bytes), now))
  const entry = { checkedAt: now, expires: now + 30000, promise }
  entry.promise = promise.catch(error => { if (indexCache.get(assets) === entry) indexCache.delete(assets); throw error })
  indexCache.set(assets, entry)
  return entry.promise
}
export async function cargaTileServicios(meta: ServicioTileMeta, assets: Assets | undefined, now = Date.now()): Promise<ServicioPoi[]> {
  const bytes = await readAsset('tiles/' + meta.id + '.json', assets, SERVICIOS_TILE_MAX)
  if (bytes.byteLength !== meta.bytes) return fail()
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(n => n.toString(16).padStart(2, '0')).join('')
  if (hash !== meta.sha256) return fail()
  const tile = validaServiciosTile(parse(bytes), now)
  if (tile.id !== meta.id || tile.pois.length !== meta.count) return fail()
  return tile.pois
}
export function estadoServicios(index: ServiciosIndex, now = Date.now()) {
  const desactualizado = now - Date.parse(index.ts) > 30 * 3600000 || now - Date.parse(index.fechaDatos) > SERVICIOS_FRESCURA_HORAS * 3600000
  return {
    consultado: index.ts, fechaDatos: index.fechaDatos, desactualizado,
    licencia: index.licencia, atribucion: index.atribucion, fuenteUrl: 'https://www.openstreetmap.org/copyright',
    ...(index.limiteTerritorial ? { limiteTerritorial: index.limiteTerritorial } : {}),
    warnings: [
      ...(desactualizado ? ['Directorio pendiente de actualizar. Se conserva la última copia disponible.'] : []),
      'Directorio colaborativo de OpenStreetMap: puede haber lugares sin incluir o cambios todavía no reflejados.',
      'Los horarios publicados no confirman que el lugar esté abierto ahora. No se comprueba disponibilidad en directo.',
    ],
  }
}
