import { parseSctXml, sctOne, sctText, type SctXmlNode } from './trafico-sct-xml'

export type ParkingFuente = 'madrid' | 'vigo'
export const APARCAMIENTOS_FUENTES = {
  madrid: { nombre: 'Aparcamientos de Madrid', fuenteUrl: 'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios', datosUrl: 'https://servayto.madrid.es/MTPAR_WSINFO/InfoParking', licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode.es', atribucion: 'Ayuntamiento de Madrid · CC BY 4.0', maxAge: 300000, maxBytes: 262144, maxItems: 500 },
  vigo: { nombre: 'Aparcamientos de Vigo', fuenteUrl: 'https://datos-ckan.vigo.org/dataset/t-parking-real', datosUrl: 'https://datos.vigo.org/data/trafico/parkings-ocupacion.json', licenciaUrl: 'https://opendatacommons.org/licenses/by/1-0/', atribucion: 'Ayuntamiento de Vigo · ODC BY 1.0', maxAge: 360000, maxBytes: 131072, maxItems: 200 },
} as const
export interface ParkingFicha {
  id: string; nombre: string; lat: number | null; lon: number | null; direccion: string | null
  capacidad: number | null; plazasPmr: number | null; horarioTexto: string | null
  fechaFicha: null; detalleConsultado: string | null; gratis: null; disuasorio: null; fuenteUrl: string
}
export interface Aparcamiento extends ParkingFicha {
  plazasLibres: number | null; fechaOcupacion: string | null; caduca: string | null
  estado: 'actual' | 'caducado' | 'sin_confirmar'
}
export interface ParkingCatalogo {
  schema: 1; fuenteId: ParkingFuente; nombre: string; consultado: string; fechaDatos: null
  fuenteUrl: string; licenciaUrl: string; atribucion: string; total: number; detallesPendientes: number; items: ParkingFicha[]
}
const fail = (): never => { throw Error('Fuente de aparcamientos no válida') }
export const parkingFuente = (v: unknown): v is ParkingFuente => v === 'madrid' || v === 'vigo'
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f\ufffd]/.test(v)
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000
const digits = (v: string): number | null => /^\d{1,6}$/.test(v) && count(Number(v)) ? Number(v) : null
const nullableText = (v: unknown, max = 300) => text(v, max) ? v.trim() : null
// Rechaza normalizaciones silenciosas como 31 de febrero y horas inexistentes.
export function parkingTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null
  const n = Date.parse(value), zone = value.endsWith('Z') ? 'Z' : value.slice(-6)
  const offset = zone === 'Z' ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4))) * (zone[0] === '+' ? 1 : -1)
  if (!Number.isFinite(n) || Math.abs(offset) > 840 || zone !== 'Z' && Number(zone.slice(4)) >= 60) return null
  return new Date(n + offset * 60000).toISOString().slice(0, 19) === value.slice(0, 19) ? n : null
}
const madridDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
export function parkingHoraVigo(value: unknown): number | null {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)) return null
  const nominal = parkingTimestamp(value.replace(' ', 'T') + 'Z')
  if (nominal === null) return null
  const candidates = [nominal - 3600000, nominal - 7200000].filter(n => madridDate.format(n) === value)
  return candidates.length === 1 ? candidates[0] : null
}
function located(city: ParkingFuente, lat: unknown, lon: unknown): boolean {
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && (city === 'madrid' ? lat >= 40.2 && lat <= 40.7 && lon >= -3.9 && lon <= -3.4 : lat >= 42.1 && lat <= 42.4 && lon >= -8.9 && lon <= -8.5)
}
function ficha(city: ParkingFuente, id: string, name: unknown, lat: unknown, lon: unknown, address?: unknown): ParkingFicha {
  if (!/^[1-9]\d{0,8}$/.test(id) || !text(name)) return fail()
  const valid = located(city, lat, lon)
  return { id: `parking-${city}-${id}`, nombre: name.trim(), lat: valid ? lat as number : null, lon: valid ? lon as number : null, direccion: nullableText(address), capacidad: null, plazasPmr: null, horarioTexto: null, fechaFicha: null, detalleConsultado: null, gratis: null, disuasorio: null, fuenteUrl: APARCAMIENTOS_FUENTES[city].fuenteUrl }
}
function estado(free: number | null, date: number | null, now: number, age: number): Pick<Aparcamiento, 'plazasLibres' | 'fechaOcupacion' | 'caduca' | 'estado'> {
  const validDate = date !== null && date <= now
  if (free === null || !validDate) return { estado: 'sin_confirmar', plazasLibres: null, fechaOcupacion: validDate ? new Date(date).toISOString() : null, caduca: null }
  const until = date + age, current = now < until
  return { estado: current ? 'actual' : 'caducado', plazasLibres: current ? free : null, fechaOcupacion: new Date(date).toISOString(), caduca: new Date(until).toISOString() }
}
function unique(items: Aparcamiento[], city: ParkingFuente) {
  if (!items.length || items.length > APARCAMIENTOS_FUENTES[city].maxItems || new Set(items.map(v => v.id)).size !== items.length) return fail()
  return items.sort((a, b) => a.id.localeCompare(b.id, 'en'))
}
export function normalizaParkingVigo(raw: string, now = Date.now()): Aparcamiento[] {
  if (raw.length > APARCAMIENTOS_FUENTES.vigo.maxBytes) return fail()
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data) || data.length > APARCAMIENTOS_FUENTES.vigo.maxItems) return fail()
  return unique(data.map(row => {
    if (!object(row) || !Number.isSafeInteger(row.id_parking) || Number(row.id_parking) <= 0) return fail()
    const item = ficha('vigo', String(row.id_parking), row.nombre, row.lat, row.lon)
    item.capacidad = count(row.totalplazas) ? row.totalplazas : null
    const free = count(row.plazaslibres) && (item.capacidad === null || row.plazaslibres <= item.capacidad) ? row.plazaslibres : null
    return { ...item, ...estado(free, parkingHoraVigo(row.fechahora), now, APARCAMIENTOS_FUENTES.vigo.maxAge) }
  }), 'vigo')
}
function soap(raw: string, operation: 'GetListParking' | 'GetDetailParking') {
  if (raw.length > APARCAMIENTOS_FUENTES.madrid.maxBytes) return fail()
  const root = parseSctXml(raw)
  if (root.tag !== 'soap:Envelope' || root.attrs['xmlns:soap'] !== 'http://schemas.xmlsoap.org/soap/envelope/') return fail()
  const response = sctOne(sctOne(root, 'soap:Body'), operation + 'Response')
  if (response.attrs.xmlns !== 'http://tempuri.org/' || response.attrs['xmlns:ns2'] !== 'http://schemas.datacontract.org/2004/07/InfoParking') return fail()
  const result = sctOne(response, operation + 'Result')
  if (sctText(result, 'ns2:code') !== '0') return fail()
  return result
}
function optional(parent: SctXmlNode, tag: string, max = 300): string | null {
  if (!parent.children.some(n => n.tag === tag)) return null
  return nullableText(sctText(parent, tag, 4096), max)
}
export function normalizaParkingMadrid(raw: string, now = Date.now()): Aparcamiento[] {
  const rows = sctOne(soap(raw, 'GetListParking'), 'ns2:ArrayOflstParking').children
  if (rows.length > APARCAMIENTOS_FUENTES.madrid.maxItems) return fail()
  return unique(rows.map(row => {
    if (row.tag !== 'ns2:lstParking') return fail()
    const item = ficha('madrid', sctText(row, 'ns2:id'), sctText(row, 'ns2:name'), Number(optional(row, 'ns2:latitude')), Number(optional(row, 'ns2:longitude')), optional(row, 'ns2:address'))
    const nodes = row.children.filter(n => n.tag === 'ns2:lstOccupation')
    const totals = nodes.length === 1 ? nodes[0].children.filter(n => n.tag === 'ns2:occupation' && optional(n, 'ns2:code') === '001' && optional(n, 'ns2:name') === 'Total') : []
    const free = totals.length === 1 ? digits(optional(totals[0], 'ns2:free') ?? '') : null
    const date = totals.length === 1 ? parkingTimestamp(optional(totals[0], 'ns2:moment')) : null
    return { ...item, ...estado(free, date, now, APARCAMIENTOS_FUENTES.madrid.maxAge) }
  }), 'madrid')
}
export function normalizaDetalleMadrid(raw: string, id: string): Pick<ParkingFicha, 'capacidad' | 'plazasPmr' | 'horarioTexto'> {
  const row = sctOne(sctOne(soap(raw, 'GetDetailParking'), 'ns2:ArrayOfparkingDetails'), 'ns2:parkingDetails')
  if (sctText(row, 'ns2:id') !== id || sctText(row, 'ns2:familyCode') !== '001') return fail()
  const containers = row.children.filter(n => n.tag === 'ns2:lstFeatures')
  const features = containers.length === 1 ? containers[0].children : []
  const number = (code: string, name: string) => {
    const matches = features.filter(n => n.tag === 'ns2:feature' && optional(n, 'ns2:nameField') === 'Tipo plaza' && optional(n, 'ns2:code') === code && optional(n, 'ns2:name') === name)
    const values = matches.map(n => digits(optional(n, 'ns2:content') ?? ''))
    return values.length && values.every(v => v !== null && v === values[0]) ? values[0] : null
  }
  const capacidad = number('001', 'Total'), pmr = number('002', 'PMR')
  return { capacidad, plazasPmr: pmr !== null && (capacidad === null || pmr <= capacidad) ? pmr : null, horarioTexto: optional(row, 'ns2:schedule', 1000) }
}
export function parkingSinDisponibilidad(item: ParkingFicha): Aparcamiento {
  return { ...item, plazasLibres: null, fechaOcupacion: null, caduca: null, estado: 'sin_confirmar' }
}
export function parkingSoloFicha(item: ParkingFicha): ParkingFicha {
  const { id, nombre, lat, lon, direccion, capacidad, plazasPmr, horarioTexto, fechaFicha, detalleConsultado, gratis, disuasorio, fuenteUrl } = item
  return { id, nombre, lat, lon, direccion, capacidad, plazasPmr, horarioTexto, fechaFicha, detalleConsultado, gratis, disuasorio, fuenteUrl }
}
export function validaCatalogoParking(value: unknown, city: ParkingFuente, now = Date.now()): ParkingCatalogo {
  if (!object(value)) return fail()
  const source = APARCAMIENTOS_FUENTES[city], stamp = parkingTimestamp(value.consultado)
  if (value.schema !== 1 || value.fuenteId !== city || value.nombre !== source.nombre || value.fuenteUrl !== source.fuenteUrl || value.licenciaUrl !== source.licenciaUrl || value.atribucion !== source.atribucion || value.fechaDatos !== null || stamp === null || stamp > now || !Array.isArray(value.items) || !value.items.length || value.items.length > source.maxItems || value.total !== value.items.length || !Number.isInteger(value.detallesPendientes) || Number(value.detallesPendientes) < 0 || Number(value.detallesPendientes) > value.total) return fail()
  const ids = new Set<string>()
  for (const item of value.items) {
    if (!object(item) || typeof item.id !== 'string' || !new RegExp(`^parking-${city}-[1-9]\\d{0,8}$`).test(item.id) || ids.has(item.id) || !text(item.nombre) || !(item.lat === null && item.lon === null || located(city, item.lat, item.lon)) || !(item.direccion === null || text(item.direccion, 300)) || !(item.capacidad === null || count(item.capacidad)) || !(item.plazasPmr === null || count(item.plazasPmr)) || typeof item.capacidad === 'number' && typeof item.plazasPmr === 'number' && item.plazasPmr > item.capacidad || !(item.horarioTexto === null || text(item.horarioTexto, 1000)) || item.fechaFicha !== null || item.gratis !== null || item.disuasorio !== null || item.fuenteUrl !== source.fuenteUrl) return fail()
    const checked = parkingTimestamp(item.detalleConsultado)
    if (item.detalleConsultado !== null && (checked === null || checked > stamp)) return fail()
    if (city === 'vigo' && (item.plazasPmr !== null || item.horarioTexto !== null || item.detalleConsultado !== null) || city === 'madrid' && item.detalleConsultado === null && (item.capacidad !== null || item.plazasPmr !== null || item.horarioTexto !== null)) return fail()
    ids.add(item.id)
  }
  return value as unknown as ParkingCatalogo
}
