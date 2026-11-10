import { describe, expect, it } from 'vitest'
// @ts-expect-error Política interna del robot Node.
import { DATA_JOBS, necesitaRecuperacion } from '../scripts/lib/data-recovery.mjs'
const now = Date.parse('2026-11-10T16:00:00Z')
const job = DATA_JOBS.find((j: {kind:string}) => j.kind === 'guardias')
const manifest = (date = '2026-11-10T12:00:00Z') => ({services:[{id:'farmacias',items:[{name:'Palencia',updatedAt:date}]}]})
const run = (status='completed', conclusion='success', createdAt='2026-11-10T10:00:00Z') => ({status,conclusion,createdAt})
describe('recuperación diaria basada en producción', () => {
  it('no confunde un robot verde con todas las provincias actualizadas', () => {
    expect(necesitaRecuperacion(job, manifest('2026-11-08T12:00:00Z'), [run()], now).retry).toBe(true)
  })
  it('recupera fallos y horarios perdidos', () => {
    expect(necesitaRecuperacion(job, manifest(), [run('completed','failure')], now).retry).toBe(true)
    expect(necesitaRecuperacion(job, manifest(), [], now).retry).toBe(true)
  })
  it('no duplica trabajos ni insiste sobre una fuente recién consultada', () => {
    expect(necesitaRecuperacion(job, manifest(), [run('queued')], now).retry).toBe(false)
    expect(necesitaRecuperacion(job, manifest('2026-11-08T12:00:00Z'), [run('completed','failure','2026-11-10T15:00:00Z')], now).retry).toBe(false)
    expect(necesitaRecuperacion(job, manifest(), [run()], now).retry).toBe(false)
  })
  it('la frescura de recarga no se oculta detrás de la de gasolina', () => {
    const electric = DATA_JOBS.find((j: {kind:string}) => j.kind === 'chargers')
    const m = {services:[{id:'gasolineras',items:[{name:'Precios del Ministerio',updatedAt:'2026-11-10T15:00:00Z'},{name:'Directorio de recarga eléctrica',updatedAt:'2026-11-07T12:00:00Z'}]}]}
    expect(necesitaRecuperacion(electric,m,[run()],now).retry).toBe(true)
  })
})
