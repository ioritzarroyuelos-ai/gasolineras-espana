import { describe, expect, it } from 'vitest'
import { leerListadoTenerife } from '../scripts/lib/guardias-tenerife.mjs'
import { turnosDeUnaColumna } from '../scripts/lib/guardias-tenerife-calendario.mjs'

describe('respuestas oficiales de Tenerife', () => {
  it('asocia el nombre con el inicio del turno en la misma fila y comprueba la zona, el mes y el relevo', () => {
    const celda = (x:number, y:number, texto:string) => ({x,y,texto})
    const cartel = [celda(.2,.04,'NOVIEMBRE 2026'),celda(.2,.07,'ADEJE Y ARONA - GUARDIA DE 24 HORAS'),
      celda(.2,.09,'HASTA LAS 9 HORAS DE LA MAÑANA DEL DÍA SIGUIENTE'),
      celda(.03,.264,'6 vie'),celda(.09,.264,'00:00h a 09:00h'),celda(.23,.265,'Dirección del turno anterior'),
      celda(.03,.279,'6 vie'),celda(.09,.279,'09:00h a 23:59h'),celda(.23,.279,'Titular de hoy'),celda(.85,.279,'(922-74-92-07)'),
      celda(.03,.291,'7 sáb'),celda(.09,.291,'00:00h a 09:00h'),celda(.23,.292,'Dirección de hoy')]
    expect(turnosDeUnaColumna(cartel,'ADEJE Y ARONA','2026-11-06')).toEqual([{ nombre:'Titular de hoy',direccion:'Dirección de hoy',
      telefono:'922749207',horario:'2026-11-06 09:00-2026-11-07 09:00',nota:'' }])
    expect(() => turnosDeUnaColumna(cartel,'CANDELARIA','2026-11-06')).toThrow()
    expect(() => turnosDeUnaColumna(cartel,'ADEJE Y ARONA','2026-12-06')).toThrow()
    expect(() => turnosDeUnaColumna(cartel.filter(p => p.texto!=='7 sáb'),'ADEJE Y ARONA','2026-11-06')).toThrow()
  })
  it('acepta HTTP 204 sin contenido como municipio sin resultados', async () => {
    await expect(leerListadoTenerife(new Response(null, { status: 204 }), true)).resolves.toEqual([])
  })
  it('no acepta HTTP 204 para el catálogo de municipios', async () => {
    await expect(leerListadoTenerife(new Response(null, { status: 204 }))).rejects.toThrow()
  })
  it.each([new Response(''), Response.json({ error: 'temporal' }), new Response('Unavailable', { status: 503 })])(
    'no convierte respuestas defectuosas en ausencia de farmacias: %j', async response => {
      await expect(leerListadoTenerife(response, true)).rejects.toThrow()
    },
  )
  it('conserva el listado publicado sin inferir horarios', async () => {
    const rows = [{ idFarmacia: 15, descripcionHorario: 'Horario por confirmar' }]
    await expect(leerListadoTenerife(Response.json(rows), true)).resolves.toEqual(rows)
  })
})
