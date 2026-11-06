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

import { slugifyMunicipio } from './municipios'
import { fechaHoraLocal } from '../../scripts/lib/fechas.mjs'
import { corrigeZonaCervera } from '../../scripts/lib/guardias-rioja.mjs'

import { estadoHorarioGuardia, fechaValida, horarioParaListado, intervaloDelDia } from './guardias-horarios'
export { textoHorarioGuardia, tipoAtencionGuardia } from './guardias-horarios'

export interface Guardia {
  territorio?: string
  fechaTurno?: string
  horarioCompleto?: boolean
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
  guardiasVerificadas?: boolean
  ts?: string
  source?: string
  territorio?: string
  count?: number
  fecha?: string
  horariosCompletos?: boolean
  sourceUrl?: string
  cobertura?: string
  incidencias?: string[]
  avisosMunicipales?: Record<string, string[]>
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

// Estos lectores antiguos mezclaban horarios de apertura, remisiones a otros
// pueblos o turnos de otro día. Un intento fallido del robot conserva la copia
// anterior en disco, por lo que también se comprueba su procedencia al leerla.
const REQUIEREN_NUEVA_LECTURA = new Set([
  'alava', 'asturias', 'badajoz', 'baleares', 'barcelona', 'bizkaia', 'burgos', 'caceres', 'cadiz',
  'clm', 'cordoba', 'coruna', 'gipuzkoa', 'girona', 'huelva', 'huesca', 'jaen', 'leon', 'lleida',
  'malaga', 'melilla', 'murcia', 'navarra', 'ourense', 'palencia', 'pontevedra', 'rioja',
  'salamanca', 'segovia', 'sevilla', 'soria', 'tarragona', 'valladolid', 'zamora', 'zaragoza',
])
const TERRITORIOS = new Set(Object.values(GUARDIAS_TERRITORIO_BY_PROVINCIA))

// Convierte los arrays posicionales del snapshot en objetos manejables.
export function parseGuardias(file: GuardiasFile | null, ahora = new Date()): Guardia[] {
  if (file?.territorio === 'rioja') file = corrigeZonaCervera(file)
  if (!file || !Array.isArray(file.guardias)) return []
  if (file.territorio && !TERRITORIOS.has(file.territorio)) return []
  if (REQUIEREN_NUEVA_LECTURA.has(file.territorio || '') &&
      (file.guardiasVerificadas !== true || !fechaValida(file.fecha || ''))) return []
  // El antiguo directorio de Bizkaia mezclaba horarios de apertura y guardias.
  // Sólo la tabla fechada del colegio identifica qué farmacias cubren el turno.
  const bizkaia = file.territorio === 'bizkaia'
  if (bizkaia && (file.source !== 'cofbizkaia.eus' || !fechaValida(file.fecha || ''))) return []
  const zona = file.territorio === 'laspalmas' || file.territorio === 'tenerife' ? 'Atlantic/Canary' : 'Europe/Madrid'
  const ahoraLocal = fechaHoraLocal(ahora, zona)
  const captura = Date.parse(file.ts || '')
  const fechaConsulta = file.fecha || (Number.isFinite(captura) ? fechaHoraLocal(new Date(captura), zona).slice(0, 10) : '')
  const out: Guardia[] = []
  for (const row of file.guardias) {
    if (!Array.isArray(row)) continue
    const horario = str(row[6])
    const lat = num(row[0]), lng = num(row[1])
    const farmacia: Guardia = {
      lat, lng,
      direccion:   str(row[2]),
      municipio:   str(row[3]),
      telefono:    str(row[4]),
      cp:          str(row[5]),
      horario,
      horarioDesc: str(row[7]),
      territorio: file.territorio,
      fechaTurno: file.fecha,
      horarioCompleto: file.territorio !== 'tenerife' || String(row[6] ?? '').length !== 100 || file.horariosCompletos === true,
      provinciaId: str(row[8]) || undefined,
      // Madrid ya publicaba coordenadas nativas verificadas antes de añadir la marca.
      coordenadasFiables: (file.coordenadasOficiales === true || (file.territorio === 'madrid' && file.source === 'cofm.es')) && lat >= 27 && lat <= 44 && lng >= -19 && lng <= 5,
    }
    if (file.territorio && fechaConsulta) {
      const vigente = horarioParaListado(farmacia, fechaConsulta, ahora, zona, ahoraLocal)
      if (vigente === null) continue
      farmacia.horario = vigente
    }
    out.push(farmacia)
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
  if (!frescuraGuardia(actualizado, ahora, zona).fiable) return { conocida: false, abierta: false, todoElDia: false }
  return estadoHorarioGuardia(g, ahora, zona)
}

const FUENTES_RECUPERADAS: Record<string, string> = {
  lugo: 'https://www.coflugo.org/farmacia-guardia',
  madrid: 'https://www.cofm.es/es/buscador-de-farmacias/',
  bizkaia: 'https://www.cofbizkaia.eus/farmacia_de_guardia/',
  barcelona: 'https://www.farmaguia.net/',
  tenerife: 'https://www.coftenerife.es/ciudadanos/farmacias-de-guardia/',
  palencia: 'https://www.cofpalencia.org/PUBLICO/CALENDARIOS%20DE%20GUARDIA/menu_calendarios_guardia.htm',
  alicante: 'https://www.cofalicante.com/farmacias-de-guardia/',
  almeria: 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on',
  asturias: 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355',
  avila: 'https://www.cofavila.com/index.php/servicio-de-guardia-nocturno/',
  cantabria: 'https://cofcantabria.org/abiertas/',
  ceuta: 'https://ipsi.ceuta.es:8443/sanidad/farmacia/controlfarmacia?cmd=guardias-nuevo',
  clm: 'https://farmaciasdeguardia.cofcam.es/',
}
export function fuenteGuardia(provinciaSlug: string, file?: GuardiasFile, ahora = new Date()): string | null {
  const known = FUENTES_RECUPERADAS[GUARDIAS_TERRITORIO_BY_PROVINCIA[provinciaSlug] || provinciaSlug]
  if (provinciaSlug === 'bizkaia') {
    // El colegio puede servir una copia de otro día cuando se abre la portada sin fecha.
    const ahoraLocal = fechaHoraLocal(ahora)
    let fecha = ahoraLocal.slice(0, 10)
    if (file?.source === 'cofbizkaia.eus' && file.fecha && file.fecha < fecha && fechaValida(file.fecha)
      && frescuraGuardia(file.ts, ahora).fiable && file.guardias?.some(row => Array.isArray(row) && intervaloDelDia(str(row[6]), ahoraLocal))) {
      fecha = file.fecha // el turno de la noche sigue en el calendario de ayer
    }
    const url = new URL(known)
    url.searchParams.set('fecha_guardia', fecha.split('-').reverse().join('/'))
    return url.href
  }
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
