// GAD3 publica la ficha técnica y enlaza su tabla de Datawrapper. El CSV
// original NO incluye necesariamente las correcciones visibles del gráfico.
// Sólo se lee JSON, nunca se ejecuta JavaScript descargado.
import { parse } from 'node-html-parser'
import { parseFecha } from './politica-parse.mjs'

export const GAD3_LISTADO = 'https://www.gad3.com/politica/'
const limpia = s => (s || '').replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ').trim()
const clave = s => limpia(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function descubreGad3(html) {
  const urls = parse(html).querySelectorAll('a[href]').map(a => a.getAttribute('href'))
  return [...new Set(urls)].filter(s => {
    try {
      const u = new URL(s)
      return u.origin === 'https://www.gad3.com' && /^\/barometro-[a-z0-9-]*estimacion-de-voto-nacional-[a-z0-9-]+\/$/.test(u.pathname) && !u.search
    } catch { return false }
  })
}

export function fichaGad3(html, url, hoy) {
  if (!descubreGad3('<a href="' + url + '"></a>').includes(url)) throw new Error('GAD3: URL nacional no reconocida')
  const root = parse(html)
  const titulo = root.querySelector('meta[property="og:title"]')?.getAttribute('content') || ''
  const publicada = root.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
  const publicacion = publicada?.slice(0, 10)
  const texto = limpia(root.querySelector('.entry-content')?.text)
  if (!/estimaci[oó]n de voto nacional/i.test(titulo) || !/^\d{4}-\d{2}-\d{2}$/.test(publicacion || '') || publicacion > hoy
    || !/Instituto:\s*GAD3\b/i.test(texto) || !/[ÁA]mbito nacional/i.test(texto)) throw new Error('GAD3: ficha nacional o publicación no reconocida')
  const campoTexto = /Fechas del trabajo de campo:\s*([^\.]+)/i.exec(texto)?.[1]
  const campo = parseFecha(campoTexto?.replace(/^Del?\s+/i, '').replace(/\s+al\s+/i, '–').replace(/\s+de\s+/gi, ' '), Number(publicacion.slice(0, 4)))
  const muestraTexto = /Tama[ñn]o de (?:la entrevista|la muestra):\s*([\d.,]+) entrevistas/i.exec(texto)?.[1]
  const muestra = Number(muestraTexto?.replace(/[.,]/g, ''))
  if (!campo.inicio || !campo.fin || campo.fin > publicacion || !Number.isInteger(muestra) || muestra < 1) throw new Error('GAD3: fechas de campo o muestra no reconocidas')
  const graficos = root.querySelectorAll('.entry-content iframe').map(n => n.getAttribute('src'))
    .filter(u => /^https:\/\/datawrapper\.dwcdn\.net\/[A-Za-z0-9]{5}\/\d+\/$/.test(u || ''))
  if (graficos.length !== 1) throw new Error('GAD3: no hay una única tabla de estimación enlazada')
  return { titulo, grafico: graficos[0], ppConUpn: new RegExp('UPN-PP:\\s*En coalici[oó]n con PP para ' + publicacion.slice(0, 4)).test(texto),
    sondeo: { empresa: 'GAD3', comitente: 'ABC / Vocento', campoInicio: campo.inicio, campoFin: campo.fin, fechaTexto: limpia(campoTexto), publicacion, muestra, fuenteUrl: url } }
}

const alias = { pp: 'pp', psoe: 'psoe', vox: 'vox', frenteamplio: 'fa', compromisfrontvalencia: 'cfv',
  erc: 'erc', juntsxcat: 'junts', pnv: 'pnv', bildu: 'ehbildu', cc: 'cca', aandalucia: 'aa',
  aramesfrontampli: 'arames', chafrenteamplioaragon: 'chafa', unidaddelpueblocanario: 'upc' }

export function tablaGad3(htmlGrafico, csv, ficha) {
  const literal = /window\.__DW_SVELTE_PROPS__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/s.exec(htmlGrafico)?.[1]
  if (!literal) throw new Error('GAD3: formato de gráfico no reconocido')
  const props = JSON.parse(JSON.parse(literal))
  const chart = props.chart
  if (!chart || chart.type !== 'tables' || chart.publicUrl !== ficha.grafico || chart.externalData
    || chart.metadata?.data?.transpose || !/estimaci[oó]n de voto.*generales/i.test(chart.title)) throw new Error('GAD3: tabla nacional no reconocida')
  // La fuente actual es TSV sin campos multilínea. Ante un formato distinto se
  // conserva la última copia buena en vez de desplazar las columnas.
  if (csv.includes('"') || !csv.includes('\t')) throw new Error('GAD3: formato de datos no reconocido')
  const filas = csv.trimEnd().split(/\r?\n/).map(l => l.split('\t'))
  const cambios = chart.metadata.data.changes ?? []
  if (!Array.isArray(cambios)) throw new Error('GAD3: formato de correcciones no reconocido')
  for (const c of cambios) {
    if (c.ignored) continue
    if (!Number.isInteger(c.row) || !Number.isInteger(c.column) || c.row < 0 || c.row >= filas.length || c.column < 0 || c.column > 50 || typeof c.value !== 'string') throw new Error('GAD3: corrección fuera de la tabla')
    // Datawrapper sólo aplica una corrección si sigue presente su valor previo.
    // No volver a aplicar cambios de una versión anterior del CSV.
    if (c.previous === undefined || filas[c.row][c.column] === c.previous) filas[c.row][c.column] = c.value
  }
  const cab = filas[0].map(limpia)
  const partido = cab.findIndex(c => /^Partido$/i.test(c))
  const porcentajes = cab.map((c, i) => /^%\s*Est\./i.test(c) ? i : -1).filter(i => i >= 0)
  const escanos = cab.map((c, i) => /^Dip\.\s*Est\./i.test(c) ? i : -1).filter(i => i >= 0)
  if (partido < 0 || porcentajes.length !== 1 || escanos.length !== 1) throw new Error('GAD3: columnas de estimación ambiguas')
  const candidaturaMap = new Map(), datos = []
  const numero = s => {
    const texto = limpia(s)
    if (!texto) return null
    if (!/^\d+(?:[,.]\d+)?$/.test(texto)) throw new Error('GAD3: cifra no reconocida')
    return Number(texto.replace(',', '.'))
  }
  for (const fila of filas.slice(1)) {
    const nombre = limpia(fila[partido]).replace(/\*+$/, '')
    const k = clave(nombre)
    if (['total', 'otro', 'otros', 'enblanco'].includes(k)) continue
    const pct = numero(fila[porcentajes[0]]), seats = numero(fila[escanos[0]])
    if (pct == null && seats == null) continue
    if (!k || k.length > 40 || (pct != null && pct > 100) || (seats != null && (!Number.isInteger(seats) || seats > 350))) throw new Error('GAD3: candidatura o valor inválido')
    const id = k === 'pp' && ficha.ppConUpn ? 'ppupn' : alias[k] || k
    if (candidaturaMap.has(id)) throw new Error('GAD3: candidatura duplicada')
    candidaturaMap.set(id, { id, siglas: id === 'ppupn' ? 'PP-UPN' : nombre, nombre: id === 'ppupn' ? 'Partido Popular y Unión del Pueblo Navarro' : nombre })
    datos.push({ candidaturaId: id, pct, escanos: seats })
  }
  if (datos.length < 5 || datos.reduce((sum, d) => sum + (d.escanos || 0), 0) !== 350) throw new Error('GAD3: reparto de escaños incompleto')
  return { candidaturas: [...candidaturaMap.values()], sondeos: [{ ...ficha.sondeo, datos }] }
}

export async function fetchGad3({ fetchImpl = fetch, hoy, userAgent }) {
  const leer = async url => {
    const r = await fetchImpl(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error('GAD3: HTTP ' + r.status)
    return r.text()
  }
  const urls = descubreGad3(await leer(GAD3_LISTADO)).slice(0, 3)
  if (!urls.length) throw new Error('GAD3: no se encuentra la publicación nacional')
  const articulos = await Promise.all(urls.map(async url => ({ url, html: await leer(url) })))
  const fechados = articulos.map(a => ({ ...a, fecha: parse(a.html).querySelector('meta[property="article:published_time"]')?.getAttribute('content') || '' }))
  if (fechados.some(a => !/^\d{4}-\d{2}-\d{2}T/.test(a.fecha))) throw new Error('GAD3: listado con publicación sin fecha')
  const ultimo = fechados.sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
  const ficha = fichaGad3(ultimo.html, ultimo.url, hoy)
  const [grafico, csv] = await Promise.all([leer(ficha.grafico), leer(ficha.grafico + 'dataset.csv')])
  return { ...tablaGad3(grafico, csv, ficha), procedencia: { wiki: 'GAD3', articulo: ficha.titulo, url: ficha.sondeo.fuenteUrl,
    licencia: 'Datos publicados por GAD3; consulta la fuente original', obtenido: new Date().toISOString(), camposFin: [ficha.sondeo.campoFin] } }
}
