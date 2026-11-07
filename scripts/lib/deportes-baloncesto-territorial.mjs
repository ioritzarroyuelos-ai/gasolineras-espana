import { parse } from 'node-html-parser'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'

const GIP = 'https://www.gisaski.eus'
const RESULTADOS = `${GIP}/es/competicion/resultados-clasificaciones/`
const CALENDARIO = `${GIP}/es/competicion/calendario/`
const AJAX = `${GIP}/site/contenido/themes/fgb/core/public/content/competicion/ajax-content.php`
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const numeroId = v => /^\d+$/.test(String(v))
const fechaEsp = v => {
  const m = texto(v).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/)
  const f = m && `${m[3]}-${m[2]}-${m[1]}`
  if (!fechaDeportiva(f)) throw Error('Fecha de partido no válida')
  return f
}
const fechaMadrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
function partesMadrid(ms) { return Object.fromEntries(fechaMadrid.formatToParts(ms).map(p => [p.type, p.value])) }

/** Convierte la hora publicada en Gipuzkoa; no adivina una hora si falta o es ambigua. */
export function horaGipuzkoa(fecha, hora) {
  if (!fechaDeportiva(fecha) || !/^\d{2}:\d{2}$/.test(hora) || hora === '00:00') return null
  const [h, m] = hora.split(':').map(Number)
  if (h > 23 || m > 59) throw Error('Hora de partido no válida')
  const base = Date.parse(`${fecha}T${hora}:00Z`)
  const candidatos = [1, 2].map(offset => base - offset * 3600000).filter(ms => {
    const p = partesMadrid(ms)
    return `${p.year}-${p.month}-${p.day}` === fecha && `${p.hour}:${p.minute}` === hora
  })
  return candidatos.length === 1 ? new Date(candidatos[0]).toISOString() : null
}

export function descubreGipuzkoa(html, ahora = Date.now()) {
  const doc = parse(html), activo = doc.querySelector('#detalle_f_temporada li.active[data-val]')
  const temporada = texto(activo?.textContent), temporadaId = activo?.getAttribute('data-val')
  const p = partesMadrid(ahora), inicio = Number(p.year) - (Number(p.month) < 7 ? 1 : 0)
  if (!numeroId(temporadaId) || temporada !== `${inicio}/${inicio + 1}`) throw Error('Gipuzkoa no identifica la temporada actual')
  const filtro = doc.querySelector('#filterbar')
  if (filtro?.getAttribute('data-template') !== AJAX.replace('content.php', '') || filtro.getAttribute('data-templateslug') !== 'ligas') throw Error('El formato público de Gipuzkoa ha cambiado')
  const referencias = doc.querySelectorAll('#detalle_f_referencia li[data-val]').map(n => ({ id: n.getAttribute('data-val'), nombre: texto(n.textContent) }))
    // Esta referencia solo reúne clubes guipuzcoanos en ligas nacionales. Las ligas completas se leen de la FEB.
    .filter(r => !/COMPETICI[ÓO]N ESTATAL/i.test(r.nombre))
  if (!referencias.length || referencias.some(r => !numeroId(r.id) || !r.nombre.includes(`${inicio}-${String(inicio + 1).slice(-2)}`))) throw Error('Referencias de Gipuzkoa sin temporada verificable')
  const ultima = doc.querySelector('#f_ultjornada')?.getAttribute('value'), proxima = doc.querySelector('#f_proxjornada')?.getAttribute('value')
  if (!fechaDeportiva(ultima) || !fechaDeportiva(proxima)) throw Error('Gipuzkoa no identifica las jornadas')
  return { temporada, temporadaId, referencias, ultima, proxima }
}

export function gruposGipuzkoa(html, temporadaId, referencia) {
  const doc = parse(html)
  const grupos = doc.querySelectorAll('.agrupacion[data-grupo]').map(n => {
    const temporada = n.getAttribute('data-temporada'), ref = n.getAttribute('data-referencia'), categoria = n.getAttribute('data-categoria'), grupo = n.getAttribute('data-grupo')
    if (temporada !== temporadaId || ref !== referencia.id || !numeroId(categoria) || !numeroId(grupo)) throw Error('Identidad del grupo de Gipuzkoa no válida')
    const nombre = texto(n.querySelector('.competi')?.textContent)
    if (!nombre) throw Error('Grupo de Gipuzkoa sin nombre')
    return { temporadaId, referencia: referencia.id, referenciaNombre: referencia.nombre, categoria, grupo, nombre }
  })
  if (!grupos.length && !/no tiene configurada ninguna competici[oó]n/i.test(doc.textContent)) throw Error('No se pueden leer los grupos de Gipuzkoa')
  if (new Set(grupos.map(g => `${g.categoria}-${g.grupo}`)).size !== grupos.length) throw Error('Grupos de Gipuzkoa duplicados')
  return grupos
}

