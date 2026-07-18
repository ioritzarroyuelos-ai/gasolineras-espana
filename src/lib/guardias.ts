// Farmacias de guardia — indice por provincia y municipio.
//
// Los scrapers (.github/workflows/fetch-guardias.yml) dejan 47 snapshots en
// public/data/guardias-<territorio>.json con esta forma:
//   { ts, source, territorio, count, schema, guardias: [...] }
// y cada guardia es un array POSICIONAL:
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Normalmente un fichero = una provincia. La excepcion es 'clm', que agrupa las
// cinco de Castilla-La Mancha; ahi la provincia se deduce del CODIGO POSTAL
// (sus dos primeros digitos son el codigo INE de provincia), que en ese fichero
// SI viene. En la mayoria de los demas el CP esta vacio, por eso no se usa como
// criterio general: para ellos la provincia la da el propio fichero.
//
// Cobertura medida el 2026-07-18: 3.165 guardias, 3.048 con municipio (96%).
// Baleares y Huesca no traen municipio, asi que solo admiten pagina provincial.

import { slugifyMunicipio } from './municipios'

export interface Guardia {
  lat: number
  lng: number
  direccion: string
  municipio: string
  telefono: string
  cp: string
  horario: string      // "2026-07-17 09:30-2026-07-17 23:00"
  horarioDesc: string  // "Guardia de hoy 09:30 - 23:00"
}

export interface GuardiasFile {
  ts?: string
  source?: string
  territorio?: string
  count?: number
  guardias?: unknown[][]
}

// slug de provincia -> nombre de territorio del fichero (guardias-<x>.json).
// Lugo no aparece: su colegio no tiene scraper todavia.
export const GUARDIAS_TERRITORIO_BY_PROVINCIA: Readonly<Record<string, string>> = {
  'alava': 'alava',
  'albacete': 'clm',
  'alicante': 'alicante',
  'almeria': 'almeria',
  'asturias': 'asturias',
  'avila': 'avila',
  'badajoz': 'badajoz',
  'islas-baleares': 'baleares',
  'barcelona': 'barcelona',
  'bizkaia': 'bizkaia',
  'burgos': 'burgos',
  'caceres': 'caceres',
  'cadiz': 'cadiz',
  'cantabria': 'cantabria',
  'castellon': 'castellon',
  'ceuta': 'ceuta',
  'ciudad-real': 'clm',
  'cordoba': 'cordoba',
  'a-coruna': 'coruna',
  'cuenca': 'clm',
  'girona': 'girona',
  'granada': 'granada',
  'guadalajara': 'clm',
  'guipuzcoa': 'gipuzkoa',
  'huelva': 'huelva',
  'huesca': 'huesca',
  'jaen': 'jaen',
  'las-palmas': 'laspalmas',
  'la-rioja': 'rioja',
  'leon': 'leon',
  'lleida': 'lleida',
  'madrid': 'madrid',
  'malaga': 'malaga',
  'melilla': 'melilla',
  'murcia': 'murcia',
  'navarra': 'navarra',
  'ourense': 'ourense',
  'palencia': 'palencia',
  'pontevedra': 'pontevedra',
  'salamanca': 'salamanca',
  'santa-cruz-de-tenerife': 'tenerife',
  'segovia': 'segovia',
  'sevilla': 'sevilla',
  'soria': 'soria',
  'tarragona': 'tarragona',
  'teruel': 'teruel',
  'toledo': 'clm',
  'valencia': 'valencia',
  'valladolid': 'valladolid',
  'zamora': 'zamora',
  'zaragoza': 'zaragoza',
}

// Fichero de datos que cubre una provincia, o null si no hay scraper.
export function guardiasFileForProvincia(provinciaSlug: string | undefined): string | null {
  if (!provinciaSlug) return null
  const t = GUARDIAS_TERRITORIO_BY_PROVINCIA[provinciaSlug]
  return t ? 'guardias-' + t + '.json' : null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim())
}
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : NaN
}

// Convierte los arrays posicionales del snapshot en objetos manejables.
export function parseGuardias(file: GuardiasFile | null): Guardia[] {
  if (!file || !Array.isArray(file.guardias)) return []
  const out: Guardia[] = []
  for (const row of file.guardias) {
    if (!Array.isArray(row)) continue
    const lat = num(row[0]), lng = num(row[1])
    out.push({
      lat, lng,
      direccion:   str(row[2]),
      municipio:   str(row[3]),
      telefono:    str(row[4]),
      cp:          str(row[5]),
      horario:     str(row[6]),
      horarioDesc: str(row[7]),
    })
  }
  return out
}

// Filtra las guardias que pertenecen a una provincia concreta. Solo hace falta
// para el fichero 'clm' (5 provincias en uno); alli el CP si viene y sus dos
// primeros digitos son el codigo INE. Para el resto de ficheros no se filtra,
// porque el CP suele estar vacio y filtrar dejaria la pagina sin resultados.
export function guardiasForProvincia(rows: Guardia[], provinciaId: string, territorio?: string): Guardia[] {
  if (territorio !== 'clm') return rows
  return rows.filter(g => g.cp.length >= 2 && g.cp.slice(0, 2) === provinciaId)
}

export interface MunicipioGuardia {
  slug: string
  name: string
  count: number
}

// Municipios con al menos una farmacia de guardia, ordenados por nombre.
// Se usa para las paginas SEO y para el sitemap.
export function municipiosConGuardia(rows: Guardia[]): MunicipioGuardia[] {
  const by = new Map<string, MunicipioGuardia>()
  for (const g of rows) {
    if (!g.municipio) continue
    const slug = slugifyMunicipio(g.municipio)
    if (!slug) continue
    const hit = by.get(slug)
    if (hit) { hit.count++; continue }
    by.set(slug, { slug, name: normalizeMunicipioName(g.municipio), count: 1 })
  }
  return Array.from(by.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

// Los colegios publican el municipio en MAYUSCULAS ("MADRID", "SANTA CRUZ DE
// TENERIFE"). Para el <h1> y el <title> queda mejor en formato titulo, con las
// particulas en minuscula.
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', "d'", 'da', 'do', 'dos', 'das'])
export function normalizeMunicipioName(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  return s.split(/\s+/).map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w
    return w.charAt(0).toUpperCase() + w.slice(1)
  }).join(' ')
}

// Guardias de un municipio concreto (por slug).
export function guardiasForMunicipio(rows: Guardia[], munSlug: string): Guardia[] {
  return rows.filter(g => g.municipio && slugifyMunicipio(g.municipio) === munSlug)
}
