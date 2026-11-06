import { describe, expect, it } from 'vitest'
import { extraerFarmaciasDelHtml, fechaCgcof } from '../scripts/lib/cgcof.mjs'
import { turnosCadiz } from '../scripts/lib/guardias-cadiz.mjs'
import { completarSevilla } from '../scripts/lib/guardias-sevilla-buscador.mjs'
import { guardiasCapitalSevilla, guardiasMunicipioSevilla, guardiasZonaSevilla } from '../scripts/lib/guardias-sevilla.mjs'

const fecha = '2026-11-06'
const p = (x: number, y: number, texto: string) => ({ x, y, texto })

describe('Calendarios diarios por municipio', () => {
  it('CGCOF mantiene las guardias de día completo, las localizadas y las horas propias de cada bloque', () => {
    const doc = '<div id="marco-aux"><div>Municipio 06/11/2026 12:00</div>' +
      '<p><a href="javascript:abbre(29,100,0)">Directorio</a></p>' +
      '<div><img> GUARDIAS TODO EL D&Iacute;A</div><p style="padding-left:40px">GUARDIA LOCALIZADA</p>' +
      '<p><a href="javascript:abbre(29,200,0)">Oficina</a></p>' +
      '<div><img>GUARDIAS DE NOCHE</div><p style="padding-left:40px">DE 22:00 A 9:30</p>' +
      '<p><a href="javascript:abbre(29,300,0)">Otra oficina</a></p></div>'
    expect(extraerFarmaciasDelHtml(doc, '6/11/2026')).toEqual([
      { id:'200', tipo:'GUARDIAS TODO EL DÍA · GUARDIA LOCALIZADA' },
      { id:'300', tipo:'GUARDIAS DE NOCHE · DE 22:00 A 9:30' },
    ])
    expect(extraerFarmaciasDelHtml(doc, '5/11/2026')).toEqual([])
    expect(fechaCgcof(new Date('2026-11-05T23:30:00Z'))).toBe('6/11/2026')
  })
  it('Sevilla capital separa viernes, domingo y noche y aplica excepciones antes de publicar', () => {
    const pg = [p(.03,.09,'LUNES A SÁBADO - SEMANA DEL 2 DE NOVIEMBRE DE 2026 AL 8 DE NOVIEMBRE DE 2026'),
      p(.51,.09,'URGENCIA DE DÍA (de 9:30 a 22:00 h.)'), p(.82,.09,'DOMINGO'),
      p(.026,.2,'»'),p(.035,.2,'CALLE A, 1. Sólo Sábado.'),p(.264,.2,'»'),p(.274,.2,'CALLE B, 2. Excepto Lunes.'),
      p(.499,.2,'»'),p(.51,.2,'CALLE C, 3. Sólo Viernes.'),p(.739,.2,'»'),p(.75,.2,'CALLE DOMINGO, 4.'),
      p(.26,.82,'URGENCIA DE NOCHE (de 22:00 a 9:30)'),p(.162,.85,'»'),p(.17,.85,'Sólo Viernes. NOCHE A, 5.'),
      p(.444,.85,'»'),p(.451,.85,'Sólo Martes. NOCHE B, 6.')]
    expect(guardiasCapitalSevilla([pg],fecha).map(f=>f[2])).toEqual(['CALLE B, 2.','CALLE C, 3.','NOCHE A, 5.'])
    expect(guardiasCapitalSevilla([pg],'2026-11-09')).toEqual([])
  })
  it('En la provincia usa exclusivamente la columna de hoy e ignora referencias sin dirección', () => {
    const pg = [p(.08,.11,'viernes 06 noviembre 2026'),p(.017,.136,'Día (de 9:30 a 22:00)'),
      p(.016,.16,'Pueblo A'),p(.092,.16,'Mayor, 1 (954111222)'),p(.016,.18,'Pueblo B'),p(.092,.18,'Servicios localizables (954222333)'),
      p(.32,.11,'sábado 07 noviembre 2026'),p(.261,.136,'Día (de 9:30 a 22:00)'),p(.26,.16,'Pueblo C'),p(.33,.16,'Otra, 8')]
    expect(guardiasZonaSevilla([pg],fecha).map(r=>[r[3],r[4]])).toEqual([['Pueblo A','954111222']])
  })
  it('Los PDF locales exigen que coincidan municipio, fecha de cabecera y día de la semana', () => {
    const pg=[p(.1,.07,'Farmacias de Guardia de CARMONA desde 02-nov-2026 hasta el 08-nov-2026'),
      p(.05,.14,'VIERNES 6'),p(.069,.16,'Día (de 9:00 a 21:00)'),p(.13,.18,'Ŀ'),p(.14,.18,'Calle Real, 2 (954111222)'),
      p(.05,.25,'SÁBADO 7'),p(.069,.27,'Día (de 9:00 a 21:00)'),p(.13,.30,'Ŀ'),p(.14,.30,'Calle Otra, 3 (954777888)')]
    expect(guardiasMunicipioSevilla([pg],fecha,'Carmona')).toHaveLength(1)
    expect(guardiasMunicipioSevilla([pg],fecha,'Brenes')).toEqual([])
    expect(guardiasMunicipioSevilla([pg],'2026-12-06','Carmona')).toEqual([])
  })
})


it('omite fichas del mapa sevillano con dos horas de cierre incompatibles, municipios ambiguos o sin guardia', () => {
  const base={municipio:'Campana, La',direccion:'C/ Mayor, 1',codigo_postal:'41429',nombre:'Farmacia'}
  const turno={tipo_guardia:'presencial',guardia_hora_inicio:'09:30',guardia_hora_fin:'09:30 (+1)',
    guardia_horario_fecha_inicio:'2026-11-06 09:30:00',guardia_horario_fecha_fin:'2026-11-07 09:30:00'}
  const fichas=[{...base,guardias:[turno]},{...base,guardias:[{...turno,guardia_horario_fecha_fin:'2026-11-06 22:00:00'}]},
    {...base,municipio:'Sector A',guardias:[turno]}, {...base,guardias:[]}]
  const api={success:true,data:{data:{metadatos:{paginacion:{totalPaginas:1}},informacion:[{contenido:fichas}]}}}
  const municipios=[{nombre:'Campana, La',provinciaId:'41'}]
  const completo=completarSevilla(api,fecha,[],municipios)
  expect(completo.map(r=>[r[3],r[6]])).toEqual([['La Campana','2026-11-06 09:30-2026-11-07 09:30']])
  expect(completarSevilla(api,fecha,completo,municipios)).toEqual([])
})

it('Paterna de Rivera mantiene la guardia diurna y la noche localizada sin inventar su hora de fin', () => {
  const h = { tipo:'DIURNO (De 9 a 22 h)/NOCTURNO: LOCALIZADA', hora_apertura:'09:00:00', hora_cierre:'22:00:00', cierre_dia_siguiente:false }
  const [dia,noche] = turnosCadiz([h],fecha)
  expect(dia).toEqual({horario:'2026-11-06 09:00-2026-11-06 22:00',nota:'Guardia diurna'})
  expect(noche.horario).toBe('')
  expect(noche.nota).toMatch(/nocturna localizada.*fin por confirmar/)
  expect(turnosCadiz([{...h,hora_apertura:'00:00:00'}],fecha)[0].horario).toBe('')
})
