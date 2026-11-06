import { describe, expect, it } from 'vitest'
import { parseTurnosGranada } from '../scripts/lib/guardias-granada.mjs'

// Filas del COF Granada: hoja del 7–8 de noviembre de 2026. En el PDF,
// el segundo domicilio del domingo aparece a continuación del primer teléfono.
const diurna = 'SERVICIO DE URGENCIA DIURNO: DE 9,30 H. A 22,00 H.'
const nocturna = 'SERVICIO DE URGENCIA NOCTURNO: DE 22,00 H. A 9,30 H. DEL DÍA SIGUIENTE'
const finSemana = 'SÁBADO 7 Y DOMINGO 8 DE NOVIEMBRE 2026'
const reyes = 'REYES CATÓLICOS, 5\n(Frente Ayuntamiento) TLF.: 958 262664'
const finde = [diurna, finSemana, reyes, 'SOLO SÁBADO 7 DE NOVIEMBRE 2026', 'GRAN VIA DE COLÓN, 22. TLF 958 222772',
  'SOLO DOMINGO 8 DE MES 2026', 'RIBERA DEL BEIRO, S/N.', '(Frente Mercadona) TLF.: 958 800242 AVDA. AMÉRICA 6 (Rotonda Helicóptero)',
  'TLF.: 958 133313', nocturna, finSemana, reyes].join('\n')
describe('PDF oficial de Granada capital', () => {
  it('aplica el día de cada bloque, conserva números de la misma fila y agrega ambos turnos', () => {
    const sabado = parseTurnosGranada(finde, '2026-11-07')
    const domingo = parseTurnosGranada(finde, '2026-11-08')
    expect(sabado.map(f => f.telefono)).toEqual(['958262664','958222772'])
    expect(domingo).toEqual([
      { direccion: 'REYES CATÓLICOS, 5', telefono: '958262664', horario: '09:30-22:00, 22:00-09:30' },
      { direccion: 'RIBERA DEL BEIRO, S/N', telefono: '958800242', horario: '09:30-22:00' },
      { direccion: 'AVDA. AMÉRICA 6', telefono: '958133313', horario: '09:30-22:00' },
    ])
    expect(parseTurnosGranada(finde, '2026-12-08')).toEqual([])
    expect(parseTurnosGranada(finde, '2025-11-08')).toEqual([])
  })
  it('descarta la hoja mensual para el festivo y conserva la ambigüedad si falta una fecha', () => {
    const semanal = [diurna, 'DE LUNES A VIERNES MES DE NOVIEMBRE 2026', '(LUNES 2 DE NOVIEMBRE EN HOJA APARTE)', reyes, nocturna, reyes].join('\n')
    expect(parseTurnosGranada(semanal, '2026-11-02')).toEqual([])
    expect(parseTurnosGranada(semanal, '2026-11-07')).toEqual([])
    expect(parseTurnosGranada(semanal, '2026-11-06').map(f => f.horario)).toEqual(['09:30-22:00, 22:00-09:30'])
    const festivo = [diurna, 'LUNES 2 NOVIEMBRE 2026', reyes].join('\n')
    expect(parseTurnosGranada(festivo, '2026-11-02')).toHaveLength(1)
    expect(parseTurnosGranada(festivo, '2026-11-06')).toEqual([])
    expect(parseTurnosGranada([diurna, reyes].join('\n'), '2026-11-06')).toEqual([])
    expect(parseTurnosGranada([diurna, 'SOLO DOMINGO 8 DE MES 2026', reyes].join('\n'), '2026-11-08')).toEqual([])
  })
  it('omite una pareja ambigua y un teléfono incompleto sin prestarle el número de la siguiente farmacia', () => {
    const texto = [diurna, finSemana, 'CALLE A, 1', 'CALLE B, 2', 'TLF.: 958 123456', 'CALLE C, 3 TLF.: 958 123', reyes].join('\n')
    expect(parseTurnosGranada(texto, '2026-11-07').map(f => f.telefono)).toEqual(['958262664'])
  })
})