function urlGrupo(grupo, base = RESULTADOS) {
  const url = new URL(base)
  for (const [clave, valor] of Object.entries({ temporada: grupo.temporadaId, referencia: grupo.referencia, categoria: grupo.categoria, grupo: grupo.grupo })) url.searchParams.set(clave, valor)
  return url.href
}
function compruebaEnlace(href, grupo) {
  const url = new URL(href, CALENDARIO)
  if (url.origin !== GIP || ['temporada', 'referencia', 'categoria', 'grupo'].some(k => url.searchParams.get(k) !== ({ temporada: grupo.temporadaId, referencia: grupo.referencia, categoria: grupo.categoria, grupo: grupo.grupo })[k])) throw Error('Datos de otra temporada o grupo en Gipuzkoa')
}
function compruebaFecha(fecha, temporada) {
  if (fecha < `${temporada.slice(0, 4)}-07-01` || fecha > `${temporada.slice(-4)}-06-30`) throw Error('Partido fuera de la temporada publicada')
}

export function calendarioGipuzkoa(html, grupo, temporada, ahora = Date.now()) {
  const doc = parse(html), tarjetas = doc.querySelectorAll('.card__partidos'), eventos = new Map()
  const hoyMadrid = partesMadrid(ahora), hoy = `${hoyMadrid.year}-${hoyMadrid.month}-${hoyMadrid.day}`
  if (!tarjetas.length) {
    if (/no (?:hay|tiene|se han)|sin partidos|no est[aá].*configurad/i.test(doc.textContent)) return []
    throw Error('No se puede leer el calendario de Gipuzkoa')
  }
  for (const tarjeta of tarjetas) {
    const enlace = tarjeta.querySelector('.card__header a')
    if (!enlace) throw Error('Jornada de Gipuzkoa sin identidad')
    compruebaEnlace(enlace.getAttribute('href'), grupo)
    const jornada = texto(enlace.textContent)
    let fecha = null, metas = null, aplazamiento = ''
    for (const fila of tarjeta.querySelectorAll('.row')) {
      if (fila.classList.contains('date')) {
        const publicada = fechaEsp(fila.textContent)
        compruebaFecha(publicada, temporada)
        fecha = /d[ií]a sin definir/i.test(fila.textContent) ? null : publicada
        continue
      }
      if (fila.classList.contains('metas')) { metas = fila; aplazamiento = ''; continue }
      if (fila.classList.contains('partidoVinculado')) { aplazamiento = texto(fila.textContent); continue }
      if (!fila.classList.contains('partido')) continue
      const local = texto(fila.querySelector('.left .equipo')?.textContent), visitante = texto(fila.querySelector('.right .equipo')?.textContent)
      // Los descansos no son partidos. No se crean rivales ni marcadores para ellos.
      if (/^(descansa|descanso|libre)$/i.test(local) || /^(descansa|descanso|libre)$/i.test(visitante)) continue
      const id = metas?.querySelector('[data-partido]')?.getAttribute('data-partido')
      if (!local || !visitante || !numeroId(id)) throw Error('Partido de Gipuzkoa incompleto')
      for (const a of fila.querySelectorAll('a.fichaEquipo')) compruebaEnlace(a.getAttribute('href'), grupo)
      const hora = texto(metas?.querySelector('.time span')?.textContent)
      const lugar = texto(metas?.querySelector('.loc span')?.textContent)
      let inicio = fecha && !aplazamiento ? horaGipuzkoa(fecha, hora) : null
      const a = texto(fila.querySelector('.marcador .local')?.textContent), b = texto(fila.querySelector('.marcador .visitante')?.textContent)
      const numerico = /^\d+$/.test(a) && /^\d+$/.test(b), marcador = numerico && (Number(a) + Number(b) > 0)
      if ((a || b) && !numerico && !/aplazad|suspendid|cancelad|pendiente/i.test(fila.textContent)) throw Error('Marcador de Gipuzkoa incompleto')
      if (marcador && (Number(a) > 1000 || Number(b) > 1000)) throw Error('Marcador de Gipuzkoa fuera de rango')
      if (marcador && !aplazamiento && ((inicio && Date.parse(inicio) > ahora) || (fecha && fecha > hoy))) throw Error('Gipuzkoa publica un resultado con fecha futura')
      const nota = texto([aplazamiento, fila.querySelector('.observaciones')?.textContent].filter(Boolean).join(' '))
      const cambio = aplazamiento.match(/jornada\s+(\d{2})\/(\d{2})\/(\d{4})/i)
      const fechaReferencia = aplazamiento ? cambio && `${cambio[3]}-${cambio[2]}-${cambio[1]}` : fecha
      // El HTML no publica un estado de fin de partido. Un tanteo del mismo día
      // puede estar en curso aunque la hora de comienzo ya haya pasado.
      const final = marcador && fechaDeportiva(fechaReferencia) && fechaReferencia < hoy
      let estado = final ? 'finalizado' : /cancelad/i.test(nota) ? 'cancelado' : /aplazad|suspendid/i.test(nota) ? 'aplazado' : marcador ? 'por_confirmar' : inicio && Date.parse(inicio) > ahora ? 'programado' : 'por_confirmar'
      // La fecha de la jornada de destino no es la nueva fecha real del partido.
      // Tampoco se conserva como hora real la fecha original de un aplazamiento.
      const fechaEvento = aplazamiento ? null : fecha
      if (aplazamiento) inicio = null
      const evento = { id: `gip-${id}`, nombre: `${local} – ${visitante}`, local, visitante, inicio, fecha: inicio ? null : fechaEvento, estado, jornada, ...(lugar ? { lugar } : {}), ...(nota ? { detalle: nota } : {}), fuenteUrl: urlGrupo(grupo, CALENDARIO), ...(final ? { resultado: { local: Number(a), visitante: Number(b) } } : {}) }
      const anterior = eventos.get(evento.id)
      if (anterior && (anterior.local !== local || anterior.visitante !== visitante || JSON.stringify(anterior.resultado) !== JSON.stringify(evento.resultado))) throw Error('Partido repetido con datos contradictorios')
      // El mismo encuentro puede figurar en la jornada original y la de recuperación.
      if (!anterior || (!anterior.inicio && evento.inicio)) eventos.set(evento.id, evento)
      metas = null; aplazamiento = ''
    }
  }
  return [...eventos.values()]
}

