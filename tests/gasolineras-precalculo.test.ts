// Equivalencia del precomputo de gasolineras (M5) con el calculo del edge.
// La agregacion vive duplicada (scripts/lib/gasolineras-precalculo.mjs en Node,
// src/lib/municipios.ts en el edge). Este test corre ambas sobre el mismo
// snapshot sintetico y exige salidas identicas: si alguien toca una y olvida la
// otra, falla en CI y no en produccion sirviendo precios equivocados.
import { describe, it, expect } from 'vitest'
import { statsNacional } from '../src/lib/municipios'
import {
  construyeGasolineras, nacionalStatsFrom, provinciaCountsFrom,
} from '../scripts/lib/gasolineras-precalculo.mjs'

const G95 = 'Precio Gasolina 95 E5'
const G98 = 'Precio Gasolina 98 E5'
const DA  = 'Precio Gasoleo A'
const DP  = 'Precio Gasoleo Premium'

function est(prov: string, fields: Record<string, string>) {
  return { IDProvincia: prov, ...fields }
}

// Cubre: estacion completa, estacion parcial, precios no positivos (descarte),
// precio vacio (descarte por combustible), y estacion sin provincia.
function snapSintetico() {
  const s = [
    est('28', { [G95]: '1,509', [DA]: '1,609', [G98]: '1,709', [DP]: '1,809' }),
    est('28', { [G95]: '1,499', [DA]: '1,599' }),          // sin 98/premium
    est('08', { [G95]: '1,600', [DA]: '1,700' }),
    est('08', { [G95]: '0', [DA]: '-1' }),                 // no positivos -> descartar precios
    est('35', { [G95]: '', [DA]: '1,400' }),               // g95 vacio -> solo descarta g95
    est('',   { [G95]: '1,450' }),                         // sin provincia
  ]
  return { Fecha: '18/07/2026 21:59:01', ListaEESSPrecio: s }
}

describe('gasolineras-precalculo <-> statsNacional (M5)', () => {
  const snap = snapSintetico()

  it('nacionalStats == statsNacional (media, no mediana; mismos min/max/count)', () => {
    const pre = JSON.parse(JSON.stringify(construyeGasolineras(snap)!.nacionalStats))
    const ref = statsNacional(snap as any)
    expect(pre.stationCount).toBe(ref.stationCount)   // cuenta TODAS las estaciones
    expect(pre.stats).toEqual(ref.stats)              // min/max/avg/count exactos por combustible
  })

  it('provinciaCounts cuenta TODAS las estaciones por IDProvincia (con o sin precio)', () => {
    const counts = provinciaCountsFrom(snap.ListaEESSPrecio)
    expect(counts['28']).toBe(2)
    expect(counts['08']).toBe(2)                       // incluye la de precios no positivos
    expect(counts['35']).toBe(1)
    expect(counts['']).toBeUndefined()                // sin id no cuenta
  })

  it('devuelve null si no hay estaciones (no escribir fichero vacio)', () => {
    expect(construyeGasolineras({ ListaEESSPrecio: [] })).toBe(null)
    expect(construyeGasolineras(null)).toBe(null)
  })
})
