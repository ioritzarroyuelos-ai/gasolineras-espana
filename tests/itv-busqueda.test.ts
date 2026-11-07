import { describe, expect, it } from 'vitest'
import base from '../public/data/tiempo/municipios.json?raw'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'
import type { EstacionITV } from '../src/lib/itv'
import { buscaItv, estacionesCercanas, estacionesEnMunicipio, origenDelMunicipio, rutaAnteriorItv } from '../src/lib/itv-busqueda'
import { catalogoTiempo, preparaBuscadorTiempo } from '../src/lib/tiempo-municipios'
import { buscadorItv, resultadosItv } from '../src/html/itv-buscador'

const municipios = catalogoTiempo(JSON.parse(base).municipios as MunicipioLista[])
const indice = preparaBuscadorTiempo(municipios)
function estacion(id: string, lat: number | null, lng: number | null, mun = 'Amorebieta-Etxano', prov = '48'): EstacionITV {
  return { id, lat, lng, mun, prov, dir: 'Dirección oficial', cp: '', op: '', tel: '', horario: '', lineas: null, fuente: 'dgt' }
}

describe('búsqueda de ITV para todos los municipios', () => {
  it.each([
    ['Madrid', '/itv/madrid/madrid'],
    ['Provincia de Madrid', '/itv/madrid'],
    ['Durango', '/itv/bizkaia/durango'],
    ['La Coruña', '/itv/a-coruna/coruna-a'],
    ['Donostia', '/itv/guipuzcoa/donostia-san-sebastian'],
    ['Gipuzkoa', '/itv/guipuzcoa'],
    ['Usansolo', '/itv/bizkaia/usansolo'],
    ['Cerdedo', '/itv/pontevedra/cerdedo-cotobade'],
  ])('%s abre el destino exacto, aunque el pueblo no tenga ITV', (q, url) => {
    expect(buscaItv(indice, q).destino).toBe(url)
    expect(buscaItv(indice, q).resultados[0].u).toBe(url)
  })
  it('muestra dos opciones para nombres ambiguos y conserva El Tiempo', () => {
    const resultado = buscaItv(indice, 'Cabanes')
    expect(resultado.destino).toBeUndefined()
    expect(resultado.resultados.slice(0, 2).map(r => r.p)).toEqual(['Castellón', 'Girona'])
    expect(indice.every(e => e.lugar.u.startsWith('/tiempo/'))).toBe(true)
  })
  it('no asigna coordenadas a un municipio que carece de ellas', () => {
    const durango = municipios.find(m => m.ine === '48027')!
    expect(origenDelMunicipio(durango)).toEqual({ nombre: 'Durango', lat: durango.lat, lng: durango.lng })
    expect(origenDelMunicipio({ ...durango, lat: null })).toBeUndefined()
    expect(origenDelMunicipio({ ...durango, lng: NaN })).toBeUndefined()
    expect(origenDelMunicipio({ ...durango, lat: 0, lng: 0 })).toBeUndefined()
  })
  it('ordena por distancia geográfica y admite centros al otro lado de la provincia', () => {
    const todas = [
      estacion('lejana', 40, -4), estacion('proxima', 43, -2.1, 'Eibar', '20'),
      estacion('igual', 43, -2), estacion('sin-latitud', null, -2),
      estacion('sin-longitud', 43, null), estacion('no-finita', 43, NaN), estacion('fuera-rango', 100, 2),
    ]
    const cerca = estacionesCercanas(todas, { nombre: 'Punto de prueba', lat: 43, lng: -2 })
    expect(cerca.map(r => r.estacion.id)).toEqual(['igual', 'proxima'])
    expect(cerca[0].distanciaKm).toBe(0)
    expect(cerca[1].distanciaKm).toBeGreaterThan(8)
    expect(cerca[1].distanciaKm).toBeLessThan(9)
    expect(estacionesCercanas(todas, {nombre:'Inválido',lat:NaN,lng:-2})).toEqual([])
  })
  it('une nombres bilingües documentados dentro de provincia sin adivinar barrios', () => {
    const municipio = municipios.find(m => m.ine === '20069')!
    const provincia = municipios.filter(m => m.provinciaId === '20')
    const todas = [estacion('correcta', 43.3, -1.9, 'SAN SEBASTIÁN', '20'), estacion('otra-provincia', 43.3, -1.9, 'SAN SEBASTIÁN', '28'), estacion('sin-confirmar', 43.3, -1.9, 'Un barrio', '20')]
    expect(estacionesEnMunicipio(todas, municipio, provincia).map(e => e.id)).toEqual(['correcta'])
    const ribadesella = municipios.find(m => m.ine === '33056')!
    expect(estacionesEnMunicipio([estacion('bilingue', 43.4, -5.1, 'RIBADESELLA/RIBESEYA', '33')], ribadesella, municipios.filter(m => m.provinciaId === '33'))).toHaveLength(1)
  })
  it('mantiene la ficha principal aunque un alias histórico nombre otro municipio', () => {
    const centro = { ...estacion('uno', 43.2, -2.7), aliasMunicipios:['Amorebieta'] }
    const provincia = municipios.filter(m => m.provinciaId === '48')
    expect(rutaAnteriorItv([centro], 'amorebieta')).toBe('amorebieta-etxano')
    expect(estacionesEnMunicipio([centro], provincia.find(m => m.ine === '48003')!, provincia)).toHaveLength(1)
    const distinto = { ...centro, mun:'Durango', aliasMunicipios:['Amorebieta', 'Amorebieta-Etxano'] }
    expect(estacionesEnMunicipio([distinto], provincia.find(m => m.ine === '48027')!, provincia)).toHaveLength(1)
    expect(estacionesEnMunicipio([distinto], provincia.find(m => m.ine === '48003')!, provincia)).toHaveLength(0)
    expect(rutaAnteriorItv([centro, distinto], 'amorebieta')).toBeUndefined()
  })
  it('solo utiliza alias municipales si el nombre principal no se reconoce y el destino es único', () => {
    const provincia = municipios.filter(m => m.provinciaId === '48')
    const durango = provincia.find(m => m.ine === '48027')!
    const centro = { ...estacion('nucleo', null, null, 'Núcleo no reconocido'), aliasMunicipios:['Durango'] }
    expect(estacionesEnMunicipio([centro], durango, provincia)).toHaveLength(1)
    expect(estacionesEnMunicipio([{ ...centro, aliasMunicipios:['Durango', 'Amorebieta-Etxano'] }], durango, provincia)).toHaveLength(0)
  })
  it('ofrece envío al servidor, escape de texto y enlaces sin JavaScript', () => {
    expect(buscadorItv('nonce', '<prueba>')).toContain('action="/itv/buscar" method="get"')
    expect(buscadorItv('nonce', '<prueba>')).toContain('value="&lt;prueba&gt;"')
    expect(buscadorItv('nonce')).toContain('Reintentar')
    expect(resultadosItv('Madrid', buscaItv(indice, 'Madrid').resultados)).toContain('href="/itv/madrid/madrid"')
  })
})
