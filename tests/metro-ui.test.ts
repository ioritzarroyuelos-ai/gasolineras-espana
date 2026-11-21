import { describe, it, expect } from 'vitest'
import { ahoraParteMetro, metroParteActual, metroLlegadasActuales, validaParteMetro } from '../scripts/lib/metro-ui.mjs'

const now = Date.parse('2026-11-21T01:00:00Z'), iso = (n: number) => new Date(n).toISOString()
const data = { estado: 'actual', directorioActual: true, fechaDatos: iso(now), caduca: iso(now + 120000) }
describe('Llegadas: reloj común de página y mapa', () => {
  it('un reloj atrasado o reajustado no extiende el parte del servidor', () => {
    expect(ahoraParteMetro(iso(now), 100, now - 120000, 100)).toBe(now)
    expect(ahoraParteMetro(iso(now), 100, now - 240000, 120100)).toBe(now + 120000)
    expect(metroParteActual(data, ahoraParteMetro(iso(now), 100, now - 240000, 120100))).toBe(false)
  })
  it('descuenta la espera de red desde el inicio de la petición', () => {
    expect(ahoraParteMetro(iso(now), 100, now - 120000, 7100)).toBe(now + 7000)
  })
  it('rechaza un reloj incompleto o parte con caducidad alterada', () => {
    expect(ahoraParteMetro('', 100, now, 200)).toBeNaN()
    expect(ahoraParteMetro(iso(now), 200, now, 100)).toBeNaN()
    expect(metroParteActual({ ...data, caduca: iso(now + 121000) }, now)).toBe(false)
    expect(validaParteMetro({}, now)).toBe(false)
  })
  it('retira llegadas pasadas y todas las de un parte caducado', () => {
    const station = { llegadas: [{ llegada: iso(now - 1) }, { llegada: iso(now) }, { llegada: iso(now + 1000) }] }
    expect(metroLlegadasActuales(station, data, now)).toEqual([{ llegada: iso(now + 1000) }])
    expect(metroLlegadasActuales(station, data, now + 120000)).toEqual([])
  })
})
