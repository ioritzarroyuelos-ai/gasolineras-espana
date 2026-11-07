import { parse } from 'node-html-parser'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'

const API = 'https://api-live.euroleague.net'
const FIBA = 'https://www.fiba.basketball'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const entero = v => Number.isInteger(v) && v >= 0
const sello = o => new Date(o.ahora ?? Date.now()).toISOString()
const columnas = [{ clave: 'pj', nombre: 'Jugados' }, { clave: 'pg', nombre: 'Ganados' }, { clave: 'pp', nombre: 'Perdidos' }, { clave: 'pf', nombre: 'A favor' }, { clave: 'pc', nombre: 'En contra' }]
const bloque = (fuenteUrl, consultado, campo, datos, aviso) => ({ estado: datos?.length ? 'actualizado' : 'no_disponible', consultado, ...(datos?.length ? { verificadoEn: consultado } : {}), fuenteUrl, [campo]: datos || [], ...(aviso ? { aviso } : {}) })
function puntos(a, b) {
  if (!entero(a) || !entero(b) || a > 1000 || b > 1000) throw Error('Marcador europeo incompleto')
  return { local: a, visitante: b }
}
function fechaUtc(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(v) || !fechaDeportiva(v.slice(0, 10))) return null
  const ms = Date.parse(v.endsWith('Z') ? v : v + 'Z')
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
function filaTabla(posicion, nombre, pj, pg, pp, pf, pc) {
  if (!Number.isInteger(posicion) || posicion < 1 || !nombre || ![pj, pg, pp, pf, pc].every(entero) || pg + pp !== pj) throw Error('Clasificación europea incompleta')
  return { posicion, nombre, valores: { pj, pg, pp, pf, pc } }
}
function validaFilas(filas) {
  if (!filas.length || new Set(filas.map(f => f.posicion)).size !== filas.length || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Clasificación europea vacía o duplicada')
  return filas.sort((a, b) => a.posicion - b.posicion)
}

export function temporadaEuro(datos, codigo, ahora = Date.now()) {
  if (!Array.isArray(datos?.data) || datos.total !== datos.data.length) throw Error('Catálogo de temporadas europeo incompleto')
  const hoy = new Date(ahora).toISOString().slice(0, 10)
  const s = datos.data.filter(s => s.competitionCode === codigo && new RegExp('^' + codigo + '\\d{4}$').test(s.code) && /^\d{4}-\d{2}$/.test(s.alias) && s.startDate?.slice(0, 10) <= hoy).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  if (!s || s.alias.slice(0, 4) !== String(s.year) || s.code !== codigo + s.year) throw Error('Temporada europea sin confirmar')
  return s
}
export function calendarioEuro(datos, temporada, fuenteUrl, ahora = Date.now()) {
  if (!Array.isArray(datos?.data) || !datos.data.length || datos.total !== datos.data.length) throw Error('Calendario europeo incompleto')
  const ids = new Set()
  return datos.data.map(p => {
    if (p.season?.code !== temporada.code || p.season?.competitionCode !== temporada.competitionCode || p.season?.alias !== temporada.alias || !Number.isInteger(p.gameCode) || ids.has(p.gameCode)) throw Error('Partido europeo de otra temporada o duplicado')
    ids.add(p.gameCode)
    const local = limpia(p.local?.club?.name), visitante = limpia(p.road?.club?.name)
    if (!local || !visitante || typeof p.played !== 'boolean') throw Error('Partido europeo sin equipos o estado')
    const estado = /cancel/i.test(p.gameStatus) ? 'cancelado' : /postpon|suspend/i.test(p.gameStatus) ? 'aplazado' : p.played ? 'finalizado' : p.confirmedDate && p.confirmedHour ? 'programado' : 'por_confirmar'
    const inicio = !['cancelado', 'aplazado'].includes(estado) && p.confirmedDate && p.confirmedHour ? fechaUtc(p.utcDate) : null
    if (p.confirmedDate && p.confirmedHour && !inicio && !['cancelado', 'aplazado'].includes(estado)) throw Error('Hora europea no verificable')
    const fecha = p.confirmedDate && fechaDeportiva(p.localDate?.slice(0, 10)) ? p.localDate.slice(0, 10) : null
    if (estado === 'finalizado' && (inicio ? Date.parse(inicio) > ahora : fecha && fecha > new Date(ahora).toISOString().slice(0, 10))) throw Error('Resultado europeo con fecha futura')
    return { id: 'euro-' + temporada.code.toLowerCase() + '-' + p.gameCode, nombre: `${local} – ${visitante}`, local, visitante, estado, ...(inicio ? { inicio } : fecha && !['cancelado', 'aplazado'].includes(estado) ? { fecha } : {}), ...(estado === 'finalizado' ? { resultado: puntos(p.local.score, p.road.score) } : {}), jornada: `${p.group?.rawName && p.group.rawName !== 'Regular Season' ? 'Grupo ' + limpia(p.group.rawName) + ' · ' : ''}Jornada ${p.round}`, fuenteUrl, ...(limpia(p.venue?.name) ? { lugar: limpia(p.venue.name) } : {}), ...(!inicio && estado !== 'finalizado' ? { detalle: 'Fecha u hora pendiente de confirmar por la competición.' } : {}) }
  })
}
export function clasificacionEuro(datos, calendario) {
  if (!Array.isArray(datos?.teams) || !datos.teams.length) throw Error('Clasificación europea no publicada')
  const clubes = new Set(calendario.data.filter(p => p.phaseType?.code === 'RS').flatMap(p => [p.local?.club?.code, p.road?.club?.code]))
  const recibidos = new Set(datos.teams.map(p => p.club?.code))
  if (recibidos.size !== datos.teams.length || recibidos.size !== clubes.size || [...recibidos].some(c => !clubes.has(c))) throw Error('Faltan equipos o se ha recibido otra clasificación europea')
  const grupos = new Map()
  for (const t of datos.teams) {
    const grupo = limpia(t.groupName)
    if (!grupo) throw Error('Clasificación europea sin grupo')
    if (!grupos.has(grupo)) grupos.set(grupo, [])
    grupos.get(grupo).push(filaTabla(t.position, limpia(t.club.name), t.gamesPlayed, t.gamesWon, t.gamesLost, t.pointsFor, t.pointsAgainst))
  }
  return [...grupos].map(([nombre, filas], i) => ({ id: 'grupo-' + i, nombre: nombre === 'Regular Season' ? 'Temporada regular' : 'Grupo ' + nombre, columnas, filas: validaFilas(filas) }))
}

// React publica objetos JSON. Se leen datos, sin ejecutar los scripts de la web.
export function objetosFiba(html) {
  const doc = parse(html)
  const partes = doc.querySelectorAll('script').flatMap(n => {
    const m = n.rawText.match(/^self\.__next_f\.push\(([\s\S]*)\)$/)
    if (!m) return []
    try { const d = JSON.parse(m[1]); return d[0] === 1 && typeof d[1] === 'string' ? [d[1]] : [] } catch { return [] }
  })
  const objetos = partes.join('').split('\n').flatMap(f => { try { return [JSON.parse(f.slice(f.indexOf(':') + 1))] } catch { return [] } })
  const salida = []
  let visitados = 0
  function visita(o, profundidad = 0) {
    if (!o || typeof o !== 'object') return
    if (++visitados > 200000 || profundidad > 80) throw Error('Página FIBA demasiado compleja')
    if (!Array.isArray(o)) salida.push(o)
    for (const [k, v] of Object.entries(o)) if (k !== 'dico') visita(v, profundidad + 1)
  }
  objetos.forEach(o => visita(o))
  return { doc, objetos: salida }
}
export function paginaFiba(html, codigo) {
  const { objetos } = objetosFiba(html)
  const evento = objetos.find(o => o.fibaCompetitionCode === codigo && o.fibaSourceDatas?.competitionCode === codigo)
  const meta = evento?.fibaSourceDatas
  if (!meta || !Number.isInteger(meta.competitionId) || !fechaDeportiva(meta.start) || !fechaDeportiva(meta.end) || !Number.isInteger(meta.season) || Number(meta.end.slice(0, 4)) !== meta.season) throw Error('Identidad o temporada FIBA no verificable')
  const listas = objetos.filter(o => Array.isArray(o.games) && o.games.some(g => g?.competition?.competitionId === meta.competitionId)).map(o => o.games)
  const partidos = listas.sort((a, b) => b.length - a.length)[0]
  const fases = objetos.find(o => Array.isArray(o.items) && o.items.some(f => f.standingHeaderCode && Array.isArray(f.roundIds)))?.items
  if (!partidos?.length || !Array.isArray(fases)) throw Error('FIBA no publica su calendario o fases completos')
  const temporada = meta.start.slice(0, 4) === meta.end.slice(0, 4) ? meta.end.slice(0, 4) : meta.start.slice(0, 4) + '-' + meta.end.slice(2, 4)
  return { meta, temporada, partidos, fases, evento }
}
export function calendarioFiba(pagina, fuenteUrl, ahora = Date.now()) {
  const ids = new Set()
  return pagina.partidos.map(p => {
    if (p.competition?.competitionId !== pagina.meta.competitionId || p.competition?.season !== pagina.meta.season || p.competition?.competitionCode !== pagina.meta.competitionCode || !Number.isInteger(p.gameId) || ids.has(p.gameId)) throw Error('FIBA mezcla competiciones o duplica partidos')
    ids.add(p.gameId)
    const local = limpia(p.teamA?.shortName || p.teamA?.officialName), visitante = limpia(p.teamB?.shortName || p.teamB?.officialName)
    // FIBA usa el año 0001 como valor vacío en eliminatorias aún sin fecha.
    const fecha = !p.gameDateTime?.startsWith('0001-') && fechaDeportiva(p.gameDateTime?.slice(0, 10)) ? p.gameDateTime.slice(0, 10) : null
    const inicio = p.hasTimeGameDateTime === true && !p.isPostponed ? fechaUtc(p.gameDateTimeUTC) : null
    if (p.hasTimeGameDateTime && !p.isPostponed && !inicio) throw Error('Hora UTC de FIBA incompleta')
    if (fecha && (fecha < pagina.meta.start || fecha > pagina.meta.end)) throw Error('Partido FIBA fuera de la edición publicada')
    const final = p.liveGameStatus === 999 && p.gameResultStatusCode === 'VALID' && p.isLive === false
    const estado = /CANCEL/i.test(p.statusCode) ? 'cancelado' : p.isPostponed ? 'aplazado' : final ? 'finalizado' : p.isLive === true ? 'en_juego' : local && visitante && inicio && Date.parse(inicio) > ahora ? 'programado' : 'por_confirmar'
    if (['finalizado', 'en_juego'].includes(estado) && (!local || !visitante || (inicio ? Date.parse(inicio) > ahora : fecha && fecha > new Date(ahora).toISOString().slice(0, 10)))) throw Error('Marcador FIBA sin equipos o con fecha futura')
    const fase = limpia(p.round?.roundName)
    const grupo = limpia(p.groupPairingCode)
    return { id: 'fiba-' + pagina.meta.competitionId + '-' + p.gameId, nombre: local && visitante ? `${local} – ${visitante}` : `${fase || 'Partido'} · Equipos por confirmar`, ...(local && visitante ? { local, visitante } : {}), estado, ...(inicio && !['aplazado', 'cancelado'].includes(estado) ? { inicio } : fecha && !['aplazado', 'cancelado'].includes(estado) ? { fecha } : {}), ...(['finalizado', 'en_juego'].includes(estado) ? { resultado: puntos(p.teamAScore, p.teamBScore) } : {}), jornada: fase + (grupo ? ' · Grupo ' + grupo : ''), fuenteUrl, ...(limpia(p.venueName) ? { lugar: limpia(p.venueName) } : {}), ...(!inicio ? { detalle: 'Hora pendiente de confirmar por FIBA.' } : {}) }
  })
}
export function clasificacionFiba(pagina) {
  const equipos = new Map(pagina.partidos.flatMap(p => [p.teamA, p.teamB]).filter(t => t?.teamId && (t.shortName || t.officialName)).map(t => [t.teamId, limpia(t.shortName || t.officialName)]))
  const tablas = []
  for (const fase of pagina.fases) {
    if (!Array.isArray(fase.data?.groups)) continue // Las eliminatorias se reflejan mediante sus partidos.
    for (const grupo of fase.data.groups) {
      const datos = grupo.teamsStats
      if (!Array.isArray(datos) || !datos.length || datos.every(d => !Number.isInteger(d.team))) continue // Fases futuras sin participantes.
      if (datos.some(d => !equipos.has(d.team))) throw Error('FIBA no identifica todos los equipos de la clasificación')
      const filas = datos.map(d => filaTabla(d.rank, equipos.get(d.team), d.gamesPlayed, d.gamesWon, d.gamesLost, d.pointsFor, d.pointsAgainst))
      tablas.push({ id: 'grupo-' + tablas.length, nombre: limpia(fase.standingHeaderName) + ' · Grupo ' + limpia(grupo.groupName), columnas, filas: validaFilas(filas) })
    }
  }
  return tablas
}

export async function obtieneBaloncestoEuropa(opciones = {}) {
  const ahora = opciones.ahora ?? Date.now(), consultado = sello(opciones), competiciones = [], incidencias = [], limitados = new Set()
  const lee = async url => {
    const host = new URL(url).hostname
    if (limitados.has(host)) throw Error('La fuente ha limitado las consultas; se detiene esta actualización')
    try { return await leerFuenteDeportiva(url, opciones) } catch (e) { if (/HTTP 429\b/.test(e.message)) limitados.add(host); throw e }
  }
  const fallo = (id, nombre, fuenteUrl, e) => incidencias.push({ deporte: 'baloncesto', id, nombre, fuenteUrl, motivo: e.message })
  for (const [codigo, id, nombre, ruta] of [['E', 'euroliga', 'Euroliga', 'euroleague'], ['U', 'eurocup', 'EuroCup', 'eurocup']]) {
    const url = `https://www.euroleaguebasketball.net/en/${ruta}/game-center/`
    try {
      const temporada = temporadaEuro(JSON.parse(await lee(`${API}/v2/competitions/${codigo}/seasons`)), codigo, ahora)
      let datos, eventos, tablas
      try { datos = JSON.parse(await lee(`${API}/v2/competitions/${codigo}/seasons/${temporada.code}/games`)); eventos = calendarioEuro(datos, temporada, url, ahora) } catch (e) { fallo(id, nombre, url, e) }
      if (datos) try {
        const ultima = Math.max(...datos.data.filter(g => g.played && g.phaseType?.code === 'RS').map(g => g.round))
        if (!Number.isInteger(ultima) || ultima < 1) throw Error('Todavía no hay jornada disputada con clasificación')
        tablas = clasificacionEuro(JSON.parse(await lee(`${API}/v3/competitions/${codigo}/seasons/${temporada.code}/rounds/${ultima}/basicstandings`)), datos)
      } catch (e) { fallo(id, nombre, url, e) }
      competiciones.push({ id, deporte: 'baloncesto', nombre, temporada: temporada.alias, categoria: 'Clubes europeos', genero: 'masculino', zona: 'Europa', fuente: { nombre: 'Euroleague Basketball', url }, comprobadoEn: consultado, agenda: bloque(url, consultado, 'eventos', eventos), clasificacion: bloque(`https://www.euroleaguebasketball.net/en/${ruta}/standings/`, consultado, 'tablas', tablas) })
    } catch (e) { fallo(id, nombre, url, e) }
  }
  const fiba = [
    { id: 'basket-champions-league', codigo: 'BCL', nombre: 'Basketball Champions League', url: 'https://www.championsleague.basketball/en' },
    { id: 'euroliga-femenina', codigo: 'ELW', nombre: 'Euroliga femenina', slug: 'euroleague-women-' },
    { id: 'eurocup-femenina', codigo: 'ECW', nombre: 'EuroCup femenina', slug: 'eurocup-women-' },
    { id: 'fiba-europe-cup', codigo: 'ECM2', nombre: 'FIBA Europe Cup', slug: 'fiba-europe-cup-' },
  ]
  let catalogo
  try { catalogo = parse(await lee(FIBA + '/en/events')) } catch (e) { fallo('fiba-catalogo', 'Catálogo de competiciones FIBA', FIBA + '/en/events', e) }
  for (const config of fiba) {
    let url = config.url
    if (!url && catalogo) url = [...new Set(catalogo.querySelectorAll('a[href]').map(n => n.getAttribute('href')).filter(h => h.startsWith(FIBA + '/en/events/' + config.slug) && /-\d{2}-\d{2}$/.test(h)))].sort().at(-1)
    if (!url) { fallo(config.id, config.nombre, FIBA + '/en/events', Error('La competición no aparece en el catálogo público actual')); continue }
    try {
      const pagina = paginaFiba(await lee(url), config.codigo)
      let eventos, tablas
      try { eventos = calendarioFiba(pagina, url + '/games', ahora) } catch (e) { fallo(config.id, config.nombre, url + '/games', e) }
      try { tablas = clasificacionFiba(pagina) } catch (e) { fallo(config.id, config.nombre, url + '/standings', e) }
      competiciones.push({ id: config.id, deporte: 'baloncesto', nombre: config.nombre, temporada: pagina.temporada, categoria: 'Clubes europeos', genero: pagina.meta.gender === 'Women' ? 'femenino' : 'masculino', zona: 'Europa', fuente: { nombre: 'FIBA', url }, comprobadoEn: consultado, agenda: bloque(url + '/games', consultado, 'eventos', eventos), clasificacion: bloque(url + '/standings', consultado, 'tablas', tablas) })
    } catch (e) { fallo(config.id, config.nombre, url, e) }
  }
  return { competiciones, incidencias }
}
