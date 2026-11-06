import { describe, expect, it } from 'vitest'
import { turnoTarragona } from '../scripts/lib/guardias-tarragona.mjs'

const notaFlix = 'La guardia comença dissabte a les 14 h. i acabarà dilluns a les 9 h Horarí sense recepta: Dissabte 17,30h a 20,30h'
describe('COFT · las instrucciones de la ficha prevalecen sobre la cabecera', () => {
  it('en Flix descarta el viernes y sólo publica la parte del sábado posterior a las dos', () => {
    expect(turnoTarragona('2026-11-06 09:00-2026-11-06 22:00',notaFlix)).toEqual({omitido:true})
    expect(turnoTarragona('2026-11-06 22:00-2026-11-07 09:00',notaFlix)).toEqual({omitido:true})
    expect(turnoTarragona('2026-11-07 09:00-2026-11-07 22:00',notaFlix).horario).toBe('2026-11-07 14:00-2026-11-07 22:00')
    expect(turnoTarragona('2026-11-08 22:00-2026-11-09 09:00',notaFlix).horario).toBe('2026-11-08 22:00-2026-11-09 09:00')
    expect(turnoTarragona('2026-11-09 09:00-2026-11-09 22:00',notaFlix)).toEqual({omitido:true})
  })
  it('conserva las condiciones de atención física y localizada sin identificar como abierta toda la guardia', () => {
    const nota = 'Farmàcia amb servei de guàrdia localitzada Horari d’obertura física De dilluns a divendres: De 9.00 a 21.00 h. Fora d’aquests horaris: Servei de guàrdia localitzada.'
    const fila = turnoTarragona('2026-11-06 09:00-2026-11-06 22:00',nota)
    expect(fila.nota).toContain(nota)
    expect(fila.horario).toBe('')
    expect(fila.conservarFranja).toBe(true)
    expect(turnoTarragona('2026-11-06 09:00-2026-11-06 22:00','Guàrdies localitzades.').nota).toContain('Guardia localizada')
  })
})
