// Helpers para rutas SEO /gasolineras/<provincia>/<municipio>.
//
// El dataset del Ministerio trae el municipio como string libre (`Municipio`)
// y un IDMunicipio numérico. Para URLs canónicas necesitamos un slug estable
// y SEO-friendly sin acentos / caracteres raros. Computamos el top-N
// municipios por provincia al vuelo a partir del snapshot en memoria — no
// precargamos nada porque el snapshot ya está cacheado in-process tras la
// primera petición y municipios.json es un fichero aparte más pesado.
//
// Escoge top-N por número de estaciones (proxy de relevancia) para evitar
// bloat del sitemap con miles de aldeas de 1 estación.
//
// Usado en:
//  - src/index.tsx ruta /gasolineras/:provinciaSlug/:municipioSlug
//  - src/index.tsx /sitemap.xml (emite top-N por provincia)
//  - src/html/shell.ts para title / description / breadcrumbs / FAQ visible

export interface MunicipioEntry {
  /** IDMunicipio oficial (5-6 dígitos) */
  id: string
  /** Nombre canónico tal como viene del Ministerio (con acentos) */
  name: string
  /** Slug URL-safe: 'donostia-san-sebastian', 'alcala-de-henares' */
  slug: string
  /** Nº de estaciones en ese municipio (para top-N) */
  stationCount: number
  /** Provincia a la que pertenece (INE id) */
  provinciaId: string
}

/**
 * Convierte un nombre de municipio a slug URL-safe.
 *
 * Reglas:
 *  - NFD + strip diacríticos (á→a, ñ→n, ç→c)
 *  - Lower case
 *  - Reemplaza todo lo no-alfanumérico por guion
 *  - Colapsa guiones múltiples y trimea extremos
 *
 * Ejemplos:
 *  - "Alcalá de Henares"       → "alcala-de-henares"
 *  - "Donostia / San Sebastián" → "donostia-san-sebastian"
 *  - "L'Hospitalet de Llobregat" → "l-hospitalet-de-llobregat"
 *  - "A Coruña"                 → "a-coruna"
 */
export function slugifyMunicipio(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Tipo compatible con lo que ya usa el index.tsx (StationRecord). */
type StationLike = {
  IDProvincia?: string
  IDMunicipio?: string
  Municipio?: string
  [k: string]: unknown
}
type SnapshotLike = {
  ListaEESSPrecio?: StationLike[]
  [k: string]: unknown
}

/**
 * Devuelve todos los municipios de una provincia con su count de estaciones.
 * Ordenados descendente por count. Para sitemap / listados.
 *
 * Complejidad: O(N) sobre snap.ListaEESSPrecio (unos 12k items globales ≈ µs).
 * Llamadas múltiples al día no son problema — Workers mantiene el snapshot en
 * memoria entre requests en la misma instancia.
 */
export function municipiosInProvincia(
  snap: SnapshotLike | null | undefined,
  provinciaId: string,
): MunicipioEntry[] {
  if (!snap || !Array.isArray(snap.ListaEESSPrecio)) return []
  // Agrupamos por IDMunicipio. Conservamos la primera variante del nombre que
  // veamos (el dataset es consistente — mismo IDMunicipio siempre trae mismo
  // literal de Municipio).
  const byId = new Map<string, { name: string; count: number }>()
  for (const s of snap.ListaEESSPrecio) {
    if (s.IDProvincia !== provinciaId) continue
    const id = s.IDMunicipio
    const name = s.Municipio
    if (!id || !name) continue
    const prev = byId.get(id)
    if (prev) { prev.count++ }
    else { byId.set(id, { name, count: 1 }) }
  }
  const out: MunicipioEntry[] = []
  byId.forEach((v, id) => {
    out.push({
      id,
      name: v.name,
      slug: slugifyMunicipio(v.name),
      stationCount: v.count,
      provinciaId,
    })
  })
  // Orden descendente por count, desempate alfabético para estabilidad.
  out.sort((a, b) => b.stationCount - a.stationCount || a.name.localeCompare(b.name))
  return out
}

/**
 * Top-N municipios de una provincia (minimizando sitemap bloat).
 * Aplica además un filtro de stationCount mínimo.
 */
export function topMunicipiosInProvincia(
  snap: SnapshotLike | null | undefined,
  provinciaId: string,
  opts: { limit?: number; minStations?: number } = {},
): MunicipioEntry[] {
  const limit = opts.limit ?? 15
  const minStations = opts.minStations ?? 5
  return municipiosInProvincia(snap, provinciaId)
    .filter(m => m.stationCount >= minStations)
    .slice(0, limit)
}

/**
 * Busca un municipio por slug dentro de una provincia. Resuelve colisiones
 * (dos municipios distintos podrían slugificarse al mismo string — muy raro
 * pero posible) escogiendo el de mayor stationCount.
 */
export function findMunicipioBySlug(
  snap: SnapshotLike | null | undefined,
  provinciaId: string,
  slug: string,
): MunicipioEntry | null {
  if (!slug) return null
  const target = slug.toLowerCase()
  const candidates = municipiosInProvincia(snap, provinciaId).filter(m => m.slug === target)
  if (candidates.length === 0) return null
  // Ya viene ordenado por count desc, asi que [0] gana.
  return candidates[0]
}

/**
 * Calcula stats de precios para las estaciones de un municipio dado.
 * Misma forma que stats por provincia (en shell.ts/buildPage).
 */
export function statsForMunicipio(
  snap: SnapshotLike | null | undefined,
  provinciaId: string,
  municipioId: string,
): {
  stats: Record<string, { min: number; avg: number; max: number; count: number }>
  stationCount: number
} {
  const stats: Record<string, { min: number; avg: number; max: number; count: number }> = {}
  if (!snap || !Array.isArray(snap.ListaEESSPrecio)) return { stats, stationCount: 0 }
  const FIELD: Record<string, string> = {
    '95':          'Precio Gasolina 95 E5',
    '98':          'Precio Gasolina 98 E5',
    'diesel':      'Precio Gasoleo A',
    'diesel_plus': 'Precio Gasoleo Premium',
  }
  const buckets: Record<string, number[]> = { '95': [], '98': [], 'diesel': [], 'diesel_plus': [] }
  let stationCount = 0
  for (const s of snap.ListaEESSPrecio) {
    if (s.IDProvincia !== provinciaId) continue
    if (s.IDMunicipio !== municipioId) continue
    stationCount++
    for (const fuelCode of Object.keys(FIELD)) {
      const raw = (s as Record<string, unknown>)[FIELD[fuelCode]]
      if (!raw) continue
      const n = parseFloat(String(raw).replace(',', '.'))
      if (Number.isFinite(n) && n > 0) buckets[fuelCode].push(n)
    }
  }
  for (const fuelCode of Object.keys(buckets)) {
    const arr = buckets[fuelCode]
    if (arr.length === 0) continue
    const sum = arr.reduce((a, b) => a + b, 0)
    stats[fuelCode] = {
      min:   Math.min(...arr),
      max:   Math.max(...arr),
      avg:   sum / arr.length,
      count: arr.length,
    }
  }
  return { stats, stationCount }
}
