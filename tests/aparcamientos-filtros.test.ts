import { describe, expect, it } from 'vitest'
import { cumpleFiltrosAparcamiento } from '../scripts/lib/aparcamientos-ui.mjs'

describe('filtros de aparcamientos oficiales', () => {
  const place = { plazasLibres: 8, plazasPmr: 2 }
  it('permite consultar todas las fichas aunque no se conozca la ocupación', () => {
    expect(cumpleFiltrosAparcamiento({ plazasLibres: null, plazasPmr: null }, { libres: false, pmr: false }, false)).toBe(true)
  })
  it('exige plazas positivas y un parte vigente para disponibilidad', () => {
    expect(cumpleFiltrosAparcamiento(place, { libres: true, pmr: false }, true)).toBe(true)
    expect(cumpleFiltrosAparcamiento(place, { libres: true, pmr: false }, false)).toBe(false)
    for (const plazasLibres of [0, null, -1, '8', NaN]) expect(cumpleFiltrosAparcamiento({ ...place, plazasLibres }, { libres: true, pmr: false }, true)).toBe(false)
  })
  it('PMR indica existencia de capacidad, aunque el aparcamiento esté lleno o sin parte', () => {
    expect(cumpleFiltrosAparcamiento({ ...place, plazasLibres: 0 }, { libres: false, pmr: true }, false)).toBe(true)
    for (const plazasPmr of [0, null, -1, '2', NaN]) expect(cumpleFiltrosAparcamiento({ ...place, plazasPmr }, { libres: false, pmr: true }, true)).toBe(false)
  })
  it('combina ambos requisitos sin atribuir las plazas libres a PMR', () => {
    expect(cumpleFiltrosAparcamiento(place, { libres: true, pmr: true }, true)).toBe(true)
    expect(cumpleFiltrosAparcamiento({ ...place, plazasLibres: 0 }, { libres: true, pmr: true }, true)).toBe(false)
    expect(cumpleFiltrosAparcamiento(place, { libres: true, pmr: true }, false)).toBe(false)
  })
})
