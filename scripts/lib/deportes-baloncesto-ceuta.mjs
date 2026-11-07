import { leerFuenteDeportiva, fechaDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

export const CALENDARIO_CEUTA = 'https://fbceuta.com/calendario/'
const API = 'https://api.swish.nbn23.com', PORTAL = 'basket-ceuta', HORA = 3600000
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim(), id = v => /^[a-f0-9]{24}$/.test(v || '')
const numero = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
const entero = v => numero(v) && Number.isInteger(v)
export function conexionPublicaCeuta(html) {
  if (!html.includes('//widget.nbn23.com/widget-react.js.gz')) throw Error('Ceuta no identifica su visor público')
  const key = html.match(/swish_widget_app\.init\(\s*\{[^}]*apiKey:\s*"([a-f0-9-]{36})"/)?.[1]
  if (!key) throw Error('Ceuta no publica una configuración reconocida del calendario')
  return key
}
export function temporadaCeuta(datos, ahora = Date.now()) {
  if (!Array.isArray(datos)) throw Error('Temporadas de Ceuta no disponibles')
  const activas = datos.filter(t => Date.parse(t.startDate) <= ahora && Date.parse(t.endDate) >= ahora)
  if (activas.length !== 1) throw Error('Ceuta no identifica una única temporada vigente')
  const t = activas[0]
  if (!id(t._id) || !/^20\d{2}\/20\d{2}$/.test(t.name) || Number(t.name.slice(5)) !== Number(t.name.slice(0, 4)) + 1 || !t.startDate.startsWith(t.name.slice(0, 4)) || !t.endDate.startsWith(t.name.slice(5))) throw Error('Temporada de Ceuta incoherente')
  return { id: t._id, nombre: t.name.replace('/', '-'), desde: t.startDate, hasta: t.endDate }
}
export function gruposCeuta(datos) {
  if (!Array.isArray(datos) || !datos.length) throw Error('Ceuta no enumera competiciones')
  const salida = []
  for (const c of datos) {
    if (!id(c.id) || !texto(c.name) || c.projectKey !== 'fbceuta' || !Array.isArray(c.groups)) throw Error('Competición ajena a la Federación de Ceuta')
    for (const g of c.groups) {
      if (!id(g.id) || !texto(g.name) || !['LEAGUE', 'PLAYOFF'].includes(g.type)) throw Error('Grupo de Ceuta incompleto')
      salida.push({ id: g.id, nombre: texto(g.name), competicion: texto(c.name), tipo: g.type })
    }
  }
  if (!salida.length || new Set(salida.map(g => g.id)).size !== salida.length) throw Error('Grupos de Ceuta vacíos o duplicados')
  return salida
}
export function calendarioCeuta(datos, grupo, temporada, ahora = Date.now()) {
  if (datos?.id !== grupo.id || texto(datos.name) !== grupo.nombre || datos.type !== grupo.tipo || !Array.isArray(datos.rounds)) throw Error('El calendario de Ceuta corresponde a otro grupo')
  const eventos = [], equipos = new Map(), hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ahora))
  for (const r of datos.rounds) {
    if (r.projectKey !== 'fbceuta' || r.seasonId !== temporada.id || !Array.isArray(r.matches) || !texto(r.name)) throw Error('Jornada de Ceuta ajena a la temporada')
    for (const p of r.matches) {
      // El visor incluye descansos con un único equipo y la fecha vacía 1970.
      // No son enfrentamientos verificables entre dos equipos.
      if ((!p.homeTeam || !p.awayTeam) && p.date === '1970-01-01T00:00:00.000Z' && p.status === 'CLOSED' && p.score?.totals?.every(t => t.total === null || t.total === 0)) continue
      if (!id(p.id) || !id(p.homeTeam?.id) || !id(p.awayTeam?.id) || p.homeTeam.id === p.awayTeam.id || !texto(p.homeTeam.name) || !texto(p.awayTeam.name)) throw Error('Partido de Ceuta incompleto')
      for (const t of [p.homeTeam, p.awayTeam]) {
        if (equipos.has(t.id) && equipos.get(t.id) !== texto(t.name)) throw Error('Equipo de Ceuta con nombres contradictorios')
        equipos.set(t.id, texto(t.name))
      }
      const sinFecha = p.date === '1970-01-01T00:00:00.000Z' || p.date === null, ms = sinFecha ? NaN : Date.parse(p.date)
      if (!sinFecha && (!fechaDeportiva(p.date?.slice(0, 10)) || !/Z$|[+-]\d{2}:\d{2}$/.test(p.date || '') || !Number.isFinite(ms) || ms < Date.parse(temporada.desde) || ms > Date.parse(temporada.hasta))) throw Error('Fecha de Ceuta fuera de su temporada')
      const fecha = Number.isFinite(ms) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ms)) : undefined
      const estados = { NOT_STARTED: fecha && fecha >= hoy ? 'programado' : 'por_confirmar', LIVE: 'en_juego', LIVE_NOT_AVAILABLE: 'en_juego', FINISHED: 'finalizado', CLOSED: 'finalizado', DEFERRED: 'aplazado' }
      if (!Object.hasOwn(estados, p.status)) throw Error('Estado de partido de Ceuta no reconocido')
      let estado = estados[p.status]
      const totales = p.score?.totals, a = totales?.find(t => t.teamId === p.homeTeam.id)?.total, b = totales?.find(t => t.teamId === p.awayTeam.id)?.total
      if (totales && (!Array.isArray(totales) || totales.length !== 2 || new Set(totales.map(t => t.teamId)).size !== 2 || totales.some(t => ![p.homeTeam.id, p.awayTeam.id].includes(t.teamId)))) throw Error('El marcador de Ceuta no identifica ambos equipos')
      const marcador = entero(a) && entero(b)
      if (['finalizado', 'en_juego'].includes(estado) && (!Number.isFinite(ms) || ms > ahora || !marcador || estado === 'finalizado' && a + b === 0)) estado = 'por_confirmar'
      eventos.push({ id: 'ceuta-' + p.id, nombre: texto(p.homeTeam.name) + ' · ' + texto(p.awayTeam.name), local: texto(p.homeTeam.name), visitante: texto(p.awayTeam.name), estado, jornada: texto(r.name),
        ...(fecha ? { fecha, inicio: new Date(ms).toISOString() } : { detalle: 'La federación todavía no confirma fecha y hora.' }),
        ...(['finalizado', 'en_juego'].includes(estado) && marcador ? { resultado: { local: a, visitante: b } } : {}),
        ...(texto(p.court?.place) ? { lugar: texto(p.court.place) } : {}), fuenteUrl: CALENDARIO_CEUTA })
    }
  }
  if (!eventos.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Calendario de Ceuta vacío o duplicado')
  return { eventos, equipos }
}
export function clasificacionCeuta(datos, grupo, equipos) {
  if (!Array.isArray(datos) || !datos.length) throw Error('La federación todavía no publica clasificación para este grupo')
  if (!equipos?.size) throw Error('La clasificación de Ceuta espera un calendario válido para confirmar sus equipos')
  const columnas = [{ clave: 'jugados', nombre: 'J' }, { clave: 'ganados', nombre: 'V' }, { clave: 'perdidos', nombre: 'D' }, { clave: 'media_favor', nombre: 'Puntos por partido' }, { clave: 'media_contra', nombre: 'Recibidos por partido' }]
  const filas = datos.map(t => {
    const s = t.stats
    if (!id(t.teamId) || !texto(t.name) || !entero(t.position) || !s || ![s.playedMatches, s.wonMatches, s.lostMatches].every(entero) || s.playedMatches !== s.wonMatches + s.lostMatches || ![s.pointsPerGame, s.opponentsPointsPerGame].every(numero)) throw Error('Clasificación de Ceuta incoherente')
    if (equipos && equipos.get(t.teamId) !== texto(t.name)) throw Error('La clasificación contiene un equipo ajeno al calendario')
    return { posicion: t.position, nombre: texto(t.name), valores: { jugados: s.playedMatches, ganados: s.wonMatches, perdidos: s.lostMatches, media_favor: s.pointsPerGame, media_contra: s.opponentsPointsPerGame } }
  })
  if (filas.some((f, i) => f.posicion !== i + 1) || new Set(datos.map(t => t.teamId)).size !== filas.length) throw Error('Posiciones de Ceuta repetidas o incompletas')
  return [{ id: 'grupo-' + grupo.id, nombre: filas.every(f => !f.valores.jugados) ? 'Orden publicado por la federación · todavía sin partidos contabilizados' : 'Clasificación del grupo', columnas, filas }]
}
export async function obtieneBaloncestoCeuta(opciones = {}) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), reloj = opciones.relojCeuta || Date.now, competiciones = [], incidencias = []
  let parado = false, conexion, siguiente = 0
  const guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado)
  const disponible = () => !parado && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes))
  const fallo = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, motivo, fuenteUrl: CALENDARIO_CEUTA, ...(id ? { id } : {}) })
  const lee = url => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('La lectura de Ceuta continuará tras la pausa: ' + estado.noConsultarAntes)
    if (siguiente > reloj()) await (opciones.duermeCeuta || (ms => new Promise(r => setTimeout(r, ms))))(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    if (estado.ventana.peticiones >= 120) { parado = true; estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString(); await guardar(); throw Error('Se ha alcanzado nuestro presupuesto horario de Ceuta') }
    estado.ventana.peticiones++; siguiente = reloj() + 700; await guardar()
    const r = await (opciones.fetcher || fetch)(destino, { ...init, headers: { ...init.headers, Referer: CALENDARIO_CEUTA, ...(destino.startsWith(API + '/') ? { Authorization: conexion } : {}) } })
    if ([401, 403, 429].includes(r.status)) { const retry = r.headers.get('Retry-After'), hasta = /^\d+$/.test(retry || '') ? reloj() + Number(retry) * 1000 : Date.parse(retry); estado.noConsultarAntes = new Date(Math.max(reloj() + HORA, Number.isFinite(hasta) && Math.abs(hasta) <= 8640000000000000 ? hasta : 0)).toISOString(); parado = true; await guardar() }
    return r
  } }).then(async html => {
    // La plantilla WordPress contiene opciones de reCAPTCHA para formularios,
    // aunque el calendario se publique normalmente. Eso no es una barrera.
    const bloqueo = /cf-chl-|challenge-platform|access denied/i.test(html) || /captcha/i.test(html) && (url.startsWith(API + '/') || !html.includes('swish_widget_app.init'))
    if (bloqueo) { parado = true; estado.noConsultarAntes = new Date(reloj() + HORA).toISOString(); await guardar(); throw Error('El visor de Ceuta solicita comprobación de acceso') }
    return html
  })
  try {
    conexion = conexionPublicaCeuta(await lee(CALENDARIO_CEUTA))
    const temporada = temporadaCeuta(JSON.parse(await lee(API + '/seasons')), reloj()), grupos = gruposCeuta(JSON.parse(await lee(API + '/competitions?seasonId=' + temporada.id)))
    // No se guardan credenciales ni la configuración del visor; sólo presupuesto y cursor.
    estado.grupo %= grupos.length
    const vistos = new Set()
    while (disponible() && !vistos.has(estado.grupo)) {
      vistos.add(estado.grupo)
      const g = grupos[estado.grupo], id = 'basket-ceuta-' + g.id, fecha = new Date(reloj()).toISOString()
      let agenda, tablas = [], errorAgenda, errorTabla, selloAgenda, selloTabla
      try { agenda = calendarioCeuta(JSON.parse(await lee(API + '/calendar?groupId=' + g.id)), g, temporada, reloj()); selloAgenda = new Date(reloj()).toISOString() } catch (e) { errorAgenda = e.message; fallo(g.competicion + ' · ' + g.nombre, e.message, id) }
      try {
        if (!agenda) throw Error('La clasificación espera un calendario válido para confirmar sus equipos')
        tablas = clasificacionCeuta(JSON.parse(await lee(API + '/standings?groupId=' + g.id)), g, agenda.equipos); selloTabla = new Date(reloj()).toISOString()
      } catch (e) { errorTabla = e.message; fallo(g.competicion + ' · ' + g.nombre + ' · clasificación', e.message, id) }
      if (selloAgenda || selloTabla) {
        const genero = /MIXTO/.test(g.competicion) ? 'mixto' : /FEMENINO/.test(g.competicion) ? 'femenino' : /MASCULINO/.test(g.competicion) ? 'masculino' : undefined, sello = new Date(reloj()).toISOString()
        competiciones.push({ id, deporte: 'baloncesto', nombre: g.competicion, grupo: g.nombre, temporada: temporada.nombre, zona: 'Ceuta', categoria: /INFANTIL|CADETE|JUNIOR|MINI/.test(g.competicion + ' ' + g.nombre) ? 'Baloncesto federado de base' : 'Baloncesto federado', ...(genero ? { genero } : {}), fuente: { nombre: 'Federación de Baloncesto de Ceuta · visor oficial', url: CALENDARIO_CEUTA }, comprobadoEn: sello,
          agenda: { estado: selloAgenda ? 'actualizado' : 'no_disponible', consultado: sello, ...(selloAgenda ? { verificadoEn: selloAgenda } : {}), fuenteUrl: CALENDARIO_CEUTA, eventos: agenda?.eventos || [], aviso: errorAgenda || 'Datos del visor oficial. Los ceros de partidos pendientes no son resultados; las fechas sin confirmar no se completan por suposición.' },
          clasificacion: { estado: selloTabla ? 'actualizado' : 'no_disponible', consultado: sello, ...(selloTabla ? { verificadoEn: selloTabla } : {}), fuenteUrl: CALENDARIO_CEUTA, tablas, ...(errorTabla ? { aviso: errorTabla } : {}) } })
        estado.ultimoExito = fecha
      }
      if (parado) break
      estado.grupo = (estado.grupo + 1) % grupos.length; await guardar()
    }
    opciones.log?.('Ceuta: ' + grupos.length + ' grupos descubiertos; ' + competiciones.length + ' fichas verificadas')
  } catch (e) { fallo('Baloncesto de Ceuta', e.message) }
  return { competiciones, incidencias }
}
