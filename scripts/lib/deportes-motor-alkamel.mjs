import { parse } from 'node-html-parser'
import { interpretaResultadoFerrari } from './deportes-motor-ferrari.mjs'

export const fuenteAlkamelEspana = 'https://f4spain-e3.alkamelsystems.com/'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const slug = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const circuito = v => { const n = slug(v); return /ricardo-tormo|valencia/.test(n) ? 'valencia' : /portimao|algarve/.test(n) ? 'portimao' : /^(?:montmelo|barcelona)$/.test(n) ? 'barcelona' : n }
const sesionClave = v => slug(v).replace(/^official-previous-test(?=-|$)/, 'official-test').replace(/^(?:sprint-race|carrera-sprint)$/, 'sprint').replace(/^qualification-/, 'qualifying-').replace(/^clasificacion-/, 'qualifying-').replace(/^carrera-/, 'race-').replace(/^entrenamientos-libres-/, 'free-practice-')
const nombreSesion = v => limpia(v).replace(/^Official (?:Previous )?Test\b/i, 'Pruebas oficiales').replace(/^Sprint Race$/i, 'Carrera sprint').replace(/^Qualifying\s/i, 'Clasificación ').replace(/^Race\s/i, 'Carrera ').replace(/^Free Practice\s/i, 'Entrenamientos libres ')
const horaPublicada = e => e.detalle?.match(/Hora publicada:\s*(\d\d:\d\d)/)?.[1]
const pruebaOficial = e => /-official-test(?:-\d+)?$/.test(e.id)

export function interpretaIndiceAlkamelEspana(html, ano) {
  const doc = parse(html), temporada = doc.querySelector('select[name="season"]'), elegido = temporada?.querySelector('option[selected]')
  const opcion = temporada?.querySelectorAll('option').find(o => limpia(o.text) === String(ano))
  if (!opcion || elegido?.getAttribute('value') !== opcion.getAttribute('value') || !/^\d+_\d{4}$/.test(opcion.getAttribute('value') || '')) throw Error('Alkamel no muestra la temporada solicitada')
  const eventos = doc.querySelectorAll('select[name="evvent"] option').map(o => ({ valor: o.getAttribute('value'), nombre: limpia(o.text), seleccionado: o.hasAttribute('selected') }))
  if (!eventos.length || eventos.some(e => !/^\d+_[A-Z0-9_ -]+$/.test(e.valor || '')) || new Set(eventos.map(e => e.valor)).size !== eventos.length) throw Error('Catálogo Alkamel vacío o ambiguo')
  return { temporada: opcion.getAttribute('value'), eventos }
}

export function interpretaSesionesAlkamelEspana(html, temporada, evento, ano, informa = () => {}) {
  const indice = interpretaIndiceAlkamelEspana(html, ano)
  if (indice.temporada !== temporada || !indice.eventos.some(e => e.valor === evento && e.seleccionado)) throw Error('Alkamel ha devuelto otra prueba')
  const salida = new Map(), carpetasAmbiguas = new Set()
  for (const a of parse(html).querySelectorAll('a[href]')) {
    const href = a.getAttribute('href')
    if (!/\/03_Classification_[^/]+\.CSV$/i.test(href || '')) continue
    const url = new URL(href, fuenteAlkamelEspana)
    if (url.origin !== new URL(fuenteAlkamelEspana).origin) throw Error('CSV Alkamel fuera del cronometrador oficial')
    const ruta = decodeURIComponent(url.pathname), m = ruta.match(/^\/Results\/([^/]+)\/([^/]+)\/\d+_(F4Spain|Eurocup3)\/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)_([^/]+)\/03_Classification_([^/]+)\.CSV$/i)
    if (!m) continue // Otros campeonatos tienen sus propios calendarios.
    if (m[1] !== temporada || m[2] !== evento || Number(m[4]) !== ano) continue // El índice puede conservar enlaces a otra prueba.
    const carpeta = url.href.slice(0, url.href.lastIndexOf('/') + 1)
    const fecha = `${m[4]}-${m[5]}-${m[6]}`
    if (!Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0, 10) !== fecha || Number(m[7]) > 23 || Number(m[8]) > 59 || limpia(m[9]) !== limpia(m[10])) {
      carpetasAmbiguas.add(carpeta); informa('Sesión Alkamel con fecha o documentos contradictorios: no se elige una versión sin verificar', url.href); continue
    }
    const id = m[3].toLowerCase() === 'f4spain' ? 'formula-4-espana' : 'eurocup-3'
    salida.set(url.href, { competicionId: id, fecha, hora: `${m[7]}:${m[8]}`, sesion: limpia(m[9]), fuenteUrl: url.href })
  }
  if (salida.size > 100) throw Error('Demasiadas sesiones en una prueba Alkamel')
  return [...salida.values()].filter(s => !carpetasAmbiguas.has(s.fuenteUrl.slice(0, s.fuenteUrl.lastIndexOf('/') + 1)))
}

