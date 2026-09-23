// Parser puro (sin red) de las tablas de sondeos de Wikipedia (HTML de la API
// action=parse). Extrae, de la(s) tabla(s) de estimaciones, los sondeos con % y
// escaños por partido, y la fila de referencia (resultado de la última
// elección). Diseño defensivo (Codex): detectar la tabla por su cabecera y por
// el encabezado de sección (no por posición), mapear partidos por su nombre (no
// por índice), separar filas de referencia, tratar "—" como ausencia (no 0) y
// los rangos "16/17"/"30-33" como {min,max}. Conserva el texto original de la
// fecha (fechaTexto). El AÑO de las fechas sin año se toma del encabezado de
// sección (=== 2025 ===) con arrastre de mes (las tablas van de más nueva a más
// antigua); si no hay año resoluble, no se emite ISO (solo fechaTexto).
//
// Testeado contra fixtures reales en tests/fixtures/politica/*.html.

import { parse } from 'node-html-parser'

const RE_EMPRESA = /encuestadora|polling firm|casa encuestadora|pollster|comisionista|commissioner/i
const RE_CAMPO = /trabajo de campo|fieldwork|fecha/i
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

// Descompone una fecha de trabajo de campo en componentes (sin decidir el año si
// no viene explícito). días 1-2 cifras, meses es/en, año 4 cifras opcional.
function componentesFecha(text) {
  const texto = limpiaTexto(text)
  if (!texto || texto === '?') return { texto }
  const t = texto.replace(/–|—/g, '-').toLowerCase()
  const anios = [...t.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => parseInt(m[0], 10))
  const anio = anios.length ? anios[anios.length - 1] : null
  const meses = []
  for (const m of t.matchAll(/[a-záéíóú]+/g)) {
    const key = m[0].normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (MESES[key]) meses.push(MESES[key])
  }
  const dias = []
  for (const m of t.matchAll(/\b\d{1,2}\b/g)) dias.push(parseInt(m[0], 10))
  if (meses.length === 0 || dias.length === 0) return { texto, anio }
  return {
    texto,
    anio,
    mes1: meses[0],
    mes2: meses.length > 1 ? meses[1] : meses[0],
    dia1: dias[0],
    dia2: dias.length > 1 ? dias[dias.length - 1] : dias[0],
  }
}

