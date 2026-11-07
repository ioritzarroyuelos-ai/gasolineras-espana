import { parse } from 'node-html-parser'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const pos = v => /^\d+$/.test(limpia(v)) && Number(v) > 0 ? Number(v) : null
const base = 'https://www.gb-3.net'
const zonas = { Silverstone: 'Europe/London', 'Donington Park': 'Europe/London', 'Brands Hatch': 'Europe/London', 'Circuit de Spa-Francorchamps': 'Europe/Brussels', Hungaroring: 'Europe/Budapest', 'Red Bull Ring': 'Europe/Vienna', 'Circuit de Barcelona-Catalunya': 'Europe/Madrid' }
const offsets = { GMT: '+00:00', BST: '+01:00', CET: '+01:00', CEST: '+02:00' }
const horaLocal = (s, zona) => {
  if (!zona || !offsets[s.Timezone] || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(s.DateTime || '')) return null
  const t = new Date(s.DateTime + offsets[s.Timezone])
  if (!Number.isFinite(t.getTime())) return null
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(t).replace(' ', 'T')
  return f === s.DateTime ? t.toISOString() : null
}
const nombreSesion = s => limpia(s).replace(/^Qualifying one$/i, 'Clasificación 1').replace(/^Qualifying two$/i, 'Clasificación 2').replace(/^Race one$/i, 'Carrera 1').replace(/^Race two$/i, 'Carrera 2').replace(/^Race three$/i, 'Carrera 3')

