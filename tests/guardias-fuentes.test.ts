import { describe, expect, it } from 'vitest'
import asturiasHTML from './fixtures/guardias/asturias.html?raw'
import avilaHTML from './fixtures/guardias/avila.html?raw'
import ceutaHTML from './fixtures/guardias/ceuta.html?raw'
import { parseAlicante, parseCLM, parseCantabria, parseAlmeria } from '../scripts/lib/guardias-fuentes.mjs'
import { parseAsturias, parseAvila, parseCeuta, fechaAvilaPublicada } from '../scripts/lib/guardias-html.mjs'
import { fechaMadrid, rangoGuardia } from '../scripts/lib/guardias-fetch.mjs'
import { parseGuardias, guardiasForProvincia } from '../src/lib/guardias'
import alicante from './fixtures/guardias/alicante.json'
import clm from './fixtures/guardias/clm.json'
import calendario from './fixtures/guardias/cantabria-calendario.json'
import listado from './fixtures/guardias/cantabria-listado.json'
import almeria from './fixtures/guardias/almeria.json'

// Respuestas reales del 3/11/2026, reducidas a los casos que causaron la regresión.
const fecha = '2026-11-03'
const html = (n: 'asturias' | 'avila' | 'ceuta') => ({ asturias: asturiasHTML, avila: avilaHTML, ceuta: ceutaHTML })[n]
describe('fuentes oficiales de guardias', () => {
  it('Almería conserva las fichas con intervalo cero sin afirmar que están abiertas', () => {
    const { rows } = parseAlmeria(almeria, fecha)
    expect(rows).toHaveLength(5) // Cuatro farmacias; una publica dos turnos.
    expect(rows[4][6]).toBe('')
    expect(rows[4][7]).toBe('Horario por confirmar: llama antes de acudir')
    expect(rows[0][6]).toMatch(/^2026-11-03 /)
    expect(() => parseAlmeria(almeria, '2026-11-05')).toThrow()
  })
  it('Alicante v2 conserva el turno de ayer y el cruce de medianoche', () => {
    const rows = parseAlicante(alicante, fecha)
    expect(rows).toHaveLength(3)
    expect(rows[1][6]).toBe('2026-11-03 09:30-2026-11-04 09:30')
    expect(rows[2][6]).toBe('2026-11-02 09:30-2026-11-03 09:30')
    expect(() => parseAlicante({ message: 'error' }, fecha)).toThrow()
  })
  it('CLM no inventa códigos postales y conserva la provincia y las fechas', () => {
    const rows = parseCLM(clm, fecha)
    const farmacias = parseGuardias({ territorio: 'clm', guardias: rows })
    expect(guardiasForProvincia(farmacias, '13', 'clm')).toHaveLength(1)
    expect(guardiasForProvincia(farmacias, '45', 'clm')).toHaveLength(1)
    expect(guardiasForProvincia(farmacias, '02', 'clm')).toHaveLength(0)
    expect(rows[0][5]).toBe('')
    expect(rows[0][6]).toBe('2026-11-02 10:00-2026-11-03 10:00')
    expect(() => parseCLM(clm, '2026-11-04')).toThrow()
    expect(() => parseCLM({ ...clm, total: 100 }, fecha)).toThrow()
  })
  it('Cantabria cruza el calendario con números oficiales y rechaza fechas sin cobertura', () => {
    const rows = parseCantabria(calendario, listado, fecha)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r[2] && r[3] && r[6])).toBe(true)
    expect(rows.some(r => String(r[6]).startsWith('2026-11-02'))).toBe(true)
    expect(() => parseCantabria(calendario, listado, '2027-01-01')).toThrow()
    expect(() => parseCantabria(calendario, { farmacias: [] }, fecha)).toThrow()
  })
  it('Asturias obtiene datos y teléfono del listado sin depender del mapa', () => {
    const rows = parseAsturias(html('asturias'), fecha)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0][4]).toBe('985807047')
    expect(rows[0][7]).toBe('Guardia no presencial')
    expect(() => parseAsturias(html('asturias'), '2026-11-04')).toThrow()
  })
  it('Ávila valida la fecha y anuncia solo la cobertura nocturna publicada', () => {
    const rows = parseAvila(html('avila'), fecha)
    expect(rows).toHaveLength(9)
    expect(rows[0][3]).toBe('Ávila')
    expect(rows.every(r => String(r[7]).includes('nocturna'))).toBe(true)
    expect(() => parseAvila(html('avila'), '2026-11-04')).toThrow()
  })
  it('Ávila conserva la fecha de la noche anterior al cruzar medianoche, sin afirmar apertura', () => {
    const publicada = fechaAvilaPublicada(html('avila'), '2026-11-04')
    expect(publicada).toBe('2026-11-03')
    const rows = parseAvila(html('avila'), publicada)
    expect(rows.every(r => r[6] === '' && String(r[7]).includes('03/11/2026') && String(r[7]).includes('Horario por confirmar'))).toBe(true)
    expect(() => fechaAvilaPublicada(html('avila'), '2026-11-05')).toThrow()
    expect(() => fechaAvilaPublicada(html('avila'), '2026-11-02')).toThrow()
  })
  it('Ávila selecciona la tabla del día aunque haya varias noches publicadas', () => {
    const varias = html('avila') + html('avila').replace('Martes 3 de noviembre', 'Miércoles 04 de noviembre')
    expect(fechaAvilaPublicada(varias, '2026-11-04')).toBe('2026-11-04')
    expect(parseAvila(varias, '2026-11-04')).toHaveLength(9)
  })
  it('Ceuta conserva los turnos día/noche sin convertir un festivo en laborable', () => {
    const rows = parseCeuta(html('ceuta'), fecha)
    expect(rows).toHaveLength(4)
    expect(rows[0][6]).toBe('2026-11-02 23:00-2026-11-03 09:00')
    expect(rows[1][2]).toContain('DIAZ SEGURA')
    expect(rows[1][4]).toBe('956511623')
    expect(rows[1][6]).toBe('')
    expect(rows[1][7]).toContain('festivos')
    expect(() => parseCeuta(html('ceuta'), '2026-12-03')).toThrow()
  })
  it('usa la fecha de Madrid al cruzar medianoche y los meses', () => {
    expect(fechaMadrid(new Date('2026-11-03T23:30:00Z'))).toBe('2026-11-04')
    expect(rangoGuardia('2026-12-31', '23:00', '09:00')).toBe('2026-12-31 23:00-2027-01-01 09:00')
    expect(() => rangoGuardia(fecha, '29:00', '09:00')).toThrow()
  })
})
