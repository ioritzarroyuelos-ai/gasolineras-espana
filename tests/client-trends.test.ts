import { describe, expect, it } from 'vitest'
import source from '../src/client/features.js?raw'

// Ejecutamos las funciones que usa el navegador; no una segunda implementación.
const start = source.indexOf('function trendComparison(')
const end = source.indexOf('(function initTrendStrip()')
const { trendComparison, trendDeltaHTML } = new Function(source.slice(start, end) +
  ';return {trendComparison,trendDeltaHTML}')()

const now = Date.parse('2026-11-04T20:00:00Z')
const current = { ts: '2026-11-04T19:00:00Z', sourceAt: '2026-11-04T18:55:00Z', ministryDate: '04/11/2026 19:55:00', medians: { g95: 1.509, diesel: 1.802 } }
const previous = { ts: '2026-11-04T07:00:00Z', sourceAt: '2026-11-04T06:55:00Z', ministryDate: '04/11/2026 7:55:00', medians: { g95: 1.510, diesel: 1.799 } }

describe('tendencias reales del navegador', () => {
  it('compara dos capturas distintas y recientes', () => {
    expect(trendComparison({ current, previous }, now).previous).toEqual(previous)
    expect(trendDeltaHTML(current.medians.g95, previous.medians.g95)).toContain('↓ 0,1 cént./L')
    expect(trendDeltaHTML(current.medians.diesel, previous.medians.diesel)).toContain('↑ 0,3 cént./L')
    expect(trendDeltaHTML(1.5, 1.5)).toContain('sin cambio')
  })
  it('no compara abril con noviembre ni dos veces la misma fecha oficial', () => {
    expect(trendComparison({ current, previous: { ...previous, ts: '2026-04-18T07:00:00Z' } }, now).previous).toBeNull()
    expect(trendComparison({ current, previous: { ...previous, ministryDate: current.ministryDate } }, now).previous).toBeNull()
    expect(trendComparison({ current, previous: { ...previous, ts: current.ts } }, now).previous).toBeNull()
  })
  it('oculta datos atrasados, futuros o incompletos y no inventa variaciones', () => {
    expect(trendComparison({ current: { ...current, ts: '2026-11-01T19:00:00Z' } }, now)).toBeNull()
    expect(trendComparison({ current: { ...current, ts: '2026-11-05T19:00:00Z' } }, now)).toBeNull()
    expect(trendComparison({}, now)).toBeNull()
    expect(trendComparison({ current: { ...current, sourceAt: '2026-04-18T19:00:00Z' } }, now)).toBeNull()
    expect(trendDeltaHTML(1.5, undefined)).toBe('')
    expect(trendDeltaHTML(NaN, 1.5)).toBe('')
  })
  it('pinta el resumen y recuerda el cierre sin otra descarga', async () => {
    const elements: Record<string, any> = {}
    for (const id of ['trend-strip', 'trend-g95', 'trend-diesel', 'trend-period', 'trend-strip-close']) {
      elements[id] = { hidden: true, innerHTML: '', textContent: '', addEventListener(_: string, handler: () => void) { this.click = handler } }
    }
    const saved = new Map<string, string>()
    let requests = 0
    const data = {
      current: { ...current, ts: new Date().toISOString(), sourceAt: new Date().toISOString() },
      previous: { ...previous, ts: new Date(Date.now() - 3600000).toISOString(), sourceAt: new Date(Date.now() - 3600000).toISOString() },
    }
    const fetch = async () => { requests++; return { ok: true, json: async () => data } }
    const script = source.slice(start, source.indexOf('// ---- WATCHDOG DE FRESCURA'))
    new Function('document', 'fetch', 'localStorage', script)(
      { getElementById: (id: string) => elements[id] }, fetch,
      { getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value) },
    )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(elements['trend-strip'].hidden).toBe(false)
    expect(elements['trend-g95'].innerHTML).toContain('↓ 0,1 cént./L')
    expect(elements['trend-period'].textContent).toContain(previous.ministryDate)
    elements['trend-strip-close'].click()
    expect(elements['trend-strip'].hidden).toBe(true)
    expect(saved.size).toBe(1)
    expect(requests).toBe(1)
  })
})
