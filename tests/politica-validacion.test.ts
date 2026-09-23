import { describe, it, expect } from 'vitest'
import { validaEleccion } from '../scripts/lib/politica-validacion.mjs'

const camara = { nombre: 'X', escanos: 100, mayoria: 51 }
const file = (sondeos: unknown[]) => ({ schemaVer: 1, id: 'x', tipo: 'autonomica', camara, sondeos })
const sondeo = (datos: unknown[]) => ({ empresa: 'E', datos })

describe('validaEleccion (validación multinivel)', () => {
  it('acepta un candidato válido', () => {
    const nuevo = file([sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 40 }])])
    const r = validaEleccion(nuevo, null)
    expect(r.ok).toBe(true)
    expect(r.diagnostico.sondeos).toBe(1)
  })

  it('rechaza escaños mayores que el tamaño de la cámara', () => {
    const nuevo = file([sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 140 }])])
    const r = validaEleccion(nuevo, null)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/cámara/)
  })

  it('rechaza un rango cuyo máximo supera la cámara', () => {
    const nuevo = file([sondeo([{ candidaturaId: 'pp', pct: 30, escanos: { min: 90, max: 130 } }])])
    expect(validaEleccion(nuevo, null).ok).toBe(false)
  })

  it('rechaza % fuera de rango como anomalía', () => {
    const nuevo = file([sondeo([{ candidaturaId: 'pp', pct: 130, escanos: 10 }])])
    const r = validaEleccion(nuevo, null)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/rango/)
  })

  it('bloquea pasar de datos a vacío sin veda', () => {
    const anterior = file([sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 40 }])])
    const nuevo = file([])
    const r = validaEleccion(nuevo, anterior)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/vacío/)
  })

  it('permite vacío si estamos en veda (ocultación legítima)', () => {
    const anterior = file([sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 40 }])])
    const nuevo = file([])
    expect(validaEleccion(nuevo, anterior, { enVeda: true }).ok).toBe(true)
  })

  it('acepta vacío si nunca hubo datos (sin_sondeos legítimo)', () => {
    expect(validaEleccion(file([]), null).ok).toBe(true)
  })

  it('marca revisión (no rechazo) si la cobertura cae >20%', () => {
    const anterior = file(Array.from({ length: 10 }, () => sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 40 }])))
    const nuevo = file(Array.from({ length: 5 }, () => sondeo([{ candidaturaId: 'pp', pct: 30, escanos: 40 }])))
    const r = validaEleccion(nuevo, anterior)
    expect(r.ok).toBe(true)
    expect(r.revision).toBe(true)
    expect(r.diagnostico.caida).toBeGreaterThan(0.2)
  })

  it('rechaza estructura inválida', () => {
    expect(validaEleccion(null, null).ok).toBe(false)
    expect(validaEleccion({ sondeos: 'no-array' }, null).ok).toBe(false)
  })
})
