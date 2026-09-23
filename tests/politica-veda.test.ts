import { describe, it, expect } from 'vitest'
import { enVeda } from '../src/lib/politica'

// Elección con fecha confirmada el 2027-05-28. Ventana de veda: 5 días antes
// (23,24,25,26,27) + el día de la votación (28).
const confirmada = { valor: '2027-05-28', confirmada: true }

describe('enVeda (LOREG 69.7: 5 días previos + jornada de votación)', () => {
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
