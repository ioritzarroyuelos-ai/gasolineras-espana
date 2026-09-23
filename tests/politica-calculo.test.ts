import { describe, it, expect } from 'vitest'
import { calculaCambio, estadoEleccion } from '../src/lib/politica'

describe('calculaCambio (sube/baja frente al resultado anterior)', () => {
  it('escaños exactos: 140 vs 137 -> +3 sube', () => {
    expect(calculaCambio(140, 137)).toEqual({ tipo: 'exacto', delta: 3, direccion: 'sube' })
  })

  it('escaños exactos: 33 vs 33 -> igual', () => {
    expect(calculaCambio(33, 33)).toEqual({ tipo: 'exacto', delta: 0, direccion: 'igual' })
  })

  it('escaños exactos: 30 vs 33 -> -3 baja', () => {
    expect(calculaCambio(30, 33)).toEqual({ tipo: 'exacto', delta: -3, direccion: 'baja' })
  })

  it('rango que cruza la referencia: {20,25} vs 22 -> ambiguo (-2..+3)', () => {
    expect(calculaCambio({ min: 20, max: 25 }, 22)).toEqual({ tipo: 'rango', min: -2, max: 3, direccion: 'ambiguo' })
  })

  it('rango entero por encima: {24,26} vs 22 -> sube', () => {
    expect(calculaCambio({ min: 24, max: 26 }, 22)).toEqual({ tipo: 'rango', min: 2, max: 4, direccion: 'sube' })
  })

  it('rango entero por debajo: {18,20} vs 22 -> baja', () => {
    expect(calculaCambio({ min: 18, max: 20 }, 22)).toEqual({ tipo: 'rango', min: -4, max: -2, direccion: 'baja' })
  })

  it('rango que toca la referencia por abajo: {22,25} vs 22 -> sube (no ambiguo)', () => {
    expect(calculaCambio({ min: 22, max: 25 }, 22)).toEqual({ tipo: 'rango', min: 0, max: 3, direccion: 'sube' })
  })

  it('rango que toca la referencia por arriba: {19,22} vs 22 -> baja', () => {
    expect(calculaCambio({ min: 19, max: 22 }, 22)).toEqual({ tipo: 'rango', min: -3, max: 0, direccion: 'baja' })
  })

  it('rango exacto en la referencia: {22,22} vs 22 -> igual', () => {
    expect(calculaCambio({ min: 22, max: 22 }, 22)).toEqual({ tipo: 'rango', min: 0, max: 0, direccion: 'igual' })
  })

  it('valores no finitos -> sin_dato (no cálculos falsos)', () => {
    expect(calculaCambio(NaN, 22)).toEqual({ tipo: 'sin_dato' })
    expect(calculaCambio({ min: NaN, max: 5 }, 22)).toEqual({ tipo: 'sin_dato' })
  })

  it('sin referencia (candidatura nueva/coalición) -> desconocido, NO 0', () => {
    expect(calculaCambio(15, null)).toEqual({ tipo: 'desconocido' })
    expect(calculaCambio(15, undefined)).toEqual({ tipo: 'desconocido' })
  })

  it('el sondeo no da escaños (null) -> sin_dato', () => {
    expect(calculaCambio(null, 22)).toEqual({ tipo: 'sin_dato' })
  })
})

describe('estadoEleccion', () => {
  const ahora = '2026-09-23T12:00:00Z'

  it('fresco con sondeos -> ok', () => {
    expect(estadoEleccion({ tieneSondeos: true, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('ok')
  })

  it('fresco sin sondeos -> sin_sondeos', () => {
    expect(estadoEleccion({ tieneSondeos: false, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('sin_sondeos')
  })

  it('última comprobación > 30h -> desactualizado', () => {
    expect(estadoEleccion({ tieneSondeos: true, ultimaComprobacionOk: '2026-09-22T00:00:00Z' }, ahora)).toBe('desactualizado')
  })

  it('marcado no disponible -> no_disponible (aunque no tenga sondeos)', () => {
    expect(estadoEleccion({ disponible: false, tieneSondeos: false, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('no_disponible')
  })
})