export function clasificacionGipuzkoa(html, grupo) {
  const doc = parse(html), tabla = doc.querySelector('table')
  if (!tabla) {
    if (/no (?:hay|tiene|se han)|sin clasificaci|no est[aá].*configurad|no se muestra|no disponible/i.test(doc.textContent)) return []
    throw Error('No se puede leer la clasificación de Gipuzkoa')
  }
  const encabezados = tabla.querySelectorAll('thead th').map(n => texto(n.textContent).toUpperCase())
  if (encabezados.join('|') !== 'POS|EQUIPO|PTOS|PJ|PG|PE|PP|NP|TF|TC') throw Error('Columnas de clasificación de Gipuzkoa desconocidas')
  const claves = ['puntos', 'pj', 'pg', 'pe', 'pp', 'np', 'pf', 'pc']
  const nombres = ['Puntos', 'Jugados', 'Ganados', 'Empatados', 'Perdidos', 'No presentados', 'A favor', 'En contra']
  const filas = tabla.querySelectorAll('tbody tr').map(n => {
    const c = n.querySelectorAll('td'), nombre = texto(n.querySelector('.equipo')?.textContent)
    if (c.length !== 10 || !nombre || !/^\d+$/.test(texto(c[0]?.textContent))) throw Error('Fila de clasificación de Gipuzkoa incompleta')
    for (const a of n.querySelectorAll('a[href]')) compruebaEnlace(a.getAttribute('href'), grupo)
    const valores = c.slice(2).map(celda => texto(celda.textContent))
    if (valores.some(v => !/^-?\d+$/.test(v))) throw Error('Puntuación de clasificación no publicada')
    return { posicion: Number(texto(c[0].textContent)), nombre, valores: Object.fromEntries(claves.map((k, i) => [k, Number(valores[i])])) }
  })
  return filas.length ? [{ id: 'clasificacion', nombre: 'Clasificación del grupo', columnas: claves.map((clave, i) => ({ clave, nombre: nombres[i] })), filas }] : []
}

async function paralelo(items, fn) {
  const salida = new Array(items.length)
  let indice = 0
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (indice < items.length) { const i = indice++; salida[i] = await fn(items[i], i) }
  }))
  return salida
}
function bloque(url, consultado, clave, contenido, aviso) {
  const disponible = contenido !== null && contenido.length > 0
  return { estado: disponible ? 'actualizado' : 'no_disponible', consultado, ...(disponible ? { verificadoEn: consultado } : {}), fuenteUrl: url, [clave]: disponible ? contenido : [], ...(aviso ? { aviso } : {}) }
}