export function interpretaResultadoAlkamelEspana(texto, sesion, fuenteUrl, verificadoEn) {
  const tabla = interpretaResultadoFerrari(texto, sesion, fuenteUrl, verificadoEn)
  const puestos = tabla.filas.map(f => f.posicion).filter(p => p !== null)
  if (new Set(puestos).size !== puestos.length || puestos.some((p, i) => p !== i + 1)) throw Error('Clasificación Alkamel con posiciones repetidas o perdidas')
  return { ...tabla, nombre: 'Resultado publicado por el cronometrador oficial' }
}

export async function ampliaEspanaAlkamel(competiciones, leer, ano, ahora, consultado, incidencias) {
  const seleccionadas = competiciones.filter(c => ['formula-4-espana', 'eurocup-3'].includes(c.id) && c.agenda.estado === 'actualizado')
  if (!seleccionadas.length) return
  const pendientes = new Set()
  const falla = (c, url, e, conservar = true) => { incidencias.push({ deporte: 'motor', id: c.id, nombre: `${c.nombre}: cronometraje`, fuenteUrl: url, motivo: e.message }); if (conservar) pendientes.add(c) }
  const dejaPendientes = () => { for (const c of pendientes) c.agenda = { estado: 'no_disponible', consultado, fuenteUrl: c.agenda.fuenteUrl, eventos: [], aviso: 'No se han podido comprobar todas las sesiones del cronometrador. Se conserva la agenda anterior cuando existe.' } }
  let html, indice
  try { html = await leer(fuenteAlkamelEspana); indice = interpretaIndiceAlkamelEspana(html, ano) }
  catch (e) { for (const c of seleccionadas) falla(c, fuenteAlkamelEspana, e); dejaPendientes(); return }
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ahora), rondas = []
  for (const c of seleccionadas) {
    const grupos = new Map()
    for (const e of c.agenda.eventos) {
      if (!e.fecha || !e.lugar) continue
      const clave = `${e.jornada}|${circuito(e.lugar)}`, previo = grupos.get(clave)
      if (previo) { previo.fecha = [previo.fecha, e.fecha].sort()[0]; previo.finFecha = [previo.finFecha, e.finFecha || e.fecha].sort().at(-1); previo.eventos.push(e) }
      else grupos.set(clave, { c, lugar: e.lugar, jornada: e.jornada, fecha: e.fecha, finFecha: e.finFecha || e.fecha, eventos: [e] })
    }
    rondas.push(...grupos.values())
  }
  const tareas = [], destinosUsados = new Set()
  for (const evento of indice.eventos) {
    if (/SWC|OCT/.test(evento.nombre)) continue // Winter Series y test fuera de la temporada ordinaria.
    const candidatas = rondas.filter(r => circuito(r.lugar) === circuito(evento.nombre) && r.fecha <= hoy)
    if (!candidatas.length) continue
    const url = new URL(fuenteAlkamelEspana); url.searchParams.set('season', indice.temporada); url.searchParams.set('evvent', evento.valor)
    try {
      const pagina = evento.seleccionado ? html : await leer(url.href)
      for (const s of interpretaSesionesAlkamelEspana(pagina, indice.temporada, evento.valor, ano, (motivo, fuenteUrl) => { for (const c of new Set(candidatas.map(r => r.c))) falla(c, fuenteUrl, Error(motivo), false) })) {
        const coinciden = candidatas.filter(r => r.c.id === s.competicionId && r.fecha <= s.fecha && r.finFecha >= s.fecha)
        if (coinciden.length !== 1 || s.fecha > hoy) continue // El catálogo contiene también enlaces antiguos mal agrupados.
        const r = coinciden[0]
        tareas.push(async () => {
          try {
            const resultado = interpretaResultadoAlkamelEspana(await leer(s.fuenteUrl), s.sesion, s.fuenteUrl, consultado)
            // Algunos títulos del campeonato omiten el número de entrenamiento,
            // pero su ID conserva free-practice-1/2. Se reutiliza esa identidad
            // dentro de la ronda verificada, sin añadir una segunda tarjeta.
            const clave = sesionClave(s.sesion), oficial = /^official-test(?:-\d+)?$/.test(clave)
            // Los números de Official Test en el calendario proceden de su
            // orden de aparición. Nunca se emparejan con Test1/2 por ese orden:
            // la familia, el día y la hora publicada deben coincidir exactamente.
            const anteriores = r.eventos.filter(e => oficial ? pruebaOficial(e) && e.fecha === s.fecha && horaPublicada(e) === s.hora :
              sesionClave(e.nombre.split(' · ').at(-1)) === clave || e.id.endsWith('-' + clave) ||
              /^free-practice-\d+$/.test(clave) && e.id.endsWith('-free-practice') && e.fecha === s.fecha && horaPublicada(e) === s.hora)
            if (anteriores.length > 1) throw Error('Sesión del campeonato ambigua: no se sustituye')
            const anterior = anteriores[0], id = anterior?.id || `${r.c.id}-alkamel-${slug(`${r.lugar}-${s.fecha}-${s.hora}-${s.sesion}`)}`
            const destino = `${r.c.id}:${id}`, posicionAnterior = anterior ? r.c.agenda.eventos.indexOf(anterior) : -1
            if (destinosUsados.has(destino) || anterior && posicionAnterior < 0) throw Error('Dos documentos intentan sustituir la misma sesión: se conserva la agenda anterior')
            // Relación 1:1. No hay ningún await entre reservar y sustituir: otra
            // tarea no puede reutilizar la referencia anterior ni hacer splice(-1).
            destinosUsados.add(destino)
            const mismaFecha = anterior?.fecha === s.fecha, horaAnterior = anterior && horaPublicada(anterior)
            const inicio = mismaFecha && anterior.inicio && horaAnterior === s.hora ? anterior.inicio : null
            const conflicto = Boolean(anterior?.inicio && !inicio)
            let detalle = inicio ? 'Horario confirmado por el campeonato y coincidente con su cronometrador. Resultados publicados en la tabla oficial de esta sesión.' : `Hora publicada: ${s.hora}. ${conflicto ? 'No coincide con el horario confirmado anteriormente; consulta la fuente antes de tomarlo como definitivo.' : 'El cronometrador no indica la zona horaria; se muestra sin convertir.'} Resultados publicados en la tabla oficial de esta sesión.`
            if (oficial && !anterior && r.eventos.some(pruebaOficial)) {
              const oficiales = r.eventos.filter(pruebaOficial)
              const horasDistintas = oficiales.every(e => e.fecha === s.fecha && horaPublicada(e) && horaPublicada(e) !== s.hora)
              const aviso = horasDistintas ? 'El calendario y el cronometraje publican horas distintas para las pruebas oficiales de esta ronda; no se ha podido confirmar qué entradas corresponden entre sí.' : 'No se ha podido confirmar qué prueba oficial del calendario corresponde a este documento. Las fechas o las horas publicadas no permiten asociarlos con seguridad.'
              detalle += ' ' + aviso
              for (const e of r.eventos.filter(pruebaOficial)) if (!e.detalle?.includes(aviso)) e.detalle = `${e.detalle || ''} ${aviso}`.trim()
            }
            const e = { id, nombre: `${r.lugar} · ${nombreSesion(s.sesion)}`, fecha: s.fecha, inicio, estado: mismaFecha && !conflicto && anterior.estado === 'finalizado' ? 'finalizado' : 'por_confirmar', lugar: r.lugar, ...(r.jornada ? { jornada: r.jornada } : {}), fuenteUrl: s.fuenteUrl, detalle, resultados: [resultado] }
            if (anterior) r.c.agenda.eventos.splice(posicionAnterior, 1, e)
            else r.c.agenda.eventos.push(e)
          } catch (e) { falla(r.c, s.fuenteUrl, e) }
        })
      }
    } catch (e) { for (const r of candidatas) falla(r.c, url.href, e) }
  }
  let siguiente = 0
  await Promise.all(Array.from({ length: 2 }, async () => { while (siguiente < tareas.length) await tareas[siguiente++]() }))
  for (const c of seleccionadas) c.agenda.aviso = 'Sesiones del campeonato y resultados de su cronometrador oficial. Si falta una tabla completa, se mantiene únicamente lo que publica la fuente, indicado en la sesión. Las horas sin zona confirmada se muestran como texto.'
  dejaPendientes()
}
