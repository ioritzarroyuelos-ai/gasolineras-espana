import { describe, expect, it } from 'vitest'
import { compruebaFuentesMovilidad } from '../scripts/lib/fuentes-movilidad.mjs'

describe('comprobación independiente de movilidad', () => {
  const now = Date.now(), fechaDatos = new Date(now - 1000).toISOString()
  const good = async () => ({ estado: 'actual', fechaDatos, fechaDirectorio: fechaDatos, total: 42 })
  it('conserva fechas de fuente, fecha de comprobación y resultados separados', async () => {
    const report = await compruebaFuentesMovilidad({ 'bizi-zaragoza': good, 'trafico-cataluna': good, 'camaras-cataluna': good, 'metro-bilbao': good }, now)
    expect(report.correcto).toBe(true); expect(report.fuentes).toHaveLength(4)
    expect(report.fuentes.every(f => f.fechaDatos === fechaDatos && Date.parse(f.consultado) >= now)).toBe(true)
  })
  it('una caída no impide comprobar las otras ni filtra detalles internos', async () => {
    const report = await compruebaFuentesMovilidad({ 'bizi-zaragoza': good, 'trafico-cataluna': good, 'camaras-cataluna': good, 'metro-bilbao': async () => { throw Error('secret credential') } }, now)
    expect(report.correcto).toBe(false)
    expect(report.fuentes.map(f => f.estado)).toEqual(['actual', 'actual', 'actual', 'error'])
    expect(report.fuentes[3]).toMatchObject({ fechaDatos: null, total: null })
    expect(JSON.stringify(report)).not.toContain('secret')
  })
  it('una descarga de datos antiguos o parciales no da verde', async () => {
    const report = await compruebaFuentesMovilidad({ 'bizi-zaragoza': async () => ({ ...await good(), estado: 'parcial' }), 'trafico-cataluna': async () => ({ ...await good(), estado: 'sin_actualizar' }), 'camaras-cataluna': good, 'metro-bilbao': good }, now)
    expect(report.correcto).toBe(false); expect(report.fuentes[0].error).toBeTruthy()
    expect(report.fuentes[1].fechaDatos).toBe(fechaDatos)
  })
})
