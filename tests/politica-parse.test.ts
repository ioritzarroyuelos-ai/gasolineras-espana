import { describe, it, expect } from 'vitest'
import { parsePct, parseEscanos, parseFecha, parseSondeos } from '../scripts/lib/politica-parse.mjs'
import generalesEs from './fixtures/politica/generales.es.html?raw'
import europeasEs from './fixtures/politica/europeas.es.html?raw'
import laRiojaEn from './fixtures/politica/la-rioja.en.html?raw'

const FIXTURES: Record<string, string> = {
  'generales.es.html': generalesEs,
  'europeas.es.html': europeasEs,
  'la-rioja.en.html': laRiojaEn,
}
const fx = (f: string) => FIXTURES[f]

describe('parsePct / parseEscanos / parseFecha (unidades)', () => {
  it('pct: normaliza coma, rechaza no-números', () => {
    expect(parsePct('31.9')).toBe(31.9)
    expect(parsePct('27,3')).toBe(27.3)
    expect(parsePct('?')).toBeNull()
    expect(parsePct('—')).toBeNull()
  })

  it('escaños: número, rango con - o /, ausencia', () => {
    expect(parseEscanos('133')).toBe(133)
    expect(parseEscanos('30-33')).toEqual({ min: 30, max: 33 })
    expect(parseEscanos('16/17')).toEqual({ min: 16, max: 17 })
    expect(parseEscanos('(24)')).toBe(24)
    expect(parseEscanos('—')).toBeNull()
    expect(parseEscanos('')).toBeNull()
  })

  it('fecha: con año explícito y con año de contexto', () => {
    expect(parseFecha('28 May–4 Jun 2026').fin).toBe('2026-06-04')
    expect(parseFecha('3-jun-2024').fin).toBe('2024-06-03')
    expect(parseFecha('22-26 Dic', 2025).fin).toBe('2025-12-26')
    expect(parseFecha('22-26 Dic', 2025).inicio).toBe('2025-12-22')
    expect(parseFecha('?').inicio).toBeUndefined()
  })
})

describe('parseSondeos (fixtures reales de Wikipedia)', () => {
  it('GENERALES es: extrae sondeos con % y escaños, mapea partidos, y la referencia 2023', () => {
    const r = parseSondeos(fx('generales.es.html'), { anioReferencia: 2023, hoy: { anio: 2026, mes: 9 } })
    expect(r.sondeos.length).toBeGreaterThan(20)
    // Partidos mapeados por nombre
    const ids = r.candidaturas.map((c) => c.id)
    expect(ids).toContain('pp')
    expect(ids).toContain('psoe')
    // Un sondeo real trae PP con % y escaños
    const s0 = r.sondeos[0]
    const pp = s0.datos.find((d) => d.candidaturaId === 'pp')
    expect(pp).toBeTruthy()
    expect(typeof pp!.pct).toBe('number')
    expect(pp!.escanos).not.toBeNull()
    // El sondeo más reciente se ancla en 2025 (celda "22-26 Dic", con hoy=sep 2026)
    expect(s0.campoInicio).toMatch(/^2025-12/)
    // Todas las fechas ISO deben caer entre 2016 y 2026 (sin años absurdos)
    for (const s of r.sondeos) if (s.campoFin) expect(Number(s.campoFin.slice(0, 4))).toBeGreaterThanOrEqual(2016)
    // Referencia del 23-J-2023 detectada y NO contada como sondeo
    expect(r.referencia).toBeTruthy()
    expect(r.referencia!.anio).toBe('2023')
    expect(r.referencia!.escanos.find((e) => e.candidaturaId === 'pp')?.escanos).toBeGreaterThan(100)
  })

  it('LA RIOJA en: pocos sondeos, rangos de escaños {min,max}, celdas — como null', () => {
    const r = parseSondeos(fx('la-rioja.en.html'), { anioReferencia: 2023 })
    expect(r.tablasCoincidentes).toBeGreaterThanOrEqual(1)
    expect(r.sondeos.length).toBeGreaterThan(0)
    // Debe existir algún escaño en rango (Sigma Dos daba 16/17, etc.)
    const hayRango = r.sondeos.some((s) => s.datos.some((d) => d.escanos && typeof d.escanos === 'object'))
    expect(hayRango).toBe(true)
    // Ningún % fuera de rango
    for (const s of r.sondeos) for (const d of s.datos) if (d.pct != null) expect(d.pct).toBeLessThanOrEqual(100)
  })

  it('EUROPEAS es: detecta la tabla de sondeos (no la de candidaturas) y saca escaños', () => {
    const r = parseSondeos(fx('europeas.es.html'), { anioReferencia: 2024 })
    expect(r.sondeos.length).toBeGreaterThan(10)
    const ids = r.candidaturas.map((c) => c.id)
    expect(ids).toContain('pp')
    expect(ids).toContain('psoe')
    // Algún sondeo con escaños numéricos
    const conEscanos = r.sondeos.some((s) => s.datos.some((d) => typeof d.escanos === 'number'))
    expect(conEscanos).toBe(true)
  })

  it('HTML sin tabla de sondeos: devuelve vacío con incidencia (no lanza)', () => {
    const r = parseSondeos('<div><table class="wikitable"><tr><th>Otra cosa</th></tr></table></div>')
    expect(r.sondeos).toEqual([])
    expect(r.incidencias.length).toBeGreaterThan(0)
  })
})
