// Parser puro (sin red) de las tablas de sondeos de Wikipedia (HTML de la API
// action=parse). Extrae, de la(s) tabla(s) de estimaciones, los sondeos con % y
// escaños por partido, y la fila de referencia (resultado de la última
// elección). Diseño defensivo (Codex): detectar la tabla por su cabecera y por
// el encabezado de sección (no por posición), mapear partidos por su nombre (no
// por índice), separar filas de referencia, tratar "—" como ausencia (no 0) y
// los rangos "16/17"/"30-33" como {min,max}. Conserva el texto original de la
// fecha (fechaTexto). Para el año se usa el que indica la celda o el encabezado
// anual de su sección. El orden de publicación puede diferir del fin de campo.
//
// Testeado contra fixtures reales en tests/fixtures/politica/*.html.

import { parse } from 'node-html-parser'

const RE_EMPRESA = /encuestadora|polling firm|casa encuestadora|pollster|comisionista|commissioner/i
const RE_CAMPO = /trabajo de campo|fieldwork|fecha/i
const RE_PUBLICACION = /publicaci[oó]n|publicad[oa]|publicaci[óo]|publication|published|release/i
const RE_MUESTRA = /muestra|sample/i
const RE_PARTICIPACION = /participaci[oó]n|turnout|% ?voto|% ?vote/i
const RE_VENTAJA = /ventaja|lead|dif\.?|advantage/i
const RE_REFERENCIA = /^\s*\d{4}\b|elecci|general election|regional election|assembly election|european parliament|resultado|referend/i
// El encabezado de sección de una tabla de estimaciones: o lleva año, o cita
// estimación/intención/encuesta (excluye "preferencias"/"preferido").
const RE_HEAD_ESTIM = /estimaci|intenci[oó]n|encuesta|opinion poll|voting intention|seat (?:projection|estimate)|estimates/i

const MESES = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, set: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
}

function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}
function limpiaTexto(s) {
  return (s || '').replace(/\s+/g, ' ').trim()
}

// "31.9", "27,3", "?", "—", "" -> number | null
export function parsePct(text) {
  const m = limpiaTexto(text).match(/-?\d+(?:[.,]\d+)?/)
  if (!m) return null
  const v = parseFloat(m[0].replace(',', '.'))
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null
}

// "133", "16/17", "30-33", "(24)", "—", "" -> number | {min,max} | null
export function parseEscanos(raw) {
  const t = limpiaTexto(raw).replace(/[()]/g, '').replace(/–|—/g, '-')
  if (!t || t === '-' || t === '?') return null
  const rango = t.match(/^(\d+)\s*[/-]\s*(\d+)$/)
  if (rango) {
    let min = parseInt(rango[1], 10)
    let max = parseInt(rango[2], 10)
    if (min > max) [min, max] = [max, min]
    return { min, max }
  }
  const uno = t.match(/^\d+$/)
  return uno ? parseInt(t, 10) : null
}

// El año al final de un intervalo corresponde a su fin. Bajo el encabezado
// 2025, «27 Dic–3 Ene» empieza en diciembre de 2024 y termina en enero de 2025.
function iso(dia, mes, anio) {
  if (!anio || !mes || !dia) return undefined
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined
  return fecha.toISOString().slice(0, 10)
}

export function parseFecha(text, anioContexto) {
  const texto = limpiaTexto(text)
  const t = texto.toLowerCase()
  if (t.includes('?')) return { texto }
  const meses = [...t.matchAll(/[a-záéíóú]+/g)].map(m => MESES[m[0]]).filter(Number.isInteger)
  const dias = [...t.matchAll(/\b\d{1,2}\b/g)]
  const anios = [...t.matchAll(/\b(?:19|20)\d{2}\b/g)]
  if (!dias.length || dias.length > 2 || !meses.length || meses.length > dias.length || anios.length > 2) return { texto }

  const mesInicio = meses[0]
  const mesFin = meses.at(-1)
  const cruzaEnero = mesFin < mesInicio ? 1 : 0
  let anioFin = anioContexto
  let anioInicio
  if (anios.length === 2) {
    anioInicio = Number(anios[0][0])
    anioFin = Number(anios[1][0])
  } else if (anios.length === 1) {
    const anio = Number(anios[0][0])
    // En «28 Dec 2025–5 Jan» el único año está junto al primer extremo.
    anioFin = dias.length === 2 && anios[0].index < dias[1].index ? anio + cruzaEnero : anio
  }
  if (!anioFin) return { texto }
  anioInicio ??= anioFin - cruzaEnero
  const inicio = iso(Number(dias[0][0]), mesInicio, anioInicio)
  const fin = iso(Number(dias.at(-1)[0]), mesFin, anioFin)
  return inicio && fin && inicio <= fin ? { texto, inicio, fin } : { texto }
}

