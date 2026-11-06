import { describe, expect, it } from 'vitest'
import { buscaLocalidades, construyeLocalidades, serviciosLocalidad } from '../src/lib/localidades'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'
const municipio = { ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid', provinciaId: '28', provinciaSlug: 'madrid', slug: 'madrid' } as MunicipioLista
describe('resultados del municipio', () => {
  it('el resumen de tiempo de la portada descarta la descripción sin periodo del formato antiguo', () => {
    const ahora = Date.parse('2026-11-07T00:30:00Z')
    const pred = { ine: municipio.ine, nombre: 'Madrid', provincia: 'Madrid', fuente: 'AEMET' as const,
      elaborado: '2026-11-06T22:00:00Z',
      dias: [{fecha:'2026-11-07', tmax:20, tmin:5, cielo:'Niebla', probLluvia:10, viento:4}] }
    const [m] = construyeLocalidades([municipio], [], '', {}, { estaciones: [] }, { [municipio.ine]:pred })
    const tarjeta = serviciosLocalidad(m, ahora).find(s => s.titulo === 'El tiempo')
    expect(tarjeta?.detalle).toBe('Máx. 20° · Mín. 5° · AEMET')
  })
  it('distingue homónimos y busca sin tildes', () => {
    const all = [{ ine: '1', nombre: 'Ávila', provinciaNombre: 'Ávila' }, { ine: '2', nombre: 'Villa', provinciaNombre: 'Madrid' }, { ine: '3', nombre: 'Villa', provinciaNombre: 'Toledo' }]
    expect(buscaLocalidades(all, 'avila').map(m => m.ine)).toEqual(['1'])
    expect(buscaLocalidades(all, 'Villa Madrid').map(m => m.ine)).toEqual(['2'])
    expect(buscaLocalidades(all, 'a')).toEqual([])
  })
  it('no inventa municipios en otras fuentes ni precios frescos', () => {
    const [m] = construyeLocalidades([municipio], [{ IDProvincia: '28', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,500' }], '2026-11-03T10:00:00Z', {}, { estaciones: [{ prov: '28', mun: 'Alcalá de Henares' }] as any }, {})
    expect(m.gas.url).toBe('/gasolineras/madrid/madrid')
    expect(m.itv.url).toBe('/itv/madrid')
    expect(m.farmacias.url).toBe('/farmacias/madrid/madrid')
    expect(m.farmacias.count).toBe(0)
    expect(serviciosLocalidad(m, Date.parse('2026-11-03T11:00:00Z'))[0].detalle).toContain('1,500 €/L')
    expect(serviciosLocalidad(m, Date.parse('2026-11-05T11:00:00Z'))[0].detalle).not.toContain('1,500')
    expect(serviciosLocalidad(m, Date.parse('2026-11-02T11:00:00Z'))[0].detalle).not.toContain('1,500')
  })
  it('vincula el nombre del colegio con el mismo municipio, conserva homónimos y ofrece el colegio de Lugo', () => {
    const datos = [
      { ine: '15030', nombre: 'Coruña, A', provinciaId: '15' },
      { ine: '28127', nombre: 'Rozas de Madrid, Las', provinciaId: '28' },
      { ine: '28128', nombre: 'Rozas de Puerto Real', provinciaId: '28' },
      { ine: '27028', nombre: 'Lugo', provinciaId: '27' },
    ].map(m => ({ ...municipio, ...m }))
    const guardia = (nombre: string) => [0, 0, 'Dirección', nombre, '', '', '', '']
    const fichas = construyeLocalidades(datos, [], '', {
      coruna: { guardias: [guardia('A Coruña')] },
      madrid: { guardias: [guardia('LAS ROZAS'), guardia('LAS ROZAS')] },
    }, { estaciones: [] }, {})
    expect(fichas.map(m => [m.farmacias.url, m.farmacias.count])).toEqual([
      ['/farmacias/a-coruna/a-coruna', 1], ['/farmacias/madrid/las-rozas', 2],
      ['/farmacias/madrid/rozas-de-puerto-real', 0], ['/farmacias/lugo', 0],
    ])
  })
})
