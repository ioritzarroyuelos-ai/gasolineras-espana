import { describe, expect, it } from 'vitest'
import { serviciosPublicosItems } from '../scripts/lib/servicios-publicos-estado.mjs'

const report = () => ({ schema: 1, consultado: '2026-11-21T10:00:00Z', fuentes: [
  { id: 'refugios-cataluna', estado: 'actual', ultimoExito: '2026-11-21T08:57:00Z', total: 2730 },
  { id: 'salas-estudio-madrid', estado: 'actual', ultimoExito: '2026-11-21T09:00:00Z', total: 68 },
] })
describe('estado de los directorios públicos independientes', () => {
  it('usa el éxito más antiguo, sin convertir recuentos en disponibilidad', () => {
    const items = serviciosPublicosItems(report())
    expect(items[0]).toEqual({name:'Servicios públicos oficiales',updatedAt:'2026-11-21T08:57:00Z',count:2})
    expect(items.map(item => item.count)).toEqual([2,2730,68])
  })
  it('la consulta nueva no oculta la copia antigua de una fuente fallida', () => {
    const input = report(); input.fuentes[0].estado = 'conservada'; input.fuentes[0].ultimoExito = '2026-11-17T09:00:00Z'
    const items = serviciosPublicosItems(input)
    expect(items[0]).toMatchObject({updatedAt:'2026-11-17T09:00:00Z',count:1})
    expect(items[0].issue).toBeTruthy(); expect(items[1].issue).toBeTruthy(); expect(items[2].issue).toBeUndefined()
  })
  it('un informe ausente o una fuente repetida no se toma por revisión correcta', () => {
    expect(serviciosPublicosItems(null)[0]).toMatchObject({updatedAt:null,count:0})
    const input=report(); input.fuentes.push({...input.fuentes[0]})
    expect(serviciosPublicosItems(input)[0]).toMatchObject({updatedAt:null,count:1})
  })
  it('cero fichas y fechas inválidas se señalan como pendientes', () => {
    const input=report(); input.fuentes[0].total=0; input.fuentes[1].ultimoExito='no es una fecha'
    const items=serviciosPublicosItems(input)
    expect(items[0]).toMatchObject({updatedAt:null,count:0})
    expect(items.every(item=>!!item.issue)).toBe(true)
  })
})
