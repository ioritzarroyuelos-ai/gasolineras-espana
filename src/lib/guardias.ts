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
import { fechaHoraLocal, instanteLocal } from '../../scripts/lib/fechas.mjs'

export interface Guardia {
  lat: number
  lng: number
  direccion: string
  municipio: string
  telefono: string
  cp: string
  horario: string      // "2026-07-17 09:30-2026-07-17 23:00"
  horarioDesc: string  // "Guardia de hoy 09:30 - 23:00"
  provinciaId?: string // Código INE explícito cuando la fuente no publica CP.
  coordenadasFiables?: boolean
}

export interface GuardiasFile {
  ts?: string
  source?: string
  territorio?: string
  count?: number
  fecha?: string
  sourceUrl?: string
  cobertura?: string
  incidencias?: string[]
  coordenadasOficiales?: boolean
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
      provinciaId: str(row[8]) || undefined,
      coordenadasFiables: file.coordenadasOficiales === true && lat >= 27 && lat <= 44 && lng >= -19 && lng <= 5,
    })
  }
  return out
}

// ---- Frescura del snapshot de guardias ----
//
// Un turno de guardia es de un DIA concreto (el dia que el scraper lo capturo;
// muchos colegios rotan a diario). El robot corre a diario: si un territorio no
// se refresca, su fichero se queda viejo y NO se puede presentar como "de hoy".
// A partir del `ts` del fichero se decide si el dato es fiable y si es de hoy.
//
// GUARDIA_STALE_HORAS = 30: un pase diario deja el dato con <=~24 h de
// antiguedad; pasadas ~30 h es que se salto al menos un pase (fallo del scraper
// o del cron) y el turno deja de mostrarse. El margen sobre 24 h absorbe el
// hueco nocturno (el robot corre de madrugada, 06:00 UTC) y el jitter de GitHub
// Actions, para no apagar la pagina cada noche.
export const GUARDIA_STALE_HORAS = 30

export interface GuardiaFrescura {
  fiable: boolean   // dato del ultimo pase diario: se puede mostrar
  esHoy: boolean    // capturado hoy en la zona del territorio
  fecha: string     // YYYY-MM-DD de captura (para etiquetar), '' si no hay ts
  horas: number     // antiguedad en horas (Infinity si no hay ts valido)
}

// ahora se inyecta en los tests; en produccion es new Date().
export function frescuraGuardia(ts: string | undefined, ahora: Date = new Date(), zona = 'Europe/Madrid'): GuardiaFrescura {
  if (!ts) return { fiable: false, esHoy: false, fecha: '', horas: Infinity }
  const t = Date.parse(ts)
  if (!Number.isFinite(t)) return { fiable: false, esHoy: false, fecha: '', horas: Infinity }
  const horas = (ahora.getTime() - t) / 3600000
  const fecha = fechaHoraLocal(new Date(t), zona).slice(0, 10)
  const hoy = fechaHoraLocal(ahora, zona).slice(0, 10)
  const fiable = horas >= -5 / 60 && horas <= GUARDIA_STALE_HORAS
  return { fiable, esHoy: fiable && fecha === hoy, fecha, horas }
}

export function zonaGuardia(provinciaSlug: string): string {
  return ['las-palmas', 'santa-cruz-de-tenerife'].includes(provinciaSlug) ? 'Atlantic/Canary' : 'Europe/Madrid'
}

export function estadoGuardia(g: Guardia, actualizado?: string, ahora = new Date(), zona = 'Europe/Madrid') {
  const unknown = { conocida: false, abierta: false, todoElDia: false }
  if (!frescuraGuardia(actualizado, ahora, zona).fiable || /localizada|no presencial|por confirmar|confirmar horario/i.test(g.horarioDesc)) return unknown
  const m = g.horario.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})-(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/)
  if (!m) return unknown
  const start = instanteLocal(m[1], zona), end = instanteLocal(m[2], zona)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return unknown
  const abierta = ahora.getTime() >= start && ahora.getTime() < end
  // Turno completo según las horas del colegio, incluso el día del cambio de hora.
  const horasTurno = (Date.parse(m[2].replace(' ', 'T') + ':00Z') - Date.parse(m[1].replace(' ', 'T') + ':00Z')) / 3600000
  return { conocida: true, abierta, todoElDia: abierta && horasTurno >= 24 }
}

const FUENTES_RECUPERADAS: Record<string, string> = {
  alicante: 'https://www.cofalicante.com/farmacias-de-guardia/',
  almeria: 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on',
  asturias: 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355',
  avila: 'https://www.cofavila.com/index.php/servicio-de-guardia-nocturno/',
  cantabria: 'https://cofcantabria.org/abiertas/',
  ceuta: 'https://ipsi.ceuta.es:8443/sanidad/farmacia/controlfarmacia?cmd=guardias-nuevo',
  clm: 'https://farmaciasdeguardia.cofcam.es/',
}
export function fuenteGuardia(provinciaSlug: string, file?: GuardiasFile): string | null {
  const known = FUENTES_RECUPERADAS[GUARDIAS_TERRITORIO_BY_PROVINCIA[provinciaSlug]]
  const value = known || file?.sourceUrl || (file?.source && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(file.source) ? 'https://' + file.source : '')
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null } catch { return null }
}

// Filtra las guardias que pertenecen a una provincia concreta. Solo hace falta
// para el fichero 'clm' (5 provincias en uno); alli el CP si viene y sus dos
// primeros digitos son el codigo INE. Para el resto de ficheros no se filtra,
// porque el CP suele estar vacio y filtrar dejaria la pagina sin resultados.
export function guardiasForProvincia(rows: Guardia[], provinciaId: string, territorio?: string): Guardia[] {
  if (territorio !== 'clm') return rows
  return rows.filter(g => g.provinciaId ? g.provinciaId === provinciaId : g.cp.length >= 2 && g.cp.slice(0, 2) === provinciaId)
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