function validaFilas(filas) {
  if (!filas.length || filas.length > 500 || filas.some(f => !f.nombre) || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Filas GB3 incompletas o duplicadas')
  return filas
}
export function interpretaRondasGb3(datos, ano, ahora) {
  if (!Array.isArray(datos) || !datos.length) throw Error('Calendario GB3 no reconocido')
  const eventos = [], sesiones = new Map(), rondas = datos.filter(r => r.IsTest === false && !r.HideFromCalendar)
  for (const r of rondas) {
    if (!r.RoundUrl?.startsWith(`/calendar/${ano}/`) || !r.FirstDate?.startsWith(`${ano}-`) || !r.LastDate?.startsWith(`${ano}-`) || !r.Series?.some(s => s.ChampionshipID === 22)) throw Error('Ronda GB3 de temporada o campeonato incorrectos')
    const ss = r.Series.find(s => s.ChampionshipID === 22).Sessions
    if (!Array.isArray(ss)) throw Error('Sesiones GB3 ausentes')
    for (const s of ss.filter(s => !s.HideFromCalendar)) {
      if (!Number.isInteger(s.Id) || !s.Name || !s.DateTime?.startsWith(`${ano}-`) || ![0, 1, 2, 3].includes(s.Type)) throw Error('Sesión GB3 sin identidad')
      const inicio = horaLocal(s, zonas[r.Venue]), fecha = s.DateTime.slice(0, 10), id = `gb3-${s.Id}`
      if (!Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha || Date.parse(fecha) < Date.parse(r.FirstDate.slice(0, 10)) - 3 * 86400000 || fecha > r.LastDate.slice(0, 10)) throw Error('Fecha GB3 fuera de su ronda')
      if (sesiones.has(id)) throw Error('Sesión GB3 duplicada')
      const e = { id, nombre: `${r.Venue} · ${nombreSesion(s.Name)}`, inicio, fecha, estado: inicio && Date.parse(inicio) >= ahora ? 'programado' : 'por_confirmar', lugar: r.Venue, jornada: `Ronda ${r.Number}`, fuenteUrl: new URL(r.RoundUrl, base).href, ...(!inicio ? { detalle: `Hora publicada: ${s.DateTime.slice(11, 16)} ${limpia(s.Timezone)}. La zona horaria no coincide con el circuito en esa fecha; consulta el horario oficial.` } : {}) }
      eventos.push(e); sesiones.set(id, s)
    }
  }
  if (!eventos.length) throw Error('Calendario GB3 vacío')
  return { eventos, sesiones, rondas }
}
export function interpretaPilotosGb3(datos, ano, fuenteUrl, verificadoEn) {
  if (!Array.isArray(datos)) throw Error('Clasificación GB3 no reconocida')
  const filas = validaFilas(datos.filter(f => !f.SubClassification).map(f => {
    if (!f.DriverUrl?.startsWith(`/drivers/${ano}/`) || !Number.isFinite(f.Points)) throw Error('Piloto GB3 de otra temporada o sin puntos')
    return { posicion: pos(f.Position), nombre: limpia(`${f.Firstname || ''} ${f.Surname || ''}`), valores: { puntos: f.Points, equipo: limpia(f.Team), numero: f.Number, estado: limpia(f.Position) || 'Sin posición' } }
  }))
  return { id: 'pilotos', nombre: 'Clasificación de pilotos', fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos' }, { clave: 'equipo', nombre: 'Equipo' }, { clave: 'numero', nombre: 'Dorsal' }, { clave: 'estado', nombre: 'Posición oficial' }], filas }
}
export function interpretaEquiposGb3(html, rondas, fuenteUrl, verificadoEn) {
  const doc = parse(html), tabla = doc.querySelector('table.results')
  const cabeceras = tabla?.querySelectorAll('thead th[colspan="3"]') || []
  // Esta página no imprime el año: debe coincidir todo su calendario con el
  // JSON de la temporada verificada, no basta el copyright del pie.
  if (cabeceras.length !== rondas.length || cabeceras.some((h, i) => {
    const partes = h.querySelectorAll('h6').map(h => limpia(h.text).replace('Sept', 'Sep'))
    return partes[0] !== rondas[i].Venue || partes[1] !== limpia(rondas[i].DateFormattedShort).replace('Sept', 'Sep')
  })) throw Error('La clasificación de equipos GB3 no coincide con el calendario de temporada')
  const filas = validaFilas(tabla.querySelectorAll('tbody tr').filter(tr => tr.querySelector('td.pos')).map(tr => {
    const c = tr.querySelectorAll('td'), puntos = Number(limpia(c[2]?.text))
    if (!Number.isFinite(puntos) || !/^\d+$/.test(limpia(c[2]?.text))) throw Error('Equipo GB3 sin puntos verificables')
    return { posicion: pos(c[0].text), nombre: limpia(c[1].text), valores: { puntos } }
  }))
  return { id: 'equipos', nombre: 'Clasificación de equipos', fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas }
}
export function interpretaResultadoGb3(datos, sesion, ano, fuenteUrl, verificadoEn) {
  if (!Array.isArray(datos)) throw Error('Resultados GB3 no reconocidos')
  const filas = validaFilas(datos.filter(f => !f.SubClassification).map(f => {
    if (!new RegExp(`^/(?:drivers|riders)/${ano}/`).test(f.DriverUrl || '') || !Number.isFinite(f.Laps)) throw Error('Resultado GB3 de otra temporada o incompleto')
    return { posicion: pos(f.Position), nombre: limpia(`${f.Firstname || ''} ${f.Surname || ''}`), valores: { numero: f.Number, equipo: limpia(f.Team) || '—', vueltas: f.Laps, tiempo: limpia(sesion.Type === 2 ? f.TotalTime : f.FastestLap) || '—', diferencia: limpia(f.Gap) || '—', estado: limpia(f.Position) || 'Sin posición' } }
  }))
  return { id: 'resultado', nombre: 'Resultado publicado por GB3', fuenteUrl, verificadoEn, columnas: [{ clave: 'numero', nombre: 'Dorsal' }, { clave: 'equipo', nombre: 'Equipo' }, { clave: 'vueltas', nombre: 'Vueltas' }, { clave: 'tiempo', nombre: sesion.Type === 2 ? 'Tiempo total' : 'Mejor vuelta' }, { clave: 'diferencia', nombre: 'Diferencia' }, { clave: 'estado', nombre: 'Posición oficial' }], filas }
}

export async function ampliaGb3(c, leer, ano, ahora, consultado, incidencias) {
  const fuenteBloque = (fuenteUrl, datos, aviso) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl, ...datos, ...(aviso ? { aviso } : {}) })
  const fallo = (url, e) => incidencias.push({ deporte: 'motor', id: c.id, nombre: 'GB3', fuenteUrl: url, motivo: e.message })
  const calendario = `${base}/json/results/${ano}/22/_rounds.json`, pilotos = `${base}/json/results/${ano}/22/_standings.json`, equipos = `${base}/standings/teams`
  let datos
  try {
    datos = interpretaRondasGb3(JSON.parse(await leer(calendario)), ano, ahora)
    const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ahora)
    const pendientes = datos.eventos.filter(e => e.fecha <= hoy && (!e.inicio || Date.parse(e.inicio) <= ahora) && datos.sesiones.get(e.id).ResultsPDF)
    let siguiente = 0
    await Promise.all(Array.from({ length: Math.min(3, pendientes.length) }, async () => {
      while (siguiente < pendientes.length) {
        const e = pendientes[siguiente++], s = datos.sesiones.get(e.id), url = `${base}/json/results/${ano}/${s.Id}.json`
        try { e.resultados = [interpretaResultadoGb3(JSON.parse(await leer(url)), s, ano, e.fuenteUrl, consultado)] }
        catch (error) { fallo(url, error) }
      }
    }))
    c.agenda = fuenteBloque(`${base}/calendar`, { eventos: datos.eventos }, 'Calendario y resultados publicados por GB3. Cuando la zona horaria oficial es incoherente se conserva la hora como texto, sin convertirla.'); c.categoria = 'Monoplazas'; c.zona = 'Europa'
  } catch (e) { fallo(calendario, e) }
  const tablas = [], tablasPendientes = []
  try { tablas.push(interpretaPilotosGb3(JSON.parse(await leer(pilotos)), ano, `${base}/standings`, consultado)) } catch (e) { tablasPendientes.push('pilotos'); fallo(pilotos, e) }
  try { if (!datos) throw Error('No se puede comprobar el calendario que identifica la clasificación de equipos'); tablas.push(interpretaEquiposGb3(await leer(equipos), datos.rondas, equipos, consultado)) } catch (e) { tablasPendientes.push('equipos'); fallo(equipos, e) }
  c.clasificacion = tablas.length ? fuenteBloque(`${base}/standings`, { tablas, ...(tablasPendientes.length ? { tablasPendientes } : {}) }) : { estado: 'no_disponible', consultado, fuenteUrl: `${base}/standings`, tablas: [], aviso: 'No se han podido comprobar las clasificaciones de GB3.' }
}
