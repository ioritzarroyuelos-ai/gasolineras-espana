import { describe, expect, it } from 'vitest'
import { buscaLocalidades, construyeLocalidades, serviciosLocalidad } from '../src/lib/localidades'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'
const municipio = { ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid', provinciaId: '28', provinciaSlug: 'madrid', slug: 'madrid' } as MunicipioLista
describe('resultados del municipio', () => {
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
    expect(m.farmacias.url).toBe('/farmacias/')
    expect(serviciosLocalidad(m, Date.parse('2026-11-03T11:00:00Z'))[0].detalle).toContain('1,500 €/L')
    expect(serviciosLocalidad(m, Date.parse('2026-11-05T11:00:00Z'))[0].detalle).not.toContain('1,500')
    expect(serviciosLocalidad(m, Date.parse('2026-11-02T11:00:00Z'))[0].detalle).not.toContain('1,500')
  })
})
