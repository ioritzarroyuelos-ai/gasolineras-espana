import { parse } from 'node-html-parser'
import { validaUrlDeportiva } from './deportes.mjs'
import { createHash } from 'node:crypto'
import { tablaTcrRevisada } from './deportes-motor-tcr-revisados.mjs'

const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const slug = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const puesto = v => /^\d+$/.test(limpia(v)) && Number(v) > 0 ? Number(v) : null
const numero = v => /^-?\d+(?:[.,]\d+)?$/.test(limpia(v)) ? Number(limpia(v).replace(',', '.')) : null

export async function leerPdfMotor(url, opciones = {}) {
  if (!validaUrlDeportiva(url)) throw Error('Fuente PDF no válida')
  const r = await (opciones.fetcher || fetch)(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/pdf', 'User-Agent': 'EspanaUtil/1.0 (+https://webapp-3ft.pages.dev/privacidad)' } })
  if (!r.ok) { await r.body?.cancel(); throw Error(`HTTP ${r.status}`) }
  const maximo = 12 * 1024 * 1024
  if (Number(r.headers.get('content-length')) > maximo || !r.body) { await r.body?.cancel(); throw Error('PDF ausente o demasiado grande') }
  const lector = r.body.getReader(), trozos = []; let total = 0
  try {
    while (true) { const { done, value } = await lector.read(); if (done) break; total += value.byteLength; if (total > maximo) { await lector.cancel(); throw Error('PDF demasiado grande') } trozos.push(value) }
  } finally { lector.releaseLock() }
  const datos = Buffer.concat(trozos)
  if (!datos.subarray(0, 8).toString().startsWith('%PDF-')) throw Error('La fuente no ha entregado un PDF')
  return datos
}

export async function interpretaClasificacionTcrPdf(datos, ano, fuenteUrl, verificadoEn) {
  const { PDFParse } = await import('pdf-parse')
  const pdf = new PDFParse({ data: datos, isEvalSupported: false })
  try {
    const documento = await pdf.getText()
    return interpretaPaginasClasificacionTcr(documento.pages.map(p => p.text), ano, fuenteUrl, verificadoEn)
  } finally { await pdf.destroy() }
}
export function interpretaPaginasClasificacionTcr(paginas, ano, fuenteUrl, verificadoEn) {
    const tablas = []
    for (const text of paginas) {
      const pagina = { text }
      const titulo = pagina.text.match(new RegExp(`(?:Trofeo (?:Junior|Master|TEAM) )?TCR (?:SPAIN|CUP) ${ano}\\b`))?.[0]
      if (!titulo || !/Nombre\s+Total\b/.test(pagina.text)) throw Error('Clasificación TCR de temporada o categoría no verificada')
      const filas = [...pagina.text.matchAll(/^(\d+)\s+([^\t\n]+?)\s*\t\s*(\d+(?:[.,]\d+)?)\s*(?=\t|\n)/gm)].map(m => ({ posicion: Number(m[1]), nombre: limpia(m[2]), valores: { puntos: Number(m[3].replace(',', '.')) } }))
      const candidatos = [...pagina.text.matchAll(/^\d+\s+[^\d\t\n]/gm)]
      if (!filas.length || filas.length !== candidatos.length || filas.length > 500 || new Set(filas.map(f => f.nombre)).size !== filas.length || filas.some(f => f.posicion < 1)) throw Error('Tabla de puntos TCR incompleta')
      tablas.push({ id: slug(titulo.replace(String(ano), '')), nombre: titulo, fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos oficiales' }], filas })
    }
    if (!tablas.length || tablas.length > 30 || new Set(tablas.map(t => t.id)).size !== tablas.length) throw Error('Clasificación TCR duplicada o vacía')
    return tablas
}

export function rondasTcr(html, ano) {
  const doc = parse(html)
  if (limpia(doc.querySelector('title')?.text) !== `Calendario ${ano}`) throw Error('Calendario TCR sin temporada verificada')
  const estado = JSON.parse(doc.querySelector('#gb-app-state')?.text || 'null')
  if (!estado) throw Error('Calendario TCR sin datos')
  const articulos = Object.values(estado).filter(v => v?.body && typeof v.body === 'object').flatMap(v => Object.values(v.body)).filter(Array.isArray).flat().filter(v => v?.title?.match(/^R\d+ ›/))
  const rondas = new Map()
  for (const r of articulos) {
    if (!String(r.url).startsWith(`https://spain.tcr-series.com/calendario-${ano}/`) || !new RegExp(`\\b${ano}$`).test(limpia(r.summary))) throw Error('Ronda TCR de otra temporada')
    const resultados = parse(r.content || '').querySelectorAll('a').filter(a => /^(?:FP\d|Clasificación|Carrera \d)$/.test(limpia(a.text))).map(a => ({ nombre: limpia(a.text), url: a.getAttribute('href') }))
    if (resultados.some(r => !r.url?.startsWith(`https://spain.tcr-series.com/docs/${ano}/`) || !r.url.endsWith('.pdf'))) throw Error('Documento TCR fuera de temporada o dominio')
    rondas.set(r.id, { id: `rfeda-tcr-${r.id}`, nombre: limpia(r.title), rango: limpia(r.summary).replace(new RegExp(` de ${ano}$`), ''), fuenteUrl: r.url, documentos: resultados })
  }
  if (!rondas.size) throw Error('No hay rondas TCR verificables')
  return [...rondas.values()]
}

export function interpretaResultadoTcrTexto(texto, sesion, ano, fuenteUrl, verificadoEn) {
  if (!/TCR\s+SPAIN/i.test(texto) || !new RegExp(`\\b${ano}\\b`).test(texto)) throw Error('Resultado TCR sin texto, identidad o temporada verificables')
  const nombreEsperado = /^FP(\d)$/.test(sesion) ? `Free Practice ${sesion.slice(2)}` : /^Carrera (\d)$/.test(sesion) ? `Race ${sesion.slice(-1)}` : 'Qualifying'
  const esValencia = /TCR WORLD TOUR EVENT OF VALENCIA/.test(texto)
  if ((esValencia || sesion !== 'Clasificación') && !texto.includes(nombreEsperado)) throw Error('Documento TCR de otra sesión')
  const filas = [], claves = new Set(); let estado = 'Orden publicado'
  for (const linea of texto.split('\n')) {
    if (/^Not Classified\b/.test(linea)) estado = 'No clasificado'
    if (/^No Time\b/.test(linea)) estado = 'Sin tiempo'
    let m, posicion, nombre, dorsal
    if (esValencia) {
      m = linea.match(/^(\d+) (.+?) \([A-Z]{3}\)(?: [^\t]*)?\t(\d+|DNC|DNS|DSQ)\s/)
      if (!m) continue
      dorsal = Number(m[1]); nombre = limpia(m[2]); posicion = /^\d+$/.test(m[3]) ? Number(m[3]) : null
    } else if (sesion === 'Clasificación') {
      m = linea.match(/^(\d+) [A-Z]{3} (.+?) ([A-ZÀ-Ý]{2,}(?:[ \t]|$))/)
      if (!m) continue
      posicion = Number(m[1]); nombre = limpia(m[2]); dorsal = '—'
    } else {
      m = linea.match(/^(\d+) (\d+) (.+?) (?:Jr|-) (?:M|-)\s/)
      if (!m) continue
      posicion = Number(m[1]); dorsal = Number(m[2]); nombre = limpia(m[3])
    }
    if (!nombre || claves.has(nombre)) throw Error('Resultado TCR duplicado')
    claves.add(nombre); filas.push({ posicion: estado === 'No clasificado' ? null : posicion, nombre, valores: { numero: dorsal, estado } })
  }
  // Los extractores de estos PDF desplazan columnas de tiempos y puntos. Solo
  // se publica la identidad y el orden inequívoco; nunca se reconstruyen tiempos.
  const candidatos = texto.split('\n').filter(l => esValencia ? /^\d+ .+? \([A-Z]{3}\)/.test(l) : sesion === 'Clasificación' ? /^\d+ [A-Z]{3} /.test(l) : /^\d+ \d+ /.test(l))
  if (!filas.length || filas.length !== candidatos.length || filas.length > 500 || filas.some((f, i) => f.posicion !== null && f.posicion !== i + 1)) throw Error('Resultado TCR con filas incompletas')
  const nombre = esValencia && sesion === 'Clasificación' && /Qualifying 2/.test(texto) ? 'Clasificación 2 · Super Pole' : sesion
  return { id: 'resultado', nombre: `Orden publicado · ${nombre}`, fuenteUrl, verificadoEn, columnas: [{ clave: 'numero', nombre: 'Dorsal publicado' }, { clave: 'estado', nombre: 'Estado oficial' }], filas }
}

export async function interpretaResultadoTcrPdf(datos, sesion, ano, fuenteUrl, verificadoEn) {
  // PDF.js transfiere el ArrayBuffer al extractor y puede dejarlo vacío.
  // La identidad del documento se calcula antes, sobre los bytes descargados.
  const hash = createHash('sha256').update(datos).digest('hex')
  const { PDFParse } = await import('pdf-parse'), pdf = new PDFParse({ data: datos, isEvalSupported: false })
  try {
    try { return interpretaResultadoTcrTexto((await pdf.getText()).text, sesion, ano, fuenteUrl, verificadoEn) }
    catch (error) { const revisado = tablaTcrRevisada(hash, sesion, ano, fuenteUrl, verificadoEn); if (revisado) return revisado; throw error }
  } finally { await pdf.destroy() }
}

export function rondasCerx(html, ano) {
  const estado = JSON.parse(parse(html).querySelector('#gb-app-state')?.text || 'null')
  if (!estado) throw Error('Calendario CERX sin datos')
  const articulos = Object.values(estado).filter(v => v?.body && typeof v.body === 'object').flatMap(v => Object.values(v.body)).filter(Array.isArray).flat().filter(v => v?.url?.startsWith('https://cerx.rfeda.es/resultados/') && v.summary)
  const rondas = new Map(), meses = { enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12' }
  for (const r of articulos) {
    const texto = limpia(r.summary), m = texto.match(new RegExp(`(?:Fecha:\\s*)?(\\d{1,2})(?:\\s*,\\s*\\d{1,2})?\\s*(?:-|y)\\s*(\\d{1,2})\\s+(\\w+)\\s+${ano}\\b`, 'i'))
    if (!m || !meses[m[3].toLowerCase()]) throw Error('Fechas CERX sin temporada verificada')
    const fecha = `${ano}-${meses[m[3].toLowerCase()]}-${m[1].padStart(2, '0')}`, finFecha = `${ano}-${meses[m[3].toLowerCase()]}-${m[2].padStart(2, '0')}`
    if (![fecha, finFecha].every(f => Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0, 10) === f) || fecha > finFecha) throw Error('Rango CERX no válido')
    rondas.set(r.id, { id: `cerx-${r.id}`, nombre: limpia(r.title), fecha, finFecha, inicio: null, estado: 'por_confirmar', fuenteUrl: r.url, detalle: 'Fin de semana publicado por CERX. Consulta en la fuente los horarios y documentos de la prueba.' })
  }
  if (!rondas.size) throw Error('No hay rondas CERX verificables')
  return [...rondas.values()]
}

export const clasificacionesRfedaHtml = [
  { id: 'rfeda-cera', url: 'https://www.rfeda.es/docs/clasificaciones/cera/clasificacion.html', marca: 'CERA' },
  { id: 'rfeda-cem-autohebdo', url: 'https://www.rfeda.es/docs/clasificaciones/cem/clasificacion.html', marca: 'CEM' },
  { id: 'rfeda-copaem', url: 'https://www.rfeda.es/docs/clasificaciones/cem/Clasificaciones%20CopaEM.html', marca: 'Copa CEM' },
]

export function interpretaClasificacionesRfedaHtml(html, marca, ano, fuenteUrl, verificadoEn) {
  const doc = parse(html), titulo = limpia(doc.querySelector('title')?.text)
  if (!titulo.includes(marca) || !new RegExp(`\\b${ano}\\b`).test(titulo)) throw Error('Clasificación RFEDA sin temporada e identidad verificadas')
  const script = doc.querySelectorAll('script').find(s => s.text.trim().startsWith('const DATA='))
  let hojas
  if (script) {
    const literal = script.text.trim().match(/^const DATA=(\[[\s\S]*?\]);(?:\s|$)/)?.[1]
    if (!literal) throw Error('Formato de clasificación RFEDA no reconocido')
    hojas = JSON.parse(literal)
  } else hojas = doc.querySelectorAll('section.sheet').map(s => ({
    id: s.getAttribute('id'), name: limpia(s.querySelector('h2')?.text),
    rows: s.querySelectorAll('.competitor').map(c => ({ pos: limpia(c.querySelector('.competitor-pos')?.text), name: limpia(c.querySelector('.competitor-name')?.text), totals: Object.fromEntries(c.querySelectorAll('.total-item').map(t => [limpia(t.querySelector('span')?.text), limpia(t.querySelector('strong')?.text)])) })),
  }))
  if (!Array.isArray(hojas) || !hojas.length || hojas.length > 30) throw Error('RFEDA no publica tablas reconocibles')
  const tablas = hojas.map(h => {
    if (!h.name || !h.id || !Array.isArray(h.rows)) throw Error('Tabla RFEDA incompleta')
    const filas = h.rows.map(r => {
      const t = r.totals || {}, neto = numero(t['TOTAL NETO'] ?? t.TOTALES), bruto = numero(t['TOTAL BRUTO'] ?? t.BRUTOS)
      if (!limpia(r.name) || neto === null && bruto === null) throw Error('Puntos RFEDA no verificables')
      return { posicion: puesto(r.pos), nombre: limpia(r.name), valores: { puntos: neto ?? bruto, bruto: bruto ?? '—', estado: limpia(r.pos) || 'Sin posición publicada' } }
    })
    if (filas.length > 500 || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Filas RFEDA duplicadas o excesivas')
    return { id: slug(h.id), nombre: `${limpia(h.name)} · clasificación provisional`, fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos oficiales' }, { clave: 'bruto', nombre: 'Puntos brutos' }, { clave: 'estado', nombre: 'Posición oficial' }], filas }
  })
  if (!tablas.some(t => t.filas.length) || new Set(tablas.map(t => t.id)).size !== tablas.length) throw Error('Clasificaciones RFEDA vacías o duplicadas')
  return tablas.filter(t => t.filas.length)
}
