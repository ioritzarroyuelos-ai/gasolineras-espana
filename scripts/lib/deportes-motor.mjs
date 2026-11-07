import { parse } from 'node-html-parser'
import { leerFuenteDeportiva } from './deportes.mjs'
import { configuracionPublicaFormula, urlResultadoFormula, interpretaResultadoFormula, interpretaResultadoF1Html, interpretaResultadosAcademy, interpretaEquiposFormula, interpretaEquiposAcademy, interpretaRondaEspanaMotor } from './deportes-motor-resultados.mjs'
import { clasificacionesRfedaHtml, interpretaClasificacionesRfedaHtml, leerPdfMotor, interpretaClasificacionTcrPdf, interpretaResultadoTcrPdf, rondasTcr, rondasCerx } from './deportes-motor-rfeda.mjs'
import { ampliaEspanaAlkamel } from './deportes-motor-alkamel.mjs'
import { ampliaGb3 } from './deportes-motor-gb3.mjs'
import { ampliaFerrari } from './deportes-motor-ferrari.mjs'
import { obtieneFrec } from './deportes-motor-frec.mjs'
import { ampliaSupercars } from './deportes-motor-supercars.mjs'
import { creaFetchMotorConPausas } from './deportes-motor-pausas.mjs'

const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const slug = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const meses = { jan: 1, ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, apr: 4, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, aug: 8, ago: 8, agosto: 8, sep: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dec: 12, dic: 12, diciembre: 12 }
const RFEDA = 'https://calendarios.rfeda.es/'
const EMISION_F1 = 'https://www.formula1.com/en/information/f1-broadcast-information.45y3LNsT1D6VoK0ZmX8ciJ'
const EMISION_ACADEMY = 'https://www.f1academy.com/About/3EF4AtFK4B3m7tegHgEx4a/where-to-watch-us'

function fechaValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
}
function fecha(d, m, ano) {
  const f = `${ano}-${String(meses[m?.toLowerCase()]).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`
  if (!fechaValida(f)) throw new Error('Fecha de motor no reconocida')
  return f
}
export function interpretaRangoMotor(texto, ano) {
  const t = limpia(texto).replace(/\bde\b/gi, '').replace(/[–—]/g, '-')
  const m = t.match(/^(\d{1,2})\s*([a-záéíóú]+)?\s*-\s*(\d{1,2})\s*([a-záéíóú]+)$/i)
  if (!m) throw new Error('Rango de motor no reconocido')
  const inicio = fecha(m[1], m[2] || m[4], ano), fin = fecha(m[3], m[4], ano)
  if (fin < inicio) throw new Error('Rango de motor invertido')
  return { fecha: inicio, finFecha: fin }
}
const rangoTexto = (a, b) => a === b ? a : `Del ${a} al ${b}`
const diaMadrid = ahora => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)

function jsonPagina(html, selector) {
  const s = parse(html).querySelector(selector)
  if (!s) throw new Error('La fuente ya no publica los datos esperados')
  return JSON.parse(s.text)
}

// Solo se decodifica JSON publicado en el HTML; nunca se ejecutan scripts de la fuente.
export function objetosFormula(html) {
  let contenido = ''
  for (const s of parse(html).querySelectorAll('script')) {
    const m = s.text.match(/^self\.__next_f\.push\((\[[\s\S]*\])\);?$/)
    if (!m) continue
    const datos = JSON.parse(m[1])
    if (datos[0] === 1 && typeof datos[1] === 'string') contenido += datos[1]
  }
  const objetos = []
  function visita(v) {
    if (!v || typeof v !== 'object') return
    objetos.push(v)
    for (const hijo of Object.values(v)) visita(hijo)
  }
  for (const linea of contenido.split('\n')) {
    try { visita(JSON.parse(linea.slice(linea.indexOf(':') + 1))) } catch { /* Registros RSC no JSON: módulos y texto. */ }
  }
  return objetos
}

export function interpretaCalendarioFormula(html, base, ano, id) {
  const doc = parse(html), encontrados = new Map()
  for (const a of doc.querySelectorAll('a')) {
    const href = a.getAttribute('href') || ''
    if (!href.startsWith(`/en/racing/${ano}/`) || /pre-season|testing/.test(href)) continue
    const tarjeta = id === 'formula-1' ? a : a.parentNode?.parentNode
    if (!tarjeta) continue
    const ronda = tarjeta.querySelectorAll('span').map(n => limpia(n.text).match(/^ROUND\s+(\d+)$/i)).find(Boolean)
    const fechaNodo = tarjeta.querySelectorAll('span').find(n => /^\d{1,2}\s*(?:[A-Za-z]+)?\s*-\s*\d{1,2}\s*[A-Za-z]+$/.test(limpia(n.text)))
    if (!ronda || !fechaNodo) continue
    const rango = interpretaRangoMotor(limpia(fechaNodo.text), ano)
    let lugar = id === 'formula-1' ? limpia(a.querySelector('p')?.text) : limpia(a.text)
    if (!lugar) continue
    const ganadores = {}
    for (const n of tarjeta.querySelectorAll('div')) {
      if (/^(Sprint Race|Feature Race(?: \d+)?)$/.test(limpia(n.text))) {
        const hijos = n.parentNode.childNodes.filter(c => c.nodeType === 1)
        if (hijos.length === 2 && hijos[0] === n) ganadores[limpia(n.text)] = limpia(hijos[1].text)
      }
    }
    encontrados.set(href, { id: `${id}-${slug(href.split('/').at(-1))}`, nombre: lugar, lugar, jornada: `Ronda ${ronda[1]}`, ...rango, fuenteUrl: new URL(href, base).href, ganadores })
  }
  if (encontrados.size < 1) throw new Error('No hay rondas verificables en el calendario oficial')
  return [...encontrados.values()].sort((a, b) => a.fecha.localeCompare(b.fecha))
}

