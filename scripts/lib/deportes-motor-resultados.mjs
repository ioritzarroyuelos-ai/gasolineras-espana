import { parse } from 'node-html-parser'

const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const posicion = v => /^\d+$/.test(texto(v)) && Number(v) > 0 ? Number(v) : null
const dato = v => v === null || v === undefined || texto(v) === '' ? '—' : typeof v === 'number' ? v : texto(v)
const columnas = pares => pares.map(([clave, nombre]) => ({ clave, nombre }))
const jsonAcademy = html => JSON.parse(parse(html).querySelector('#__NEXT_DATA__')?.text || 'null')?.props?.pageProps?.pageData

function validaFilas(filas) {
  if (!filas.length || filas.length > 500 || filas.some(f => !f.nombre) || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Resultados vacíos, incompletos o duplicados')
  const clasificadas = filas.filter(f => f.posicion !== null)
  if (new Set(clasificadas.map(f => f.posicion)).size !== clasificadas.length) throw Error('Posiciones duplicadas en los resultados')
  return filas
}

export function interpretaResultadoFormula(datos, esperada, fuenteUrl, verificadoEn) {
  const s = datos.sessionResults || datos
  if (s.session !== esperada.session || s.startTime !== esperada.startTime || s.gmtOffset !== esperada.gmtOffset || s.sessionType !== esperada.sessionType || Number(s.sessionNumber) !== Number(esperada.sessionNumber)) throw Error('Los resultados pertenecen a otra sesión')
  if (!Array.isArray(s.results) || !s.results.length) throw Error('La sesión no publica resultados verificables')
  const camposResultado = ['racingNumber', 'displayPosition', 'positionValue', 'lapsCompleted', 'displayTime', 'classifiedTime', 'raceTime', 'racePoints', 'completionStatusCode']
  const resultados = s.results.filter(r => r.driverFirstName || r.driverLastName || !s.results.some(otro => (otro.driverFirstName || otro.driverLastName) && camposResultado.every(k => r[k] === otro[k])))
  const filas = validaFilas(resultados.map(r => ({
    posicion: posicion(r.displayPosition ?? r.positionValue), nombre: texto(`${r.driverFirstName || ''} ${r.driverLastName || ''}`) || (texto(r.racingNumber) ? `Dorsal ${texto(r.racingNumber)} · nombre no publicado` : ''),
    valores: { numero: dato(r.racingNumber), equipo: dato(r.displayTeamName || r.teamName), vueltas: dato(r.lapsCompleted), tiempo: dato(r.displayTime || r.classifiedTime || r.raceTime), puntos: dato(r.racePoints), estado: dato(r.completionStatusCode) },
  })))
  const pares = [['numero', 'Dorsal'], ['equipo', 'Equipo'], ['vueltas', 'Vueltas'], ['tiempo', 'Tiempo / diferencia'], ...(s.results.some(r => r.racePoints != null) ? [['puntos', 'Puntos']] : []), ['estado', 'Estado oficial']]
  return { id: 'resultado', nombre: s.results.every(r => r.version === 'Final') ? 'Resultado final oficial' : 'Resultado publicado por el campeonato', fuenteUrl, verificadoEn, columnas: columnas(pares), filas }
}

// Configuración pública que la propia web utiliza en su navegador. No se
// ejecuta código remoto ni se buscan credenciales de cuenta o de servidor.
export function configuracionPublicaFormula(html, marca) {
  for (const script of parse(html).querySelectorAll('script')) {
    if (!script.text.includes('globalThis.cwpConfig=')) continue
    const inicio = script.text.indexOf('.push('), fin = script.text.lastIndexOf(')')
    const datos = JSON.parse(script.text.slice(inicio + 6, fin))
    const codigo = datos[1]?.children
    if (!codigo?.startsWith('globalThis.cwpConfig=')) continue
    const c = JSON.parse(codigo.slice('globalThis.cwpConfig='.length))
    if (c.brand?.id !== marca || c.api?.baseUrl !== 'https://api.formula1.com' || c.api?.endpoint?.results !== '/v2/core-fom-results' || typeof c.api?.key?.public !== 'string') throw Error('Configuración pública de resultados inesperada')
    return { base: c.api.baseUrl + c.api.endpoint.results, headers: { apiKey: c.api.key.public, 'Content-Type': 'application/json' } }
  }
  throw Error('No se encuentra la conexión pública de resultados')
}

export function urlResultadoFormula(config, sesion, marca) {
  if (!new RegExp(`^${marca}/(?:practice|qualifying|race)\\?meeting=\\d+&session=\\d+$`).test(sesion.value || '')) throw Error('Enlace de resultados inesperado')
  return `${config.base}/${sesion.value}`
}

export function interpretaResultadoF1Html(html, tituloEsperado, fuenteUrl, verificadoEn) {
  const doc = parse(html)
  if (texto(doc.querySelector('h1')?.text).toUpperCase() !== texto(tituloEsperado).toUpperCase()) throw Error('La tabla de F1 no corresponde al gran premio y sesión solicitados')
  const tabla = doc.querySelector('table'), nombres = tabla?.querySelectorAll('thead th').map(n => texto(n.text))
  const etiquetas = { 'No.': ['numero', 'Dorsal'], Team: ['equipo', 'Equipo'], 'Time / Gap': ['tiempo', 'Tiempo / diferencia'], 'Time / Retired': ['tiempo', 'Tiempo / retirada'], Laps: ['vueltas', 'Vueltas'], Pts: ['puntos', 'Puntos'], 'Pts.': ['puntos', 'Puntos'], Q1: ['q1', 'Q1'], Q2: ['q2', 'Q2'], Q3: ['q3', 'Q3'], SQ1: ['sq1', 'SQ1'], SQ2: ['sq2', 'SQ2'], SQ3: ['sq3', 'SQ3'] }
  if (!nombres || nombres[0] !== 'Pos.' || !nombres.includes('Driver') || nombres.some(n => !['Pos.', 'Driver'].includes(n) && !etiquetas[n])) throw Error('Columnas de resultados de F1 no reconocidas')
  const filas = validaFilas(tabla.querySelectorAll('tbody tr').map(tr => {
    const c = tr.querySelectorAll('td')
    if (c.length !== nombres.length) throw Error('Fila de resultados de F1 incompleta')
    c.forEach(td => td.querySelectorAll('span').filter(n => (n.getAttribute('class') || '').split(' ').includes('md:hidden')).forEach(n => n.remove()))
    return { posicion: posicion(c[0].text), nombre: texto(c[nombres.indexOf('Driver')].text), valores: { estado: texto(c[0].text), ...Object.fromEntries(nombres.flatMap((n, i) => etiquetas[n] ? [[etiquetas[n][0], dato(c[i].text)]] : [])) } }
  }))
  return { id: 'resultado', nombre: 'Resultado publicado por Fórmula 1', fuenteUrl, verificadoEn, columnas: columnas([...nombres.filter(n => etiquetas[n]).map(n => etiquetas[n]), ['estado', 'Posición oficial']]), filas }
}

export function interpretaResultadosAcademy(html, eventos, ano, verificadoEn, ahora) {
  const d = jsonAcademy(html)
  if (!d || !new RegExp(`\\b${ano}\\b`).test(d.SeasonName || '') || !Number.isInteger(d.RaceId) || !Array.isArray(d.SessionResults)) throw Error('Resultados de F1 Academy de temporada no verificada')
  const salida = new Map()
  for (const s of d.SessionResults) {
    const e = eventos.find(e => e.id === `f1-academy-${d.RaceId}-${s.SessionId}`)
    if (!e) continue
    if (!Number.isFinite(Date.parse(s.SessionStartTime)) || new Date(s.SessionStartTime).getUTCFullYear() !== ano) throw Error('Fecha de resultados de F1 Academy no verificable')
    if (e.inicio && Date.parse(e.inicio) !== Date.parse(s.SessionStartTime)) throw Error('Los resultados de F1 Academy no corresponden al horario publicado')
    if (!s.SessionResultsAvailable || s.HideSessionResult || s.NoClassification || !s.Results?.length || Date.parse(s.SessionStartTime) > ahora) continue
    const filas = validaFilas(s.Results.map(r => ({ posicion: posicion(r.DisplayFinishPosition ?? r.FinishPosition), nombre: texto(`${r.DriverForename || ''} ${r.DriverSurname || ''}`), valores: { numero: dato(r.CarNumber), equipo: dato(r.TeamName), vueltas: dato(r.LapsCompleted), tiempo: dato(r.TimeOrFinishReason), diferencia: dato(r.Gap), mejor: dato(r.Best), estado: dato(r.ResultStatus || r.DisplayFinishPosition) } })))
    salida.set(e.id, [{ id: 'resultado', nombre: s.ResultsAreOfficial ? 'Resultado oficial' : 'Resultado provisional', fuenteUrl: e.fuenteUrl, verificadoEn, columnas: columnas([['numero', 'Dorsal'], ['equipo', 'Equipo'], ['vueltas', 'Vueltas'], ['tiempo', 'Tiempo / estado'], ['diferencia', 'Diferencia'], ['mejor', 'Mejor vuelta'], ['estado', 'Estado oficial']]), filas }])
  }
  return salida
}

export function interpretaEquiposFormula(html, tipo, ano) {
  const doc = parse(html), tabla = doc.querySelector('table')
  if (!tabla) throw Error('No se encuentra la clasificación de equipos')
  const anos = new Set(tipo === 'formula-1' ? doc.querySelectorAll('title,h1').filter(n => /STANDINGS/i.test(n.text)).flatMap(n => n.text.match(/20\d{2}/g) || []) : tabla.querySelectorAll('th a[href]').map(a => a.getAttribute('href')?.match(/^\/en\/racing\/(\d{4})\//)?.[1]).filter(Boolean))
  if (anos.size !== 1 || !anos.has(String(ano))) throw Error('Clasificación de equipos de temporada no verificada')
  const filas = []
  for (const tr of tabla.querySelectorAll('tr')) {
    const c = tr.querySelectorAll('th,td'), partes = c[0]?.querySelectorAll('span') || []
    const pos = tipo === 'formula-1' ? texto(c[0]?.text) : texto(partes[0]?.text)
    if (!/^\d+$/.test(pos)) continue
    const nombre = texto(tipo === 'formula-1' ? c[1]?.text : partes[1]?.text), puntos = texto(c.at(-1)?.text)
    if (!nombre || !/^\d+(?:\.\d+)?$/.test(puntos)) throw Error('Clasificación de equipos incompleta')
    filas.push({ posicion: Number(pos), nombre, valores: { puntos: Number(puntos) } })
  }
  validaFilas(filas)
  return { id: 'equipos', nombre: 'Clasificación de equipos', columnas: columnas([['puntos', 'Puntos']]), filas }
}

export function interpretaEquiposAcademy(html, ano) {
  const d = jsonAcademy(html)
  if (!d?.Season?.includes(String(ano)) || !Array.isArray(d.Standings)) throw Error('Clasificación de equipos de F1 Academy de temporada no verificada')
  const filas = validaFilas(d.Standings.map(f => {
    if (!Number.isInteger(f.Position) || f.Position < 1 || !Number.isFinite(f.TotalPoints) || !f.FullName || !f.TeamID) throw Error('Clasificación de equipos de F1 Academy incompleta')
    return { posicion: f.Position, nombre: texto(f.FullName), valores: { puntos: f.TotalPoints } }
  }))
  return { id: 'equipos', nombre: 'Clasificación de equipos', columnas: columnas([['puntos', 'Puntos']]), filas }
}

const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const claveSesion = nombre => texto(nombre).toLowerCase().replace(/^qualy/, 'qualification').replace(/\W+/g, '-').replace(/^-|-$/g, '')
const nombreSesion = nombre => texto(nombre).replace(/^Qual(?:y|ification)/, 'Clasificación').replace(/^Race/, 'Carrera').replace(/^Sprint$/, 'Carrera sprint').replace(/^Official Test$/, 'Pruebas oficiales').replace(/^(?:Free )?Practice/, 'Entrenamientos')

export function interpretaRondaEspanaMotor(html, ronda, ano, verificadoEn, ahora) {
  const doc = parse(html), canonical = doc.querySelector('link[rel=canonical]')?.getAttribute('href')
  const ruta = url => new URL(url).pathname.replace(/^\/es\//, '/')
  if (!canonical || new URL(canonical).origin !== new URL(ronda.fuenteUrl).origin || ruta(canonical) !== ruta(ronda.fuenteUrl) || !new RegExp(`\\b${ano}\\b`).test(texto(doc.querySelector('title')?.text).replace(/_/g, ' '))) throw Error('La ronda nacional no acredita su identidad y temporada')
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ahora), eventos = [], porClave = new Map(), ocurrencias = new Map()
  for (const dia of doc.querySelectorAll('.sch-day')) {
    const encabezado = texto(dia.querySelector('h3')?.text).toLowerCase(), numerica = encabezado.match(/\b(\d{1,2})\/(\d{1,2})\b/)
    const palabras = encabezado.match(/\b([a-z]+) (\d{1,2})$/)
    const mes = numerica ? Number(numerica[2]) : palabras ? meses.indexOf(palabras[1]) + 1 : 0, numero = numerica ? Number(numerica[1]) : Number(palabras?.[2])
    const fecha = `${ano}-${String(mes).padStart(2, '0')}-${String(numero).padStart(2, '0')}`
    if (!mes || !numero || !Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha || fecha < ronda.fecha || fecha > ronda.finFecha) throw Error('La sesión nacional cae fuera del fin de semana publicado')
    for (const li of dia.querySelectorAll('li')) {
      const trozos = li.querySelectorAll('span').map(n => texto(n.text)).filter(Boolean)
      const hora = trozos.find(t => /^\d{2}:\d{2}$/.test(t)), nombre = trozos.find(t => /^(?:Official Test|Free Practice|Practice \d+|Qualification \d+|Race \d+|Sprint)$/.test(t))
      if (hora && (Number(hora.slice(0, 2)) > 23 || Number(hora.slice(3)) > 59)) throw Error('Hora nacional no válida')
      if (!nombre) continue // Una hora sin nombre no demuestra qué sesión se disputa.
      const clave = claveSesion(nombre), ocurrencia = (ocurrencias.get(clave) || 0) + 1
      ocurrencias.set(clave, ocurrencia)
      const evento = { id: `${ronda.id}-${clave}${ocurrencia > 1 ? `-${ocurrencia}` : ''}`, nombre: `${ronda.nombre} · ${nombreSesion(nombre)}`, fecha, inicio: null, estado: 'por_confirmar', lugar: ronda.lugar, jornada: ronda.jornada, fuenteUrl: ronda.fuenteUrl, detalle: hora ? `Hora publicada: ${hora}. La fuente no indica la zona horaria; comprueba el horario en el campeonato.` : 'Hora pendiente de publicación.' }
      eventos.push(evento)
      if (!porClave.has(clave)) porClave.set(clave, evento)
    }
  }
  for (const tabs of doc.querySelectorAll('.round-tabs')) {
    const etiquetas = tabs.querySelectorAll('ul[uk-tab] a').map(n => texto(n.text)), tablas = tabs.querySelectorAll('.standing-table')
    if (tablas.length && tablas.length !== etiquetas.length) throw Error('No se puede asociar cada tabla nacional con su sesión')
    tablas.forEach((tabla, i) => {
      const etiqueta = etiquetas[i]
      if (!/^(?:(Qualy|Race|Practice) \d+|Sprint)$/.test(etiqueta)) throw Error('Tipo de resultado nacional no reconocido')
      const clave = claveSesion(etiqueta), existente = porClave.get(clave)
      if ((existente?.fecha || ronda.finFecha) > hoy) return
      const e = existente || { id: `${ronda.id}-${clave}`, nombre: `${ronda.nombre} · ${nombreSesion(etiqueta)}`, fecha: ronda.fecha, finFecha: ronda.finFecha, inicio: null, estado: 'por_confirmar', lugar: ronda.lugar, jornada: ronda.jornada, fuenteUrl: ronda.fuenteUrl, detalle: 'Resultado de este fin de semana. La fuente no publica un día y una hora verificables para esta sesión.' }
      let filas
      try { filas = validaFilas(tabla.querySelectorAll('tbody tr').filter(tr => texto(tr.querySelector('.driver-name')?.text)).map(tr => {
        const c = tr.querySelectorAll('td')
        if (c.length !== 7 || !tr.querySelector('.driver-name')) throw Error('Resultado nacional incompleto')
        return { posicion: posicion(c[0].text), nombre: texto(tr.querySelector('.driver-name').text), valores: { numero: dato(c[1].text), equipo: dato(tr.querySelector('.team-name')?.text), vueltas: dato(c[4].text), tiempo: dato(c[5].text), diferencia: dato(c[6].text), estado: dato(c[0].text) } }
      })) } catch { e.detalle += ' La tabla oficial contiene datos incompletos o repetidos y no permite confirmar un resultado fiable.'; if (!existente) eventos.push(e); return }
      e.resultados = [{ id: 'resultado', nombre: `Resultado publicado · ${filas.length} ${filas.length === 1 ? 'piloto identificado' : 'pilotos identificados'}`, fuenteUrl: ronda.fuenteUrl, verificadoEn, columnas: columnas([['numero', 'Dorsal'], ['equipo', 'Equipo'], ['vueltas', 'Vueltas'], ['tiempo', /Fastest Lap/i.test(tabla.querySelector('thead')?.text || '') ? 'Mejor vuelta' : 'Tiempo total'], ['diferencia', 'Diferencia'], ['estado', 'Posición oficial']]), filas }]
      if (filas.length === 1) e.detalle += ' La fuente solo identifica al primer piloto; no publica aquí el resto de participantes.'
      e.estado = 'finalizado'
      if (!existente) eventos.push(e)
    })
  }
  return eventos.length ? eventos : [ronda]
}
