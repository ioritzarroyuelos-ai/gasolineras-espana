import { describe, it, expect } from 'vitest'
import { temporadaEuro, calendarioEuro, clasificacionEuro, paginaFiba, calendarioFiba, clasificacionFiba, obtieneBaloncestoEuropa } from '../scripts/lib/deportes-baloncesto-europa.mjs'
const fixtures = import.meta.glob('./fixtures/deportes-baloncesto/europa-*', { query: '?raw', import: 'default', eager: true })
const fixture = (name: string) => String(fixtures['./fixtures/deportes-baloncesto/' + name])
const json = (name: string) => JSON.parse(fixture(name))
const ahora = Date.parse('2026-11-07T15:30:00Z'), fuente = 'https://www.euroleaguebasketball.net/en/euroleague/game-center/'
describe('Baloncesto europeo con identidad oficial', () => {
  it('selecciona la temporada publicada y no adopta una temporada futura', () => {
    const datos = json('europa-temporadas.json')
    expect(temporadaEuro(datos, 'E', ahora).code).toBe('E2026')
    expect(temporadaEuro(datos, 'E', Date.parse('2026-05-01T12:00Z')).code).toBe('E2025')
    expect(() => temporadaEuro(datos, 'U', ahora)).toThrow('Temporada')
    datos.total++
    expect(() => temporadaEuro(datos, 'E', ahora)).toThrow('incompleto')
  })
  it('no publica 0–0 futuros ni una hora provisional como confirmada', () => {
    const datos = json('europa-calendario.json'), temporada = temporadaEuro(json('europa-temporadas.json'), 'E', ahora)
    const eventos = calendarioEuro(datos, temporada, fuente, ahora)
    expect(eventos[0].estado).toBe('finalizado')
    expect(eventos[1].estado).toBe('programado')
    expect(eventos[1].resultado).toBeUndefined()
    datos.data[1].confirmedHour = false
    expect(calendarioEuro(datos, temporada, fuente, ahora)[1].inicio).toBeUndefined()
    datos.data[1].season.code = 'E2025'
    expect(() => calendarioEuro(datos, temporada, fuente, ahora)).toThrow('temporada')
  })
  it('rechaza resultados europeos futuros y agendas parciales', () => {
    const datos = json('europa-calendario.json'), temporada = temporadaEuro(json('europa-temporadas.json'), 'E', ahora)
    datos.data[1].played = true
    expect(() => calendarioEuro(datos, temporada, fuente, ahora)).toThrow('futura')
    datos.data[1].played = false; datos.total++
    expect(() => calendarioEuro(datos, temporada, fuente, ahora)).toThrow('incompleto')
  })
  it('comprueba todos los clubes y el balance oficial de la tabla europea', () => {
    const tabla = json('europa-tabla.json')
    const calendario = { data: tabla.teams.map((t: any) => ({ phaseType: { code: 'RS' }, local: { club: t.club }, road: { club: t.club } })) }
    expect(clasificacionEuro(tabla, calendario)[0].filas).toHaveLength(20)
    tabla.teams[0].gamesWon++
    expect(() => clasificacionEuro(tabla, calendario)).toThrow('incompleta')
    tabla.teams.shift()
    expect(() => clasificacionEuro(tabla, calendario)).toThrow('Faltan equipos')
  })
  it('lee FIBA sin ejecutar scripts y trata el año0001 como fecha sin confirmar', () => {
    const p = paginaFiba(fixture('europa-fiba.html'), 'BCL')
    expect(p.temporada).toBe('2026-27')
    const e = calendarioFiba(p, 'https://www.championsleague.basketball/en/games', ahora)
    expect(e[0]).toMatchObject({ estado: 'finalizado', resultado: { local: 82, visitante: 73 } })
    expect(e.at(-1)).toMatchObject({ estado: 'por_confirmar', nombre: 'Play-ins · Equipos por confirmar' })
    expect(e.at(-1)?.fecha).toBeUndefined()
    expect(e.at(-1)?.inicio).toBeUndefined()
    expect(e.every(x => !x.emisiones)).toBe(true)
    expect(() => paginaFiba(fixture('europa-fiba.html'), 'ELW')).toThrow('Identidad')
    expect(() => paginaFiba('<script>globalThis.process.exit()</script>', 'BCL')).toThrow('Identidad')
  })
  it('exige el estado final de FIBA, rechaza mezcla de ediciones y no inventa horarios', () => {
    const p = paginaFiba(fixture('europa-fiba.html'), 'BCL')
    p.partidos[0].gameResultStatusCode = 'EMPTY'
    expect(calendarioFiba(p, fuente, ahora)[0].resultado).toBeUndefined()
    p.partidos[0].hasTimeGameDateTime = false
    expect(calendarioFiba(p, fuente, ahora)[0].inicio).toBeUndefined()
    p.partidos[0].competition.season = 2026
    expect(() => calendarioFiba(p, fuente, ahora)).toThrow('mezcla')
  })
  it('identifica equipos de la tabla FIBA y rechaza grupos a medias', () => {
    const p = paginaFiba(fixture('europa-fiba.html'), 'BCL')
    expect(clasificacionFiba(p)[0].filas).toHaveLength(4)
    p.fases[0].data.groups[0].teamsStats[0].team = 999999
    expect(() => clasificacionFiba(p)).toThrow('todos los equipos')
  })
  it('un límite detiene consultas posteriores al mismo dominio', async () => {
    const llamadas: string[] = []
    const r = await obtieneBaloncestoEuropa({ ahora, fetcher: async u => { llamadas.push(new URL(String(u)).hostname); return new Response('Esperar', { status: 429 }) } })
    expect(llamadas.filter(h => h === 'api-live.euroleague.net')).toHaveLength(1)
    expect(llamadas.filter(h => h === 'www.fiba.basketball')).toHaveLength(1)
    expect(r.competiciones).toEqual([])
  })
})
