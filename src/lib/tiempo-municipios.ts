import { IMPORTANTE_MIN_HAB, slugTiempo, type MunicipioLista } from '../../scripts/lib/tiempo.mjs'
import { municipioFusionado, municipiosINE, nombresDelINE } from './municipios-ine'
import { provinciaById } from './provincias'

// Coordenadas del núcleo principal, no del centro de la provincia. Población:
// Nomenclátor del INE 2025. Para Andalucía, ficha SIMA (sustituir el código):
// https://www.juntadeandalucia.es/institutodeestadisticaycartografia/sima/ficha.htm?mun=04904
// A Chan: https://www.aemet.es/es/eltiempo/prediccion/municipios/cerdedo-cotobade-chan-a-id36902
// Unkina/Usansolo: CartoCiudad (IGN), núcleo 1600021005, código municipal 48916.
// https://www.cartociudad.es/geocoder/api/geocoder/findJsonp?type=poblacion&id=1600021005
const nucleos: Record<string, readonly [lat: number, lng: number, poblacion: number]> = {
  '04904': [36.749, -2.908, 3040],
  '11903': [36.341, -5.323, 2778],
  '14901': [37.669, -5.155, 1073],
  '14902': [37.637, -4.865, 1375],
  '18077': [36.954, -3.856, 529],
  '18106': [36.934, -3.909, 632],
  '18915': [37.497, -3.508, 833],
  '18916': [36.702, -3.486, 3181],
  '21902': [37.713, -6.854, 1183],
  '36902': [42.47192825, -8.48202606, 5656],
  '41904': [37.061, -5.804, 2297],
  '48916': [43.218974, -2.818344, 4563],
}