function sesionEspanol(s) {
  return limpia(s).replace(/^FP(\d+)$/, 'Entrenamientos $1').replace(/^Practice(?: (\d+))?$/, (_, n) => `Entrenamientos${n ? ` ${n}` : ''}`).replace(/^Free Practice$/, 'Entrenamientos').replace(/^Sprint Qualifying$/, 'Clasificación sprint').replace(/^Qualifying/, 'Clasificación').replace(/^Sprint Race$/, 'Carrera sprint').replace(/^Feature Race/, 'Carrera principal').replace(/^Opening Race$/, 'Carrera inicial').replace(/^Reverse Grid Race$/, 'Carrera con parrilla invertida').replace(/^Race$/, 'Carrera').replace(/^Sprint$/, 'Carrera sprint')
}
function instante(s, offset) {
  if (typeof s !== 'string' || !fechaValida(s.slice(0, 10)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s)) return null
  const valor = /(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? s : /^[+-]\d{2}:\d{2}$/.test(offset ?? '') ? s + offset : null
  return valor && Number.isFinite(Date.parse(valor)) ? new Date(valor).toISOString() : null
}

export function interpretaSesionesFormula(html, ronda, ahora = Date.now()) {
  const objetos = objetosFormula(html)
  const rutaRonda = new URL(ronda.fuenteUrl).pathname
  const carrera = objetos.find(o => Array.isArray(o.meetingSessions) && o.meetingSessions.length && String(o.season) === ronda.fecha.slice(0, 4) && o.url === rutaRonda)
  if (!carrera) throw new Error('La ronda no publica sesiones verificables')
  return carrera.meetingSessions.map(s => {
    const titulo = s.shortName || s.text || s.description
    if (!titulo || !s.meetingSessionKey) throw new Error('Sesión sin identidad')
    const provisional = s.sessionStatus === 'TBC'
    const instanteFuente = instante(s.startTime, s.gmtOffset)
    const inicio = provisional ? null : instanteFuente
    const fechaSesion = s.startTime?.slice(0, 10)
    const res = objetos.find(o => o.session === s.session && o.startTime === s.startTime && Array.isArray(o.results))
    const primero = res?.results.find(r => String(r.positionValue || r.displayPosition) === '1')
    const ganador = primero ? limpia([primero.driverFirstName, primero.driverLastName].join(' ')) : ronda.ganadores?.[titulo]
    // El reloj por sí solo nunca demuestra que una sesión ha terminado.
    const finalizado = s.state === 'completed' && (instanteFuente ? Date.parse(instanteFuente) <= ahora : fechaValida(fechaSesion) && fechaSesion < diaMadrid(ahora))
    const estado = /cancel/i.test(s.state || '') ? 'cancelado' : finalizado ? 'finalizado' : provisional || !inicio || Date.parse(inicio) < ahora || s.state === 'completed' ? 'por_confirmar' : 'programado'
    const detalle = [finalizado && ganador ? `Primero: ${ganador}` : finalizado ? 'Sesión finalizada. Resultado completo en la fuente oficial.' : '', provisional ? 'Horario pendiente de confirmar por el campeonato.' : !inicio ? 'Hora sin zona horaria confirmada.' : ''].filter(Boolean).join(' ')
    return { id: `${ronda.id}-${s.meetingSessionKey}`, nombre: `${ronda.nombre} · ${sesionEspanol(titulo)}`, inicio, fecha: fechaValida(fechaSesion) ? fechaSesion : ronda.fecha, estado, lugar: ronda.lugar, jornada: ronda.jornada, fuenteUrl: ronda.fuenteUrl, ...(detalle ? { detalle } : {}) }
  })
}

export function interpretaClasificacionMotor(html, tipo, ano) {
  const doc = parse(html)
  const tabla = doc.querySelector('table')
  if (!tabla) throw new Error('No se encuentra la clasificación oficial')
  // El copyright y el menú pueden tener el año actual incluso en una edición
  // anterior. Se comprueba la tabla o el título de esa clasificación.
  const anos = new Set(tipo === 'formula-2' || tipo === 'formula-3'
    ? tabla.querySelectorAll('th a[href]').map(a => a.getAttribute('href')?.match(/^\/en\/racing\/(\d{4})\//)?.[1]).filter(Boolean)
    : doc.querySelectorAll('title,h1,h2').filter(n => /standings/i.test(n.text)).flatMap(n => [...n.text.matchAll(/\b20\d{2}\b/g)].map(m => m[0])))
  if (anos.size !== 1 || !anos.has(String(ano))) throw new Error('La clasificación no acredita la temporada')
  const filas = []
  for (const tr of tabla.querySelectorAll('tr')) {
    const c = tr.querySelectorAll('th,td')
    let posicion, nombre, puntos, equipo
    if (tipo === 'formula-1') {
      if (c.length !== 5 || !/^\d+$/.test(limpia(c[0].text))) continue
      c[1].querySelectorAll('span').filter(n => (n.getAttribute('class') || '').split(' ').includes('md:hidden')).forEach(n => n.remove())
      posicion = Number(limpia(c[0].text)); nombre = limpia(c[1].text); equipo = limpia(c[3].text); puntos = limpia(c[4].text)
    } else if (tipo === 'formula-2' || tipo === 'formula-3') {
      const partes = c[0]?.querySelectorAll('span') || []
      if (partes.length !== 2 || !/^\d+$/.test(limpia(partes[0].text))) continue
      posicion = Number(limpia(partes[0].text)); nombre = limpia(partes[1].text); puntos = limpia(c.at(-1).text)
    } else {
      const n = tr.querySelector('.nameStandings'), p = tr.querySelector('.pointsStandingsTable')
      if (!n || !p) continue
      n.querySelectorAll('span').filter(n => (n.getAttribute('class') || '').includes('uk-hidden@m')).forEach(n => n.remove())
      posicion = Number(limpia(c[0].text)); nombre = limpia(n.text); puntos = limpia(p.text)
      equipo = n.querySelector('.team-stripe')?.getAttribute('uk-tooltip')?.match(/title:\s*([^;]+)/)?.[1]
    }
    if (!Number.isInteger(posicion) || posicion < 1 || !nombre || !/^\d+(?:\.\d+)?$/.test(puntos)) throw new Error('Fila de clasificación incompleta')
    filas.push({ posicion, nombre, valores: { puntos: Number(puntos), ...(equipo ? { equipo } : {}) } })
  }
  if (filas.length < 3 || new Set(filas.map(f => f.posicion)).size !== filas.length) throw new Error('Clasificación vacía o duplicada')
  return [{ id: 'pilotos', nombre: 'Clasificación de pilotos', columnas: [{ clave: 'puntos', nombre: 'Puntos' }, ...(filas.every(f => f.valores.equipo) ? [{ clave: 'equipo', nombre: 'Equipo' }] : [])], filas }]
}

export function interpretaCalendarioAcademy(html, ano, ahora = Date.now()) {
  const d = jsonPagina(html, '#__NEXT_DATA__').props?.pageProps?.pageData
  if (!d?.SeasonName?.includes(String(ano)) || !d.Races?.length) throw new Error('Temporada F1 Academy no verificada')
  return d.Races.flatMap(r => (r.Sessions || []).map(s => {
    const fecha = s.SessionStartTime?.slice(0, 10)
    if (!fechaValida(fecha)) throw new Error('Fecha F1 Academy no reconocida')
    const inicio = s.Unconfirmed || r.Provisional ? null : instante(s.SessionStartTime)
    const finalizado = s.SessionResultsAvailable === true && !s.HideSessionResult && !s.NoClassification && Date.parse(s.SessionStartTime) <= ahora
    return { id: `f1-academy-${r.RaceId}-${s.SessionId}`, nombre: `${r.CircuitShortName} · ${sesionEspanol(s.SessionName)}`, inicio, fecha, estado: finalizado ? 'finalizado' : !inicio || Date.parse(inicio) < ahora ? 'por_confirmar' : 'programado', lugar: r.CircuitName, jornada: `Ronda ${r.RoundNumber}`, fuenteUrl: `https://www.f1academy.com/Racing-Series/Results?raceid=${r.RaceId}`, detalle: finalizado && s.WinnerName ? `Primera: ${limpia(s.WinnerFullName || s.WinnerName)}` : !inicio ? 'Horario pendiente de confirmar por el campeonato.' : 'Horario publicado por F1 Academy.' }
  }))
}
export function interpretaClasificacionAcademy(html, ano) {
  const d = jsonPagina(html, '#__NEXT_DATA__').props?.pageProps?.pageData
  if (!d?.Season?.includes(String(ano)) || !Array.isArray(d.Standings) || d.Standings.length < 3) throw new Error('Clasificación F1 Academy no verificada')
  const filas = d.Standings.map(f => {
    if (!Number.isInteger(f.Position) || f.Position < 1 || !Number.isFinite(f.TotalPoints) || !f.FullName) throw new Error('Clasificación F1 Academy incompleta')
    return { posicion: f.Position, nombre: limpia(f.FullName), valores: { puntos: f.TotalPoints, equipo: limpia(f.TeamName) || 'No publicado' } }
  })
  return [{ id: 'pilotos', nombre: 'Clasificación de pilotos', columnas: [{ clave: 'puntos', nombre: 'Puntos' }, { clave: 'equipo', nombre: 'Equipo' }], filas }]
}

export function interpretaCalendarioEspanaMotor(html, id, ano, ahora = Date.now()) {
  const doc = parse(html), eventos = new Map()
  const anos = new Set(doc.querySelectorAll('title,h1,h2').filter(n => /calendario|temporada/i.test(n.text)).flatMap(n => [...n.text.matchAll(/\b20\d{2}\b/g)].map(m => m[0])))
  if (anos.size !== 1 || !anos.has(String(ano))) throw new Error('El calendario no acredita la temporada')
  for (const a of doc.querySelectorAll('a')) {
    const url = a.getAttribute('href'), n = a.querySelector('h4'), f = a.querySelector('.date')
    if (!url?.includes('/round/') || !n || !f) continue
    const anoRonda = url.match(/\/round\/(20\d{2})[_/-]/)?.[1]
    if (anoRonda && anoRonda !== String(ano)) throw Error('El calendario enlaza una ronda de otra temporada')
    const rango = interpretaRangoMotor(limpia(f.text), ano)
    const ronda = limpia(a.querySelector('.round-number,h3')?.text).replace(/^R(?:ound)?\s*/i, 'Ronda ')
    eventos.set(url, { id: `${id}-${slug(new URL(url).pathname.split('/').filter(Boolean).at(-1))}`, nombre: limpia(n.text), ...rango, estado: rango.finFecha < diaMadrid(ahora) ? 'por_confirmar' : 'programado', lugar: limpia(n.text), jornada: ronda, fuenteUrl: url, detalle: `${rangoTexto(rango.fecha, rango.finFecha)}. Fin de semana de competición; las horas y los resultados de cada carrera se consultan en la fuente oficial.` })
  }
  if (!eventos.size) throw new Error('Calendario nacional sin rondas verificables')
  return [...eventos.values()]
}

export function interpretaCalendarioRfeda(html, ano, ahora = Date.now()) {
  const d = jsonPagina(html, '#gb-app-state')
  const datos = Object.values(d).filter(v => v?.body && typeof v.body === 'object').flatMap(v => Object.values(v.body)).filter(Array.isArray).flat().filter(v => v?.type === 'event')
  if (!datos.length) throw new Error('RFEDA no publica próximas pruebas verificables')
  const grupos = new Map()
  for (const e of datos) {
    if (/EUROCUP 3|CAMPEONATO DE ESPAÑA DE F4/i.test(e.title)) continue // Estas dos tienen su calendario completo del organizador.
    const fecha = e.date?.slice(0, 10), finFecha = e.endDate?.slice(0, 10)
    if (!fechaValida(fecha) || !fechaValida(finFecha) || finFecha < fecha) throw new Error('RFEDA publica una fecha incompleta o inválida')
    if (fecha.slice(0, 4) !== String(ano)) continue
    const nombre = limpia(e.title.split(/\s+-\s+/)[0]), id = `rfeda-${slug(nombre)}`
    const aplazada = /aplazad|pend.*nueva fecha/i.test(e.title), cancelada = /cancelad|anulad/i.test(e.title)
    const evento = { id: `rfeda-${e.id}`, nombre: limpia(e.title), estado: aplazada ? 'aplazado' : cancelada ? 'cancelado' : finFecha < diaMadrid(ahora) ? 'por_confirmar' : 'programado', lugar: limpia(e.address), fuenteUrl: e.url, detalle: aplazada ? 'Prueba aplazada. Nueva fecha pendiente de publicación.' : `${rangoTexto(fecha, finFecha)}. Calendario de la RFEDA; horario de las sesiones por confirmar.` }
    // RFEDA usa 12:00 como marcador de eventos de todo el día y 31/12 para aplazamientos.
    if (!aplazada) Object.assign(evento, { fecha, finFecha, ...(Number(e.allDay) === 1 ? {} : { inicio: instante(e.date) }) })
    if (!grupos.has(id)) grupos.set(id, { id, nombre, eventos: [] })
    grupos.get(id).eventos.push(evento)
  }
  return [...grupos.values()]
}

export function interpretaEmisionMotor(html, id, ano, verificadoEn) {
  const doc = parse(html)
  if (id === 'formula-1') {
    const fila = doc.querySelectorAll('tr').find(tr => /^Spain(?: and| &)/.test(limpia(tr.querySelector('td')?.text)))
    const a = fila?.querySelector('a')
    if (limpia(a?.text) !== 'DAZN' || !a?.getAttribute('href')?.startsWith('https://www.dazn.com/')) throw new Error('No se confirma el canal de F1 para España')
    return { nombre: 'DAZN · consultar programación', url: a.getAttribute('href'), fuenteUrl: EMISION_F1, territorio: 'España', verificadoEn }
  }
  const texto = limpia(doc.text)
  const youtube = doc.querySelectorAll('a').find(a => limpia(a.text) === 'YouTube' && a.getAttribute('href') === 'https://www.youtube.com/@f1academy')
  if (!texto.includes(`${ano} F1 ACADEMY season`) || !/all regions can stream Qualifying and the Races/.test(texto) || !youtube) throw new Error('No se confirma la emisión de F1 Academy en España para esta temporada')
  return { nombre: 'YouTube oficial de F1 Academy', url: youtube.getAttribute('href'), fuenteUrl: EMISION_ACADEMY, territorio: 'España', verificadoEn }
}

async function mapaLimitado(elementos, fn) {
  const resultados = new Array(elementos.length)
  let siguiente = 0
  await Promise.all(Array.from({ length: Math.min(3, elementos.length) }, async () => {
    while (siguiente < elementos.length) { const i = siguiente++; resultados[i] = await fn(elementos[i]) }
  }))
  return resultados
}

export async function obtieneMotor(opciones = {}) {
  opciones = { ...opciones, fetcher: creaFetchMotorConPausas(opciones) }
  const ahora = opciones.ahora ?? Date.now(), consultado = new Date(ahora).toISOString(), ano = Number(diaMadrid(ahora).slice(0, 4))
  const competiciones = [], incidencias = []
  const leer = async (url, headers, pdf = false) => {
    const intento = () => pdf ? leerPdfMotor(url, opciones) : leerFuenteDeportiva(url, headers ? { ...opciones, fetcher: (u, init) => opciones.fetcher(u, { ...init, headers: { ...init?.headers, ...headers } }) } : opciones)
    try { return await intento() } catch (error) {
      // Un segundo intento para fallos transitorios. El lector común impide
      // nuevas consultas si la fuente ha pedido una pausa, incluso entre pasadas.
      if (error instanceof TypeError || /TimeoutError|AbortError/.test(error.name) || /HTTP (?:408|5\d\d)/.test(error.message)) return intento()
      throw error
    }
  }
  const fuenteBloque = (url, datos, aviso) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl: url, ...datos, ...(aviso ? { aviso } : {}) })
  const fallo = (id, nombre, url, error, datos) => {
    incidencias.push({ deporte: 'motor', id, nombre, fuenteUrl: url, motivo: error.message })
    return { estado: 'no_disponible', consultado, fuenteUrl: url, aviso: 'No se ha podido comprobar este bloque en la fuente oficial.', ...datos }
  }
  async function carga(config, agendaFn, clasificacionFn) {
    const c = { id: config.id, deporte: 'motor', nombre: config.nombre, temporada: String(ano), categoria: config.categoria || 'Monoplazas', zona: config.zona || 'Internacional', genero: config.id === 'f1-academy' ? 'femenino' : 'mixto', fuente: { nombre: config.fuente || config.nombre, url: config.calendario }, comprobadoEn: consultado }
    const resultados = await Promise.allSettled([agendaFn(), clasificacionFn()])
    c.agenda = resultados[0].status === 'fulfilled' ? fuenteBloque(config.calendario, { eventos: resultados[0].value }, config.aviso) : fallo(c.id, c.nombre, config.calendario, resultados[0].reason, { eventos: [] })
    c.clasificacion = resultados[1].status === 'fulfilled' ? fuenteBloque(config.clasificacion, Array.isArray(resultados[1].value) ? { tablas: resultados[1].value } : resultados[1].value) : fallo(c.id, c.nombre, config.clasificacion, resultados[1].reason, { tablas: [] })
    competiciones.push(c)
  }
  async function dosClasificaciones(config, pilotosFn, equiposUrl, equiposFn) {
    const tareas = [{ id: 'pilotos', url: config.clasificacion, fn: pilotosFn }, { id: 'equipos', url: equiposUrl, fn: equiposFn }]
    const respuestas = await Promise.allSettled(tareas.map(async t => t.fn(await leer(t.url))))
    const tablas = [], tablasPendientes = []
    respuestas.forEach((r, i) => {
      const t = tareas[i]
      if (r.status === 'fulfilled') tablas.push(...(Array.isArray(r.value) ? r.value : [r.value]).map(tabla => ({ ...tabla, fuenteUrl: t.url, verificadoEn: consultado })))
      else { tablasPendientes.push(t.id); incidencias.push({ deporte: 'motor', id: config.id, nombre: `${config.nombre}: ${t.id}`, fuenteUrl: t.url, motivo: r.reason.message }) }
    })
    if (!tablas.length) throw Error('No se han podido comprobar las clasificaciones de pilotos y equipos')
    return { tablas, ...(tablasPendientes.length ? { tablasPendientes, aviso: `No se ha podido actualizar la clasificación de ${tablasPendientes.join(' y ')}.` } : {}) }
  }
  for (const [id, nombre, base] of [['formula-1', 'Fórmula 1', 'https://www.formula1.com'], ['formula-2', 'Fórmula 2', 'https://www.fiaformula2.com'], ['formula-3', 'Fórmula 3', 'https://www.fiaformula3.com']]) {
    const calendario = `${base}/en/racing/${ano}`, clasificacion = `${base}/en/${id === 'formula-1' ? 'results' : 'standings'}/${ano}/drivers`
    await carga({ id, nombre, calendario, clasificacion }, async () => {
      const rondas = interpretaCalendarioFormula(await leer(calendario), base, ano, id)
      const pendientes = []
      const eventos = await mapaLimitado(rondas, async ronda => {
        try {
          const html = await leer(ronda.fuenteUrl), sesiones = interpretaSesionesFormula(html, ronda, ahora), objetos = objetosFormula(html)
          const carrera = objetos.find(o => Array.isArray(o.meetingSessions) && String(o.season) === String(ano) && o.url === new URL(ronda.fuenteUrl).pathname)
          for (const e of sesiones) {
            const s = carrera.meetingSessions.find(s => e.id === `${ronda.id}-${s.meetingSessionKey}`)
            if (e.estado !== 'finalizado') continue
            pendientes.push(async () => {
              try {
                const inline = objetos.find(o => o.session === s.session && o.startTime === s.startTime && Array.isArray(o.results))
                if (inline) e.resultados = [interpretaResultadoFormula(inline, s, ronda.fuenteUrl, consultado)]
                else if (id !== 'formula-1') {
                  if (s.isAvailable !== true) return
                  const marca = id === 'formula-2' ? 'f2' : 'f3', config = configuracionPublicaFormula(html, marca)
                  e.resultados = [interpretaResultadoFormula(JSON.parse(await leer(urlResultadoFormula(config, s, marca), config.headers)), s, ronda.fuenteUrl, consultado)]
                } else {
                  const sufijo = s.sessionType === 'Practice' ? `practice/${s.sessionNumber}` : s.session === 'ss' ? 'sprint-qualifying' : s.session === 's' ? 'sprint-results' : s.sessionType === 'Qualifying' ? 'qualifying' : s.session === 'r' ? 'race-result' : null
                  const href = parse(html).querySelectorAll('a').map(a => a.getAttribute('href')).find(h => sufijo && h?.startsWith(`/en/results/${ano}/races/`) && h.endsWith(`/${sufijo}`))
                  if (!href) throw Error('La sesión no enlaza una tabla de resultados oficial')
                  const url = new URL(href, base).href, etiqueta = sufijo === 'sprint-results' ? 'SPRINT' : sufijo === 'race-result' ? 'RACE RESULT' : s.description
                  e.resultados = [interpretaResultadoF1Html(await leer(url), `${carrera.meetingOfficialName} - ${etiqueta}`, url, consultado)]
                }
              } catch (error) { incidencias.push({ deporte: 'motor', id, nombre: `${nombre}: ${e.nombre}`, fuenteUrl: ronda.fuenteUrl, motivo: error.message }) }
            })
          }
          return sesiones
        } catch (e) {
          incidencias.push({ deporte: 'motor', id, nombre, fuenteUrl: ronda.fuenteUrl, motivo: e.message })
          const { ganadores, ...evento } = ronda
          return [{ ...evento, estado: 'por_confirmar', detalle: `${rangoTexto(ronda.fecha, ronda.finFecha)}. No se han podido comprobar las sesiones. Consulta el calendario oficial.` }]
        }
      })
      // Una única cola para todas las sesiones: no se multiplican conexiones
      // por el número de rondas ni se descarta el calendario por una tabla caída.
      await mapaLimitado(pendientes, tarea => tarea())
      return eventos.flat()
    }, async () => dosClasificaciones({ id, nombre, clasificacion }, html => interpretaClasificacionMotor(html, id, ano), `${base}/en/${id === 'formula-1' ? 'results' : 'standings'}/${ano}/${id === 'formula-1' ? 'team' : 'teams'}`, html => interpretaEquiposFormula(html, id, ano)))
    if (incidencias.some(i => i.id === id && i.fuenteUrl.startsWith(`${base}/en/racing/${ano}/`))) {
      const c = competiciones.find(c => c.id === id)
      c.agenda.aviso = 'Calendario consultado; algunas sesiones o tablas de resultados no se han podido comprobar. Consulta su fuente oficial.'
    }
  }
  const academia = { id: 'f1-academy', nombre: 'F1 Academy', calendario: 'https://www.f1academy.com/Racing-Series/Calendar', clasificacion: 'https://www.f1academy.com/Racing-Series/Standings/Driver' }
  await carga(academia, async () => {
    const eventos = interpretaCalendarioAcademy(await leer(academia.calendario), ano, ahora)
    await mapaLimitado([...new Set(eventos.filter(e => e.estado === 'finalizado').map(e => e.fuenteUrl))], async url => {
      try { const tablas = interpretaResultadosAcademy(await leer(url), eventos.filter(e => e.fuenteUrl === url), ano, consultado, ahora); for (const e of eventos) if (tablas.has(e.id)) e.resultados = tablas.get(e.id) }
      catch (e) { incidencias.push({ deporte: 'motor', id: academia.id, nombre: 'F1 Academy: resultados', fuenteUrl: url, motivo: e.message }) }
    })
    return eventos
  }, async () => dosClasificaciones(academia, html => interpretaClasificacionAcademy(html, ano), 'https://www.f1academy.com/Racing-Series/Standings/Team', html => interpretaEquiposAcademy(html, ano)))
  for (const config of [
    { id: 'formula-4-espana', nombre: 'Fórmula 4 España', zona: 'España y Portugal', calendario: `https://f4spain.org/es/f4s-calendario-${ano}/`, clasificacion: `https://f4spain.org/es/standings/standings-${ano}/` },
    { id: 'eurocup-3', nombre: 'Eurocup-3', zona: 'Europa', calendario: `https://eurocup3.org/es/calendario-${ano}/`, clasificacion: `https://eurocup3.org/es/standings/standings-${ano}/` },
  ]) {
    await carga({ ...config, aviso: 'Sesiones y posiciones publicadas por el campeonato. Algunas tablas solo incluyen al primer piloto; los tiempos ausentes no se calculan. Las horas sin zona confirmada se muestran como texto.' }, async () => {
      const rondas = interpretaCalendarioEspanaMotor(await leer(config.calendario), config.id, ano, ahora)
      return (await mapaLimitado(rondas, async ronda => {
        try { return interpretaRondaEspanaMotor(await leer(ronda.fuenteUrl), ronda, ano, consultado, ahora) }
        catch (e) { incidencias.push({ deporte: 'motor', id: config.id, nombre: `${config.nombre}: ${ronda.nombre}`, fuenteUrl: ronda.fuenteUrl, motivo: e.message }); return [ronda] }
      })).flat()
    }, async () => interpretaClasificacionMotor(await leer(config.clasificacion), config.id, ano))
  }
  await ampliaEspanaAlkamel(competiciones, leer, ano, ahora, consultado, incidencias)
  try {
    const grupos = interpretaCalendarioRfeda(await leer(RFEDA), ano, ahora)
    for (const g of grupos) competiciones.push({ id: g.id, deporte: 'motor', nombre: g.nombre, temporada: String(ano), categoria: 'Calendario RFEDA', zona: 'Pruebas en España', genero: 'mixto', fuente: { nombre: 'Real Federación Española de Automovilismo', url: RFEDA }, comprobadoEn: consultado, agenda: fuenteBloque(RFEDA, { eventos: g.eventos }, 'Próximas pruebas publicadas por la RFEDA. Cobertura de calendario; no incluye resultados ni todas las pruebas de la temporada.'), clasificacion: { estado: 'no_disponible', consultado, fuenteUrl: RFEDA, aviso: 'Esta fuente publica el calendario, sin clasificación.', tablas: [] } })
  } catch (e) { incidencias.push({ deporte: 'motor', nombre: 'Calendario RFEDA', fuenteUrl: RFEDA, motivo: e.message }) }
  // La portada RFEDA solo enumera próximas pruebas. Una categoría no debe
  // desaparecer tras su última ronda: sus resultados y puntos siguen vigentes.
  for (const [id, nombre] of [['rfeda-gb3', 'GB3'], ['rfeda-supercars-espana', 'SUPERCARS ESPAÑA'], ['rfeda-tcr-spain', 'TCR Spain'], ['rfeda-cerx', 'CERX'], ['rfeda-cera', 'CERA'], ['rfeda-copaem', 'CopaEM'], ['rfeda-ferrari-challenge-trofeo-pirelli', 'FERRARI CHALLENGE TROFEO PIRELLI'], ['rfeda-cem-autohebdo', 'CEM AUTOHEBDO']]) {
    if (competiciones.some(c => c.id === id)) continue
    competiciones.push({ id, deporte: 'motor', nombre, temporada: String(ano), categoria: 'Calendario RFEDA', zona: 'Pruebas en España', genero: 'mixto', fuente: { nombre: 'Real Federación Española de Automovilismo', url: RFEDA }, comprobadoEn: consultado, agenda: { estado: 'no_disponible', consultado, fuenteUrl: RFEDA, eventos: [], aviso: 'La portada RFEDA no permite confirmar próximas pruebas de esta categoría.' }, clasificacion: { estado: 'no_disponible', consultado, fuenteUrl: RFEDA, tablas: [], aviso: 'Esta fuente publica calendario, sin clasificación.' } })
  }
  for (const config of clasificacionesRfedaHtml) {
    const c = competiciones.find(c => c.id === config.id)
    if (!c) continue
    try { c.clasificacion = fuenteBloque(config.url, { tablas: interpretaClasificacionesRfedaHtml(await leer(config.url), config.marca, ano, config.url, consultado) }, 'Clasificaciones provisionales publicadas por la RFEDA. Se conserva su orden, incluidos empates y pilotos sin posición.'); c.categoria = 'Automovilismo RFEDA' }
    catch (e) { c.clasificacion = fallo(c.id, c.nombre, config.url, e, { tablas: [] }) }
  }
  const tcr = competiciones.find(c => c.id === 'rfeda-tcr-spain')
  if (tcr) {
    const calendario = `https://spain.tcr-series.com/calendario-${ano}`, clasificacion = 'https://spain.tcr-series.com/clasificaciones-tcr'
    try {
      const rondas = rondasTcr(await leer(calendario), ano)
      const eventos = (await mapaLimitado(rondas, async r => {
        const rango = interpretaRangoMotor(r.rango, ano)
        if (!r.documentos.length || rango.fecha > diaMadrid(ahora)) return [{ id: r.id, nombre: r.nombre, ...rango, estado: 'por_confirmar', fuenteUrl: r.fuenteUrl, detalle: 'Fin de semana publicado por TCR Spain. Horarios y documentos oficiales en la fuente de cada ronda.' }]
        const salida = []
        for (const d of r.documentos) {
          const e = { id: `${r.id}-${slug(d.nombre)}`, nombre: `${r.nombre} · ${d.nombre}`, ...rango, estado: 'por_confirmar', fuenteUrl: d.url, detalle: 'Resultado de este fin de semana. Se muestra el orden y el dorsal que permite leer el PDF; consulta en el documento los tiempos y el horario exacto.' }
          try { e.resultados = [await interpretaResultadoTcrPdf(await leer(d.url, undefined, true), d.nombre, ano, d.url, consultado)] }
          catch (error) { incidencias.push({ deporte: 'motor', id: tcr.id, nombre: `TCR Spain: ${d.nombre}`, fuenteUrl: d.url, motivo: error.message }); e.detalle = 'Resultado disponible en el PDF oficial. Su formato no permite extraer aquí una tabla fiable. Día y hora exactos de la sesión pendientes de verificar.' }
          salida.push(e)
        }
        return salida
      })).flat()
      tcr.agenda = fuenteBloque(calendario, { eventos }, 'Calendario y orden de sesiones de TCR Spain. Dos actas históricas escaneadas se han revisado visualmente y sólo se muestran mientras el documento oficial no cambie. Otros escaneados pendientes de revisión se enlazan sin tabla. No se reconstruyen tiempos de columnas ambiguas.'); tcr.categoria = 'Turismos'; tcr.zona = 'España y Francia'
    } catch (e) { incidencias.push({ deporte: 'motor', id: tcr.id, nombre: 'TCR Spain: calendario completo', fuenteUrl: calendario, motivo: e.message }) }
    try {
      const doc = parse(await leer(clasificacion)), a = doc.querySelectorAll('a').find(a => limpia(a.text) === `Temporada ${ano}`), url = a?.getAttribute('href') && new URL(a.getAttribute('href'), clasificacion).href
      if (!url?.startsWith(`https://spain.tcr-series.com/docs/${ano}/clasificaciones/`) || !url.endsWith('.pdf')) throw Error('No se encuentra el documento de clasificación de esta temporada')
      tcr.clasificacion = fuenteBloque(url, { tablas: await interpretaClasificacionTcrPdf(await leer(url, undefined, true), ano, url, consultado) }, 'Puntos publicados en la última clasificación enlazada por TCR Spain. No se recalculan ni se mezclan las distintas categorías.'); tcr.categoria = 'Turismos'
    } catch (e) { tcr.clasificacion = fallo(tcr.id, tcr.nombre, clasificacion, e, { tablas: [] }) }
  }
  const gb3 = competiciones.find(c => c.id === 'rfeda-gb3')
  if (gb3) await ampliaGb3(gb3, leer, ano, ahora, consultado, incidencias)
  const ferrari = competiciones.find(c => c.id === 'rfeda-ferrari-challenge-trofeo-pirelli')
  if (ferrari) await ampliaFerrari(ferrari, leer, ano, ahora, consultado, incidencias)
  const supercars = competiciones.find(c => c.id === 'rfeda-supercars-espana')
  if (supercars) await ampliaSupercars(supercars, leer, ano, ahora, consultado, incidencias)
  competiciones.push(await obtieneFrec(leer, ano, consultado, incidencias))
  const cerx = competiciones.find(c => c.id === 'rfeda-cerx'), fuenteCerx = 'https://cerx.rfeda.es/resultados'
  if (cerx) {
    try { cerx.agenda = fuenteBloque(fuenteCerx, { eventos: rondasCerx(await leer(fuenteCerx), ano) }, 'Calendario de pruebas publicado por CERX. Sus resultados están en documentos externos y algunos requieren acceso.'); cerx.zona = 'España y Portugal' }
    catch (e) { incidencias.push({ deporte: 'motor', id: cerx.id, nombre: 'CERX: calendario', fuenteUrl: fuenteCerx, motivo: e.message }) }
  }
  // Estas fuentes identifican expresamente el territorio y las sesiones cubiertas.
  // Un enlace genérico de YouTube en el menú de otro campeonato no basta.
  for (const [id, url] of [['formula-1', EMISION_F1], ['f1-academy', EMISION_ACADEMY]]) {
    const c = competiciones.find(c => c.id === id)
    if (c?.agenda.estado !== 'actualizado') continue
    try {
      const emision = interpretaEmisionMotor(await leer(url), id, ano, consultado)
      for (const e of c.agenda.eventos) {
        if (!e.fecha || e.fecha < diaMadrid(ahora) || e.estado === 'cancelado' || e.estado === 'aplazado') continue
        if (id === 'formula-1' ? / · Carrera$/.test(e.nombre) : / · (?:Clasificación|Carrera)/.test(e.nombre)) e.emisiones = [emision]
      }
    } catch (e) { incidencias.push({ deporte: 'motor', id, nombre: `${c.nombre}: dónde verlo`, fuenteUrl: url, motivo: e.message }) }
  }
  for (const c of competiciones) for (const e of c.agenda.eventos) {
    if (e.resultados?.length && e.detalle?.includes('Resultado completo en la fuente oficial.')) e.detalle = e.detalle.replace(' Resultado completo en la fuente oficial.', '')
  }
  return { competiciones, incidencias }
}
