import { describe, it, expect } from 'vitest'
import { enVeda } from '../src/lib/politica'
import { eleccionPorId } from '../scripts/lib/politica-catalogo.mjs'

// Elección con fecha confirmada el 2027-05-28. Ventana de veda: 5 días antes
// (23,24,25,26,27) + el día de la votación (28).
const confirmada = { valor: '2027-05-28', confirmada: true }

describe('enVeda (LOREG 69.7: 5 días previos + jornada de votación)', () => {
  it('respeta la medianoche peninsular del 24 de noviembre y el final del 29 en Canarias', () => {
    const fecha = eleccionPorId('generales')!.proxima
    expect(enVeda('2026-11-23T22:59:59.999Z', fecha)).toBe(false)
    expect(enVeda('2026-11-23T23:00:00.000Z', fecha)).toBe(true)
    expect(enVeda('2026-11-29T23:59:59.999Z', fecha)).toBe(true)
    expect(enVeda('2026-11-30T00:00:00.000Z', fecha)).toBe(false)
  })

  it('aplica los husos reales aunque cambie la hora durante la ventana', () => {
    const octubre = { valor: '2026-10-25', confirmada: true }
    expect(enVeda('2026-10-19T21:59:59.999Z', octubre)).toBe(false)
    expect(enVeda('2026-10-19T22:00:00.000Z', octubre)).toBe(true)
    expect(enVeda('2026-10-25T23:59:59.999Z', octubre)).toBe(true)
    expect(enVeda('2026-10-26T00:00:00.000Z', octubre)).toBe(false)
  })

  it('rechaza un día oficial imposible o un instante inválido', () => {
    expect(enVeda('2026-03-01T10:00:00Z', { valor: '2026-02-30', confirmada: true })).toBe(false)
    expect(enVeda('pendiente', confirmada)).toBe(false)
  })

  it('dentro de la ventana (3 días antes) -> true', () => {
    expect(enVeda('2027-05-25T10:00:00Z', confirmada)).toBe(true)
  })

  it('el día -5 está incluido', () => {
    expect(enVeda('2027-05-23T00:00:00Z', confirmada)).toBe(true)
  })

  it('6 días antes -> false', () => {
    expect(enVeda('2027-05-22T10:00:00Z', confirmada)).toBe(false)
  })

  it('el día de la votación cuenta como veda', () => {
    expect(enVeda('2027-05-28T10:00:00Z', confirmada)).toBe(true)
  })

  it('el día siguiente a la votación -> false', () => {
    expect(enVeda('2027-05-29T10:00:00Z', confirmada)).toBe(false)
  })

  it('elección sin fecha confirmada -> nunca en veda', () => {
    expect(enVeda('2027-05-25T10:00:00Z', { valor: '2027-05-28', confirmada: false })).toBe(false)
  })

  it('elección sin fecha -> nunca en veda', () => {
    expect(enVeda('2027-05-25T10:00:00Z', { valor: null, confirmada: true })).toBe(false)
  })
})