function ordenNatural(nombre: string): string {
  if (!nombre.includes(',')) return nombre.trim()
  return nombre.split('/').map(parte => {
    const m = parte.trim().match(/^(.+),\s*(las?|los?|el|as?|os?|els|les|es|sa|ses|l['’])$/i)
    if (!m) return parte.trim()
    const articulo = m[2][0].toUpperCase() + m[2].slice(1)
    return articulo + (/['’]$/.test(articulo) ? '' : ' ') + m[1].trim()
  }).join('/')
}

export function catalogoTiempo(base: MunicipioLista[]): MunicipioLista[] {
  const original = new Map(base.map(m => [m.ine, m]))
  const provincias = new Set(base.map(m => m.provinciaId))
  const salida: MunicipioLista[] = []
  for (const actual of municipiosINE(base)) {
    const nombre = ordenNatural(actual.nombre)
    const existente = original.get(actual.ine)
    if (existente) {
      salida.push(nombre === existente.nombre ? existente : { ...existente, nombre })
      continue
    }
    const id = actual.ine.slice(0, 2)
    const provincia = provinciaById(id)
    const posicion = nucleos[actual.ine]
    if (!provincias.has(id) || !provincia || !posicion) continue
    const [lat, lng, pob] = posicion
    salida.push({ ine: actual.ine, nombre, provinciaId: id, provinciaSlug: provincia.slug,
      provinciaNombre: provincia.name, slug: slugTiempo(nombre), lat, lng, pob, imp: pob >= IMPORTANTE_MIN_HAB })
  }
  return salida
}

const nombresMunicipales: Record<string, readonly string[]> = {
  '15030': ['La Coruña', 'Coruña'],
  '17079': ['Gerona'],
  '20069': ['Donostia', 'San Sebastián'],
  '25120': ['Lérida'],
  '32054': ['Orense'],
  '36902': ['Cerdedo', 'Cotobade'],
}
const nombresProvinciales: Record<string, readonly string[]> = {
  '01': ['Araba'], '03': ['Alacant'], '07': ['Illes Balears', 'Balears', 'Baleares'],
  '12': ['Castelló'], '15': ['La Coruña', 'Coruña'], '17': ['Gerona'], '20': ['Gipuzkoa'],
  '25': ['Lérida'], '31': ['Nafarroa'], '32': ['Orense'], '38': ['Tenerife'], '48': ['Vizcaya'],
}

function nombresDe(m: MunicipioLista): string[] {
  const slugs = new Set([m.slug, slugTiempo(m.nombre)])
  const variantes = [...nombresDelINE(m.ine), ...(nombresMunicipales[m.ine] || [])]
  if (m.nombre.includes('/')) variantes.push(...m.nombre.split('/'))
  for (const n of variantes) {
    slugs.add(slugTiempo(n))
    for (const parte of ordenNatural(n).split('/')) slugs.add(slugTiempo(parte))
  }
  return [...slugs]
}

export function rutaMunicipioTiempo(municipios: MunicipioLista[], slug: string): {municipio: MunicipioLista; redirigir: boolean} | undefined {
  const canonico = municipios.find(m => m.slug === slug)
  if (canonico) return { municipio: canonico, redirigir: false }
  const clave = slugTiempo(slug)
  const destino = municipioFusionado(municipios[0]?.provinciaId || '', clave)
  const candidatas = municipios.filter(m => m.slug === destino || nombresDe(m).includes(clave))
  if (candidatas.length === 1) return { municipio: candidatas[0], redirigir: true }
}

export interface ResultadoTiempo { n: string; p: string; u: string; tipo: 'municipio' | 'provincia' }
interface Entrada { lugar: ResultadoTiempo; nombres: string[] }
export type IndiceBusquedaTiempo = Entrada[]

export function preparaBuscadorTiempo(municipios: MunicipioLista[]): IndiceBusquedaTiempo {
  const indice: Entrada[] = []
  const provincias = new Set<string>()
  for (const m of municipios) {
    const u = '/tiempo/' + m.provinciaSlug
    indice.push({ lugar: { n: m.nombre, p: m.provinciaNombre, u: u + '/' + m.slug, tipo: 'municipio' }, nombres: nombresDe(m) })
    if (provincias.has(m.provinciaId)) continue
    provincias.add(m.provinciaId)
    indice.push({ lugar: { n: m.provinciaNombre, p: m.provinciaNombre, u, tipo: 'provincia' },
      nombres: [m.provinciaNombre, ...(nombresProvinciales[m.provinciaId] || [])].map(slugTiempo) })
  }
  const comparar = new Intl.Collator('es').compare
  return indice.sort((a, b) => comparar(a.lugar.n,b.lugar.n) || comparar(a.lugar.p,b.lugar.p))
}

export function buscaTiempo(indice: IndiceBusquedaTiempo, consulta: string): { resultados: ResultadoTiempo[]; destino?: string } {
  const clave = slugTiempo(consulta.slice(0, 80))
  if (clave.length < 2) return { resultados: [] }
  const soloProvincia = clave.startsWith('provincia-de-')
  const nombre = soloProvincia ? clave.slice('provincia-de-'.length) : clave
  if (!nombre) return { resultados: [] }
  const ciudades: ResultadoTiempo[] = [], provincias: ResultadoTiempo[] = [], comienzos: ResultadoTiempo[] = [], otros: ResultadoTiempo[] = []
  for (const { lugar, nombres } of indice) {
    if (soloProvincia && lugar.tipo !== 'provincia') continue
    if (nombres.includes(nombre)) {
      if (lugar.tipo === 'municipio') ciudades.push(lugar)
      else provincias.push(lugar)
    } else if (comienzos.length < 12 && nombres.some(n => n.startsWith(nombre))) comienzos.push(lugar)
    else if (otros.length < 12 && nombres.some(n => n.includes(nombre))) otros.push(lugar)
  }
  const exactas = ciudades.length ? ciudades : provincias
  return { resultados: [...ciudades, ...provincias, ...comienzos, ...otros].slice(0, 12),
    destino: exactas.length === 1 ? exactas[0].u : undefined }
}
