// Estaciones de ITV — indice por provincia y municipio.
//
// Datos: public/data/itv.json, generado por scripts/fetch-itv.mjs a partir del
// FeatureServer publico de la DGT (mas un parche de la Generalitat Valenciana
// para Castellon, que la DGT no cubre).
//
// POR QUE SE AGRUPA POR MUNICIPIO Y NO HAY FICHA POR ESTACION
// Una ficha por estacion serian ~473 URLs con direccion, telefono y poco mas:
// contenido fino, que es justo lo que Google deja sin indexar. Agrupar por
// municipio da paginas con sustancia y ataca la consulta con intencion real
// ("ITV en <municipio>"), que es el mismo patron que funciona en las paginas de
// farmacia de guardia.
//
// Solo 393 de los 8.131 municipios de España tienen ITV. NO se generan paginas
// para el resto: seria contenido doorway sobre un dato estatico en un nicho ya
// cubierto por competidores especializados.

import { slugifyMunicipio } from './municipios'
import { PROVINCIAS } from './provincias'

export interface EstacionITV {
  id: string
  prov: string        // codigo INE de provincia, 2 digitos
  mun: string
  dir: string
  cp: string
  tel: string
  op: string          // operador (Applus, Itevelesa, Veiasa...)
  lat: number | null  // la fuente valenciana no publica coordenadas
  lng: number | null
  lineas: number | null
  horario: string
  fuente: string
}

export interface ItvFile {
  v?: number
  generatedAt?: string
  fuentes?: string[]
  total?: number
  estaciones?: EstacionITV[]
}

export interface MunicipioITV {
  slug: string
  name: string
  count: number
}

export interface ProvinciaITV {
  id: string
  slug: string
  name: string
  count: number
}

const PROV_BY_SLUG = new Map(PROVINCIAS.map(p => [p.slug, p]))
const PROV_BY_ID = new Map(PROVINCIAS.map(p => [p.id, p]))

export function provinciaPorSlug(slug: string | undefined) {
  return slug ? PROV_BY_SLUG.get(slug) ?? null : null
}

// Los municipios llegan en mayusculas ("VILA-REAL", "SANTA CRUZ DE TENERIFE").
// Para <h1> y <title> queda mejor en formato titulo, con las particulas en
// minuscula. Misma regla que en src/lib/guardias.ts.
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', "d'", 'da', 'do', 'dos', 'das'])

export function normalizaNombreMunicipio(raw: string): string {
  const s = String(raw || '').trim().toLowerCase()
  if (!s) return ''
  return s.split(/\s+/).map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w
    return w.charAt(0).toUpperCase() + w.slice(1)
  }).join(' ')
}

export function parseItv(file: ItvFile | null): EstacionITV[] {
  if (!file || !Array.isArray(file.estaciones)) return []
  return file.estaciones.filter(e => e && typeof e.prov === 'string')
}

export function estacionesDeProvincia(todas: EstacionITV[], provinciaId: string): EstacionITV[] {
  return todas.filter(e => e.prov === provinciaId)
}

export function estacionesDeMunicipio(deProvincia: EstacionITV[], munSlug: string): EstacionITV[] {
  return deProvincia.filter(e => e.mun && slugifyMunicipio(e.mun) === munSlug)
}

// Municipios con al menos una estacion, ordenados por nombre. Se usa para las
// paginas SEO, el enlazado interno y el sitemap.
export function municipiosConItv(deProvincia: EstacionITV[]): MunicipioITV[] {
  const by = new Map<string, MunicipioITV>()
  for (const e of deProvincia) {
    if (!e.mun) continue
    const slug = slugifyMunicipio(e.mun)
    if (!slug) continue
    const hit = by.get(slug)
    if (hit) { hit.count++; continue }
    by.set(slug, { slug, name: normalizaNombreMunicipio(e.mun), count: 1 })
  }
  return Array.from(by.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

// Provincias con estacion, ordenadas por nombre. Para el indice de /itv/.
export function provinciasConItv(todas: EstacionITV[]): ProvinciaITV[] {
  const cuenta = new Map<string, number>()
  for (const e of todas) cuenta.set(e.prov, (cuenta.get(e.prov) || 0) + 1)
  const out: ProvinciaITV[] = []
  for (const [id, count] of cuenta) {
    const p = PROV_BY_ID.get(id)
    if (!p) continue
    out.push({ id, slug: p.slug, name: p.name, count })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export function telHref(t: string): string {
  const clean = String(t || '').replace(/[^0-9+]/g, '')
  return clean ? 'tel:' + clean : ''
}

export function mapsHref(e: EstacionITV): string {
  if (e.lat != null && e.lng != null && Number.isFinite(e.lat) && e.lat !== 0) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + e.lat + ',' + e.lng
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(e.dir + ' ' + e.mun)
}