function tituloDe(el) {
  const a = el.querySelector('a')
  const img = el.querySelector('img')
  return (a && a.getAttribute('title')) || (img && img.getAttribute('alt')) || el.getAttribute('title') || ''
}

// Cada referencia bibliográfica (COinS) enlaza un artículo con su fecha de
// publicación. Las fechas de consulta de Wikipedia no pertenecen al sondeo.
function fechaBibliografica(texto) {
  const s = limpiaTexto(texto).toLowerCase()
  const numerica = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (numerica) return iso(+numerica[3], +numerica[2], +numerica[1])
  const literal = /^(\d{1,2})(?: de | )([a-z]+)(?: de | )(\d{4})$/.exec(s)
  if (literal) return iso(+literal[1], MESES[literal[2]], +literal[3])
}

function urlCitada(raw) {
  try {
    const u = new URL(raw)
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port || u.pathname === '/') return
    u.protocol = 'https:'
    u.hash = ''
    if (u.hostname === 'twitter.com' || u.hostname === 'x.com') {
      u.hostname = 'x.com'
      u.search = ''
    }
    return u
  } catch { /* Un texto o enlace relativo no identifica la publicación. */ }
}

// Conserva las citas en la propia celda antes de quitar sus superíndices.
// Así no se hereda por error una publicación de la fila o del partido vecino.
export function citasPorCelda(root) {
  const notas = new Map()
  for (const nota of root.querySelectorAll('li[id]')) {
    const meta = nota.querySelector('.Z3988')
    if (!meta) continue
    const rft = new URLSearchParams(meta.getAttribute('title'))
    const url = urlCitada(rft.get('rft_id'))
    if (!url) continue
    const enlaces = nota.querySelectorAll('.citation a.external, cite a.external')
    if (!enlaces.some(a => urlCitada(a.getAttribute('href'))?.href === url.href)) continue
    notas.set(nota.getAttribute('id'), {
      url, editorial: rft.get('rft.jtitle') || rft.get('rft.pub'),
      fecha: fechaBibliografica(rft.get('rft.date')),
    })
  }
  const porCelda = new WeakMap()
  for (const a of root.querySelectorAll('td sup a')) {
    const href = a.getAttribute('href') || ''
    const nota = href.startsWith('#') && notas.get(href.slice(1))
    if (!nota) continue
    const celda = a.closest('td')
    const citas = porCelda.get(celda) ?? []
    citas.push(nota)
    porCelda.set(celda, citas)
  }
  return porCelda
}

const identidad = nombre => norm((nombre || '').replace(/\.(?:es|com|org|net)$/i, ''))
const fechaMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' })

function editorDelDominio(url) {
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'moreincommones.substack.com') return 'MOREINCOMMON'
  if (host === 'x.com' && /^\/la_septima_tv\/status\/\d+\/?$/i.test(url.pathname)) return 'LASEPTIMA'
  // elmundo.es identifica al medio; elmundo.es.ejemplo.com no lo hace.
  const m = /(?:^|\.)([a-z0-9-]+)\.(?:com|es|org|net)$/.exec(host)
  return m && norm(m[1])
}

export function fuentePrimaria(citas, empresa, comitente, campoFin, hoy = fechaMadrid.format(new Date())) {
  if (!citas?.length || !campoFin) return
  const originales = new Set([empresa, ...(comitente || '').split('/')].map(s => identidad(s.trim())).filter(Boolean))
  const validas = citas.filter(c => originales.has(editorDelDominio(c.url))
    && (!c.editorial || originales.has(identidad(c.editorial)))
    && (!c.fecha || (c.fecha >= campoFin && c.fecha <= hoy)))
  const fechadas = validas.filter(c => c.fecha)
  // Con publicaciones originales en días distintos no podemos identificar de
  // forma inequívoca la fecha. Tampoco escogemos la primera por orden de cita.
  if (new Set(fechadas.map(c => c.fecha)).size > 1) return
  const elegida = fechadas[0] || validas[0]
  if (!elegida) return
  return elegida.fecha ? { fuenteUrl: elegida.url.href, publicacion: elegida.fecha } : { fuenteUrl: elegida.url.href }
}

function clasifica(th) {
  const txt = limpiaTexto(th.text)
  const title = tituloDe(th)
  const hay = (re) => re.test(txt) || re.test(title)
  if (hay(RE_EMPRESA)) return { rol: 'empresa' }
  if (hay(RE_MUESTRA)) return { rol: 'muestra' }
  if (hay(RE_PARTICIPACION)) return { rol: 'participacion' }
  if (hay(RE_PUBLICACION)) return { rol: 'otro' }
  if (hay(RE_CAMPO)) return { rol: 'fecha' }
  if (hay(RE_VENTAJA)) return { rol: 'ventaja' }
  const siglas = txt || title
  const nombre = title || txt
  if (siglas && norm(siglas)) return { rol: 'partido', id: norm(siglas).toLowerCase(), siglas: (txt || title).trim(), nombre: nombre.trim() }
  return { rol: 'otro' }
}

