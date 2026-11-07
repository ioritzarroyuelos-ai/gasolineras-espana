import { describe, expect, it } from 'vitest'
import { descubreTemporadaWnba, normalizaTablaWnba, normalizaCalendarioWnba, obtieneWnba } from '../scripts/lib/deportes-baloncesto-wnba.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/*', { query: '?raw', import: 'default', eager: true })
const fixture = (nombre: string) => String(archivos['./fixtures/deportes-baloncesto/' + nombre])
const ahora = Date.parse('2026-11-07T14:00:00Z')
describe('WNBA oficial', () => {
  it('descubre la temporada de la fuente y sus 15 equipos, sin deducirlos del reloj', () => {
    const contexto = descubreTemporadaWnba(fixture('wnba.html'))
    expect(contexto.temporada).toBe('2026')
    expect(contexto.equipos).toHaveLength(15)
    const tablas = normalizaTablaWnba(fixture('wnba-table.html'), contexto)
    expect(tablas[0].filas).toHaveLength(15)
    expect(tablas[0].filas[0]).toMatchObject({ posicion: 1, nombre: 'Minnesota Lynx', valores: { pj: 44, pg: 33 } })
    expect(() => normalizaTablaWnba(fixture('wnba-table.html'), { ...contexto, temporada: '2025' })).toThrow('otra temporada')
    expect(() => normalizaTablaWnba(fixture('wnba-table.html'), { ...contexto, equipos: contexto.equipos.slice(1) })).toThrow('incompleta')
  })
  it('no convierte ceros futuros en marcadores ni los canales de EEUU en emisiones españolas', () => {
    const datos = JSON.parse(fixture('wnba-games.json'))
    const partido = datos.leagueSchedule.gameDates[0].games[0]
    expect(normalizaCalendarioWnba(datos, '2026', ahora)[0].estado).toBe('finalizado')
    partido.postponedStatus = 'Y'
    expect(normalizaCalendarioWnba(datos, '2026', ahora)[0].estado).toBe('finalizado')
    partido.gameStatus = 1; partido.gameStatusText = 'TBD'; partido.postponedStatus = 'N'
    partido.homeTeam.score = 0; partido.awayTeam.score = 0
    const evento = normalizaCalendarioWnba(datos, '2026', ahora)[0]
    expect(evento.inicio).toBeUndefined()
    expect(evento.resultado).toBeUndefined()
    expect(evento.emisiones).toBeUndefined()
    partido.gameStatus = 3; partido.gameStatusText = 'Final'; partido.gameDateTimeUTC = '2027-01-01T01:00:00Z'
    expect(() => normalizaCalendarioWnba(datos, '2026', ahora)).toThrow('sin confirmar')
    partido.gameStatus = 2; partido.gameStatusText = 'Q1 10:00'; partido.homeTeam.score = 10; partido.awayTeam.score = 8
    expect(() => normalizaCalendarioWnba(datos, '2026', ahora)).toThrow('sin confirmar')
    partido.gameDateTimeUTC = '2026-11-07T13:00:00Z'
    expect(normalizaCalendarioWnba(datos, '2026', ahora)[0]).toMatchObject({ estado: 'en_juego', resultado: { local: 10, visitante: 8 } })
  })
  it('el calendario y la clasificación fallan de forma independiente', async () => {
    const r = await obtieneWnba({ ahora, fetcher: async url => {
      if (String(url).endsWith('/schedule')) return new Response(fixture('wnba.html'))
      if (String(url).endsWith('/standings')) return new Response(fixture('wnba-table.html'))
      return new Response('No disponible', { status: 503 })
    } })
    expect(r.competiciones[0].agenda.verificadoEn).toBeUndefined()
    expect(r.competiciones[0].clasificacion.tablas[0].filas).toHaveLength(15)
    expect(r.incidencias).toHaveLength(1)
  })
})
