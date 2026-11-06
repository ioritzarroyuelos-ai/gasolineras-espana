import { describe, it, expect } from 'vitest'
import { avisosDelMunicipio, buildGuardiaMunicipioPage } from '../src/html/guardia-municipio'
import { parseGuardias, tipoAtencionGuardia } from '../src/lib/guardias'

const fecha = '2026-11-06'
const ts = fecha + 'T07:00:00Z'
const tarde = new Date(fecha + 'T18:00:00Z')
const fila = (municipio: string, horario: string, nota = '') => [0, 0, 'Farmacia de prueba', municipio, '', '', horario, nota]

describe('guardias municipales contrastadas', () => {
  it('retira los archivos antiguos que mezclaron aperturas o fechas aunque el robot los haya descargado hoy', () => {
    for (const territorio of ['ourense', 'tarragona', 'cordoba', 'baleares', 'malaga', 'valladolid']) {
      const datos = { territorio, fecha, ts, guardias: [fila('Pueblo', '09:00-21:00')] }
      expect(parseGuardias(datos, tarde)).toEqual([])
      expect(parseGuardias({ ...datos, guardiasVerificadas: true }, tarde)).toHaveLength(1)
    }
    expect(parseGuardias({ territorio: 'fuente-desconocida', fecha, ts, guardias: [fila('Pueblo', '09:00-21:00')] }, tarde)).toEqual([])
  })

  it('de varios turnos fechados conserva el de hoy y el de ayer sólo mientras sigue atendiendo', () => {
    const anterior = '2026-11-05 22:00-2026-11-06 09:00', actual = '2026-11-06 22:00-2026-11-07 09:00'
    const datos = { territorio: 'cantabria', fecha, ts, guardiasVerificadas: true, guardias: [fila('Pueblo', anterior + ' / ' + actual), fila('Pueblo', anterior)] }
    expect(parseGuardias(datos, new Date(fecha + 'T07:59:59Z')).map(g => g.horario)).toEqual([anterior + ' / ' + actual, anterior])
    expect(parseGuardias(datos, new Date(fecha + 'T08:00:00Z')).map(g => g.horario)).toEqual([actual])
    expect(parseGuardias(datos, new Date('2026-11-07T08:00:00Z'))).toEqual([])
  })

  it('una guardia del sábado todavía no aparece el viernes por la noche en Canarias', () => {
    const datos = { territorio: 'laspalmas', fecha, ts, guardias: [fila('Pueblo', '2026-11-07 09:00-2026-11-08 09:00')] }
    expect(parseGuardias(datos, new Date(fecha + 'T23:30:00Z'))).toEqual([])
    expect(parseGuardias({ ...datos, territorio: 'madrid' }, new Date(fecha + 'T23:30:00Z'))).toHaveLength(1)
  })

  it('un horario comercial de 24 horas no entra en el filtro de turnos de 24 horas', () => {
    const raws = { territorio: 'valencia', fecha, ts, guardias: [fila('Pueblo', '2026-11-06 09:00-2026-11-07 09:00')] }
    const farmacias = parseGuardias(raws, tarde)
    expect(tipoAtencionGuardia(farmacias[0])).toBe('apertura')
    const html = buildGuardiaMunicipioPage('n', { provinciaName: 'Valencia', provinciaSlug: 'valencia', municipioName: 'Pueblo',
      municipioSlug: 'pueblo', canonical: 'https://prueba.test/farmacias/valencia/pueblo', actualizado: ts, turno: '24h',
      otrosMunicipios: [], guardias: farmacias, ahora: tarde })
    expect(html).not.toContain('Farmacia de prueba')
  })

  it('sólo muestra la remisión del colegio en el pueblo indicado y para la fecha comprobada', () => {
    const datos = { fecha, ts, guardiasVerificadas: true, avisosMunicipales: { ermua: ['Para el turno de noche, acudir a Eibar.'] } }
    expect(avisosDelMunicipio('bizkaia', 'ermua', datos, tarde)).toContain('acudir a Eibar')
    expect(avisosDelMunicipio('bizkaia', 'durango', datos, tarde)).toBe('')
    expect(avisosDelMunicipio('bizkaia', 'ermua', datos, new Date('2026-11-07T15:00:00Z'))).toBe('')
  })
})