function iso(dia, mes, anio) {
  if (!anio || !mes || !dia || dia < 1 || dia > 31) return undefined
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

// Compat: resuelve una fecha usando anioContexto cuando no hay año explícito.
export function parseFecha(text, anioContexto) {
  const c = componentesFecha(text)
  const anio = c.anio || anioContexto
  if (!c.mes1) return { texto: c.texto }
  return { texto: c.texto, inicio: iso(c.dia1, c.mes1, anio), fin: iso(c.dia2, c.mes2, anio) }
}

function tituloDe(el) {
  const a = el.querySelector('a')
  const img = el.querySelector('img')
  return (a && a.getAttribute('title')) || (img && img.getAttribute('alt')) || el.getAttribute('title') || ''
}

function clasifica(th) {
  const txt = limpiaTexto(th.text)
  const title = tituloDe(th)
  const hay = (re) => re.test(txt) || re.test(title)
  if (hay(RE_EMPRESA)) return { rol: 'empresa' }
  if (hay(RE_MUESTRA)) return { rol: 'muestra' }
  if (hay(RE_PARTICIPACION)) return { rol: 'participacion' }
  if (hay(RE_CAMPO)) return { rol: 'fecha' }
  if (hay(RE_VENTAJA)) return { rol: 'ventaja' }
  const siglas = txt || title
  const nombre = title || txt
  if (siglas && norm(siglas)) return { rol: 'partido', id: norm(siglas).toLowerCase(), siglas: (txt || title).trim(), nombre: nombre.trim() }
  return { rol: 'otro' }
}

function headerText(tab) {
  const r0 = tab.querySelector('tr')
  if (!r0) return ''
  return r0.querySelectorAll('th,td').map((c) => limpiaTexto(c.text) || tituloDe(c)).join(' | ')
}
function esTablaSondeos(tab) {
  const h = headerText(tab)
  return RE_EMPRESA.test(h) && RE_CAMPO.test(h)
}

function parseCelda(td) {
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

// Componentes de fecha de la primera fila de datos (no-referencia) de las tablas
// seleccionadas: sirve para anclar el año del sondeo más reciente.
function primeraFechaDatos(seleccion) {
  for (const { tab } of seleccion) {
    const cols = columnasDe(tab)
    const partidos = cols.filter((c) => c.rol === 'partido')
    const fechaCol = cols.find((c) => c.rol === 'fecha')
    const empresaIdx = (cols.find((c) => c.rol === 'empresa') || { i: 0 }).i
    if (!fechaCol) continue
    const filas = tab.querySelectorAll('tr')
    for (let r = 1; r < filas.length; r++) {
      const tds = filas[r].querySelectorAll('td')
      if (tds.length < partidos.length) continue
      const et = limpiaTexto(tds[empresaIdx] ? tds[empresaIdx].text : '')
      if (!et || RE_REFERENCIA.test(et)) continue
      const c = componentesFecha(tds[fechaCol.i] ? tds[fechaCol.i].text : '')
      if (c.mes1 != null || c.anio != null) return c
    }
  }
  return null
}

/**
 * @param {string} html
 * @param {{ anioReferencia?: number, hoy?: { anio: number, mes: number } }} [opts]
 */
export function parseSondeos(html, opts = {}) {
  const root = parse(html)
  root.querySelectorAll('sup').forEach((s) => s.remove())
  root.querySelectorAll('span,td,div').forEach((el) => {
    if (/display\s*:\s*none/i.test(el.getAttribute('style') || '')) el.remove()
  })

  // Recorre encabezados + tablas en orden de documento; asocia a cada tabla de
  // estimaciones el año de su encabezado de sección más cercano.
  const nodos = root.querySelectorAll('h1,h2,h3,h4,table.wikitable')
  const seleccion = []
  let headText = ''
  for (const n of nodos) {
    const tag = (n.tagName || '').toUpperCase()
    if (/^H[1-4]$/.test(tag)) {
      headText = limpiaTexto(n.text)
      continue
    }
    if (!esTablaSondeos(n)) continue
    const anioHead = (headText.match(/\b(?:19|20)\d{2}\b/) || [])[0]
    const relevante = !!anioHead || RE_HEAD_ESTIM.test(headText) || headText === ''
    if (relevante) seleccion.push({ tab: n, anioHead: anioHead ? parseInt(anioHead, 10) : null })
  }

  const incidencias = []
  if (seleccion.length === 0) {
    return { tablasCoincidentes: 0, candidaturas: [], sondeos: [], referencia: null, incidencias: ['no se encontró tabla de sondeos por cabecera'], filas: { candidatas: 0, aceptadas: 0, rechazadas: 0 } }
  }

  // Ancla del año: el sondeo más NUEVO (primera fila de datos) suele ser reciente.
  // Si su celda trae año explícito, ese manda; si no, se ancla respecto a HOY
  // (que pasa el robot): un mes de inicio posterior al mes actual es del año
  // pasado. A partir de ahí se arrastra hacia atrás (tablas de nuevo a viejo).
  const primera = primeraFechaDatos(seleccion)
  let anioRun = null
  if (primera) {
    if (primera.anio != null) anioRun = primera.anio
    else if (opts.hoy && opts.hoy.anio && primera.mes1 != null) {
      anioRun = primera.mes1 <= (opts.hoy.mes || 12) ? opts.hoy.anio : opts.hoy.anio - 1
    }
  }

  const candMap = new Map()
  const sondeos = []
  let referencia = null
  let candidatasFilas = 0
  let rechazadas = 0
  // Invariante de ordenación: las tablas van de sondeo más NUEVO (arriba) a más
  // ANTIGUO. Guardamos la fecha de FIN del sondeo anterior (más nuevo) para
  // corregir el año inferido: la fecha de fin nunca puede ser posterior a la del
  // anterior; si sale posterior, hemos cruzado a un año anterior. Persiste entre
  // tablas (años consecutivos).
  let prevFinTs = null

  for (const { tab } of seleccion) {
    const columnas = columnasDe(tab)
    const partidos = columnas.filter((c) => c.rol === 'partido')
    if (partidos.length === 0) continue
    const empresaIdx = (columnas.find((c) => c.rol === 'empresa') || { i: 0 }).i
    const fechaCol = columnas.find((c) => c.rol === 'fecha')
    const muestraCol = columnas.find((c) => c.rol === 'muestra')
    for (const p of partidos) if (!candMap.has(p.id)) candMap.set(p.id, { id: p.id, nombre: p.nombre, siglas: p.siglas })

    // anio = año de trabajo (se arrastra fila a fila y entre tablas).
    let anio = anioRun
    const filas = tab.querySelectorAll('tr')
    for (let r = 1; r < filas.length; r++) {
      const tds = filas[r].querySelectorAll('td')
      if (tds.length < partidos.length) continue
      candidatasFilas++
      const empresaTxt = limpiaTexto(tds[empresaIdx] ? tds[empresaIdx].text : '')

      if (RE_REFERENCIA.test(empresaTxt)) {
        const anioFila = (empresaTxt.match(/(?:19|20)\d{2}/) || [])[0]
        const escanos = extraeEscanosFila(tds, columnas)
        if (escanos.length) {
          const match = opts.anioReferencia && anioFila === String(opts.anioReferencia)
          if (match || !referencia) referencia = { texto: empresaTxt, anio: anioFila || null, escanos }
        }
        continue
      }
      if (!empresaTxt) {
        rechazadas++
        continue
      }

      const [empresa, comitente] = empresaTxt.split('/').map((s) => s.trim())
      const c = fechaCol ? componentesFecha(tds[fechaCol.i] ? tds[fechaCol.i].text : '') : { texto: '' }
      // Determina el año de inicio y de fin de esta fila.
      let inicioAnio, finAnio
      if (c.mes1 != null) {
        const base = c.anio != null ? c.anio : anio
        if (base != null) {
          inicioAnio = base
          finAnio = c.mes2 != null && c.mes2 < c.mes1 ? base + 1 : base // rango que cruza fin de año
          // Con año inferido (no explícito), corrige hacia atrás si la fecha de
          // fin saldría posterior a la del sondeo anterior (más nuevo): imposible
          // en una tabla ordenada -> hemos cruzado de año. Arregla el caso dic–ene.
          if (c.anio == null && prevFinTs != null) {
            for (let g = 0; g < 6; g++) {
              const ft = Date.parse(iso(c.dia2 != null ? c.dia2 : c.dia1, c.mes2 != null ? c.mes2 : c.mes1, finAnio) + 'T00:00:00Z')
              if (Number.isNaN(ft) || ft <= prevFinTs) break
              inicioAnio -= 1
              finAnio -= 1
            }
          }
          anio = inicioAnio
        }
      }

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
      const s = { empresa: empresa || empresaTxt, datos, fechaTexto: c.texto || '' }
      if (comitente) s.comitente = comitente
      const inicio = iso(c.dia1, c.mes1, inicioAnio)
      const fin = iso(c.dia2, c.mes2, finAnio)
      if (inicio) s.campoInicio = inicio
      if (fin) {
        s.campoFin = fin
        const ft = Date.parse(fin + 'T00:00:00Z')
        if (!Number.isNaN(ft)) prevFinTs = ft // ancla para el orden de la siguiente fila
      }
      if (muestra != null) s.muestra = muestra
      sondeos.push(s)
    }
    anioRun = anio // arrastra el año a la siguiente tabla (más antigua)
  }

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
