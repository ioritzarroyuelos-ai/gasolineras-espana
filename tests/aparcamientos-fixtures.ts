import { APARCAMIENTOS_FUENTES, type ParkingCatalogo, type ParkingFuente } from '../src/lib/aparcamientos-datos'
export const PARKING_NOW = Date.parse('2026-11-21T12:00:00Z')
export const parkingStamp = (seconds = 0) => new Date(PARKING_NOW - seconds * 1000).toISOString()
export const parkingXml = (body: string, operation = 'GetListParking') => `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${operation}Response xmlns="http://tempuri.org/" xmlns:ns2="http://schemas.datacontract.org/2004/07/InfoParking"><${operation}Result><ns2:code>0</ns2:code>${body}</${operation}Result></${operation}Response></soap:Body></soap:Envelope>`
export function madridRow(id = 72, free: string | null = '0', date = parkingStamp(60)) {
  return `<ns2:lstParking><ns2:id>${id}</ns2:id><ns2:name>Parking ${id}</ns2:name><ns2:latitude>40.4092538</ns2:latitude><ns2:longitude>-3.6941255</ns2:longitude><ns2:address>Calle del Museo</ns2:address>${free === null ? '' : `<ns2:lstOccupation><ns2:occupation><ns2:code>001</ns2:code><ns2:free>${free}</ns2:free><ns2:moment>${date}</ns2:moment><ns2:name>Total</ns2:name></ns2:occupation></ns2:lstOccupation>`}</ns2:lstParking>`
}
export const madridList = (rows = madridRow()) => parkingXml('<ns2:ArrayOflstParking>' + rows + '</ns2:ArrayOflstParking>')
export function madridDetail(id = 72, pmr = '3', extra = '') {
  const feature = (code: string, name: string, value: string) => `<ns2:feature><ns2:code>${code}</ns2:code><ns2:name>${name}</ns2:name><ns2:nameField>Tipo plaza</ns2:nameField><ns2:content>${value}</ns2:content></ns2:feature>`
  return parkingXml(`<ns2:ArrayOfparkingDetails><ns2:parkingDetails><ns2:id>${id}</ns2:id><ns2:familyCode>001</ns2:familyCode><ns2:lstFeatures>${feature('001', 'Total', '132')}${feature('002', 'PMR', pmr)}${feature('002', 'PMR', pmr)}${extra}</ns2:lstFeatures><ns2:schedule>[24 Horas][Lunes,Domingo][00:00][23:59]</ns2:schedule><ns2:lstAccess><ns2:access><ns2:latitude>-3.6</ns2:latitude><ns2:longitude>40.4</ns2:longitude></ns2:access></ns2:lstAccess></ns2:parkingDetails></ns2:ArrayOfparkingDetails>`, 'GetDetailParking')
}
export const vigoRow = (id = 4763) => ({ id_parking: id, nombre: 'Parking Vigo ' + id, lat: 42.22014, lon: -8.73556, totalplazas: 388, plazaslibres: 0, ocupacion: 100, fechahora: '2026-11-21 12:59:00' })
export function parkingCatalogue(city: ParkingFuente, stamp = parkingStamp()): ParkingCatalogo {
  const source = APARCAMIENTOS_FUENTES[city]
  return { schema: 1, fuenteId: city, nombre: source.nombre, consultado: stamp, fechaDatos: null, fuenteUrl: source.fuenteUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion, total: 1, detallesPendientes: 0, items: [{ id: 'parking-' + city + (city === 'madrid' ? '-72' : '-4763'), nombre: 'Aparcamiento de prueba', lat: city === 'madrid' ? 40.4 : 42.22, lon: city === 'madrid' ? -3.6 : -8.73, direccion: null, capacidad: 132, plazasPmr: city === 'madrid' ? 3 : null, horarioTexto: null, fechaFicha: null, detalleConsultado: city === 'madrid' ? stamp : null, gratis: null, disuasorio: null, fuenteUrl: source.fuenteUrl }] }
}
export async function parkingAssets(data: ParkingCatalogo, state = 'actual') {
  const raw = JSON.stringify(data), bytes = new TextEncoder().encode(raw)
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
  const source = { id: data.fuenteId, estado: state, ultimoExito: data.consultado, total: data.total, bytes: bytes.byteLength, sha256 }
  const index = { schema: 1, consultado: parkingStamp(), fuentes: [source, { id: data.fuenteId === 'madrid' ? 'vigo' : 'madrid', estado: 'error' }] }
  return { index, fetch: async (request: Request) => new URL(request.url).pathname.endsWith('index.json') ? Response.json(index) : new Response(raw) }
}