function esTablaSondeos(tab) {
  const cab = tab.querySelector('tr')?.querySelectorAll('th,td').map(clasifica) ?? []
  return cab.some(c => c.rol === 'empresa') && cab.some(c => c.rol === 'fecha')
}

function parseCelda(td) {
  // La fuente puede compartir una misma celda entre filas mediante rowspan.
  td = td.clone()
  const spans = td.querySelectorAll('span')
  let seatSpan = spans.find((s) => /font-size/i.test(s.getAttribute('style') || ''))
  if (!seatSpan) seatSpan = spans.find((s) => /^\(?\d+\s*[/-]?\s*\d*\)?$/.test(limpiaTexto(s.text)))
  let escanosRaw = ''
  if (seatSpan) {
    escanosRaw = seatSpan.text
    seatSpan.remove()
  }
  return { pct: parsePct(td.text), escanos: parseEscanos(escanosRaw) }
}

function columnasDe(tab) {
  const cab = tab.querySelector('tr').querySelectorAll('th,td')
  const columnas = []
  let idx = 0
  for (const th of cab) {
    const span = parseInt(th.getAttribute('colspan') || '1', 10) || 1
    columnas.push({ ...clasifica(th), i: idx })
    idx += span
  }
  return columnas
}

function extraeEscanosFila(tds, columnas) {
  const out = []
  for (const col of columnas) {
    if (col.rol !== 'partido') continue
    const td = tds[col.i]
    if (!td) continue
    const { escanos } = parseCelda(td)
    if (escanos != null) out.push({ candidaturaId: col.id, escanos: typeof escanos === 'number' ? escanos : escanos.max })
  }
  return out
}

// Respeta las celdas compartidas por varias filas. Un número que abarca
// varios partidos (colspan) no se puede atribuir por entero a cada uno.
function filasDeDatos(tabla) {
  const pendientes = []
  const datos = []
  const filas = tabla.querySelectorAll('tr').filter(fila => fila.closest('table') === tabla)
  for (const [indice, fila] of filas.entries()) {
    const columnas = []
    pendientes.forEach((p, i) => { if (p.hasta >= indice) columnas[i] = p.celda })
    let columna = 0
    const propias = fila.childNodes.filter(n => n.tagName === 'TD' || n.tagName === 'TH')
    for (const elemento of propias) {
      while (columna in columnas) columna++
      const ancho = Math.min(100, Number.parseInt(elemento.getAttribute('colspan') || '1', 10) || 1)
      const alto = Math.min(filas.length, Number.parseInt(elemento.getAttribute('rowspan') || '1', 10) || 1)
      const celda = elemento.tagName === 'TD' && ancho === 1 ? elemento : null
      for (let n = 0; n < ancho; n++) {
        columnas[columna] = celda
        if (alto > 1) pendientes[columna] = { celda, hasta: indice + alto - 1 }
        columna++
      }
    }
    if (propias.some(n => n.tagName === 'TD')) datos.push(columnas)
  }
  return datos
}

function tablasDeEstimaciones(root) {
  const seleccion = []
  const titulos = []
  const esAnual = t => /^(?:19|20)\d{2}$/.test(t)
  for (const nodo of root.querySelectorAll('h1,h2,h3,h4,h5,h6,table.wikitable')) {
    if (nodo.tagName !== 'TABLE') {
      const nivel = Number(nodo.tagName[1])
      titulos.length = nivel
      titulos[nivel - 1] = limpiaTexto(nodo.text)
      continue
    }
    if (!esTablaSondeos(nodo)) continue
    const secciones = titulos.filter(Boolean)
    // El mismo encabezado anual puede aparecer bajo estimaciones o bajo voto
    // directo. Los bloques, las preferencias y las respuestas en bruto difieren.
    if (secciones.some(t => /voto direct[oa]|intenci[oó]n directa|voting preferences|preferenci|preferred|predicted|victory (?:likelihood|preferences)|bloque ideol[oó]gico/i.test(t))) continue
    const ultimo = secciones.at(-1) || ''
    if (ultimo && !esAnual(ultimo) && !RE_HEAD_ESTIM.test(ultimo)) continue
    const anio = secciones.filter(esAnual).at(-1)
    seleccion.push({ tab: nodo, anio: anio ? Number(anio) : undefined })
  }
  return seleccion
}

