import { describe, it, expect } from 'vitest'
import workflow from '../.github/workflows/fetch-prices.yml?raw'
import { buildFuelTrends } from '../scripts/lib/fuel-trends.mjs'

const snapshot = (Fecha: string, price = '1,500') => ({ Fecha, ListaEESSPrecio: [
  { IDCCAA: '13', 'Precio Gasolina 95 E5': price, 'Precio Gasoleo A': '1,400' },
  { IDCCAA: '13', 'Precio Gasolina 95 E5': '1,600', 'Precio Gasoleo A': '1,500' },
] })
const morning = snapshot('04/11/2026 8:58:14')
const evening = snapshot('04/11/2026 20:58:14', '1,400')
const first = buildFuelTrends(morning, { now: new Date('2026-11-04T08:00:00Z') })
const now = new Date('2026-11-04T20:00:00Z')

describe('tendencia entre fotos oficiales recientes', () => {
  it('calcula el cambio real y conserva las fechas de ambas fotos', () => {
    const data = buildFuelTrends(evening, { now, previous: first })
    expect(data.current.medians.g95).toBe(1.5)
    expect(data.previous!.medians.g95).toBe(1.55)
    expect(data.previous!.ministryDate).toBe(morning.Fecha)
    expect(data.current.ministryDate).toBe(evening.Fecha)
    expect(data.current.sourceAt).toBe('2026-11-04T19:58:14.000Z')
    expect(data.previous!.sourceAt).toBe('2026-11-04T07:58:14.000Z')
  })

  it('no compara noviembre con un fichero de abril', () => {
    const old = buildFuelTrends(snapshot('19/04/2026 0:06:03'), { now: new Date('2026-04-18T22:10:00Z') })
    expect(buildFuelTrends(evening, { now, previous: old }).previous).toBeNull()
  })

  it('añade la fecha oficial también a una referencia reciente guardada sin sourceAt', () => {
    const { sourceAt: _sourceAt, ...legacyCurrent } = first.current
    const data = buildFuelTrends(evening, { now, previous: { current: legacyCurrent } })
    expect(data.previous!.sourceAt).toBe('2026-11-04T07:58:14.000Z')
  })

  it('arranca con el snapshot oficial anterior reciente cuando trends estaba abandonado', () => {
    const data = buildFuelTrends(evening, { now, previous: { current: { ts: '2026-04-18T22:52:27Z' } },
      previousSnapshot: morning, previousMeta: { ministryDate: morning.Fecha, fetchedAt: '2026-11-04T08:00:00Z' } })
    expect(data.previous!.ministryDate).toBe(morning.Fecha)
    expect(data.previous!.medians.g95).toBe(1.55)
  })

  it('no inventa una comparación cuando el Ministerio repite la misma foto', () => {
    const data = buildFuelTrends(morning, { now: new Date('2026-11-04T09:00:00Z'), previous: first,
      previousSnapshot: morning, previousMeta: { ministryDate: morning.Fecha, fetchedAt: '2026-11-04T08:00:00Z' } })
    expect(data.previous).toBeNull()
  })

  it('al repetir una foto mantiene la referencia anterior válida, sin cambiarla por sí misma', () => {
    const second = buildFuelTrends(evening, { now, previous: first })
    const retry = buildFuelTrends(evening, { now: new Date('2026-11-04T20:10:00Z'), previous: second })
    expect(retry.previous!.ministryDate).toBe(morning.Fecha)
  })

  it('rechaza un snapshot antiguo aunque alguien haya cambiado solo su hora de descarga', () => {
    const stale = snapshot('19/04/2026 0:06:03')
    const data = buildFuelTrends(evening, { now, previousSnapshot: stale,
      previousMeta: { ministryDate: stale.Fecha, fetchedAt: '2026-11-04T08:00:00Z' } })
    expect(data.previous).toBeNull()
  })

  it('no mezcla metadata de una foto con precios de otra ni compara hacia atrás', () => {
    expect(buildFuelTrends(evening, { now, previousSnapshot: morning,
      previousMeta: { ministryDate: evening.Fecha, fetchedAt: '2026-11-04T08:00:00Z' } }).previous).toBeNull()
    const future = buildFuelTrends(evening, { now })
    expect(buildFuelTrends(morning, { now, previous: future }).previous).toBeNull()
  })

  it('no anuncia tendencia actual con una fuente caducada y rechaza fechas imposibles', () => {
    expect(buildFuelTrends(morning, { now: new Date('2026-11-08T20:00:00Z'), previous: first }).previous).toBeNull()
    expect(() => buildFuelTrends(snapshot('31/11/2026 8:58:14'), { now })).toThrow(/Fecha/)
  })

  it('conserva la fecha oficial antigua aunque se descargue hoy, incluido el horario de verano', () => {
    const data = buildFuelTrends(snapshot('19/04/2026 0:06:03'), { now })
    expect(data.current.ts).toBe('2026-11-04T20:00:00.000Z')
    expect(data.current.sourceAt).toBe('2026-04-18T22:06:03.000Z')
    expect(data.previous).toBeNull()
  })

  it('incluye el archivo de tendencia en la publicación automática', () => {
    expect(workflow.split('\n').find(line => line.trim().startsWith('git add '))).toContain('public/data/trends.json')
  })
})