export async function obtieneBaloncestoTerritorial(opciones = {}) {
  const ahora = opciones.ahora ?? Date.now(), consultado = new Date(ahora).toISOString(), competiciones = [], incidencias = []
  const fallo = (nombre, fuenteUrl, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, fuenteUrl, motivo: String(motivo).slice(0, 500), ...(id ? { id } : {}) })
  let limiteConsultas = false
  async function consulta(url, params) {
    if (limiteConsultas) throw Error('La federación ha limitado las consultas (HTTP 429). Hemos detenido esta actualización.')
    const fetcher = opciones.fetcher || fetch
    const configuracion = params ? { ...opciones, fetcher: (u, init) => fetcher(u, { ...init, method: 'POST', body: new URLSearchParams(params), headers: { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }) } : opciones
    const leer = async () => {
      try { return await leerFuenteDeportiva(url, configuracion) }
      catch (e) { if (/HTTP 429\b/.test(e.message)) limiteConsultas = true; throw e }
    }
    try { return await leer() }
    catch (error) {
      if (limiteConsultas || /HTTP (?:401|403|404)/.test(error.message)) throw error
      return leer()
    }
  }
  try {
    const info = descubreGipuzkoa(await consulta(RESULTADOS), ahora)
    function parametros(referencia, categoria = '', grupo = '', templateName) {
      return { lang: 'es', mobile: '0', verjornada: '0', templateSlug: 'ligas', template: templateName === 'clasificacion' ? 'resultados' : 'calendario', urlcalen: CALENDARIO, urlclasi: RESULTADOS, f_temporada: info.temporadaId, f_referencia: referencia, f_categoria: categoria, f_grupo: grupo, f_ultjornada: info.ultima, f_proxjornada: info.proxima, ...(templateName ? { templateName } : {}) }
    }
    const encontrados = await paralelo(info.referencias, async referencia => {
      try { return gruposGipuzkoa(await consulta(AJAX, parametros(referencia.id)), info.temporadaId, referencia) }
      catch (e) { fallo(referencia.nombre, RESULTADOS, e.message); return [] }
    })
    const grupos = encontrados.flat()
    opciones.log?.(`Gipuzkoa: ${grupos.length} grupos territoriales y escolares publicados`)
    const resultados = await paralelo(grupos, async grupo => {
      const url = urlGrupo(grupo), id = `basket-gip-${grupo.referencia}-${grupo.categoria}-${grupo.grupo}`
      let eventos = null, tablas = null, avisoAgenda, avisoTabla
      // Secuencial dentro de cada grupo: nunca se superan tres peticiones simultáneas.
      try { eventos = calendarioGipuzkoa(await consulta(AJAX, parametros(grupo.referencia, grupo.categoria, grupo.grupo, 'jornadas')), grupo, info.temporada, ahora) }
      catch (e) { avisoAgenda = 'No hemos podido comprobar el calendario de este grupo.'; fallo(grupo.nombre, url, e.message, id) }
      try { tablas = clasificacionGipuzkoa(await consulta(AJAX, parametros(grupo.referencia, grupo.categoria, grupo.grupo, 'clasificacion')), grupo) }
      catch (e) { avisoTabla = 'No hemos podido comprobar la clasificación de este grupo.'; fallo(grupo.nombre, url, e.message, id) }
      if (eventos?.length === 0) avisoAgenda = 'La federación todavía no publica partidos para este grupo.'
      if (tablas?.length === 0) avisoTabla = 'La federación no publica una clasificación para este grupo.'
      const referencia = grupo.referenciaNombre.replace(/\s*\d{4}-\d{2}\s*$/, '')
      const categoria = grupo.nombre.split(/\s+-\s+/)[0]
      const genero = /\bFem\b|FEMENIN/i.test(categoria) ? 'femenino' : /\bMas\b|MASCULIN/i.test(categoria) ? 'masculino' : /MIXT/i.test(categoria) ? 'mixto' : null
      return { id, deporte: 'baloncesto', nombre: grupo.nombre, temporada: info.temporada, categoria, zona: /COMPETICI[ÓO]N VASCA/i.test(referencia) ? 'País Vasco' : 'Gipuzkoa', grupo: referencia, ...(genero ? { genero } : {}), fuente: { nombre: 'Federación Guipuzcoana de Baloncesto', url }, comprobadoEn: consultado, agenda: bloque(urlGrupo(grupo, CALENDARIO), consultado, 'eventos', eventos, avisoAgenda), clasificacion: bloque(url, consultado, 'tablas', tablas, avisoTabla) }
    })
    competiciones.push(...resultados)
  } catch (e) { fallo('Baloncesto de Gipuzkoa', RESULTADOS, e.message) }
  return { competiciones, incidencias }
}
