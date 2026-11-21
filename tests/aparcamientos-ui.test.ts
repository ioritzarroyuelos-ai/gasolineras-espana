import { describe, expect, it } from 'vitest'
import { APARCAMIENTOS_MAPA, preparaParteAparcamientos, aparcamientoActual, formateaHorarioAparcamiento } from '../scripts/lib/aparcamientos-ui.mjs'
import { APARCAMIENTOS_FUENTES } from '../src/lib/aparcamientos-datos'
import { isValidSyncValue } from '../src/lib/auth'
import { parkingCatalogue, parkingStamp, PARKING_NOW } from './aparcamientos-fixtures'

const fixture = (city: 'madrid' | 'vigo' = 'madrid') => {
  const c = parkingCatalogue(city), item = { ...c.items[0], plazasLibres: 0, fechaOcupacion: parkingStamp(60), caduca: new Date(PARKING_NOW + (city === 'madrid' ? 240000 : 300000)).toISOString(), estado: 'actual' }
  return { ...c, evaluadoEn: parkingStamp(), catalogoConsultado: c.consultado, conDisponibilidad: 1, estado: 'actual', warnings: [], items: [item] }
}
describe('aparcamientos en el mapa: vigencia y permisos', () => {
  it('separa visualmente el horario sin modificar ni interpretar el texto de la fuente', () => {
    const source = { horarioTexto: '[24 Horas][Lunes,Martes,Miércoles][00:00][23:59]' }, original = source.horarioTexto
    expect(formateaHorarioAparcamiento(source.horarioTexto)).toBe('24 Horas · Lunes, Martes, Miércoles · 00:00 · 23:59')
    expect(source.horarioTexto).toBe(original)
    expect(formateaHorarioAparcamiento('[Lunes,Viernes][Excepto festivos: consultar][Cierre especial 24/12]')).toBe('Lunes, Viernes · Excepto festivos: consultar · Cierre especial 24/12')
    const free = 'De lunes a viernes; excepto festivos. Días 24 y 31: consultar.'
    expect(formateaHorarioAparcamiento(free)).toBe(free)
    expect(formateaHorarioAparcamiento('[Horario incompleto')).toBe('[Horario incompleto')
  })
  it.each(['madrid', 'vigo'] as const)('conserva cero y coincide con el contrato oficial de %s', city => {
    const d = APARCAMIENTOS_MAPA.find(f => f.ciudad === city)!, server = APARCAMIENTOS_FUENTES[city]
    expect([d.fuenteUrl, d.licenciaUrl, d.atribucion, d.maxAge]).toEqual([server.fuenteUrl, server.licenciaUrl, server.atribucion, server.maxAge])
    const part = preparaParteAparcamientos(fixture(city), city, PARKING_NOW, 100)
    expect(part.items[0].plazasLibres).toBe(0)
    expect(aparcamientoActual(part.items[0], false, PARKING_NOW, 100)).toBe(true)
    expect(part.items[0].horario).toBeUndefined()
  })
  it('caduca por lugar, descuenta la red y no prolonga el plazo con reloj atrasado', () => {
    const data = fixture(), old = data.items[0]
    data.items.push({ ...old, id: 'parking-madrid-73', fechaOcupacion: parkingStamp(290), caduca: new Date(PARKING_NOW + 10000).toISOString() }); data.total = 2; data.conDisponibilidad = 2
    const part = preparaParteAparcamientos(data, 'madrid', PARKING_NOW - 3600000, 100)
    expect(aparcamientoActual(part.items[1], false, PARKING_NOW - 3600000 + 11000, 11100)).toBe(false)
    expect(aparcamientoActual(part.items[0], false, PARKING_NOW - 7200000, 240100)).toBe(false)
    expect(aparcamientoActual(part.items[0], true, PARKING_NOW - 3600000, 100)).toBe(false)
  })
  it('el respaldo no resucita cifras y una ficha sin coordenadas sigue siendo una ficha', () => {
    const data: any = fixture(); data.consultado = null; data.conDisponibilidad = 0; data.estado = 'sin_actualizar'
    Object.assign(data.items[0], { lat: null, lon: null, plazasLibres: null, fechaOcupacion: null, caduca: null, estado: 'sin_confirmar' })
    const part = preparaParteAparcamientos(data, 'madrid', PARKING_NOW, 100)
    expect(part.items).toHaveLength(1); expect(part.items[0].lat).toBeNull(); expect(aparcamientoActual(part.items[0], false, PARKING_NOW, 100)).toBe(false)
  })
  it.each([
    (d: any) => d.items[0].plazasLibres = 1000,
    (d: any) => d.items[0].plazasLibres = -1,
    (d: any) => d.items[0].plazasLibres = 1.5,
    (d: any) => d.items[0].fechaOcupacion = new Date(PARKING_NOW + 1000).toISOString(),
    (d: any) => d.items[0].caduca = new Date(PARKING_NOW + 3600000).toISOString(),
    (d: any) => d.items[0].lat = 42.2,
    (d: any) => d.items[0].id = 'parking-vigo-72',
    (d: any) => d.items[0].fuenteUrl = 'https://example.test',
    (d: any) => d.items[0].plazasPmr = 1000,
    (d: any) => d.consultado = null,
    (d: any) => d.conDisponibilidad = 0,
    (d: any) => { d.items.push(d.items[0]); d.total = 2; d.conDisponibilidad = 2 },
  ])('rechaza un parte incoherente antes de mostrar plazas (%#)', change => {
    const data = fixture(); change(data); expect(() => preparaParteAparcamientos(data, 'madrid', PARKING_NOW, 100)).toThrow()
  })
  it('guarda sólo identidades estables de su ciudad y rechaza stock o proveedores mezclados', () => {
    const madrid = { id: 'parking-madrid-72', nombre: 'Prueba', categoria: 'aparcamientos-madrid', lat: 40.4, lon: -3.6 }
    const vigo = { id: 'parking-vigo-4763', nombre: 'Prueba Vigo', categoria: 'aparcamientos-vigo', lat: 42.22, lon: -8.73 }
    const storageName = 'eu-servicios-favoritos-v1'
    expect(isValidSyncValue(storageName, [madrid, vigo])).toBe(true)
    for (const item of [{ ...madrid, plazasLibres: 0 }, { ...madrid, categoria: vigo.categoria }, { ...madrid, id: 'osm-node-72' }, { ...madrid, id: 'parking-madrid-0' }, { ...madrid, id: 'parking-madrid-072' }, { ...madrid, lat: vigo.lat }, { ...vigo, categoria: 'aparcamientos' }]) expect(isValidSyncValue(storageName, [item])).toBe(false)
    expect(isValidSyncValue('eu-servicios-preferencias-v1', { version: 1, categorias: [madrid.categoria, vigo.categoria], municipios: ['28079', '36057'] })).toBe(true)
  })
})
