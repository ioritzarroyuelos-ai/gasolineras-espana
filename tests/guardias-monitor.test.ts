import { describe, expect, it } from 'vitest'
import { evaluaGuardiaMonitor } from '../scripts/lib/guardias-monitor.mjs'
const now = Date.parse('2026-11-21T10:00:00Z')
const file = { ts: '2026-11-21T09:00:00Z', guardias: [[0, 0, 'Farmacia de prueba']], incidencias: [] as string[] }
describe('Monitor de guardias sin envíos', () => {
  it('una copia reciente completa no tiene incidencia', () => { expect(evaluaGuardiaMonitor(file, now)).toMatchObject({ stale: false, parcial: false }) })
  it('Almería y Córdoba parciales no dan falso verde aunque se hayan consultado hoy', () => {
    for (const aviso of ['Horarios por confirmar; calendario incompleto.', '80 consultas municipales sin turno verificable.']) {
      expect(evaluaGuardiaMonitor({ ...file, incidencias: [aviso] }, now)).toMatchObject({ stale: false, parcial: true, incidencias: [aviso] })
    }
  })
  it('un fichero vacío, ilegible, viejo o futuro sigue pendiente', () => {
    expect(evaluaGuardiaMonitor({ ...file, guardias: [] }, now).parcial).toBe(true)
    expect(evaluaGuardiaMonitor(null, now)).toMatchObject({ stale: true, parcial: true })
    expect(evaluaGuardiaMonitor({ ...file, ts: '2026-11-19T00:00:00Z' }, now).stale).toBe(true)
    expect(evaluaGuardiaMonitor({ ...file, ts: '2026-11-22T00:00:00Z' }, now).stale).toBe(true)
  })
  it('cruzar medianoche no vuelve antigua una consulta de hace una hora', () => { expect(evaluaGuardiaMonitor({ ...file, ts: '2026-11-20T23:30:00Z' }, Date.parse('2026-11-21T00:30:00Z')).stale).toBe(false) })
})
