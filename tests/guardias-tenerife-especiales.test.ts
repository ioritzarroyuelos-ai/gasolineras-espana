import { describe, expect, it } from 'vitest'
import { turnosEspeciales } from '../scripts/lib/guardias-tenerife-especiales.mjs'

const celda = (x: number, y: number, texto: string) => ({x,y,texto})
const pagina = [
  celda(.17,.05,'LA OROTAVA - LOS REALEJOS NOVIEMBRE 2026'),
  celda(.22,.17,'HASTA LAS 12H DE LA NOCHE'), celda(.64,.17,'24 HORAS'),
  celda(.04,.67,'6 viernes'), celda(.03,.70,'6 vie 09:00h a 00:00h'),
  celda(.20,.65,'Lcda. Dª. Mª Lourdes Rodríguez Lorenzo'), celda(.20,.69,'C/Inocencio García, 13 (LA OROTAVA)'), celda(.29,.73,'(922-33-00-94)'),
  celda(.53,.67,'6 viernes'), celda(.51,.70,'6 vie 09:00h a 23:59h'), celda(.51,.72,'7 sáb 00:00h a 09:00h'),
  celda(.72,.65,'Lcda. Dª. Daida Hernández Hernández'), celda(.65,.69,'Carretera General S/N (La Montañeta) LOS REALEJOS'), celda(.77,.73,'(922-34-60-99)')
]
describe('COF Tenerife · carteles especiales', () => {
  it('mantiene la farmacia, el teléfono y el relevo de cada columna', () => {
    const turnos = turnosEspeciales([pagina], 'LA OROTAVA - LOS REALEJOS', '2026-11-06')
    expect(turnos?.map(t=>[t.telefono,t.horario])).toEqual([
      ['922330094','2026-11-06 09:00-2026-11-07 00:00'],
      ['922346099','2026-11-06 09:00-2026-11-07 09:00']
    ])
    expect(turnos?.[0].direccion).toContain('Inocencio García')
    expect(turnos?.[1].direccion).toContain('LOS REALEJOS')
    expect(() => turnosEspeciales([pagina],17,'2026-12-06')).toThrow()
    expect(() => turnosEspeciales([pagina],16,'2026-11-06')).toThrow()
    expect(() => turnosEspeciales([pagina],'LA MATANZA, LA VICTORIA, SANTA URSULA, TACORONTE Y EL SAUZAL','2026-11-06')).toThrow()
  })
  it('exige el relevo impreso de la mañana siguiente y excluye el cartel de aperturas de Santa Cruz', () => {
    expect(() => turnosEspeciales([pagina.filter(e=>!e.texto.includes('7 sáb'))],17,'2026-11-06')).toThrow(/Horario/)
    expect(turnosEspeciales([pagina],'SANTA CRUZ DE TENERIFE','2026-11-06')).toEqual([])
    expect(turnosEspeciales([pagina],'ADEJE Y ARONA','2026-11-06')).toBeNull()
  })
})
