import { describe, it, expect } from 'vitest'
import {
  datosPaginaAcb, normalizaCalendarioAcb, normalizaClasificacionAcb, normalizaNba,
  leerLiteralFeb, codigoFuncion, decodificaRespuestaFeb, normalizaPartidosFeb, normalizaTablaFeb,
  obtieneBaloncesto, normalizaFinalBaseFeb, normalizaClasificacionNba, compruebaLeaguePassEspana,
  enlacesEquiposNba, normalizaClasificacionEquiposNba, obtieneClasificacionEquiposNba,
} from '../scripts/lib/deportes-baloncesto.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { buildCompeticionDeportesPage, tarjetaEvento } from '../src/html/deportes'

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
    expect(resultado.incidencias.filter(i => i.id === 'nba' && i.fuenteUrl.includes('/games?'))).toHaveLength(3)
    expect(nba?.clasificacion.estado).toBe('no_disponible')
  })

  it('verifica las 30 posiciones NBA por conferencia y rechaza otra temporada, duplicados o faltas', () => {
    const original = JSON.parse(fixture('nba-clasificacion.json'))
    const tablas = normalizaClasificacionNba(original, '2026-27')
    expect(tablas.map(t => [t.nombre, t.filas.length])).toEqual([['Conferencia Este', 15], ['Conferencia Oeste', 15]])
    expect(tablas[1].filas[0]).toMatchObject({ nombre: 'Los Angeles Lakers', valores: { pg: 8, pp: 2, pj: 10 } })
    expect(() => normalizaClasificacionNba(original, '2025-26')).toThrow('otra temporada')
    const falta = structuredClone(original)
    falta.resultSets[0].rowSet.pop()
    expect(() => normalizaClasificacionNba(falta, '2026-27')).toThrow('incompleta')
    const duplicado = structuredClone(original), tabla = duplicado.resultSets[0]
    tabla.rowSet[1][tabla.headers.indexOf('TeamID')] = tabla.rowSet[0][tabla.headers.indexOf('TeamID')]
    expect(() => normalizaClasificacionNba(duplicado, '2026-27')).toThrow('repite equipos')
    const temporada = structuredClone(original)
    temporada.resultSets[0].rowSet[0][temporada.resultSets[0].headers.indexOf('SeasonID')] = '22025'
    expect(() => normalizaClasificacionNba(temporada, '2026-27')).toThrow('incoherentes')
  })

  it('seguir un equipo desde su nombre completo NBA busca el mismo equipo del calendario', () => {
    const { eventos, temporada } = normalizaNba(fixture('nba-dia.html'), '2026-11-07')
    if (!temporada) throw Error('Falta la temporada NBA de la captura')
    const tablas = normalizaClasificacionNba(JSON.parse(fixture('nba-clasificacion.json')), temporada)
    const e = eventos[0], nombre = e.local!
    const fila = tablas.flatMap(t => t.filas).find(f => f.nombreBusqueda === nombre)!
    expect(fila.nombre).not.toBe(nombre)
    const bloque = { estado: 'actualizado' as const, consultado: fecha, verificadoEn: fecha, fuenteUrl: 'https://www.nba.com/' }
    const c = validarCompeticionDeportiva({ id: 'nba', deporte: 'baloncesto', nombre: 'NBA', temporada, categoria: 'Sénior', zona: 'Estados Unidos y Canadá', fuente: { nombre: 'NBA', url: bloque.fuenteUrl }, comprobadoEn: fecha,
      agenda: { ...bloque, eventos }, clasificacion: { ...bloque, tablas } }, Date.parse(fecha))
    const html = buildCompeticionDeportesPage(c, 'prueba', 'https://web.example/deportes/competicion/nba', new URL('https://web.example/deportes/competicion/nba'), 'madrid')
    const id = 'baloncesto:' + nombre.toLowerCase()
    expect(html).toContain('data-fav="' + id + '" data-name="' + fila.nombre + '" data-url="/deportes/baloncesto?q=' + encodeURIComponent(nombre) + '#competiciones"')
    const partido = tarjetaEvento({ ...e, competicionId: 'nba', competicion: 'NBA', deporte: 'baloncesto', temporada, conservado: false }, 'madrid')
    expect(partido).toContain('data-fav="' + id + '"')
    expect([e.nombre, e.local, e.visitante].join(' ').toLowerCase()).toContain(nombre.toLowerCase())
  })

  it('una agenda NBA incompleta no impide comprobar la clasificación independiente', async () => {
    const resultado = await obtieneBaloncesto({ ahora: Date.parse(fecha), fetcher: async (url, init) => {
      if (String(url).includes('stats.nba.com/stats/leaguestandingsv3?')) {
        expect((init?.headers as Record<string, string>)?.Referer).toBe('https://www.nba.com/')
        return new Response(fixture('nba-clasificacion.json'))
      }
      return String(url) === 'https://www.nba.com/games?date=2026-11-07' ? new Response(fixture('nba-dia.html')) : new Response('Error', { status: 503 })
    } })
    const nba = resultado.competiciones.find(c => c.id === 'nba')
    expect(nba?.agenda.estado).toBe('no_disponible')
    expect(nba?.clasificacion.estado).toBe('actualizado')
    expect(nba?.clasificacion.tablas.flatMap(t => t.filas)).toHaveLength(30)
  })

  const muestraEquipos = () => JSON.parse(fixture('nba-equipos-clasificacion.json'))
  const htmlDatosNba = (datos: unknown) => '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(datos) + '</script>'
  const catalogoEquipos = (m = muestraEquipos()) => htmlDatosNba({ page: m.paginaCatalogo, props: { pageProps: {} } }) + m.enlaces.map((url: string) => '<a href="' + url + '">Equipo</a>').join('')
  const paginasEquipos = (m = muestraEquipos()) => m.equipos.map((e: { url: string; datos: unknown }) => ({ url: e.url, html: htmlDatosNba(e.datos) }))

  it('lee 30 fichas NBA oficiales de la misma temporada, con posiciones y balances completos', () => {
    const m = muestraEquipos(), urls = enlacesEquiposNba(catalogoEquipos(m))
    expect(urls).toHaveLength(30)
    expect(urls.every(u => m.equipos.some((e: { url: string }) => e.url === u))).toBe(true)
    const tablas = normalizaClasificacionEquiposNba(paginasEquipos(m), '2026-27')
    expect(tablas.map(t => [t.nombre, t.filas.length])).toEqual([['Conferencia Este', 15], ['Conferencia Oeste', 15]])
    expect(tablas.every(t => t.columnas.map(c => c.clave).join(',') === 'pj,pg,pp')).toBe(true)
    expect(tablas[0].filas[0]).toMatchObject({ posicion: 1, nombre: 'Philadelphia 76ers', nombreBusqueda: '76ers', valores: { pj: 10, pg: 8, pp: 2 } })
    expect(tablas.flatMap(t => t.filas).reduce((n, f) => n + Number(f.valores.pg), 0)).toBe(132)
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(m), '2025-26')).toThrow('otra temporada')
    expect(() => enlacesEquiposNba(catalogoEquipos({ ...m, enlaces: m.enlaces.slice(1) }))).toThrow('30 equipos')
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(m).slice(1), '2026-27')).toThrow('incompleta')
  })

  it('rechaza fichas NBA de otro equipo, temporada, liga y tablas con posiciones repetidas o balances incompatibles', () => {
    const otro = muestraEquipos(); otro.equipos[0].datos.props.pageProps.team.info.TEAM_ID++
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(otro), '2026-27')).toThrow('otro equipo')
    const anterior = muestraEquipos(); anterior.equipos[0].datos.props.pageProps.team.scheduleSeason = '2025-26'
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(anterior), '2026-27')).toThrow('otra temporada')
    const pretemporada = muestraEquipos(); pretemporada.equipos[0].datos.props.pageProps.team.ranks.SEASON_ID = '12026'
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(pretemporada), '2026-27')).toThrow('otra temporada')
    const rango = muestraEquipos(), este = rango.equipos.filter((e: any) => e.datos.props.pageProps.team.info.TEAM_CONFERENCE === 'East')
    este[0].datos.props.pageProps.team.info.CONF_RANK = este[1].datos.props.pageProps.team.info.CONF_RANK
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(rango), '2026-27')).toThrow('posiciones repetidas')
    const balance = muestraEquipos(), info = balance.equipos[0].datos.props.pageProps.team.info
    info.W++; info.PCT = Math.round(info.W / (info.W + info.L) * 1000) / 1000
    expect(() => normalizaClasificacionEquiposNba(paginasEquipos(balance), '2026-27')).toThrow('no coinciden')
    const duplicado = paginasEquipos(); duplicado[1] = duplicado[0]
    expect(() => normalizaClasificacionEquiposNba(duplicado, '2026-27')).toThrow('repite equipos')
  })

  function respuestasEquipos(m = muestraEquipos()) {
    const respuestas = new Map<string, string>([['https://www.nba.com/teams', catalogoEquipos(m)], ...paginasEquipos(m).map((e: { url: string; html: string }) => [e.url, e.html] as [string, string])])
    return async (url: RequestInfo | URL) => new Response(respuestas.get(String(url)) || 'Error', { status: respuestas.has(String(url)) ? 200 : 503 })
  }
  it('usa las fichas oficiales cuando Stats agota el tiempo, sin perder la agenda ni los alias de favoritos', async () => {
    const desdeFichas = respuestasEquipos()
    const resultado = await obtieneBaloncesto({ ahora: Date.parse(fecha), fetcher: async (url, init) => {
      if (String(url).startsWith('https://stats.nba.com/')) throw new DOMException('Tiempo agotado', 'TimeoutError')
      if (String(url).startsWith('https://www.nba.com/games?date=')) {
        const dia = new URL(String(url)).searchParams.get('date')!
        return new Response(fixture('nba-dia.html').replaceAll('2026-11-07', dia))
      }
      return desdeFichas(url)
    } })
    const nba = resultado.competiciones.find(c => c.id === 'nba')!
    expect(nba.agenda.estado).toBe('actualizado')
    expect(nba.clasificacion.estado).toBe('actualizado')
    expect(nba.clasificacion.fuenteUrl).toBe('https://www.nba.com/teams')
    expect(nba.clasificacion.aviso).toContain('30 fichas oficiales')
    expect(nba.clasificacion.tablas.flatMap(t => t.filas)).toHaveLength(30)
    expect(resultado.incidencias.some(i => i.nombre === 'NBA · Clasificación')).toBe(false)
    expect(() => validarCompeticionDeportiva(nba, Date.parse(fecha))).not.toThrow()
    const e = nba.agenda.eventos[0], fila = nba.clasificacion.tablas.flatMap(t => t.filas).find(f => f.nombreBusqueda === e.local)!
    const html = buildCompeticionDeportesPage(nba, 'prueba', 'https://web.example/deportes/competicion/nba', new URL('https://web.example/deportes/competicion/nba'), 'madrid')
    expect(html).toContain('data-fav="baloncesto:' + e.local!.toLowerCase() + '" data-name="' + fila.nombre + '"')
  })

  it.each([503, 429])('no publica una tabla parcial ni sigue descargando equipos después de HTTP%s', async status => {
    const desdeFichas = respuestasEquipos(), llamadas: string[] = []
    await expect(obtieneClasificacionEquiposNba('2026-27', { fetcher: async url => {
      llamadas.push(String(url))
      if (String(url).includes('/team/')) return new Response('', { status })
      return desdeFichas(url)
    } })).rejects.toThrow('HTTP ' + status)
    expect(llamadas.filter(u => u.includes('/team/')).length).toBeLessThanOrEqual(2)
  })

  it('un fallo de una ficha no renueva la clasificación y un429 de Stats no abre otra vía', async () => {
    const desdeFichas = respuestasEquipos(), urls: string[] = [], fallo = muestraEquipos().equipos[7].url
    const carga = async (stats429: boolean) => obtieneBaloncesto({ ahora: Date.parse(fecha), fetcher: async url => {
      urls.push(String(url))
      if (String(url).startsWith('https://stats.nba.com/')) return new Response('', { status: stats429 ? 429 : 503 })
      if (String(url) === 'https://www.nba.com/games?date=2026-11-07') return new Response(fixture('nba-dia.html'))
      if (String(url) === fallo) return new Response('', { status: 503 })
      return desdeFichas(url)
    } })
    const parcial = (await carga(false)).competiciones.find(c => c.id === 'nba')!
    expect(parcial.clasificacion.estado).toBe('no_disponible'); expect(parcial.clasificacion.tablas).toEqual([]); expect(parcial.clasificacion.verificadoEn).toBeUndefined()
    urls.length = 0
    expect((await carga(true)).competiciones.find(c => c.id === 'nba')!.clasificacion.estado).toBe('no_disponible')
    expect(urls).not.toContain('https://www.nba.com/teams')
  })

  it('League Pass exige todos los partidos, cobertura en vivo y España explícitamente', () => {
    const oferta = '<section><p>All NBA games are included in an NBA League Pass subscription.</p><p>both live and on-demand</p><p>NBA League Pass is available for subscription in: Spain</p></section>'
    expect(compruebaLeaguePassEspana(oferta)).toBe(true)
    expect(compruebaLeaguePassEspana(oferta.replace('Spain', 'United States'))).toBe(false)
    expect(compruebaLeaguePassEspana(oferta.replace('All NBA games', 'Selected games'))).toBe(false)
    expect(compruebaLeaguePassEspana(oferta.replace('both live and on-demand', 'on-demand'))).toBe(false)
    expect(compruebaLeaguePassEspana('<script>' + oferta + '</script>')).toBe(false)
  })

  it('lee literales FEB sin ejecutar funciones, acceder al sistema ni modificar prototipos', () => {
    expect(leerLiteralFeb('$R[0]={lista:$R[1]=[1,"dos",!0],copia:$R[1]}')).toEqual({ lista: [1, 'dos', true], copia: [1, 'dos', true] })
    expect(() => leerLiteralFeb('{x:globalThis.process.exit()}')).toThrow()
    expect(() => leerLiteralFeb('{"__proto__":{polluted:!0}}')).toThrow()
    expect(() => leerLiteralFeb('$R[7]')).toThrow('incompleta')
    expect(() => leerLiteralFeb('{x:[1,2')).toThrow()
  })

  it('encuentra las consultas FEB tratando el símbolo como texto y no como expresión regular', () => {
    const hash = 'a'.repeat(64)
    expect(codigoFuncion('$partidos=x.handler(f(`' + hash + '`))', '$partidos')).toBe(hash)
    const especial = 'x\\.*+?^${}()|[]'
    expect(codigoFuncion(especial + '=x.handler(f(`' + hash + '`))', especial)).toBe(hash)
    expect(codigoFuncion('ajeno=x.handler(f(`' + hash + '`))', 'ajeno|otro')).toBeUndefined()
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

