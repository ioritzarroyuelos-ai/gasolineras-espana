import { describe, it, expect } from 'vitest'
import { calendarioItv, fechaItvValida, recordatorioItvValido } from '../src/lib/itv-recordatorio'

const recordatorio = { id: '11111111-1111-4111-8111-111111111111', fecha: '2028-02-29', nombre: 'Mi vehículo' }

describe('recordatorio ITV: fecha indicada por el visitante', () => {
  it.each(['2028-02-29', '2026-12-31', '2000-01-01', '2099-12-31'])('admite una fecha real: %s', fecha => expect(fechaItvValida(fecha)).toBe(true))
  it.each(['2027-02-29', '2026-04-31', '2026-00-01', '2026-01-00', '2026-13-01', '30/11/2026', '2026-11-30T00:00Z', '1999-12-31', '', null])('rechaza fecha inexistente o mal formada: %s', fecha => expect(fechaItvValida(fecha)).toBe(false))
  it('no admite campos arbitrarios, matrícula ni saltos que inyecten eventos', () => {
    expect(recordatorioItvValido(recordatorio)).toBe(true)
    expect(recordatorioItvValido({ ...recordatorio, matricula: 'test' })).toBe(false)
    expect(recordatorioItvValido({ ...recordatorio, nombre: 'Coche\r\nBEGIN:VEVENT' })).toBe(false)
    expect(recordatorioItvValido({ ...recordatorio, id: 'id\nMAILTO:test@example.test' })).toBe(false)
  })
  it('crea un día completo, con fin exclusivo correcto y dos avisos sin direcciones de email', () => {
    const ics = calendarioItv(recordatorio, new Date('2026-11-21T12:34:56Z'))
    expect(ics).toContain('DTSTAMP:20261121T123456Z\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301\r\n')
    expect(ics).toContain('TRIGGER:-P7D\r\nACTION:DISPLAY')
    expect(ics).toContain('TRIGGER:-P1D\r\nACTION:DISPLAY')
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(ics).not.toMatch(/ATTENDEE|ORGANIZER|MAILTO|https:\/\/[^\r\n]*[?]/)
    expect(ics.replace(/\r\n /g, '')).toContain('Fecha indicada por ti')
  })
  it('mantiene el día elegido al cambiar de año o en días de cambio horario', () => {
    for (const [fecha, next] of [['2026-12-31', '20270101'], ['2026-03-29', '20260330'], ['2026-10-25', '20261026']]) {
      const ics = calendarioItv({ ...recordatorio, fecha })
      expect(ics).toContain('DTSTART;VALUE=DATE:' + fecha.replace(/-/g, ''))
      expect(ics).toContain('DTEND;VALUE=DATE:' + next)
    }
  })
  it('escapa separadores y pliega a75 octetos sin cortar caracteres UTF-8', () => {
    const nombre = 'Á'.repeat(50) + ',;\\'
    const ics = calendarioItv({ ...recordatorio, nombre })
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:ITV: ' + 'Á'.repeat(50) + '\\,\\;\\\\')
    expect(new TextDecoder().decode(new TextEncoder().encode(ics))).not.toContain('\ufffd')
  })
  it('la identidad del evento se conserva al editar la fecha', () => {
    const uid = (text: string) => text.split('\r\n').find(line => line.startsWith('UID:'))
    expect(uid(calendarioItv(recordatorio))).toBe(uid(calendarioItv({ ...recordatorio, fecha: '2028-03-01' })))
  })
})
