import { describe, it, expect } from 'vitest'
import {
  datosPaginaAcb, normalizaCalendarioAcb, normalizaClasificacionAcb, normalizaNba,
  leerLiteralFeb, decodificaRespuestaFeb, normalizaPartidosFeb, normalizaTablaFeb,
  obtieneBaloncesto, normalizaFinalBaseFeb,
} from '../scripts/lib/deportes-baloncesto.mjs'

const fixtures = import.meta.glob('./fixtures/deportes-baloncesto/*', { query: '?raw', import: 'default', eager: true })
const fixture = (nombre: string): string => String(fixtures['./fixtures/deportes-baloncesto/' + nombre])
const fecha = '2026-11-07T13:00:00.000Z'
const fuente = 'https://acb.com/es/liga/calendario'
const htmlAcb = (data: unknown) => '<script>self.__next_f.push(' + JSON.stringify([1, 'aa:' + JSON.stringify(['$', '$L1', null, { data }]) + '\n']) + ')</script>'

describe('baloncesto oficial', () => {
  it('lee ACB con resultados reales, sin convertir partidos futuros en 0–0', () => {
    const { eventos, temporada } = normalizaCalendarioAcb(fixture('acb-agenda.html'), fuente, fecha)
    expect(temporada).toBe('2026-27')
    expect(eventos.find(e => e.id === 'acb-105375')).toMatchObject({ estado: 'finalizado', resultado: { local: 107, visitante: 92 } })
    const sinHorario = eventos.find(e => e.id === 'acb-105672')
    expect(sinHorario).toMatchObject({ estado: 'por_confirmar' })
    expect(sinHorario?.inicio).toBeUndefined()
    expect(sinHorario?.resultado).toBeUndefined()
    expect(eventos.find(e => e.id === 'acb-105429')?.estado).toBe('programado')
  })

  it('conserva únicamente los canales asignados por la ACB a cada partido', () => {
    const { eventos } = normalizaCalendarioAcb(fixture('acb-agenda.html'), fuente, fecha)
    expect(eventos[0].emisiones).toContainEqual({ nombre: 'DAZN', url: 'https://www.dazn.com/es-ES', fuenteUrl: fuente, territorio: 'España', verificadoEn: fecha })
    const data = datosPaginaAcb(fixture('acb-agenda.html')).data
    data.rounds[0].matches[0].broadcastChannels.primary.push({ name: 'No válido', link: 'javascript:alert(1)' })
    data.rounds[0].matches[0].broadcastChannels.primary.push({ name: 'Canal fuera de España', link: 'https://www.dazn.com/en-US' })
    data.rounds[0].matches[0].broadcastChannels.primary.push({ name: 'Subdominio global', link: 'https://watch.dazn.com/en-US' })
    data.rounds[0].matches[0].broadcastChannels.primary.push({ name: 'Emisión de Estados Unidos', link: 'https://www.espn.com/watch/' })
    expect(normalizaCalendarioAcb(htmlAcb(data), fuente, fecha).eventos[0].emisiones?.some(e => e.nombre === 'No válido')).toBe(false)
    expect(normalizaCalendarioAcb(htmlAcb(data), fuente, fecha).eventos[0].emisiones?.some(e => e.nombre === 'Canal fuera de España')).toBe(false)
    expect(normalizaCalendarioAcb(htmlAcb(data), fuente, fecha).eventos[0].emisiones?.some(e => e.nombre === 'Subdominio global' || e.nombre === 'Emisión de Estados Unidos')).toBe(false)
    data.rounds[0].matches[0].matchStatus = 'CANCELLED'
    expect(normalizaCalendarioAcb(htmlAcb(data), fuente, fecha).eventos[0].emisiones).toEqual([])
  })

  it('rechaza calendarios ACB incompletos y referencias a datos ajenos', () => {
    const data = datosPaginaAcb(fixture('acb-agenda.html')).data
    data.rounds[0].matches[0].awayTeam = '$xx:props:data:teams:0'
    expect(() => normalizaCalendarioAcb(htmlAcb(data), fuente, fecha)).toThrow('Referencia')
    expect(() => normalizaCalendarioAcb('<html>Servicio temporalmente no disponible</html>', fuente, fecha)).toThrow()
  })

  it('no publica una clasificación de ACB a la que faltan equipos', () => {
    const html = fixture('acb-tabla.html')
    expect(normalizaClasificacionAcb(html).tablas[0].filas).toHaveLength(18)
    const data = datosPaginaAcb(html).data
    data.standings.pop()
    expect(() => normalizaClasificacionAcb(htmlAcb(data))).toThrow('Faltan equipos')
  })

  it('comprueba la fecha solicitada y el número de partidos NBA', () => {
    const html = fixture('nba-dia.html')
    const nba = normalizaNba(html, '2026-11-07')
    expect(nba.temporada).toBe('2026-27')
    expect(nba.eventos).toHaveLength(7)
    expect(() => normalizaNba(html, '2026-11-08')).toThrow('fecha solicitada')
    expect(() => normalizaNba(html.replace('"2026-11-07":7', '"2026-11-07":8'), '2026-11-07')).toThrow('incompleto')
    expect(nba.eventos.every(e => e.inicio?.endsWith('Z'))).toBe(true)
    expect(nba.eventos.every(e => !('emisiones' in e))).toBe(true)
  })

  it('un día NBA válido no oculta el fallo de otros días ni renueva una agenda incompleta', async () => {
    const resultado = await obtieneBaloncesto({
      ahora: Date.parse(fecha),
      fetcher: async url => String(url) === 'https://www.nba.com/games?date=2026-11-07'
        ? new Response(fixture('nba-dia.html')) : new Response('Error', { status: 503 }),
    })
    const nba = resultado.competiciones.find(c => c.id === 'nba')
    expect(nba?.temporada).toBe('2026-27')
    expect(nba?.agenda.estado).toBe('no_disponible')
    expect(nba?.agenda.eventos).toEqual([])
    expect(nba?.agenda.verificadoEn).toBeUndefined()
    expect(resultado.incidencias.filter(i => i.id === 'nba')).toHaveLength(3)
  })

  it('lee literales FEB sin ejecutar funciones, acceder al sistema ni modificar prototipos', () => {
    expect(leerLiteralFeb('$R[0]={lista:$R[1]=[1,"dos",!0],copia:$R[1]}')).toEqual({ lista: [1, 'dos', true], copia: [1, 'dos', true] })
    expect(() => leerLiteralFeb('{x:globalThis.process.exit()}')).toThrow()
    expect(() => leerLiteralFeb('{"__proto__":{polluted:!0}}')).toThrow()
    expect(() => leerLiteralFeb('$R[7]')).toThrow('incompleta')
    expect(() => leerLiteralFeb('{x:[1,2')).toThrow()
  })

  it('decodifica el formato público FEB y conserva sus marcadores', () => {
    const partidos = decodificaRespuestaFeb(JSON.parse(fixture('feb-partidos.json')))
    const eventos = normalizaPartidosFeb(partidos, 'https://beta.competiciones.feb.es/tercera-feb/partidos')
    expect(eventos[0]).toMatchObject({ fecha: '2026-11-01', estado: 'finalizado', resultado: { local: 104, visitante: 70 } })
    expect(eventos[0].inicio).toBeUndefined()
    expect(eventos[0].detalle).toContain('zona horaria sin confirmar')
  })

  it('no da por terminado un partido FEB por su fecha ni muestra un marcador inventado', () => {
    const p = decodificaRespuestaFeb(JSON.parse(fixture('feb-partidos.json')))[0]
    p.state = 'upcoming'; p.teamA.score = '0'; p.teamB.score = '0'
    const e = normalizaPartidosFeb([p], 'https://beta.competiciones.feb.es/tercera-feb/partidos')[0]
    expect(e.estado).toBe('programado')
    expect(e.resultado).toBeUndefined()
    p.state = 'final'; p.teamA.score = '*'
    expect(() => normalizaPartidosFeb([p], 'https://beta.competiciones.feb.es/tercera-feb/partidos')).toThrow('Marcador')
    p.teamA.score = '77'; p.fecha = '31/02/2026'
    expect(() => normalizaPartidosFeb([p], 'https://beta.competiciones.feb.es/tercera-feb/partidos')).toThrow('Fecha')
  })

  it('rechaza una tabla FEB con balances imposibles o equipos repetidos', () => {
    const r = { posicion: 1, nombreEquipo: 'Equipo', pj: 5, pg: 4, pp: 1, pf: 400, pc: 350 }
    expect(normalizaTablaFeb({ rows: [r] }, 'grupo', 'Grupo A').filas[0].valores).toEqual({ pj: 5, pg: 4, pp: 1, pf: 400, pc: 350 })
    expect(() => normalizaTablaFeb({ rows: [{ ...r, pj: 6 }] }, 'grupo', 'Grupo A')).toThrow()
    expect(() => normalizaTablaFeb({ rows: [r, r] }, 'grupo', 'Grupo A')).toThrow()
  })

  it('mantiene la temporada terminada de base y su clasificación final completa', () => {
    const c = normalizaFinalBaseFeb(fixture('feb-base-final.html'), 21, 'https://baloncestoenvivo.feb.es/resultados.aspx?g=21&t=2025', Date.parse(fecha))
    expect(c.temporada).toBe('2025/2026')
    expect(c.agenda.eventos[0]).toMatchObject({ fecha: '2026-05-02', estado: 'finalizado', local: 'BARÇA', visitante: 'REAL MADRID', resultado: { local: 87, visitante: 91 } })
    expect(c.clasificacion.tablas[0].filas).toHaveLength(32)
    expect(c.clasificacion.tablas[0].filas[0]).toEqual({ posicion: 1, nombre: 'REAL MADRID', valores: {} })
    expect(c.clasificacion.tablas[0].columnas).toEqual([])
    expect(c.agenda.aviso).toContain('Campeonato terminado')
  })

  it('no presenta un campeonato como terminado sin clasificación final o con un resultado futuro', () => {
    const html = fixture('feb-base-final.html')
    const fuente = 'https://baloncestoenvivo.feb.es/resultados.aspx?g=21&t=2025'
    expect(() => normalizaFinalBaseFeb(html.replace('Clasificación Final', 'Clasificación provisional'), 21, fuente, Date.parse(fecha))).toThrow('clasificación final')
    expect(() => normalizaFinalBaseFeb(html.replaceAll('02/05/2026', '02/05/2027'), 21, fuente, Date.parse(fecha))).toThrow('no está confirmado')
  })

  it('un fallo de las fuentes no produce datos falsos ni una actualización vacía como válida', async () => {
    const resultado = await obtieneBaloncesto({ ahora: Date.parse(fecha), fetcher: async () => new Response('Error', { status: 503 }) })
    expect(resultado.competiciones).toEqual([])
    expect(resultado.incidencias.length).toBeGreaterThanOrEqual(10)
  })
})

