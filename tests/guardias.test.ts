import { describe, it, expect } from 'vitest'
import { frescuraGuardia, GUARDIA_STALE_HORAS, parseGuardias } from '../src/lib/guardias'

// Fecha de referencia fija para que los tests no dependan del reloj.
const AHORA = new Date('2026-09-04T12:00:00Z')

describe('frescuraGuardia', () => {
  it('capturado hoy: fiable y esHoy', () => {
    const f = frescuraGuardia('2026-09-04T06:00:00Z', AHORA)
    expect(f.fiable).toBe(true)
    expect(f.esHoy).toBe(true)
    expect(f.fecha).toBe('2026-09-04')
  })

  it('capturado ayer de madrugada, dentro de 30 h: fiable pero NO esHoy', () => {
    // Robot corre a las 06:00 UTC; a las 12:00 del dia siguiente son 30 h justas.
    const f = frescuraGuardia('2026-09-03T06:00:00Z', AHORA)
    expect(f.horas).toBeCloseTo(30, 5)
    expect(f.fiable).toBe(true)      // 30 <= 30
    expect(f.esHoy).toBe(false)      // fecha de captura = ayer
    expect(f.fecha).toBe('2026-09-03')
  })

  it('pasadas mas de 30 h (se salto un pase): NO fiable', () => {
    const f = frescuraGuardia('2026-09-03T05:59:00Z', AHORA)
    expect(f.horas).toBeGreaterThan(GUARDIA_STALE_HORAS)
    expect(f.fiable).toBe(false)
    expect(f.esHoy).toBe(false)
  })

  it('territorio viejo de hace meses: NO fiable', () => {
    const f = frescuraGuardia('2026-04-25T20:59:42.303Z', AHORA)
    expect(f.fiable).toBe(false)
    expect(f.esHoy).toBe(false)
    expect(f.fecha).toBe('2026-04-25')
  })

  it('sin ts o ts invalido: NO fiable, horas Infinity', () => {
    for (const bad of [undefined, '', 'no-es-fecha']) {
      const f = frescuraGuardia(bad as string | undefined, AHORA)
      expect(f.fiable).toBe(false)
      expect(f.esHoy).toBe(false)
      expect(f.horas).toBe(Infinity)
      expect(f.fecha).toBe('')
    }
  })

  it('el margen de 30 h cubre el hueco nocturno sin apagar la pagina', () => {
    // Dato capturado ayer 06:00; visita de madrugada de hoy (03:00), antes del
    // pase diario. Debe seguir siendo fiable (no apagon), aunque no sea "hoy".
    const madrugada = new Date('2026-09-04T03:00:00Z')
    const f = frescuraGuardia('2026-09-03T06:00:00Z', madrugada)
    expect(f.horas).toBeCloseTo(21, 5)
    expect(f.fiable).toBe(true)
    expect(f.esHoy).toBe(false)
  })
})

// Regresion: el parser sigue devolviendo los campos posicionales tal cual.
describe('parseGuardias (regresion)', () => {
  it('mapea el array posicional a objeto', () => {
    const rows = parseGuardias({
      ts: '2026-09-04T06:00:00Z',
      guardias: [[40.4, -3.7, 'CALLE X, 1', 'MADRID', '910000000', '28001',
        '2026-09-04 09:30-2026-09-04 23:00', 'Guardia de hoy 09:30 – 23:00']],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].municipio).toBe('MADRID')
    expect(rows[0].telefono).toBe('910000000')
    expect(rows[0].horarioDesc).toContain('Guardia de hoy')
  })
})
