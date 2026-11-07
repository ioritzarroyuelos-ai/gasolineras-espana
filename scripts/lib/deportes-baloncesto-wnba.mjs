import { parse } from 'node-html-parser'
import { leerFuenteDeportiva } from './deportes.mjs'
const WEB = 'https://www.wnba.com'
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const entero = v => Number.isInteger(v) && v >= 0
const pagina = html => {
  const raw = parse(html).querySelector('#__NEXT_DATA__')?.rawText
  if (!raw) throw Error('La WNBA no ha entregado sus datos')
  return JSON.parse(raw)?.props?.pageProps
}
export function descubreTemporadaWnba(html) {
  const d = pagina(html)
  if (!/^20\d{2}$/.test(d?.latestSeason) || !Array.isArray(d.teamFilters) || d.teamFilters.length < 10 || d.teamFilters.some(t => !texto(t.value) || !texto(t.label)) || new Set(d.teamFilters.map(t => t.value)).size !== d.teamFilters.length) throw Error('Temporada o equipos WNBA incompletos')
  return { temporada: d.latestSeason, equipos: d.teamFilters.map(t => t.value) }
}
export function normalizaTablaWnba(html, contexto) {
  const d = pagina(html), filas = d?.standingsRowsData
  if (d?.defaultSeason !== contexto.temporada || !Array.isArray(filas) || filas.length !== contexto.equipos.length) throw Error('Clasificación WNBA de otra temporada o incompleta')
  const resultado = filas.map(t => {
    if (t.LeagueID !== '10' || t.SeasonID !== '2' + contexto.temporada || !contexto.equipos.includes(t.TeamSlug) || !texto(t.TeamCity) || !texto(t.TeamName) || !entero(t.PlayoffRank) || t.PlayoffRank < 1 || !['WINS', 'LOSSES', 'TotalPoints', 'OppTotalPoints'].every(k => entero(t[k]))) throw Error('Clasificación WNBA incoherente')
    return { posicion: t.PlayoffRank, nombre: texto(t.TeamCity + ' ' + t.TeamName), valores: { pj: t.WINS + t.LOSSES, pg: t.WINS, pp: t.LOSSES, pf: t.TotalPoints, pc: t.OppTotalPoints } }
  }).sort((a, b) => a.posicion - b.posicion)
  if (new Set(filas.map(t => t.TeamSlug)).size !== contexto.equipos.length || !resultado.every((t, i) => t.posicion === i + 1)) throw Error('La clasificación WNBA repite equipos o posiciones')
  return [{ id: 'temporada-regular', nombre: 'Temporada regular · Clasificación general', columnas: [{ clave: 'pj', nombre: 'Jugados' }, { clave: 'pg', nombre: 'Ganados' }, { clave: 'pp', nombre: 'Perdidos' }, { clave: 'pf', nombre: 'A favor' }, { clave: 'pc', nombre: 'En contra' }], filas: resultado }]
}
export function normalizaCalendarioWnba(datos, temporada, ahora = Date.now()) {
  const d = datos?.leagueSchedule
  if (d?.leagueId !== '10' || d.seasonYear !== temporada || !Array.isArray(d.gameDates) || !d.gameDates.length || d.gameDates.some(g => !Array.isArray(g.games))) throw Error('Calendario WNBA de otra temporada o incompleto')
  const eventos = d.gameDates.flatMap(d => d.games).map(p => {
    if (!/^10\d{8}$/.test(p.gameId) || !texto(p.homeTeam?.teamName) || !texto(p.awayTeam?.teamName)) throw Error('Partido WNBA incompleto')
    const local = texto(p.homeTeam.teamCity + ' ' + p.homeTeam.teamName), visitante = texto(p.awayTeam.teamCity + ' ' + p.awayTeam.teamName)
    // postponedStatus puede seguir marcado después de jugarse: el estado final
    // explícito y su fecha real tienen prioridad sobre esa marca histórica.
    const estado = /cancel/i.test(p.gameStatusText) ? 'cancelado' : p.gameStatus === 3 && /^Final/.test(p.gameStatusText) ? 'finalizado' : /postpon/i.test(p.gameStatusText) || p.postponedStatus === 'Y' ? 'aplazado' : p.gameStatus === 2 ? 'en_juego' : p.gameStatus === 1 ? 'programado' : 'por_confirmar'
    const utc = p.gameDateTimeUTC
    const hora = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(utc ?? '') && Number.isFinite(Date.parse(utc)) && !/TBD/i.test(p.gameStatusText)
    if (['finalizado', 'en_juego'].includes(estado) && (!hora || Date.parse(utc) > ahora || !entero(p.homeTeam.score) || !entero(p.awayTeam.score))) throw Error('Resultado WNBA sin confirmar')
    const resultado = ['finalizado', 'en_juego'].includes(estado) && entero(p.homeTeam.score) && entero(p.awayTeam.score) ? { local: p.homeTeam.score, visitante: p.awayTeam.score } : undefined
    return { id: 'wnba-' + p.gameId, nombre: local + ' · ' + visitante, local, visitante, estado,
      ...(hora && !['aplazado', 'cancelado'].includes(estado) ? { inicio: utc } : {}), ...(resultado ? { resultado } : {}),
      jornada: ({ Preseason: 'Pretemporada', 'Regular Season': 'Temporada regular', 'Comm Cup': 'Commissioner’s Cup', 'All-Star': 'All-Star', Playoffs: 'Playoffs' }[p.seasonType] ?? texto(p.seasonType)), fuenteUrl: WEB + '/game/' + p.gameId }
  })
  if (!eventos.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Calendario WNBA vacío o duplicado')
  return eventos
}
export async function obtieneWnba(opciones = {}) {
  const incidencias = [], consultado = new Date(opciones.ahora ?? Date.now()).toISOString()
  const incidencia = (nombre, url, error) => incidencias.push({ id: 'wnba', deporte: 'baloncesto', nombre, fuenteUrl: url, motivo: error.message })
  let contexto
  try { contexto = descubreTemporadaWnba(await leerFuenteDeportiva(WEB + '/schedule', opciones)) }
  catch (e) { incidencia('WNBA', WEB + '/schedule', e); return { competiciones: [], incidencias } }
  const urlAgenda = WEB + '/api/schedule?season=' + contexto.temporada + '&regionId=1'
  const respuestas = await Promise.allSettled([leerFuenteDeportiva(urlAgenda, opciones).then(h => normalizaCalendarioWnba(JSON.parse(h), contexto.temporada, opciones.ahora)), leerFuenteDeportiva(WEB + '/standings', opciones).then(h => normalizaTablaWnba(h, contexto))])
  const bloque = (r, clave, url, aviso) => ({ estado: r.status === 'fulfilled' ? 'actualizado' : 'no_disponible', consultado, ...(r.status === 'fulfilled' ? { verificadoEn: consultado } : {}), fuenteUrl: url, aviso, [clave]: r.status === 'fulfilled' ? r.value : [] })
  respuestas.forEach((r, i) => { if (r.status === 'rejected') incidencia('WNBA · ' + (i ? 'Clasificación' : 'Calendario'), i ? WEB + '/standings' : urlAgenda, r.reason) })
  return { competiciones: [{ id: 'wnba', deporte: 'baloncesto', nombre: 'WNBA', temporada: contexto.temporada, categoria: 'WNBA', genero: 'femenino', zona: 'Estados Unidos y Canadá', fuente: { nombre: 'WNBA', url: WEB + '/schedule' }, comprobadoEn: consultado,
    agenda: bloque(respuestas[0], 'eventos', WEB + '/schedule', 'Calendario oficial con las fases identificadas. Las emisiones en España todavía no están confirmadas.'),
    clasificacion: bloque(respuestas[1], 'tablas', WEB + '/standings', 'Clasificación de la temporada regular; los playoffs se muestran en los resultados.') }], incidencias }
}
