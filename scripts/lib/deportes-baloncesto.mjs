import { parse } from 'node-html-parser'
import { leerFuenteDeportiva, validaUrlDeportiva, fechaDeportiva } from './deportes.mjs'
import { obtieneBaloncestoTerritorial } from './deportes-baloncesto-territorial.mjs'
import { obtieneBaloncestoEuropa } from './deportes-baloncesto-europa.mjs'
import { obtieneWnba } from './deportes-baloncesto-wnba.mjs'
import { obtieneBaloncestoBizkaia } from './deportes-baloncesto-bizkaia.mjs'
import { obtieneBaloncestoFbcyl } from './deportes-baloncesto-fbcyl.mjs'
import { obtieneBaloncestoFbcv, obtieneBaloncestoOtrasOW } from './deportes-baloncesto-fbcv.mjs'
import { obtieneBaloncestoAlava } from './deportes-baloncesto-alava.mjs'
import { obtieneBaloncestoGesdeportiva } from './deportes-baloncesto-gesdeportiva.mjs'
import { obtieneBaloncestoAragon } from './deportes-baloncesto-aragon.mjs'
import { obtieneBaloncestoGalicia } from './deportes-baloncesto-galicia.mjs'

const FEB = 'https://beta.competiciones.feb.es'
const ACB = 'https://acb.com'
const NBA = 'https://www.nba.com'
const NBA_LEAGUE_PASS_ESPANA = 'https://www.primevideo.com/help?nodeId=TsnKYpbmX4KgCuogDS'
const limpio = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const esEntero = v => Number.isInteger(v) && v >= 0
const canalesEspana = new Set(['dazn.com', 'movistarplus.es', 'orange.es', 'vodafone.es', '3cat.cat', 'agalega.gal', 'aragonplay.es', 'eitb.eus', 'etbon.eus'])
function canalEspana(url) {
  if (!validaUrlDeportiva(url)) return false
  const u = new URL(url), h = u.hostname.replace(/^www\./, '')
  const esDazn = h === 'dazn.com' || h.endsWith('.dazn.com')
  return [...canalesEspana].some(d => h === d || h.endsWith('.' + d)) && (!esDazn || /^\/es-ES(?:\/|$)/i.test(u.pathname))
}
const fechaConsulta = opciones => new Date(opciones.ahora ?? Date.now()).toISOString()
const columnas = [{ clave: 'pj', nombre: 'Jugados' }, { clave: 'pg', nombre: 'Ganados' }, { clave: 'pp', nombre: 'Perdidos' }, { clave: 'pf', nombre: 'A favor' }, { clave: 'pc', nombre: 'En contra' }]
const incidencia = (nombre, fuenteUrl, motivo, id) => ({ deporte: 'baloncesto', nombre, fuenteUrl, motivo, ...(id ? { id } : {}) })
function bloque(url, fecha, contenido, clave, aviso) {
  return { estado: contenido ? 'actualizado' : 'no_disponible', consultado: fecha, ...(contenido ? { verificadoEn: fecha } : {}), fuenteUrl: url, ...(aviso ? { aviso } : {}), [clave]: contenido ?? [] }
}
function base(id, nombre, temporada, fuente, fecha, extra = {}) {
  return { id, deporte: 'baloncesto', nombre, temporada, categoria: nombre, zona: 'España', fuente, comprobadoEn: fecha, ...extra }
}
function puntuacion(a, b, estado) {
  if (!['finalizado', 'en_juego'].includes(estado)) return undefined
  const x = typeof a === 'string' && /^\d+$/.test(a) ? Number(a) : a
  const y = typeof b === 'string' && /^\d+$/.test(b) ? Number(b) : b
  if (!esEntero(x) || !esEntero(y) || x > 1000 || y > 1000) throw Error('Marcador incompleto')
  return { local: x, visitante: y }
}
function fechaCorta(v) {
  const m = limpio(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  const f = m ? m[3] + '-' + m[2] + '-' + m[1] : null
  if (!fechaDeportiva(f)) throw Error('Fecha de partido no válida')
  return f
}

/** Lee únicamente datos literales de TanStack. Nunca ejecuta código de la fuente. */
export function leerLiteralFeb(src, inicio = 0) {
  let i = inicio, nodos = 0
  const refs = new Map()
  const espacio = () => { while (i < src.length && /\s/.test(src[i])) i++ }
  function leer(profundidad = 0) {
    if (++nodos > 100000 || profundidad > 80) throw Error('Datos FEB demasiado complejos')
    espacio()
    let m = src.slice(i).match(/^\$R\[(\d+)\]/)
    if (m) {
      i += m[0].length; espacio()
      if (src[i] === '=') { i++; const v = leer(profundidad + 1); refs.set(m[1], v); return v }
      if (!refs.has(m[1])) throw Error('Referencia FEB incompleta')
      return refs.get(m[1])
    }
    if (src[i] === '"') {
      const inicioCadena = i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i++] === '"') return JSON.parse(src.slice(inicioCadena, i).replace(/[\u0000-\u001f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')))
      }
      throw Error('Cadena FEB incompleta')
    }
    if (src[i] === '{' || src[i] === '[') {
      const objeto = src[i++] === '{', valor = objeto ? {} : [], fin = objeto ? '}' : ']'
      espacio()
      while (src[i] !== fin) {
        if (objeto) {
          let clave
          if (src[i] === '"') clave = leer(profundidad + 1)
          else { m = src.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/); if (!m) throw Error('Clave FEB no válida'); clave = m[0]; i += clave.length }
          if (['__proto__', 'constructor', 'prototype'].includes(clave)) throw Error('Clave FEB no permitida')
          espacio(); if (src[i++] !== ':') throw Error('Objeto FEB incompleto')
          valor[clave] = leer(profundidad + 1)
        } else valor.push(leer(profundidad + 1))
        espacio(); if (src[i] === fin) break
        if (src[i++] !== ',') throw Error('Lista FEB incompleta')
        espacio()
      }
      i++; return valor
    }
    for (const [token, valor] of [['!0', true], ['!1', false], ['null', null], ['void 0', null], ['undefined', null], ['true', true], ['false', false]]) {
      if (src.startsWith(token, i)) { i += token.length; return valor }
    }
    m = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)
    if (m) { i += m[0].length; const n = Number(m[0]); if (!Number.isFinite(n)) throw Error('Número FEB no válido'); return n }
    throw Error('La fuente FEB contiene un formato desconocido')
  }
  return leer()
}