/**
 * @param {string} html
 * @param {{ anioReferencia?: number, hoy?: string }} [opts]
 */
export function parseSondeos(html, opts = {}) {
  const root = parse(html)
  const citas = citasPorCelda(root)
  const hoy = opts.hoy ?? fechaMadrid.format(new Date())
  root.querySelectorAll('sup').forEach((s) => s.remove())
  root.querySelectorAll('span,td,div').forEach((el) => {
    if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) el.remove()
  })

  const seleccion = tablasDeEstimaciones(root)

  const incidencias = []
  if (seleccion.length === 0) {
    return { tablasCoincidentes: 0, candidaturas: [], sondeos: [], referencia: null, incidencias: ['no se encontró tabla de sondeos por cabecera'], filas: { candidatas: 0, aceptadas: 0, rechazadas: 0 } }
  }

  let variantesSinDistinguir = 0
  const candMap = new Map()
  const sondeos = []
  let referencia = null
  let candidatasFilas = 0
  let rechazadas = 0
  for (const { tab, anio } of seleccion) {
    const columnas = columnasDe(tab)
    const partidos = columnas.filter((c) => c.rol === 'partido')
    if (partidos.length === 0) continue
    const empresaIdx = (columnas.find((c) => c.rol === 'empresa') || { i: 0 }).i
    const fechaCol = columnas.find((c) => c.rol === 'fecha')
    const muestraCol = columnas.find((c) => c.rol === 'muestra')
    for (const p of partidos) if (!candMap.has(p.id)) candMap.set(p.id, { id: p.id, nombre: p.nombre, siglas: p.siglas })

    for (const tds of filasDeDatos(tab)) {
      if (tds.length < partidos.length) continue
      candidatasFilas++
      const celdaEmpresa = tds[empresaIdx]
      const celdaFecha = fechaCol && tds[fechaCol.i]
      const empresaTxt = limpiaTexto(celdaEmpresa?.text)

      if (RE_REFERENCIA.test(empresaTxt)) {
        const anioFila = (empresaTxt.match(/(?:19|20)\d{2}/) || [])[0]
        const escanos = extraeEscanosFila(tds, columnas)
        if (escanos.length) {
          const match = opts.anioReferencia && anioFila === String(opts.anioReferencia)
          if (match || !referencia) referencia = { texto: empresaTxt, anio: anioFila || null, escanos }
        }
        continue
      }
      if (!empresaTxt || /<\/?ref\b/i.test(empresaTxt)) {
        rechazadas++
        continue
      }
      // Hay una encuesta con varias estimaciones sin rótulos independientes.
      // Una fila por estimación aparentaría sondeos distintos.
      if (Number(celdaEmpresa.getAttribute('rowspan')) > 1 && Number(celdaFecha?.getAttribute('rowspan')) > 1) {
        variantesSinDistinguir++
        rechazadas++
        continue
      }
      const [empresa, ...encargo] = empresaTxt.split('/').map(s => s.trim())
      const comitente = encargo.join(' / ')
      const fecha = parseFecha(celdaFecha?.text, anio)

      const muestraTxt = muestraCol && tds[muestraCol.i] ? limpiaTexto(tds[muestraCol.i].text).replace(/[.,\s]/g, '') : ''
      const muestra = /^\d+$/.test(muestraTxt) ? parseInt(muestraTxt, 10) : null

      const datos = []
      for (const p of partidos) {
        const td = tds[p.i]
        if (!td) continue
        const { pct, escanos } = parseCelda(td)
        if (pct == null && escanos == null) continue
        datos.push({ candidaturaId: p.id, pct, escanos })
      }
      if (datos.length === 0) {
        rechazadas++
        continue
      }
      const s = { empresa: empresa || empresaTxt, datos, fechaTexto: fecha.texto }
      if (comitente) s.comitente = comitente
      if (fecha.inicio) s.campoInicio = fecha.inicio
      if (fecha.fin) s.campoFin = fecha.fin
      if (muestra != null) s.muestra = muestra
      const publicada = fuentePrimaria(citas.get(celdaEmpresa), empresa, comitente, fecha.fin, hoy)
      if (publicada?.publicacion) Object.assign(s, publicada)
      sondeos.push(s)
    }
  }
  if (variantesSinDistinguir) incidencias.push(variantesSinDistinguir + ' filas con estimaciones alternativas del mismo sondeo sin identificar')

  if (seleccion.length > 1) incidencias.push(`${seleccion.length} tablas de estimaciones combinadas`)

  return {
    tablasCoincidentes: seleccion.length,
    candidaturas: [...candMap.values()],
    sondeos,
    referencia,
    incidencias,
    filas: { candidatas: candidatasFilas, aceptadas: sondeos.length, rechazadas },
  }
}
