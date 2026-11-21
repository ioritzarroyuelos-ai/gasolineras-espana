import { describe, expect, it } from 'vitest'
import { parseGirona, consultaGirona } from '../scripts/lib/guardias-girona.mjs'
import { parseGuardias, estadoGuardia } from '../src/lib/guardias'
import today from './fixtures/guardias/girona-2026-11-21.html?raw'
import yesterday from './fixtures/guardias/girona-2026-11-20.html?raw'

describe('Girona: fecha explícita y continuidad nocturna', () => {
  it('lee las dos respuestas reales, sin aceptar la tabla de otra fecha', () => {
    expect(parseGirona(today, '2026-11-21')).toHaveLength(48)
    expect(parseGirona(yesterday, '2026-11-20')).toHaveLength(64)
    expect(() => parseGirona(yesterday, '2026-11-21')).toThrow('otra fecha')
  })
  it('consulta exactamente las fechas pedidas y conserva sólo las 19 guardias nocturnas que alcanzan hoy', async () => {
    const calls: [string, string][] = []
    const rows = await consultaGirona('2026-11-21', async (_url, init) => { const date = init.body.get('date')!; calls.push([init.method, date]); expect(init.body.get('city')).toBe('0'); return date === '2026-11-21' ? today : yesterday })
    expect(calls).toEqual([['POST', '2026-11-21'], ['POST', '2026-11-20']])
    expect(rows).toHaveLength(67)
    const nocturnal = rows.filter(row => String(row[6]).startsWith('2026-11-20'))
    expect(nocturnal).toHaveLength(19)
    expect(nocturnal.every(row => String(row[6]).split(' / ').every(range => range.slice(17) > '2026-11-21 00:00'))).toBe(true)
    expect(rows.some(row => String(row[7]).includes('localizada'))).toBe(true)
  })
  it('una respuesta antigua o incompleta no se publica como turno nuevo', async () => {
    await expect(consultaGirona('2026-11-21', async () => yesterday)).rejects.toThrow('otra fecha')
    const empty = today.replace(/<table[\s\S]+<\/table>/, '<table id="pharmacies-of-guard-data-table"></table>')
    await expect(consultaGirona('2026-11-21', async () => empty)).rejects.toThrow('incompleto')
  })
  it('si el turno cruza medianoche exige la marca explícita del colegio', () => {
    expect(() => parseGirona(yesterday.replaceAll('(dia seg.)', ''), '2026-11-20')).toThrow('turno no reconocido')
  })
  it('el lector web reconoce la madrugada y retira esos turnos al terminar, sin abrir guardias localizadas', async () => {
    const rows = await consultaGirona('2026-11-21', async (_url, init) => init.body.get('date') === '2026-11-21' ? today : yesterday)
    const early = new Date('2026-11-21T07:00:00Z'), late = new Date('2026-11-21T11:00:00Z')
    const file = { fecha: '2026-11-21', ts: '2026-11-21T06:00:00Z', territorio: 'girona', source: 'cofgi.org', guardiasVerificadas: true, guardias: rows }
    const morning = parseGuardias(file, early)
    expect(morning.some(row => row.horario.startsWith('2026-11-20') && estadoGuardia(row, file.ts, early).abierta)).toBe(true)
    expect(parseGuardias(file, late).filter(row => row.horario.startsWith('2026-11-20')).every(row => !estadoGuardia(row, file.ts, late).abierta)).toBe(true)
    expect(morning.filter(row => row.horarioDesc.includes('localizada')).every(row => !estadoGuardia(row, file.ts, early).abierta)).toBe(true)
  })
})
