import { describe, expect, it } from 'vitest'
import { parseAlicante, parseCLM } from '../scripts/lib/guardias-fuentes.mjs'
import { urgenciasMICOF } from '../scripts/lib/guardias-micof.mjs'
import alicante from './fixtures/guardias/alicante.json'
import clm from './fixtures/guardias/clm.json'

const fecha = '2026-11-06'
const calendario = (mes: number, dia: string, descripcion: string) =>
  `<div class="farmacias-horario"><select><option value="${mes}" selected></option></select>
  <div class="farmacias-horario--wrapper"><ul><li><strong>${dia}</strong> 00:00-14:30, 17:00-21:00 ${descripcion}</li></ul></div></div>`

describe('municipio físico y guardia publicada por el colegio', () => {
  it('el MICOF debe señalar urgencias dentro de la fecha y mes de la consulta', () => {
    const etiqueta = '<span class="label--urgencia">HORARIO DE URGENCIAS</span>'
    expect(urgenciasMICOF(calendario(11, 'Viernes 06', etiqueta), fecha)).toBe(true)
    expect(urgenciasMICOF(calendario(11, 'Viernes 06', ''), fecha)).toBe(false)
    expect(urgenciasMICOF(calendario(10, 'Viernes 06', etiqueta), fecha)).toBe(false)
    expect(urgenciasMICOF(calendario(11, 'Jueves 05', etiqueta), fecha)).toBe(false)
  })
  it('Alicante valida el día y conserva el nombre completo de su municipio', () => {
    const ejemplo = structuredClone(alicante)
    ejemplo.data.pharmacies[0].location = 'San Vicente del Raspeig/Sant V'
    expect(parseAlicante(ejemplo, '2026-11-03')[0][3]).toBe('San Vicente del Raspeig/Sant Vicent del Raspeig')
    expect(() => parseAlicante(ejemplo, fecha)).toThrow()
  })
  it('sitúa la farmacia de Ruidera y distingue las remisiones fuera de Castilla-La Mancha', () => {
    const base = clm.data[0]
    const data = [
      { ...base, provincia: 'Albacete', localidad: 'RUIDERA', numero_farmacia: 'CR-0220-F' },
      { ...base, provincia: 'Guadalajara', localidad: 'BRONCHALES (TERUEL)', numero_farmacia: 'TE-90080-F' },
      { ...base, provincia: 'Toledo', localidad: 'VILLAFRANCA', zona: 'VILLAFRANCA DE LOS CABALLEROS' },
    ]
    const filas = parseCLM({ ...clm, total: data.length, data }, clm.fecha)
    expect(filas.map(f => [f[3], f[8]])).toEqual([['RUIDERA', '13'], ['Villafranca de los Caballeros', '45']])
  })
})
