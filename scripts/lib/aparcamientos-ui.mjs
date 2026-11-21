import { plazoServicio, vigenteServicio } from './servicios-ui.mjs'

export const APARCAMIENTOS_MAPA = [
  { id: 'aparcamientos-madrid', ciudad: 'madrid', nombre: 'Aparcamientos de Madrid · plazas disponibles', municipio: '28079', maxAge: 300000, maxItems: 500, bounds: [40.2, 40.7, -3.9, -3.4], fuenteUrl: 'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios', licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode.es', atribucion: 'Ayuntamiento de Madrid · CC BY 4.0' },
  { id: 'aparcamientos-vigo', ciudad: 'vigo', nombre: 'Aparcamientos de Vigo · plazas disponibles', municipio: '36057', maxAge: 360000, maxItems: 200, bounds: [42.1, 42.4, -8.9, -8.5], fuenteUrl: 'https://datos-ckan.vigo.org/dataset/t-parking-real', licenciaUrl: 'https://opendatacommons.org/licenses/by/1-0/', atribucion: 'Ayuntamiento de Vigo · ODC BY 1.0' },
]
export const fuenteAparcamiento = categoria => APARCAMIENTOS_MAPA.find(f => f.id === categoria)
// Sólo separadores visuales. No interpreta horas, días, excepciones ni apertura.
export function formateaHorarioAparcamiento(value) {
  if (typeof value !== 'string') return ''
  if (!/^(?:\[[^\[\]]+\])+$/.test(value)) return value
  return [...value.matchAll(/\[([^\[\]]+)\]/g)].map(group => group[1].replace(/,(?=\S)/g, ', ')).join(' · ')
}
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f\ufffd]/.test(v)
const count = v => Number.isInteger(v) && v >= 0 && v <= 100000
const stamp = v => typeof v === 'string' && /^20\d\d-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const fail = () => { throw Error('No se pudo comprobar el parte de aparcamientos') }
export function coordenadasAparcamiento(p, fuente) {
  return !!fuente && Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && p.lat >= fuente.bounds[0] && p.lat <= fuente.bounds[1] && p.lon >= fuente.bounds[2] && p.lon <= fuente.bounds[3]
}
// La hora del dispositivo no rejuvenece el parte. El plazo se ancla al inicio
// de la petición y a la evaluación del servidor, también si la red es lenta.
export function preparaParteAparcamientos(data, ciudad, inicioWall, inicioMono) {
  const fuente = APARCAMIENTOS_MAPA.find(f => f.ciudad === ciudad)
  if (!fuente || !object(data) || data.fuenteId !== ciudad || data.fuenteUrl !== fuente.fuenteUrl || data.licenciaUrl !== fuente.licenciaUrl || data.atribucion !== fuente.atribucion || !stamp(data.evaluadoEn) || !['actual', 'parcial', 'sin_actualizar'].includes(data.estado) || data.fechaDatos !== null || !Array.isArray(data.items) || !data.items.length || data.items.length > fuente.maxItems || data.total !== data.items.length || !count(data.conDisponibilidad) || data.consultado !== null && (!stamp(data.consultado) || Date.parse(data.consultado) > Date.parse(data.evaluadoEn)) || data.catalogoConsultado !== null && (!stamp(data.catalogoConsultado) || Date.parse(data.catalogoConsultado) > Date.parse(data.evaluadoEn))) return fail()
  const seen = new Set(), evaluated = Date.parse(data.evaluadoEn)
  const items = data.items.map(item => {
    if (!object(item) || !new RegExp('^parking-' + ciudad + '-[1-9]\\d{0,8}$').test(item.id) || seen.has(item.id) || !text(item.nombre, 200) || item.fuenteUrl !== fuente.fuenteUrl || !(item.lat === null && item.lon === null || coordenadasAparcamiento(item, fuente)) || item.direccion !== null && !text(item.direccion, 300) || item.capacidad !== null && !count(item.capacidad) || item.plazasPmr !== null && !count(item.plazasPmr) || item.horarioTexto !== null && !text(item.horarioTexto, 1000) || item.gratis !== null || item.disuasorio !== null || item.fechaFicha !== null || !['actual', 'caducado', 'sin_confirmar'].includes(item.estado)) return fail()
    if (item.capacidad !== null && item.plazasPmr !== null && item.plazasPmr > item.capacidad || item.detalleConsultado !== null && (!stamp(item.detalleConsultado) || Date.parse(item.detalleConsultado) > evaluated)) return fail()
    seen.add(item.id)
    const current = item.estado === 'actual'
    if (current && (data.consultado === null || !count(item.plazasLibres) || item.capacidad !== null && item.plazasLibres > item.capacidad || !stamp(item.fechaOcupacion) || !stamp(item.caduca) || Date.parse(item.fechaOcupacion) > evaluated || Date.parse(item.caduca) - Date.parse(item.fechaOcupacion) !== fuente.maxAge || Date.parse(item.caduca) <= evaluated)) return fail()
    if (!current && item.plazasLibres !== null) return fail()
    return { ...item, proveedor: 'aparcamientos-oficiales', categorias: [fuente.id], fuenteId: ciudad, _estadoComprobado: current, _plazo: current ? plazoServicio(item.caduca, data.evaluadoEn, inicioWall, inicioMono) : null }
  })
  if (items.filter(p => p._estadoComprobado).length !== data.conDisponibilidad) return fail()
  return { ...data, items }
}
export function aparcamientoActual(item, failed = false, nowWall = Date.now(), nowMono = performance.now()) {
  return !failed && item?._estadoComprobado === true && vigenteServicio(item._plazo, nowWall, nowMono)
}
