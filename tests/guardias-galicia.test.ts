import { describe, expect, it } from 'vitest'
import { parseOurense, parsePontevedra, parseCoruna } from '../scripts/lib/guardias-galicia.mjs'

const fecha = '2026-11-06'
describe('Guardias publicadas por los colegios gallegos', () => {
  it('Ourense conserva el servicio localizado y su hora de cierre aunque la ficha tenga horario semanal y coordenadas erróneas', () => {
    const farmacia = {fecha,nombre:'Paéz',zona_guardia:'Allariz',contactos_profesionales:[{direccion:'Rúa Piñeiro 7',municipio:'Allariz',telefono:'988301189',coordenadas:'[4.21,-779.93]'}],
      horario_habitual_farmacia:[{horario:'09:00-13:30'}],horarios:[{tipo:'Permanente - Localizada',hora_apertura:'09:00:00',hora_cierre:'09:00:00',cierre_dia_siguiente:true}]}
    const data = {informacion:[farmacia],metadatos:{paginacion:{totalElementos:'1'}}}
    const [fila] = parseOurense(data, fecha, true)
    expect(fila.slice(0,2)).toEqual([0,0])
    expect(fila[6]).toBe('2026-11-06 09:00-2026-11-07 09:00')
    expect(fila[7]).toContain('Localizada')
    const condicional = { ...farmacia, localizacion:'Localizada fuera de horario de apertura' }
    const [mixta] = parseOurense({...data,informacion:[condicional]},fecha)
    expect(mixta[7]).toBe('Permanente · Localizada fuera de horario de apertura · Allariz')
    expect(mixta[6]).toBe(fila[6])
    expect(() => parseOurense(data, '2026-11-07')).toThrow()
    farmacia.horarios[0].cierre_dia_siguiente = false
    expect(parseOurense(data, fecha, true)).toEqual([])
    expect(parseOurense(data, fecha)[0][6]).toBe('Horario por confirmar')
  })
  it('Pontevedra no mezcla una farmacia de anoche con los turnos diurnos y nocturnos fechados hoy', () => {
    const f = {id:'1',nombre:'Farmacia A',fecha,municipio:'Arbo',direccion:'C/ Rial do Pazo',tipo:'Diurno',observaciones:'Servicio de urgencia localizada.'}
    const filas = parsePontevedra([{...f,id:'2',fecha:'2026-11-05',tipo:'Nocturno'},f,{...f,tipo:'Nocturno'}],fecha)
    expect(filas).toHaveLength(1)
    expect(filas[0].slice(6)).toEqual(['Turno diurno y nocturno','Servicio de urgencia localizada.'])
  })
  it('A Coruña comprueba el número publicado y deja las horas habituales fuera de la guardia', () => {
    const f = {nombre:'Farmacia',direccion:'Rúa Nova',nombrePoblacion:'Camariñas',horario:'09:00-13:30',nombreGuardiaTipoTurno:'Diurno y Nocturno'}
    const html = '<input id="FechaBusqueda" value="06/11/2026"><strong>1</strong> farmacia de guardia mapaBuscadorFarmacias.addMarkers('+JSON.stringify([f])+')'
    expect(parseCoruna(html, fecha)[0][6]).toBe('Turno diurno y nocturno')
    expect(() => parseCoruna(html.replace('<strong>1','<strong>2'), fecha)).toThrow()
    expect(() => parseCoruna(html, '2026-11-07')).toThrow()
  })
})
