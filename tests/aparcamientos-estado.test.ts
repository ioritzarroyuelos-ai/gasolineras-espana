import { describe, expect, it } from 'vitest'
import { aparcamientosItems } from '../scripts/lib/aparcamientos-estado.mjs'
import { evaluateServices, type ServiceManifest } from '../src/lib/service-status'
// @ts-expect-error Coordinador Node de los trabajos automáticos.
import { DATA_JOBS, necesitaRecuperacion } from '../scripts/lib/data-recovery.mjs'
const now = Date.parse('2026-11-21T12:00:00Z')
const report = () => ({ schema: 1, consultado: '2026-11-21T09:09:00Z', fuentes: [
  { id: 'madrid', estado: 'actual', ultimoExito: '2026-11-21T09:08:00Z', total: 75 },
  { id: 'vigo', estado: 'actual', ultimoExito: '2026-11-21T09:07:00Z', total: 12 },
] })
describe('Estado diario de los catálogos de aparcamientos', () => {
  it('usa la comprobación más antigua sin afirmar plazas libres', () => {
    const items = aparcamientosItems(report(), now)
    expect(items[0]).toEqual({ name: 'Catálogos de aparcamientos oficiales', updatedAt: '2026-11-21T09:07:00Z', count: 2 })
    expect(items.map(i => i.count)).toEqual([2, 75, 12])
    expect(items.every(i => !i.issue)).toBe(true)
  })
  it.each(['conservada', 'parcial', 'error'])('muestra %s aunque el índice se haya consultado hoy', state => {
    const input = report(); input.fuentes[0].estado = state
    const items = aparcamientosItems(input, now)
    expect(items[0].count).toBe(1); expect(items[1].issue).toBeTruthy(); expect(items[2].issue).toBeUndefined()
    const manifest: ServiceManifest = { schema: 1, services: [{ id: 'servicios', name: 'Servicios', maxAgeHours: 30, items }] }
    expect(evaluateServices(manifest, now).services.find(s => s.id === 'servicios')?.ok).toBe(false)
  })
  it.each(['fuente-ausente', 'duplicada', 'futura', 'posterior', 'imposible', 'cero'])('no oculta una comprobación inválida: %s', kind => {
    const input = report()
    if (kind === 'fuente-ausente') input.fuentes.pop()
    if (kind === 'duplicada') input.fuentes.push({ ...input.fuentes[0] })
    if (kind === 'futura') input.consultado = '2026-11-22T09:00:00Z'
    if (kind === 'posterior') input.fuentes[0].ultimoExito = '2026-11-21T10:00:00Z'
    if (kind === 'imposible') input.fuentes[0].ultimoExito = '2026-02-31T10:00:00Z'
    if (kind === 'cero') input.fuentes[0].total = 0
    expect(aparcamientosItems(input, now)[0].issue).toBeTruthy()
  })
  it('detecta un catálogo atrasado y permite el reintento limitado sin reanudar cifras en directo', () => {
    const input = report(); input.fuentes[0].ultimoExito = '2026-11-18T09:08:00Z'
    const items = aparcamientosItems(input, now)
    const manifest: ServiceManifest = { schema: 1, services: [{ id: 'servicios', name: 'Servicios', maxAgeHours: 30, items }] }
    expect(evaluateServices(manifest, now).services.find(s => s.id === 'servicios')?.ok).toBe(false)
    const job = DATA_JOBS.find((j: { kind: string }) => j.kind === 'aparcamientos')
    const run = { status: 'completed', conclusion: 'failure', run_started_at: '2026-11-21T08:00:00Z' }
    expect(necesitaRecuperacion(job, manifest, [run], now).retry).toBe(true)
    expect(necesitaRecuperacion(job, manifest, [{ ...run, run_started_at: '2026-11-21T09:00:00Z' }], now).retry).toBe(false)
  })
})