export function datosPaginaFeb(html) {
  const doc = parse(html)
  const script = doc.querySelectorAll('script').map(n => n.rawText).find(s => s.startsWith('$_TSR.router='))
  if (!script || !script.includes('$R[0]=')) throw Error('La FEB no ha entregado los datos de la página')
  const datos = leerLiteralFeb(script, script.indexOf('$R[0]='))
  const edicion = datos.matches?.find(m => m.b?.edition)?.b.edition
  const consultas = datos.dehydratedData?.queries?.queries
  if (!edicion?.feb?.idCategoria || !/^\d{4}\/(?:\d{2}|\d{4})$/.test(edicion.seasonLabel) || !Array.isArray(consultas)) throw Error('La FEB no identifica la temporada')
  return { edicion, consultas, doc }
}

/** Subconjunto de la serialización pública: objetos, listas y valores simples. */
export function decodificaRespuestaFeb(valor) {
  const refs = new Map()
  let nodos = 0
  const escapes = { '\\\\': '\\', '\\"': '"', '\\n': '\n', '\\r': '\r', '\\b': '\b', '\\t': '\t', '\\f': '\f', '\\u2028': '\u2028', '\\u2029': '\u2029', '\\x3C': '<' }
  function leer(n, profundidad = 0) {
    if (++nodos > 100000 || profundidad > 50 || !n || typeof n !== 'object') throw Error('Respuesta FEB no válida')
    if (n.t === 0 && Number.isFinite(Number(n.s))) return Number(n.s)
    if (n.t === 1 && typeof n.s === 'string') return n.s.replace(/(\\\\|\\"|\\n|\\r|\\b|\\t|\\f|\\u2028|\\u2029|\\x3C)/g, s => escapes[s])
    if (n.t === 2 && [0, 1, 2, 3].includes(n.s)) return [null, undefined, true, false][n.s]
    if (n.t === 4 && refs.has(n.i)) return refs.get(n.i)
    if (n.t === 9 && Array.isArray(n.a)) { const a = []; refs.set(n.i, a); for (const v of n.a) a.push(leer(v, profundidad + 1)); return a }
    if ([10, 11].includes(n.t) && Array.isArray(n.p?.k) && n.p.k.length === n.p.v?.length) {
      const o = {}; refs.set(n.i, o)
      for (let j = 0; j < n.p.k.length; j++) { const k = n.p.k[j]; if (typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k)) throw Error('Clave FEB no permitida'); o[k] = leer(n.p.v[j], profundidad + 1) }
      return o
    }
    throw Error('La FEB no pudo completar la consulta')
  }
  const d = leer(valor)
  if (d.error || !Object.hasOwn(d, 'result')) throw Error('La FEB no pudo completar la consulta')
  return d.result
}
function codificaConsultaFeb(data) {
  let i = 0
  function cod(v) {
    if (typeof v === 'number') return { t: 0, s: v }
    if (typeof v === 'string') return { t: 1, s: v }
    if (Array.isArray(v)) return { t: 9, i: i++, a: v.map(cod), o: 0 }
    return { t: 10, i: i++, p: { k: Object.keys(v), v: Object.values(v).map(cod) }, o: 0 }
  }
  return JSON.stringify({ t: cod({ data }), f: 127, m: [] })
}
export function codigoFuncion(texto, simbolo) {
  const seguro = simbolo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...texto.matchAll(new RegExp(seguro + '=.{0,100}?\\.handler\\([^\x60]*\x60([a-f0-9]{64})\x60\\)\\)', 'g'))].at(-1)?.[1]
}
async function funcionesFeb(doc, opciones) {
  const entrada = doc.querySelectorAll('script[src]').map(n => n.getAttribute('src')).find(u => /^\/assets\/index-[\w-]+\.js$/.test(u))
  if (!entrada) throw Error('No se encuentra el calendario público FEB')
  const js = await leerFuenteDeportiva(FEB + entrada, opciones)
  const simboloAgenda = js.match(/queryKey:\[\x60feb\x60,\x60partidos-page\x60,[\s\S]{0,160}?queryFn:[\s\S]{0,90}?=>([A-Za-z_$][\w$]*)\(\{signal:/)?.[1]
  const agenda = simboloAgenda && codigoFuncion(js, simboloAgenda)
  const simboloTabla = js.match(/queryKey:\[\x60feb\x60,\x60clasificacion-final\x60,[\s\S]{0,120}?queryFn:[\s\S]{0,90}?=>([A-Za-z_$][\w$]*)\(\{signal:/)?.[1]
  let tabla = simboloTabla && codigoFuncion(js, simboloTabla)
  if (!tabla && simboloTabla) {
    const imp = [...js.matchAll(/import\{([^}]+)\}from"(\.\/feb\.functions-[\w-]+\.js)"/g)].find(m => m[1].includes(' as ' + simboloTabla))
    const alias = imp?.[1].split(',').find(s => s.endsWith(' as ' + simboloTabla))?.split(' as ')[0]
    if (imp && alias) {
      const mod = await leerFuenteDeportiva(FEB + '/assets/' + imp[2].slice(2), opciones)
      const local = mod.match(/export\{([^}]+)\}/)?.[1].split(',').find(s => s.endsWith(' as ' + alias))?.split(' as ')[0]
      tabla = local && codigoFuncion(mod, local)
    }
  }
  if (!agenda || !tabla) throw Error('La FEB ha cambiado el formato de las consultas')
  return { agenda, tabla }
}
async function consultaFeb(hash, data, opciones) {
  const url = FEB + '/_serverFn/' + hash + '?payload=' + encodeURIComponent(codificaConsultaFeb(data))
  return decodificaRespuestaFeb(JSON.parse(await leerFuenteDeportiva(url, opciones)))
}
export function normalizaPartidosFeb(partidos, fuenteUrl) {
  if (!Array.isArray(partidos)) throw Error('Calendario FEB incompleto')
  const ids = new Set()
  return partidos.map(p => {
    if (!Number.isInteger(p.idPartido) || ids.has(p.idPartido) || !limpio(p.teamA?.name) || !limpio(p.teamB?.name)) throw Error('Partido FEB incompleto o duplicado')
    ids.add(p.idPartido)
    const estados = { upcoming: 'programado', final: 'finalizado', live: 'en_juego', postponed: 'aplazado', cancelled: 'cancelado' }
    const estado = estados[p.state] ?? 'por_confirmar'
    const fecha = fechaCorta(p.fecha)
    const hora = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.hora ?? '') ? p.hora : ''
    const resultado = puntuacion(p.teamA.score, p.teamB.score, estado)
    return { id: 'feb-' + p.idPartido, nombre: limpio(p.teamA.name) + ' · ' + limpio(p.teamB.name), local: limpio(p.teamA.name), visitante: limpio(p.teamB.name),
      fecha, estado, ...(resultado ? { resultado } : {}),
      ...(limpio(p.matchday) ? { jornada: limpio(p.matchday) } : {}), ...(limpio(p.venue) ? { lugar: limpio(p.venue) } : {}),
      ...(hora ? { detalle: hora + ' · Hora publicada por la FEB; zona horaria sin confirmar.' } : {}), fuenteUrl }
  })
}
export function normalizaTablaFeb(datos, id, nombre) {
  if (!Array.isArray(datos?.rows) || !datos.rows.length) throw Error('Clasificación FEB vacía')
  const filas = datos.rows.map(r => {
    if (!Number.isInteger(r.posicion) || r.posicion < 1 || !limpio(r.nombreEquipo) || !['pj', 'pg', 'pp', 'pf', 'pc'].every(k => esEntero(r[k])) || r.pj !== r.pg + r.pp) throw Error('Clasificación FEB incompleta')
    return { posicion: r.posicion, nombre: limpio(r.nombreEquipo), valores: Object.fromEntries(columnas.map(c => [c.clave, r[c.clave]])) }
  })
  if (new Set(filas.map(f => f.posicion)).size !== filas.length || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Clasificación FEB duplicada')
  return { id, nombre, columnas, filas }
}

/** Extrae el bloque de datos de Next sin evaluar scripts ni resolver código. */
export function datosPaginaAcb(html) {
  const partes = []
  for (const n of parse(html).querySelectorAll('script')) {
    const m = n.rawText.match(/^self\.__next_f\.push\((.*)\)$/s)
    if (m) { const a = JSON.parse(m[1]); if (a[0] === 1 && typeof a[1] === 'string') partes.push(a[1]) }
  }
  const linea = partes.join('').split('\n').find(s => s.includes('"data":{"availableFilters"'))
  if (!linea) throw Error('La ACB no ha entregado los datos')
  const registro = linea.slice(0, linea.indexOf(':')), valor = JSON.parse(linea.slice(linea.indexOf(':') + 1)), data = valor?.[3]?.data
  if (!data?.selectedFilters || !Array.isArray(data.availableFilters?.seasons)) throw Error('Datos ACB incompletos')
  function resuelve(v) {
    if (typeof v !== 'string') return v
    const prefijo = '$' + registro + ':props:data:'
    if (!v.startsWith(prefijo)) throw Error('Referencia ACB desconocida')
    let n = data
    for (const k of v.slice(prefijo.length).split(':')) { if (!/^\w+$/.test(k) || ['constructor', 'prototype', '__proto__'].includes(k) || !Object.hasOwn(n ?? {}, k)) throw Error('Referencia ACB incompleta'); n = n[k] }
    if (!n || typeof n !== 'object') throw Error('Referencia ACB incompleta')
    return n
  }
  const temporada = data.availableFilters.seasons.find(s => s.id === data.selectedFilters.season)?.displayName
  if (!/^\d{4}-\d{2}$/.test(temporada ?? '')) throw Error('Temporada ACB desconocida')
  return { data, resuelve, temporada }
}
export function normalizaCalendarioAcb(html, fuenteUrl, verificadoEn) {
  const { data, resuelve, temporada } = datosPaginaAcb(html)
  if (!Array.isArray(data.rounds) || !data.rounds.length) throw Error('Calendario ACB vacío')
  const ids = new Set()
  const eventos = data.rounds.flatMap(r => {
    if (!Array.isArray(r.matches)) throw Error('Jornada ACB incompleta')
    return r.matches.map(p => {
      const local = limpio(resuelve(p.homeTeam)?.fullName), visitante = limpio(resuelve(p.awayTeam)?.fullName)
      if (!local || !visitante || !Number.isInteger(p.id) || ids.has(p.id)) throw Error('Partido ACB incompleto o duplicado')
      ids.add(p.id)
      const estados = { NOT_STARTED: 'programado', SCHEDULED: 'programado', FINALIZED: 'finalizado', IN_PROGRESS: 'en_juego', LIVE: 'en_juego', POSTPONED: 'aplazado', CANCELLED: 'cancelado' }
      const estado = estados[p.matchStatus] ?? 'por_confirmar'
      const conHora = estado !== 'por_confirmar' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.startDateTime ?? '') && Number.isFinite(Date.parse(p.startDateTime))
      const emisiones = [...(p.broadcastChannels?.primary ?? []), ...(p.broadcastChannels?.secondary ?? [])].filter(c => !['aplazado', 'cancelado'].includes(estado) && limpio(c.name) && canalEspana(c.link))
        .map(c => ({ nombre: limpio(c.name), url: c.link, fuenteUrl, territorio: 'España', verificadoEn }))
      const resultado = puntuacion(p.homeTeamScore, p.awayTeamScore, estado)
      return { id: 'acb-' + p.id, nombre: local + ' · ' + visitante, local, visitante, estado, ...(conHora ? { inicio: p.startDateTime } : {}),
        ...(resultado ? { resultado } : {}), jornada: 'Jornada ' + r.roundNumber, fuenteUrl, emisiones: [...new Map(emisiones.map(e => [e.nombre, e])).values()],
        ...(estado === 'por_confirmar' ? { detalle: 'Fecha y hora pendientes de confirmar por la ACB.' } : {}) }
    })
  })
  return { eventos, temporada }
}
export function normalizaClasificacionAcb(html) {
  const { data, resuelve, temporada } = datosPaginaAcb(html)
  if (!Array.isArray(data.standings) || !data.standings.length) throw Error('Clasificación ACB vacía')
  const filas = data.standings.map(r => {
    const nombre = limpio(resuelve(r.team)?.fullName)
    if (!nombre || !Number.isInteger(r.position) || !['matchesPlayed', 'wins', 'losses', 'pointsFor', 'pointsAgainst'].every(k => esEntero(r[k])) || r.matchesPlayed !== r.wins + r.losses) throw Error('Clasificación ACB incompleta')
    return { posicion: r.position, nombre, valores: { pj: r.matchesPlayed, pg: r.wins, pp: r.losses, pf: r.pointsFor, pc: r.pointsAgainst } }
  })
  if (filas.length !== data.teams?.length || new Set(filas.map(f => f.posicion)).size !== filas.length) throw Error('Faltan equipos en la clasificación ACB')
  return { temporada, tablas: [{ id: 'liga-endesa', nombre: 'Liga Endesa', columnas, filas }] }
}
export function normalizaNba(html, fechaEsperada) {
  const contenido = parse(html).querySelector('#__NEXT_DATA__')?.rawText
  if (!contenido) throw Error('La NBA no ha entregado los partidos')
  const d = JSON.parse(contenido)?.props?.pageProps
  if (d?.hasError || !d?.gameCardFeed?.modules || (fechaEsperada && d.selectedDate !== fechaEsperada)) throw Error('La NBA no ha entregado la fecha solicitada')
  const partidos = d.gameCardFeed.modules.flatMap(m => m.cards ?? []).map(c => c.cardData).filter(c => c?.gameId && c?.leagueId === '00')
  const esperado = d.allGamesInCurrentYear?.[String(d.selectedDate).slice(0, 4)]?.[d.selectedDate]
  if (typeof esperado !== 'number' || partidos.length !== esperado) throw Error('El calendario NBA está incompleto')
  const temporadas = new Set(partidos.map(p => p.seasonYear))
  if (temporadas.size > 1) throw Error('La NBA mezcla temporadas')
  const eventos = partidos.map(p => {
    if (!limpio(p.homeTeam?.teamName) || !limpio(p.awayTeam?.teamName) || !/^\d{10}$/.test(p.gameId) || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(p.gameTimeUtc ?? '')) throw Error('Partido NBA incompleto')
    const estado = /postpon/i.test(p.gameStatusText) ? 'aplazado' : /cancel/i.test(p.gameStatusText) ? 'cancelado' : ({ 1: 'programado', 2: 'en_juego', 3: 'finalizado' }[p.gameStatus] ?? 'por_confirmar')
    const resultado = puntuacion(p.homeTeam.score, p.awayTeam.score, estado)
    const fuenteUrl = validaUrlDeportiva(p.shareUrl) && new URL(p.shareUrl).hostname === 'www.nba.com' ? p.shareUrl : NBA + '/games?date=' + d.selectedDate
    return { id: 'nba-' + p.gameId, nombre: p.homeTeam.teamName + ' · ' + p.awayTeam.teamName, local: p.homeTeam.teamName, visitante: p.awayTeam.teamName, inicio: p.gameTimeUtc, estado, ...(resultado ? { resultado } : {}), fuenteUrl }
  })
  if (new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('La NBA repite partidos')
  return { eventos, temporada: [...temporadas][0] }
}
export function normalizaClasificacionNba(datos, temporada) {
  if (!/^\d{4}-\d{2}$/.test(temporada) || datos?.parameters?.LeagueID !== '00' || datos.parameters.SeasonYear !== temporada || datos.parameters.SeasonType !== 'Regular Season') throw Error('La clasificación NBA pertenece a otra temporada o competición')
  const tabla = datos.resultSets?.find(t => t.name === 'Standings')
  const campos = ['LeagueID', 'SeasonID', 'TeamID', 'TeamCity', 'TeamName', 'Conference', 'PlayoffRank', 'WINS', 'LOSSES', 'TotalPoints', 'OppTotalPoints']
  if (!Array.isArray(tabla?.headers) || new Set(tabla.headers).size !== tabla.headers.length || campos.some(c => !tabla.headers.includes(c)) || !Array.isArray(tabla.rowSet) || tabla.rowSet.length !== 30) throw Error('La clasificación NBA está incompleta')
  const filas = tabla.rowSet.map(valores => {
    if (!Array.isArray(valores) || valores.length !== tabla.headers.length) throw Error('Fila de la clasificación NBA incompleta')
    const r = Object.fromEntries(tabla.headers.map((k, i) => [k, valores[i]]))
    if (r.LeagueID !== '00' || r.SeasonID !== '2' + temporada.slice(0, 4) || !esEntero(r.TeamID) || !limpio(r.TeamCity) || !limpio(r.TeamName) || !['East', 'West'].includes(r.Conference) || !Number.isInteger(r.PlayoffRank) || r.PlayoffRank < 1 || r.PlayoffRank > 15 || !['WINS', 'LOSSES', 'TotalPoints', 'OppTotalPoints'].every(k => esEntero(r[k]))) throw Error('Datos de la clasificación NBA incoherentes')
    return { id: r.TeamID, conferencia: r.Conference, fila: { posicion: r.PlayoffRank, nombre: limpio(r.TeamCity + ' ' + r.TeamName), nombreBusqueda: limpio(r.TeamName), valores: { pj: r.WINS + r.LOSSES, pg: r.WINS, pp: r.LOSSES, pf: r.TotalPoints, pc: r.OppTotalPoints } } }
  })
  if (new Set(filas.map(f => f.id)).size !== 30) throw Error('La clasificación NBA repite equipos')
  return [['East', 'Este'], ['West', 'Oeste']].map(([codigo, nombre]) => {
    const grupo = filas.filter(f => f.conferencia === codigo).map(f => f.fila).sort((a, b) => a.posicion - b.posicion)
    if (grupo.length !== 15 || new Set(grupo.map(f => f.posicion)).size !== 15) throw Error('Conferencia NBA incompleta')
    return { id: 'nba-' + codigo.toLowerCase(), nombre: 'Conferencia ' + nombre, columnas, filas: grupo }
  })
}
export function enlacesEquiposNba(html) {
  const d = parse(html), datos = JSON.parse(d.querySelector('#__NEXT_DATA__')?.rawText || 'null')
  if (datos?.page !== '/teams' || datos?.props?.pageProps?.hasError) throw Error('La NBA no ha entregado su directorio de equipos')
  const urls = [...new Set(d.querySelectorAll('a[href]').map(a => {
    try {
      const u = new URL(a.getAttribute('href'), NBA)
      return u.origin === NBA && !u.search && !u.hash && /^\/team\/\d{10}\/[a-z0-9-]+$/.test(u.pathname) ? u.href : null
    } catch { return null }
  }).filter(Boolean))]
  if (urls.length !== 30 || new Set(urls.map(u => new URL(u).pathname.split('/')[2])).size !== 30) throw Error('El directorio NBA no contiene 30 equipos distintos')
  return urls
}
export function normalizaClasificacionEquiposNba(paginas, temporada) {
  if (!/^20\d{2}-\d{2}$/.test(temporada) || !Array.isArray(paginas) || paginas.length !== 30) throw Error('Clasificación de fichas NBA incompleta o sin temporada')
  const equipos = paginas.map(p => {
    if (!validaUrlDeportiva(p.url) || new URL(p.url).origin !== NBA) throw Error('Ficha fuera de la web oficial NBA')
    const ruta = new URL(p.url), m = ruta.pathname.match(/^\/team\/(\d{10})\/([a-z0-9-]+)$/)
    const datos = JSON.parse(parse(p.html).querySelector('#__NEXT_DATA__')?.rawText || 'null'), t = datos?.props?.pageProps?.team, r = t?.info, liga = t?.ranks
    if (!m || ruta.search || ruta.hash || datos?.page !== '/team/[...props]' || datos?.props?.pageProps?.hasError ||
      t?.id !== m[1] || t?.slug !== m[2] || r?.TEAM_ID !== Number(m[1]) || r?.TEAM_SLUG !== m[2] || liga?.TEAM_ID !== Number(m[1])) throw Error('La ficha NBA pertenece a otro equipo')
    if (r.SEASON_YEAR !== temporada || t.scheduleSeason !== temporada || liga.LEAGUE_ID !== '00' || liga.SEASON_ID !== '2' + temporada.slice(0, 4)) throw Error('La ficha NBA pertenece a otra temporada o competición')
    if (!limpio(r.TEAM_CITY) || !limpio(r.TEAM_NAME) || !['East', 'West'].includes(r.TEAM_CONFERENCE) ||
      !Number.isInteger(r.CONF_RANK) || r.CONF_RANK < 1 || r.CONF_RANK > 15 || !esEntero(r.W) || !esEntero(r.L) || r.W + r.L > 100 ||
      !Number.isFinite(r.PCT) || r.PCT < 0 || r.PCT > 1 || Math.abs(r.PCT - (r.W + r.L ? r.W / (r.W + r.L) : 0)) > 0.001) throw Error('Posición o balance NBA incoherente')
    return { id: r.TEAM_ID, conferencia: r.TEAM_CONFERENCE, fila: { posicion: r.CONF_RANK, nombre: limpio(r.TEAM_CITY + ' ' + r.TEAM_NAME), nombreBusqueda: limpio(r.TEAM_NAME), valores: { pj: r.W + r.L, pg: r.W, pp: r.L } } }
  })
  if (new Set(equipos.map(e => e.id)).size !== 30) throw Error('La clasificación NBA repite equipos')
  if (equipos.reduce((n, e) => n + e.fila.valores.pg, 0) !== equipos.reduce((n, e) => n + e.fila.valores.pp, 0)) throw Error('Los balances NBA de las 30 fichas no coinciden entre sí')
  return [['East', 'Este'], ['West', 'Oeste']].map(([codigo, nombre]) => {
    const filas = equipos.filter(e => e.conferencia === codigo).map(e => e.fila).sort((a, b) => a.posicion - b.posicion)
    if (filas.length !== 15 || new Set(filas.map(f => f.posicion)).size !== 15) throw Error('Conferencia NBA incompleta o con posiciones repetidas')
    return { id: 'nba-' + codigo.toLowerCase(), nombre: 'Conferencia ' + nombre, columnas: columnas.slice(0, 3), filas }
  })
}
export async function obtieneClasificacionEquiposNba(temporada, opciones = {}) {
  const urls = enlacesEquiposNba(await leerFuenteDeportiva(NBA + '/teams', opciones)), paginas = []
  let cursor = 0, fallo
  // Las fichas son una fuente pública distinta. Ante cualquier fallo se detienen
  // las nuevas lecturas y se descarta el conjunto parcial, también ante HTTP429.
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (!fallo && cursor < urls.length) {
      const url = urls[cursor++]
      try { paginas.push({ url, html: await leerFuenteDeportiva(url, opciones) }) }
      catch (e) { fallo ||= e }
    }
  }))
  if (fallo) throw fallo
  return normalizaClasificacionEquiposNba(paginas, temporada)
}
export function compruebaLeaguePassEspana(html) {
  const parrafos = parse(html).querySelectorAll('section p').map(p => limpio(p.text))
  // El distribuidor enumera España y afirma expresamente que incluye todos
  // los partidos. Una oferta global o los canales de EE. UU. no bastan.
  const paises = parrafos.find(p => p.startsWith('NBA League Pass is available for subscription in:'))
  return !!paises && /(?:[:,]|\band\b)\s*Spain\s*(?:[,.;]|$)/.test(paises) &&
    parrafos.some(p => p.startsWith('All NBA games are included in an NBA League Pass subscription.')) &&
    parrafos.some(p => /both live and on-demand/.test(p))
}
async function obtieneAcb(opciones) {
  const fecha = fechaConsulta(opciones), urlAgenda = ACB + '/es/liga/calendario', urlTabla = ACB + '/es/liga/clasificacion'
  const resultados = await Promise.allSettled([leerFuenteDeportiva(urlAgenda, opciones).then(h => normalizaCalendarioAcb(h, urlAgenda, fecha)), leerFuenteDeportiva(urlTabla, opciones).then(normalizaClasificacionAcb)])
  const agenda = resultados[0].status === 'fulfilled' ? resultados[0].value : null
  const tabla = resultados[1].status === 'fulfilled' ? resultados[1].value : null
  const incidencias = resultados.flatMap((r, i) => r.status === 'rejected' ? [incidencia('Liga Endesa', i ? urlTabla : urlAgenda, r.reason.message, 'acb-liga-endesa')] : [])
  if (!agenda && !tabla) return { competiciones: [], incidencias }
  const temporada = agenda?.temporada ?? tabla.temporada
  const tablaCoincide = tabla?.temporada === temporada
  return { competiciones: [{ ...base('acb-liga-endesa', 'Liga Endesa', temporada, { nombre: 'ACB', url: urlAgenda }, fecha, { genero: 'masculino' }),
    agenda: bloque(urlAgenda, fecha, agenda?.eventos, 'eventos'),
    clasificacion: bloque(urlTabla, fecha, tablaCoincide ? tabla.tablas : null, 'tablas', tabla && !tablaCoincide ? 'La clasificación publicada pertenece a otra temporada.' : undefined) }], incidencias }
}
async function obtieneNba(opciones) {
  const fecha = fechaConsulta(opciones), dia = fecha.slice(0, 10), incidencias = [], coleccion = []
  // Incluye la madrugada española, que pertenece al día anterior en Estados Unidos.
  const dias = [-1, 0, 1, 2].map(n => new Date(Date.parse(dia + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10))
  for (const diaNba of dias) {
    const url = NBA + '/games?date=' + diaNba
    try { coleccion.push(normalizaNba(await leerFuenteDeportiva(url, opciones), diaNba)) }
    catch (e) { incidencias.push(incidencia('NBA', url, e.message, 'nba')) }
  }
  const temporadas = new Set(coleccion.map(c => c.temporada).filter(Boolean))
  if (!coleccion.length || temporadas.size !== 1) return { competiciones: [], incidencias }
  let eventos = [...new Map(coleccion.flatMap(c => c.eventos).map(e => [e.id, e])).values()]
  const url = NBA + '/games', temporada = [...temporadas][0], agendaIncompleta = incidencias.length > 0
  let tablas, fuenteTabla = NBA + '/standings', fichasOficiales = false
  const urlTabla = 'https://stats.nba.com/stats/leaguestandingsv3?LeagueID=00&Season=' + encodeURIComponent(temporada) + '&SeasonType=Regular+Season'
  try {
    // El servicio público de estadísticas exige la procedencia de su página;
    // no usa una cuenta, una clave ni una sesión privada.
    const conProcedencia = { ...opciones, fetcher: (destino, init) => (opciones.fetcher || fetch)(destino, { ...init, headers: { ...init.headers, Referer: NBA + '/' } }) }
    tablas = normalizaClasificacionNba(JSON.parse(await leerFuenteDeportiva(urlTabla, conProcedencia)), temporada)
  } catch (e) {
    // No se busca otra vía ante una restricción de acceso o un límite explícito.
    if (/HTTP (?:401|403|429)\b/.test(e.message)) incidencias.push(incidencia('NBA · Clasificación', urlTabla, e.message, 'nba'))
    else try {
      tablas = await obtieneClasificacionEquiposNba(temporada, opciones)
      fuenteTabla = NBA + '/teams'; fichasOficiales = true
      opciones.log?.('NBA: clasificación comprobada en las 30 fichas oficiales de equipos.')
    } catch (respaldo) {
      incidencias.push(incidencia('NBA · Clasificación', urlTabla, e.message, 'nba'), incidencia('NBA · Fichas de equipos', NBA + '/teams', respaldo.message, 'nba'))
    }
  }
  let emisionConfirmada = false
  try {
    emisionConfirmada = compruebaLeaguePassEspana(await leerFuenteDeportiva(NBA_LEAGUE_PASS_ESPANA, opciones))
    if (!emisionConfirmada) throw Error('La fuente ya no confirma todos los partidos de League Pass en España')
    eventos = eventos.map(e => ['programado', 'en_juego', 'finalizado'].includes(e.estado) ? { ...e, emisiones: [{ nombre: 'NBA League Pass (suscripción adicional)', url: e.fuenteUrl, fuenteUrl: NBA_LEAGUE_PASS_ESPANA, territorio: 'España', verificadoEn: fecha }] } : e)
  } catch (e) { incidencias.push(incidencia('NBA · Dónde verlo', NBA_LEAGUE_PASS_ESPANA, e.message, 'nba')) }
  return { competiciones: [{ ...base('nba', 'NBA', temporada, { nombre: 'NBA', url }, fecha, { genero: 'masculino', zona: 'Estados Unidos y Canadá' }),
    // Una lectura parcial no debe sustituir la última agenda completa ni darle
    // una fecha nueva a los partidos del día que no se pudo consultar.
    agenda: bloque(url, fecha, agendaIncompleta ? null : eventos, 'eventos', agendaIncompleta ? 'No hemos podido comprobar todos los días de la agenda NBA; consulta la fuente oficial.' : emisionConfirmada ? 'NBA League Pass requiere una suscripción adicional. Incluye los partidos en directo y sus repeticiones; no forma parte de la suscripción básica de Prime Video.' : 'Horarios y resultados consultados. Las retransmisiones en España no están confirmadas.'),
    clasificacion: bloque(fuenteTabla, fecha, tablas, 'tablas', tablas ? fichasOficiales ? 'Posiciones, victorias y derrotas de la temporada regular publicadas en las 30 fichas oficiales de equipos NBA. Esta fuente no ofrece los puntos totales anotados y recibidos.' : 'Clasificación de la temporada regular, separada por conferencias.' : 'No hemos podido comprobar la clasificación de la NBA.') }], incidencias }
}
function rangosFeb(ahora) {
  const dia = new Date(ahora).toISOString().slice(0, 10)
  const b = Date.parse(dia + 'T12:00:00Z')
  const formato = t => new Date(t).toISOString().slice(0, 10).split('-').reverse().join('-')
  return [-7, 0, 7].map(n => ({ fechaInicio: formato(b + n * 86400000), fechaFin: formato(b + (n + 6) * 86400000) }))
}
const nombresFeb = { 'lf-endesa': 'Liga Femenina Endesa', 'lf-challenge': 'Liga Femenina Challenge', 'lf-2': 'Liga Femenina 2', 'primera-feb': 'Primera FEB', 'segunda-feb': 'Segunda FEB', 'tercera-feb': 'Tercera FEB', 'copa-espana': 'Copa España FEB', 'liga-u': 'Liga U' }
async function obtieneFeb(opciones) {
  const fecha = fechaConsulta(opciones), competiciones = [], incidencias = []
  let funciones
  for (const [id, nombre] of Object.entries(nombresFeb)) {
    const url = FEB + '/' + id, urlTabla = url + '/clasificacion', urlAgenda = url + '/partidos'
    try {
      const pagina = datosPaginaFeb(await leerFuenteDeportiva(urlTabla, opciones))
      if (pagina.edicion.competitionId !== id) throw Error('La FEB devuelve otra competición')
      const edicion = pagina.edicion
      if (!funciones) funciones = await funcionesFeb(pagina.doc, opciones)
      const contexto = pagina.consultas.find(q => q.queryKey[1] === 'clasificacion-contexto' && q.state.status === 'success')?.state.data
      if (!Array.isArray(contexto?.fases)) throw Error('No se pueden identificar los grupos FEB')
      const fases = contexto.fases.filter(f => Array.isArray(f.grupos) && f.grupos.length)
      const grupos = fases.flatMap(f => f.grupos.map(g => ({ ...g, fase: f.nombreFase, eliminatoria: f.playOff || /play[\s-]?offs?|supercopa/i.test(f.nombreFase) })))
      if (!grupos.length) throw Error('La FEB todavía no publica grupos')
      let agenda, errorAgenda
      try {
        const respuestas = await Promise.all(rangosFeb(opciones.ahora ?? Date.now()).map(r => consultaFeb(funciones.agenda, { idCategoria: edicion.feb.idCategoria, ranges: [r] }, opciones)))
        if (!respuestas.every(Array.isArray)) throw Error('Calendario FEB incompleto')
        agenda = respuestas.flat()
      }
      catch (e) { errorAgenda = e.message; incidencias.push(incidencia(nombre, urlAgenda, e.message, 'feb-' + id)) }
      const historico = new Map()
      for (const g of grupos) {
        const grupoId = 'feb-' + id + '-' + g.idGrupo
        let tabla, errorTabla
        try {
          if (!Number.isInteger(g.idJornada)) throw Error('Esta fase todavía no tiene una clasificación publicada')
          const cache = pagina.consultas.find(q => q.queryKey[1] === 'clasificacion-final' && q.queryKey[3] === g.idJornada && q.state.status === 'success')?.state.data
          const datos = cache ?? await consultaFeb(funciones.tabla, { idJornada: g.idJornada, idCategoria: edicion.feb.idCategoria }, opciones)
          tabla = normalizaTablaFeb(datos, 'grupo-' + g.idGrupo, limpio(g.nombreGrupo))
        } catch (e) { errorTabla = e.message; if (!g.eliminatoria) incidencias.push(incidencia(nombre + ' · ' + limpio(g.nombreGrupo), urlTabla, e.message, grupoId)) }
        let eventos, errorGrupoAgenda = errorAgenda
        let esHistorico = false
        try {
          if (agenda) {
            let partidos = agenda.filter(p => p.idGrupo === g.idGrupo)
            if (!partidos.length && fechaDeportiva(g.fechaJornada) && Date.parse(g.fechaJornada) < (opciones.ahora ?? Date.now()) - 7 * 86400000) {
              const fin = Date.parse(g.fechaJornada + 'T12:00:00Z')
              const formatea = t => new Date(t).toISOString().slice(0, 10).split('-').reverse().join('-')
              const rango = { fechaInicio: formatea(fin - 6 * 86400000), fechaFin: formatea(fin) }
              if (!historico.has(g.fechaJornada)) historico.set(g.fechaJornada, consultaFeb(funciones.agenda, { idCategoria: edicion.feb.idCategoria, ranges: [rango] }, opciones))
              const anteriores = await historico.get(g.fechaJornada)
              if (!Array.isArray(anteriores)) throw Error('Últimos resultados FEB incompletos')
              partidos = anteriores.filter(p => p.idGrupo === g.idGrupo)
              esHistorico = true
            }
            eventos = normalizaPartidosFeb(partidos, urlAgenda)
          }
        }
        catch (e) { errorGrupoAgenda = e.message; incidencias.push(incidencia(nombre, urlAgenda, e.message, grupoId)) }
        competiciones.push({ ...base(grupoId, nombre, edicion.seasonLabel, { nombre: 'Federación Española de Baloncesto', url }, fecha, { genero: id.startsWith('lf-') ? 'femenino' : 'masculino', grupo: limpio(g.nombreGrupo) }),
          agenda: bloque(urlAgenda, fecha, eventos, 'eventos', errorGrupoAgenda ? 'No hemos podido comprobar los partidos de este grupo.' : esHistorico ? 'Última semana de resultados publicada para esta fase, con sus fechas originales.' : 'Agenda de los últimos 7 días y los próximos 14. La hora se muestra como la publica la FEB.'),
          clasificacion: bloque(urlTabla, fecha, tabla ? [tabla] : null, 'tablas', errorTabla ? g.eliminatoria ? 'Esta fase se decide por eliminatorias; consulta los resultados.' : 'No hemos podido comprobar la clasificación de este grupo.' : undefined) })
      }
    } catch (e) { incidencias.push(incidencia(nombre, url, e.message, 'feb-' + id)) }
  }
  return { competiciones, incidencias }
}
export async function obtieneBaloncesto(opciones = {}) {
  const resultados = await Promise.allSettled([obtieneAcb(opciones), obtieneFeb(opciones), obtieneNba(opciones), obtieneBaseFeb(opciones), obtieneCopasAcb(opciones), obtieneBaloncestoTerritorial(opciones), obtieneBaloncestoEuropa(opciones), obtieneWnba(opciones), obtieneBaloncestoBizkaia(opciones), obtieneBaloncestoFbcyl(opciones), obtieneBaloncestoFbcv(opciones), obtieneBaloncestoOtrasOW(opciones), obtieneBaloncestoAlava(opciones), obtieneBaloncestoGesdeportiva(opciones), obtieneBaloncestoAragon(opciones), obtieneBaloncestoGalicia(opciones)])
  const competiciones = [], incidencias = []
  for (const r of resultados) {
    if (r.status === 'fulfilled') { competiciones.push(...r.value.competiciones); incidencias.push(...r.value.incidencias) }
    else incidencias.push(incidencia('Baloncesto', FEB, r.reason.message))
  }
  incidencias.push(
    incidencia('Baloncesto · Cataluña', 'https://www.basquetcatala.cat/competicions', 'Aún sin lectura automática verificada. En la revisión del 7 de noviembre de 2026, el portal solicitó una verificación manual de seguridad.'),
    incidencia('Baloncesto · Andalucía', 'https://www.andaluzabaloncesto.org/', 'Aún sin lectura automática verificada. En la revisión del 7 de noviembre de 2026, la página oficial respondió con una protección de acceso (HTTP 403).'),
    incidencia('Baloncesto · Ceuta', 'https://fbceuta.es/calendario/', 'Aún sin lectura automática verificada. El calendario revisado el 7 de noviembre de 2026 contenía un evento de plantilla, sin encuentros oficiales identificables.'),
  )
  return { competiciones, incidencias }
}

const BASE_FEB = {
  19: ['Selecciones autonómicas · Mini masculino', 'masculino', 'Mini'],
  20: ['Selecciones autonómicas · Mini femenino', 'femenino', 'Mini'],
  40: ['Selecciones autonómicas · Cadete masculino', 'masculino', 'Cadete'],
  41: ['Selecciones autonómicas · Cadete femenino', 'femenino', 'Cadete'],
  25: ['Selecciones autonómicas · Infantil masculino', 'masculino', 'Infantil'],
  26: ['Selecciones autonómicas · Infantil femenino', 'femenino', 'Infantil'],
  55: ['Minicopa LF Endesa', 'femenino', 'Base'],
  44: ['Fase final de Primera División Femenina', 'femenino', 'Primera División'],
  21: ['Campeonato de España de clubes · Junior masculino', 'masculino', 'Junior'],
  22: ['Campeonato de España de clubes · Junior femenino', 'femenino', 'Junior'],
  35: ['Campeonato de España de clubes · Cadete masculino', 'masculino', 'Cadete'],
  36: ['Campeonato de España de clubes · Cadete femenino', 'femenino', 'Cadete'],
  37: ['Campeonato de España de clubes · Infantil masculino', 'masculino', 'Infantil'],
  38: ['Campeonato de España de clubes · Infantil femenino', 'femenino', 'Infantil'],
  71: ['Campeonato de España de clubes · Mini masculino', 'masculino', 'Mini'],
  72: ['Campeonato de España de clubes · Mini femenino', 'femenino', 'Mini'],
}
const FEB_CLASICO = 'https://baloncestoenvivo.feb.es'
export function normalizaFinalBaseFeb(html, categoria, fuenteUrl, ahora = Date.now()) {
  const doc = parse(html), fecha = new Date(ahora).toISOString(), meta = BASE_FEB[categoria]
  if (!meta) throw Error('Categoría de base desconocida')
  const temporada = limpio(doc.querySelector('select[id$="temporadasDropDownList"] option[selected]')?.text)
  const fase = limpio(doc.querySelector('select[id$="gruposDropDownList"] option[selected]')?.text)
  if (!/^\d{4}\/\d{4}$/.test(temporada)) throw Error('Temporada del campeonato sin confirmar')
  const final = doc.querySelector('table[id$="clasificacionFinalDataGrid"]')
  if (!final || !doc.querySelectorAll('h1').some(n => /clasificaci.n final/i.test(n.text))) throw Error('La FEB todavía no publica la clasificación final del campeonato')
  const filas = final.querySelectorAll('tr').filter(tr => tr.querySelectorAll('td').length).map(tr => {
    const c = tr.querySelectorAll('td'), posicion = Number(limpio(c[0]?.text)), nombre = limpio(c[1]?.text)
    if (!Number.isInteger(posicion) || posicion < 1 || !nombre || c.length !== 2) throw Error('Clasificación final incompleta')
    return { posicion, nombre, valores: {} }
  })
  if (filas.length < 2 || new Set(filas.map(f => f.posicion)).size !== filas.length || new Set(filas.map(f => f.nombre)).size !== filas.length || !filas.every((f, i) => f.posicion === i + 1)) throw Error('La clasificación final tiene huecos o duplicados')
  const tablaPartidos = doc.querySelector('table[id$="_jornadaDataGrid"]')
  if (!tablaPartidos) throw Error('Faltan los resultados de la última fase')
  const eventos = tablaPartidos.querySelectorAll('tr').filter(tr => tr.querySelectorAll('td').length).map(tr => {
    const c = tr.querySelectorAll('td'), equipos = c[0]?.querySelectorAll('a') ?? [], marcador = limpio(c[1]?.text).match(/^(\d+)-(\d+)$/)
    const f = fechaCorta(c[2]?.text), hora = limpio(c[3]?.text), href = c[1]?.querySelector('a')?.getAttribute('href'), id = href?.match(/[?&]p=(\d+)(?:&|$)/)?.[1]
    if (equipos.length !== 2 || !marcador || !id || f > fecha.slice(0, 10)) throw Error('El resultado final del campeonato no está confirmado')
    const local = limpio(equipos[0].text), visitante = limpio(equipos[1].text)
    if (!local || !visitante) throw Error('Faltan los equipos del resultado final')
    return { id: 'feb-' + id, nombre: local + ' · ' + visitante, local, visitante, fecha: f, estado: 'finalizado', resultado: { local: Number(marcador[1]), visitante: Number(marcador[2]) },
      jornada: fase, fuenteUrl: FEB_CLASICO + '/Partido.aspx?p=' + id,
      ...(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora) ? { detalle: hora + ' · Hora publicada por la FEB; zona horaria sin confirmar.' } : {}) }
  })
  if (!eventos.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Resultados de la fase final incompletos')
  const [nombre, genero, categoriaNombre] = meta
  return { ...base('feb-base-' + categoria, nombre, temporada, { nombre: 'Federación Española de Baloncesto', url: fuenteUrl }, fecha, { genero, categoria: categoriaNombre }),
    agenda: bloque(fuenteUrl, fecha, eventos, 'eventos', 'Campeonato terminado. Mostramos los resultados de la última fase publicada: ' + fase + '.'),
    clasificacion: bloque(fuenteUrl, fecha, [{ id: 'clasificacion-final', nombre: 'Clasificación final del campeonato', columnas: [], filas }], 'tablas') }
}
async function obtieneBaseFeb(opciones) {
  const competiciones = [], incidencias = [], indice = FEB_CLASICO + '/calendariofeb.aspx'
  let urls
  try {
    const doc = parse(await leerFuenteDeportiva(indice, opciones))
    urls = new Map()
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href')
      if (!/^https:\/\/baloncestoenvivo\.feb\.es\/resultados\.aspx\?/.test(href ?? '')) continue
      const u = new URL(href), id = Number(u.searchParams.get('g')), temporada = Number(u.searchParams.get('t'))
      if (!BASE_FEB[id] || !Number.isInteger(temporada) || temporada < 2000) continue
      if (!urls.has(id) || temporada > Number(new URL(urls.get(id)).searchParams.get('t'))) urls.set(id, href)
    }
    if (!urls.size) throw Error('El directorio FEB no identifica campeonatos de base')
  } catch (e) { return { competiciones, incidencias: [incidencia('Campeonatos de base FEB', indice, e.message)] } }
  const entradas = [...urls]
  for (let i = 0; i < entradas.length; i += 3) {
    const grupo = await Promise.allSettled(entradas.slice(i, i + 3).map(async ([id, url]) => normalizaFinalBaseFeb(await leerFuenteDeportiva(url, opciones), id, url, opciones.ahora ?? Date.now())))
    for (let j = 0; j < grupo.length; j++) {
      const r = grupo[j], [id, url] = entradas[i + j]
      if (r.status === 'fulfilled') competiciones.push(r.value)
      else incidencias.push(incidencia(BASE_FEB[id][0], url, r.reason.message, 'feb-base-' + id))
    }
  }
  return { competiciones, incidencias }
}

async function obtieneCopasAcb(opciones) {
  const competiciones = [], incidencias = [], fecha = fechaConsulta(opciones)
  for (const [ruta, nombre, numero] of [['copa-del-rey', 'Copa del Rey ACB', 2], ['supercopa', 'Supercopa Endesa', 3], ['minicopa', 'Minicopa Endesa', 10]]) {
    let url = ACB + '/es/' + ruta + '/calendario'
    try {
      let html = await leerFuenteDeportiva(url, opciones), pagina = datosPaginaAcb(html), anterior = false
      if (pagina.data.selectedFilters.competition !== numero) throw Error('La ACB ha devuelto otra competición')
      if (Array.isArray(pagina.data.rounds) && !pagina.data.rounds.length) {
        const actual = pagina.data.availableFilters.seasons.find(s => s.id === pagina.data.selectedFilters.season)
        const previa = pagina.data.availableFilters.seasons.filter(s => s.startYear < actual?.startYear).sort((a, b) => b.startYear - a.startYear)[0]
        if (!previa) throw Error('La ACB todavía no publica partidos para esta competición')
        url += '?temporada=' + previa.id
        html = await leerFuenteDeportiva(url, opciones); pagina = datosPaginaAcb(html); anterior = true
        if (pagina.data.selectedFilters.season !== previa.id || pagina.data.selectedFilters.competition !== numero) throw Error('La ACB no ha entregado la edición solicitada')
      }
      const agenda = normalizaCalendarioAcb(html, url, fecha)
      competiciones.push({ ...base('acb-' + ruta, nombre, agenda.temporada, { nombre: 'ACB', url }, fecha, { genero: 'masculino', categoria: numero === 10 ? 'Base · Minicopa' : nombre }),
        agenda: bloque(url, fecha, agenda.eventos, 'eventos', anterior ? 'Última edición con partidos publicados. Se conserva la temporada real de esos resultados.' : 'Calendario y resultados publicados por la ACB.'),
        clasificacion: bloque(ACB + '/es/' + ruta + '/bracket', fecha, null, 'tablas', 'Competición por eliminatorias. Consulta el cuadro oficial y los resultados de los partidos.') })
    } catch (e) { incidencias.push(incidencia(nombre, url, e.message, 'acb-' + ruta)) }
  }
  return { competiciones, incidencias }
}




