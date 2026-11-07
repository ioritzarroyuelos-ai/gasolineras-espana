import { describe, expect, it, vi } from 'vitest'
import { gruposAlava, calendarioAlava, clasificacionAlava, obtieneBaloncestoAlava } from '../scripts/lib/deportes-baloncesto-alava.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/*', { query: '?raw', import: 'default', eager: true })
const fixture = (nombre: string) => String(archivos['./fixtures/deportes-baloncesto/' + nombre])
const ahora = Date.parse('2026-11-07T14:00:00Z')
const grupo = { codigo: '0101', nombre: 'GRUPO UNICO-SEN.FEM.1ª', categoria: 'SENIOR FEMENINA 1ª' }
describe('Álava: jornadas publicadas sin horarios individuales inventados', () => {
  it('descubre los 61 grupos y conserva las categorías femeninas, masculinas, mixtas y escolares', () => {
    const grupos = gruposAlava(fixture('alava-indice.html'))
    expect(grupos).toHaveLength(61)
    expect(grupos[1]).toEqual(grupo)
    expect(grupos.some(g => g.categoria.includes('MIXTO'))).toBe(true)
    expect(() => gruposAlava(fixture('alava-indice.html').replace('grupo=0001', 'grupo=9999'))).toThrow('Enlace')
  })
  it('lee 132 partidos y 12 equipos, sin convertir la fecha nominal de jornada en horario del partido', () => {
    const agenda = calendarioAlava(fixture('alava-calendario.html'), grupo, ahora)
    expect(agenda.temporada).toBe('Calendario 2026–2027')
    expect(agenda.eventos).toHaveLength(132)
    expect(agenda.eventos[0]).toMatchObject({ resultado: { local: 65, visitante: 22 }, estado: 'finalizado' })
    expect(agenda.eventos.every(e => !e.inicio && !e.fecha && e.detalle?.includes('Fecha de jornada:'))).toBe(true)
    expect(agenda.eventos.filter(e => e.estado === 'finalizado')).toHaveLength(12)
    expect(clasificacionAlava(fixture('alava-tabla.html'), grupo)[0].filas).toHaveLength(12)
  })
  it('rechaza otro grupo, no publica cero a cero ni marcadores de jornadas futuras como resultado final', () => {
    const html = fixture('alava-calendario.html')
    expect(() => calendarioAlava(html.replace('GRUPO: 0101', 'GRUPO: 0102'), grupo, ahora)).toThrow('otro grupo')
    expect(calendarioAlava(html.replace('65 &ndash; 22', '0 &ndash; 0'), grupo, ahora).eventos[0].resultado).toBeUndefined()
    expect(calendarioAlava(html.replace('18-10-2026', '18-12-2026'), grupo, ahora).eventos[0].estado).toBe('por_confirmar')
    expect(() => clasificacionAlava(fixture('alava-tabla.html').replace('Puesto', 'Jornada'), grupo)).toThrow('tabla reconocida')
  })
  it('respeta una pausa y detiene toda la fuente después de un 429', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } })), guardar = vi.fn()
    await obtieneBaloncestoAlava({ ahora, relojAlava: () => ahora, fetcher, estadoNovanet: { 'basket-alava': { version: 1, noConsultarAntes: new Date(ahora + 3600000).toISOString() } } })
    expect(fetcher).not.toHaveBeenCalled()
    await obtieneBaloncestoAlava({ ahora, relojAlava: () => ahora, fetcher, guardarEstadoNovanet: guardar })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls.at(-1)?.[1].noConsultarAntes).toBe(new Date(ahora + 3600000).toISOString())
  })
})
