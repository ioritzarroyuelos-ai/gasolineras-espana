import { describe, expect, it } from 'vitest'
import { ALMERIA_LOCALIZADOR, parseLocalizadorAlmeria } from '../scripts/lib/guardias-almeria-respaldo.mjs'
import { estadoGuardia, fuenteGuardia, parseGuardias, tipoAtencionGuardia } from '../src/lib/guardias'
import sample from './fixtures/guardias/almeria-localizador.html?raw'

const now = Date.parse('2026-11-21T09:24:00Z'), fecha = '2026-11-21'
describe('Almería: respaldo oficial con horario por confirmar', () => {
  it('lee fichas reales ligadas a una consulta de hoy, sin convertir horas relativas en turnos', () => {
    const data = parseLocalizadorAlmeria(sample, fecha, now)
    expect(data.consultadoFuente).toBe('2026-11-21T09:23:00.000Z')
    expect(data.rows).toHaveLength(6)
    expect(data.rows.every(row => row[6] === '' && String(row[7]).includes('Horario por confirmar'))).toBe(true)
    expect(data.rows[0].slice(0, 2)).toEqual([37.2964, -1.879346])
    const file = { territorio: 'almeria', fecha, source: 'cofalmeria.com', sourceUrl: ALMERIA_LOCALIZADOR, ts: new Date(now).toISOString(), coordenadasOficiales: true, guardias: data.rows }
    const rows = parseGuardias(file, new Date(now))
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(tipoAtencionGuardia(row)).toBe('sin_confirmar')
      expect(estadoGuardia(row, file.ts, new Date(now))).toMatchObject({ abierta: false, todoElDia: false, conocida: false })
    }
    expect(fuenteGuardia('almeria', file)).toBe(ALMERIA_LOCALIZADOR)
    expect(parseGuardias(file, new Date('2026-11-22T09:24:00Z'))).toHaveLength(0)
  })
  it.each([
    ['fecha distinta', sample, '2026-11-22', now],
    ['consulta antigua', sample, fecha, now + 15 * 60000],
    ['consulta futura', sample, fecha, now - 2 * 60000],
    ['día de la semana incorrecto', sample.replace('sábado 21 de noviembre', 'viernes 21 de noviembre'), fecha, now],
    ['hora imposible', sample.replace('10:23</p>', '24:23</p>'), fecha, now],
    ['sin fecha', sample.replace('Datos consultados el', 'Consulta sin fecha'), fecha, now],
    ['sin atribución', sample.replace('Turnos facilitados por el', 'Lista de'), fecha, now],
    ['respuesta vacía', '<html>Error</html>', fecha, now],
  ])('rechaza %s sin rejuvenecer una copia anterior', (_label, html, date, stamp) => {
    expect(() => parseLocalizadorAlmeria(html as string, date as string, stamp as number)).toThrow()
  })
  it('una coordenada imposible se omite, conservando dirección y advertencia', () => {
    const { rows } = parseLocalizadorAlmeria(sample.replace('37.2964,-1.879346', '40.4,-3.7'), fecha, now)
    expect(rows[0].slice(0, 2)).toEqual([0, 0])
    expect(rows[0][2]).toContain('Calle de prueba')
  })
  it('la excepción de enlace no admite otros sitios ni otras provincias', () => {
    expect(fuenteGuardia('almeria', { source: 'cofalmeria.com', sourceUrl: 'https://example.org/' })).not.toBe('https://example.org/')
    expect(fuenteGuardia('almeria', { source: 'otro.es', sourceUrl: ALMERIA_LOCALIZADOR })).not.toBe(ALMERIA_LOCALIZADOR)
  })
})
