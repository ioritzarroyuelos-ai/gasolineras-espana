import { describe, expect, it } from 'vitest'
import fixture from './fixtures/guardias-tenerife-santa-cruz.json'
import { guardiaPermanenteSantaCruz } from '../scripts/lib/guardias-tenerife-permanente.mjs'
import { turnosEspeciales } from '../scripts/lib/guardias-tenerife-especiales.mjs'
import { estadoGuardia, tipoAtencionGuardia } from '../src/lib/guardias'

const fecha = '2026-11-21'
const copia = () => structuredClone(fixture)

describe('guardia diaria explícita del cartel mixto de Santa Cruz', () => {
  it('cruza la ficha real del PDF con el intervalo fechado de la API; excluye las demás aperturas', () => {
    const filas = turnosEspeciales(fixture.paginas, 'SANTA CRUZ DE TENERIFE', fecha, fixture.directorio)
    expect(filas).toHaveLength(1)
    expect(filas?.[0]).toMatchObject({nombre:'Lcdo.: José Manuel Rendón Pérez', direccion:'Calle Horacio Nelson, 21',
      telefono:'922271279', horario:'2026-11-21 00:00-2026-11-22 00:00'})
    expect(filas?.[0].nota).toContain('corroborada para este día')
    expect(filas?.some(f => f.telefono === '922271263')).toBe(false)
  })
  it.each(['2026-11-19', '2026-11-28', '2026-12-21', '2026-11-31', 'ayer'])(
    'no reutiliza un horario diario para otra fecha o fecha inválida: %s', dia => {
      expect(guardiaPermanenteSantaCruz(fixture.paginas, dia, fixture.directorio)).toEqual([])
    })
  it('no obtiene guardia de una apertura ordinaria de 24 h aunque la API confirme el día', () => {
    const f = copia()
    f.paginas[0].find(c => c.texto === 'Horario de guardia: 24H')!.texto = 'Horario de esta farmacia: 24H'
    expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
  })
  it('sin directorio comprobado mantiene el caso pendiente', () => {
    expect(guardiaPermanenteSantaCruz(fixture.paginas, fecha)).toEqual([])
  })
  it('el lector de la web respeta el fin exacto del día canario y el filtro de 24 h', () => {
    const [turno] = guardiaPermanenteSantaCruz(fixture.paginas, fecha, fixture.directorio)
    const farmacia = {territorio:'tenerife', fechaTurno:fecha, horarioCompleto:true, lat:28.47025654, lng:-16.26210033,
      direccion:turno.direccion, municipio:'Santa Cruz de Tenerife', telefono:turno.telefono, cp:'',
      horario:turno.horario, horarioDesc:'Calendario de guardias del colegio · '+turno.nota}
    const captura = fecha+'T11:00:00Z'
    expect(tipoAtencionGuardia(farmacia)).toBe('guardia')
    // En Madrid ya es 22/11, en Canarias continúa el día 21.
    expect(estadoGuardia(farmacia,captura,new Date('2026-11-21T23:30:00Z'),'Atlantic/Canary'))
      .toEqual({conocida:true,abierta:true,todoElDia:true})
    expect(estadoGuardia(farmacia,captura,new Date('2026-11-22T00:00:00Z'),'Atlantic/Canary').abierta).toBe(false)
  })
  it.each(['telefono', 'titular', 'direccion', 'municipio'])(
    'requiere coincidencia exacta de la identidad: %s', campo => {
      const f = copia()
      if (campo === 'titular') f.directorio[0].infoTitulares[0].nombreCompleto = 'Otro titular'
      else f.directorio[0][campo as 'telefono'|'direccion'|'municipio'] = 'Otro valor'
      expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
    })
  it.each(['telefono', 'titular'])(
    'rechaza identidad ambigua con dos oficinas que comparten %s', campo => {
      const f = copia(), otra = structuredClone(f.directorio[0])
      otra.idFarmacia = '999'
      if (campo === 'telefono') otra.infoTitulares[0].nombreCompleto = 'Otro titular'
      else otra.telefono = '922000000'
      f.directorio.push(otra)
      expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
    })
  it.each(['horaIni', 'horaFin', 'fechaFin'])(
    'no convierte una jornada parcial o un fin sin día siguiente en 24 h: %s', campo => {
      const f = copia(), h = f.directorio[0].infoHorario.find(h => h.fecha.startsWith(fecha))!
      h[campo as 'horaIni'|'horaFin'|'fechaFin'] = campo === 'fechaFin' ? fecha+'T00:00:00' : '0001-01-01T22:00:00'
      expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
    })
  it('rechaza intervalos duplicados o superpuestos del día', () => {
    const f = copia()
    f.directorio[0].infoHorario.push(structuredClone(f.directorio[0].infoHorario.find(h => h.fecha.startsWith(fecha))!))
    expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
  })
  it('rechaza un segundo bloque de guardia y condiciones nuevas dentro del bloque', () => {
    const f = copia(), marca = f.paginas[0].find(c => c.texto === 'Horario de guardia: 24H')!
    f.paginas[0].push({...marca, x:.6})
    expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
    f.paginas[0].pop()
    f.paginas[0].push({...marca, y:marca.y+.02, texto:'Guardia localizada: previo aviso'})
    expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
  })
  it('no atribuye la ficha a otra zona ni a un cartel sin la cabecera esperada', () => {
    const f = copia()
    f.paginas[0] = f.paginas[0].filter(c => c.texto !== 'CRUZ DE TENERIFE')
    expect(guardiaPermanenteSantaCruz(f.paginas, fecha, f.directorio)).toEqual([])
  })
})
