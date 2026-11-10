import { describe, expect, it } from 'vitest'
import { seleccionarSemanaPalencia } from '../scripts/lib/guardias-palencia.mjs'

describe('Palencia · selección del calendario semanal oficial', () => {
  it.each(['PALENCIA (del 9 al 15 de Noviembre', 'PALENCIA (DEL 9 AL 15 DE NOVIEMBRE)', 'Palencia (9 al 15 de noviembre)'])('acepta el enlace publicado sin exigir puntuación: %s', nombre => {
    const actual = { nombre, url: 'calendarios de guardias 23.pdf' }
    const resultado = seleccionarSemanaPalencia([{ nombre: 'PALENCIA (del 2 al 8 de noviembre)' }, actual], '2026-11-10')
    expect(resultado.enlace).toBe(actual)
    expect(resultado.lunes.toISOString().slice(0, 10)).toBe('2026-11-09')
    expect(resultado.domingo.toISOString().slice(0, 10)).toBe('2026-11-15')
  })
  it('conserva la comprobación de fechas al cruzar un mes o un año', () => {
    expect(seleccionarSemanaPalencia([{ nombre: 'PALENCIA (del 30 de noviembre al 6 de diciembre)' }], '2026-12-01').lunes.getUTCMonth()).toBe(10)
    expect(seleccionarSemanaPalencia([{ nombre: 'PALENCIA (del 28 de diciembre al 3 de enero' }], '2027-01-01').lunes.getUTCFullYear()).toBe(2026)
  })
  it('rechaza una semana antigua, otra localidad, enlaces ambiguos y texto sobrante', () => {
    for (const nombre of ['PALENCIA (del 2 al 8 de noviembre)', 'PALENCIA (del 9 al 15 de diciembre)', 'GUARDO (del 9 al 15 de noviembre)', 'PALENCIA (del 9 al 15 de noviembre) ANULADO']) {
      expect(() => seleccionarSemanaPalencia([{ nombre }], '2026-11-10')).toThrow(/semana actual/)
    }
    const repetido = { nombre: 'PALENCIA (del 9 al 15 de noviembre)' }
    expect(() => seleccionarSemanaPalencia([repetido, repetido], '2026-11-10')).toThrow(/único/)
  })
})
