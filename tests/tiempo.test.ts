import { describe, it, expect } from 'vitest'
// Lib .mjs con tipos en scripts/lib/tiempo.d.mts (mismo patron que historico-estatico).
import { frescuraTiempo, TIEMPO_STALE_HORAS } from '../scripts/lib/tiempo.mjs'

describe('frescuraTiempo', () => {
  const ahora = Date.parse('2026-09-06T12:00:00Z')

  it('es fiable si el dato tiene menos del umbral', () => {
    const fr = frescuraTiempo('2026-09-06T09:00:00Z', ahora)
    expect(fr.fiable).toBe(true)
    expect(fr.horas).toBeCloseTo(3, 1)
  })

  it('NO es fiable si supera el umbral', () => {
    const fr = frescuraTiempo('2026-09-05T20:00:00Z', ahora) // 16h
    expect(fr.fiable).toBe(false)
  })

  it('NO es fiable si no hay fecha', () => {
    expect(frescuraTiempo(null, ahora).fiable).toBe(false)
    expect(frescuraTiempo(undefined, ahora).fiable).toBe(false)
  })

  it('el umbral es 12 horas', () => {
    expect(TIEMPO_STALE_HORAS).toBe(12)
  })
})
