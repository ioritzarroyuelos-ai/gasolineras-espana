#!/usr/bin/env node
// v1.41 — Descarga las farmacias de guardia de la provincia de Sevilla
// desde los PDFs trimestrales del COF Sevilla (farmaceuticosdesevilla.es).
//
// 9 zonas farmaceuticas:
//   - 4 zonas con texto (Aljarafe, Sevilla capital, alcaladeguadaira,
//     moron-osuna-estepa, sierranorte): parser de texto via pdf-parse.
//   - 5 zonas con PDFs ESCANEADOS (alcaladelrio, brenes, burguillos,
//     cantillana, carmona): parser OCR via tesseract.js + @napi-rs/canvas
//     + pdfjs-dist. Cada PDF cubre el trimestre con un par Dia+Noche por
//     dia. Indice del par = dias desde el inicio del trimestre. El texto
//     OCR se cachea por hash de PDF para no re-OCR el mismo trimestre.
//
// Fuente:
//   https://servicios.farmaceuticosdesevilla.es/images/farmaciasguardia/T<N>/<zona>.pdf
//   donde N = 1..4 (trimestre actual) y zona en lista fija.
//   El widget HTML que indexa los PDFs:
//   https://servicios.farmaceuticosdesevilla.es/farmaciasguardiaweb?u=db017cb7039e43d3cc3a05c06f774ed0
//
// Estructura del PDF:
//   Cada dia: "<diaSemana> <numDia> <mes> <year>"  (header)
//             "Día (de 9:30 a 22:00)"               (sub-header diurnos)
//             "<Municipio>@@@ @@@<Direccion> (<Telefono>)@@@@@@" (lineas)
//             "Noche (de 22:00 a 09:30)"            (sub-header nocturnos)
//             "<Municipio>@@@ @@@<Direccion> (<Telefono>)@@@@@@" (lineas)
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'sevilla-geo.json')
const OCR_CACHE_DIR = resolve(CACHE_DIR, 'sevilla-ocr')
const OUT_FILE = resolve(DATA_DIR, 'guardias-sevilla.json')

const BASE = 'https://servicios.farmaceuticosdesevilla.es'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.41 (+https://webapp-3ft.pages.dev)'

// BBOX provincia Sevilla. Provincia tiene 105 municipios — bbox holgado.
const BBOX = { minLat: 36.8, maxLat: 38.1, minLng: -6.6, maxLng: -4.5 }

// 9 zonas farmaceuticas de la provincia de Sevilla. Sus PDFs son fijos
// (mismo nombre cada trimestre). La grafia es la del COF: 'Aljarafe' tiene
// mayuscula, el resto minusculas.
const ZONAS = [
  'Aljarafe',
  'Sevilla', // capital — formato distinto, parser dedicado
  'alcaladeguadaira',
  'alcaladelrio',
  'brenes',
  'burguillos',
  'cantillana',
  'carmona',
  'moron-osuna-estepa',
  'sierranorte',
]

// Zonas que cubren un unico municipio. En estas no hay columna "Municipio"
// en el PDF (ya viene implicito) y el formato es:
//   "Ŀ<direccion> (<tel>) - <nombre>"
const ZONA_MUNICIPIO_UNICO = {
  alcaladeguadaira: 'Alcalá de Guadaira',
}

// Zonas con PDFs ESCANEADOS (sin texto). Pipeline OCR. Cada zona = 1
// municipio. El PDF cubre el trimestre completo con un par Dia+Noche por
// dia, en orden cronologico desde el dia 1 del primer mes del trimestre.
const ZONAS_ESCANEADAS = {
  alcaladelrio: 'Alcalá del Río',
  brenes: 'Brenes',
  burguillos: 'Burguillos',
  cantillana: 'Cantillana',
  carmona: 'Carmona',
}

// Zona Sevilla capital — PDF semanal organizado por SEMANA + URGENCIA
// DE DÍA / NOCHE + zonas (CENTRO, NERVIÓN, MACARENA, SUR, etc.).
const ZONA_CAPITAL = 'Sevilla'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

function trimestre(d = new Date()) {
  return Math.floor(d.getMonth() / 3) + 1 // 1..4
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch { return {} }
}
function saveCache(c) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2))
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

async function fetchPdf(zona, t) {
  const url = `${BASE}/images/farmaciasguardia/T${t}/${zona}.pdf`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`PDF ${zona} T${t}: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

async function geocodeOne(q) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (!isFinite(lat) || !isFinite(lng)) return null
    if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
    if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
    return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
  } catch { return null }
}

async function geocode(direccion, municipio) {
  // Limpiar la direccion: quitar parentesis (telefonos) y "(A partir 8:00 h)"-
  // tipo prefijos que confunden a Nominatim.
  const clean = direccion
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  const variants = [clean]
  // Cortar al primer " - <texto>" si <texto> no es un número (descriptor de
  // barrio/zona). Ejemplo: "Trajano, 40 - Centro" → "Trajano, 40".
  const cortado = clean.replace(/\s+-\s+[^,\d][^,]*$/i, '').trim()
  if (cortado && cortado !== clean) variants.push(cortado)
  // Sin numero al final (e.g. "Pza. Encarnación, 22" → "Pza. Encarnación").
  const sinN = clean.replace(/,\s*\d+.*$/, '').trim()
  if (sinN && sinN !== clean && !variants.includes(sinN)) variants.push(sinN)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, ${municipio}, Sevilla, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  // Fallback: solo municipio (centro del pueblo) si la direccion no se
  // encuentra. Mejor algo que nada.
  return await geocodeOne(`${municipio}, Sevilla, España`)
}

// Parsea el PDF buscando el bloque del dia actual.
// Estructura: header "<dia> <num> <mes> <year>", luego "Día (de 9:30 a 22:00)"
// con lineas de farmacias diurnas, luego "Noche (de 22:00 a 09:30)" con
// nocturnas. Termina cuando aparece otro header de dia.
function parseDia(text, target, mes, year) {
  // Header: "lunes 20 abril 2026", "martes 21 abril 2026", ...
  const re = new RegExp(`(${DIAS.join('|')})\\s+${target}\\s+${mes}\\s+${year}`, 'i')
  const match = text.match(re)
  if (!match) return { diurnas: [], nocturnas: [] }
  const start = match.index + match[0].length
  // El proximo dia (target+1) o el anterior (target-1) marca el final.
  const reEnd = new RegExp(`(${DIAS.join('|')})\\s+\\d{1,2}\\s+\\w+\\s+${year}`, 'gi')
  reEnd.lastIndex = start
  let endMatch
  let end = text.length
  while ((endMatch = reEnd.exec(text)) !== null) {
    if (endMatch.index > start) {
      end = endMatch.index
      break
    }
  }
  const block = text.slice(start, end)
  const diurnas = []
  const nocturnas = []
  // Separar diurnas/nocturnas por la cabecera "Día (..." vs "Noche (...".
  const idxNoche = block.search(/Noche\s*\(/i)
  const blockDia = idxNoche >= 0 ? block.slice(0, idxNoche) : block
  const blockNoche = idxNoche >= 0 ? block.slice(idxNoche) : ''
  // Cada linea: "@@@<Municipio>@@@ @@@<Direccion> (<tel>)@@@@@@"
  // Pero algunos saltos de pagina rompen el formato — usamos un regex laxo.
  const reFila = /@@@([A-ZÁÉÍÓÚÑa-záéíóúñ\.\s]+?)@@@\s*@@@(.*?)@@@@@@/g
  for (const m of blockDia.matchAll(reFila)) {
    const muni = m[1].trim()
    const dir = m[2].trim()
    if (muni && dir && !/^día\s*\(/i.test(muni) && !/^noche\s*\(/i.test(muni)) {
      diurnas.push({ municipio: muni, direccion: dir })
    }
  }
  for (const m of blockNoche.matchAll(reFila)) {
    const muni = m[1].trim()
    const dir = m[2].trim()
    if (muni && dir && !/^día\s*\(/i.test(muni) && !/^noche\s*\(/i.test(muni)) {
      nocturnas.push({ municipio: muni, direccion: dir })
    }
  }
  return { diurnas, nocturnas }
}

// Parser para zonas mono-municipio (Alcalá de Guadaira). El formato no usa
// columnas con @@@ — cada farmacia es una linea con bullet "Ŀ" inicial.
//   "Ŀ<direccion> (<tel>) - <nombre>"
function parseDiaSimple(text, target, year, municipio) {
  // Header: "SÁBADO 25" — sin mes ni año en la cabecera, pero año esta al final.
  const reHeader = new RegExp(`(${DIAS.join('|')})\\s+${target}\\b`, 'i')
  const match = text.match(reHeader)
  if (!match) return { diurnas: [], nocturnas: [] }
  const start = match.index + match[0].length
  // Próximo header del calendario marca el final.
  const reEnd = new RegExp(`(${DIAS.join('|')})\\s+\\d{1,2}\\b`, 'gi')
  reEnd.lastIndex = start
  let endMatch
  let end = text.length
  while ((endMatch = reEnd.exec(text)) !== null) {
    if (endMatch.index > start) {
      end = endMatch.index
      break
    }
  }
  const block = text.slice(start, end)
  // Separar Día / Noche.
  const idxNoche = block.search(/Noche\s*\(/i)
  const blockDia = idxNoche >= 0 ? block.slice(0, idxNoche) : block
  const blockNoche = idxNoche >= 0 ? block.slice(idxNoche) : ''
  // Cada farmacia: "Ŀ<dir> (<tel>) - <nombre>" — bullet seguido de texto, hasta
  // siguiente Ŀ o fin. Soportar también lineas multilínea.
  const reFila = /Ŀ([^Ŀ]+?)(?=Ŀ|Noche\s*\(|$)/gs
  const extract = (b, dest) => {
    for (const m of b.matchAll(reFila)) {
      const linea = m[1].replace(/\s+/g, ' ').trim()
      if (!linea || /^día\s*\(/i.test(linea) || /^noche\s*\(/i.test(linea)) continue
      // Direccion = todo hasta el ultimo " - " (que separa nombre).
      const idx = linea.lastIndexOf(' - ')
      const direccion = idx >= 0 ? linea.slice(0, idx).trim() : linea
      dest.push({ municipio, direccion })
    }
  }
  const diurnas = []
  const nocturnas = []
  extract(blockDia, diurnas)
  extract(blockNoche, nocturnas)
  return { diurnas, nocturnas }
}

// Parser CAPITAL — PDF semanal organizado por bloques:
//   "LUNES A SÁBADO - SEMANA DEL X AL Y URGENCIA DE DÍA (de 9:30 a 22:00 h.)"
//     -> Lista de farmacias por zona (CENTRO, NERVIÓN, MACARENA, SUR,
//        SEVILLA ESTE - ROCHELAMBERT, TRIANA - LOS REMEDIOS).
//     -> Cada farmacia: "» <direccion> - T: <tel>" — algunas con anotaciones
//        "Sólo Miércoles", "Excepto Sábado", "Sólo Sábado" para filtrar dia.
//   "URGENCIA DE NOCHE (de 22:00 a 9:30) LUNES A DOMINGO"
//     -> Lista similar, con anotaciones "Sólo Lunes", "Sólo Martes", etc.
//
// Devuelve farmacias de la semana actual sin filtrar por restriccion de dia
// (ROI: las anotaciones varian mucho — mejor mostrar la lista semanal y que
// el usuario verifique en el local). Esto da una cobertura amplia de la
// capital.
function parseDiaCapital(text, today) {
  // Localizar la semana actual. Formato:
  //   "SEMANA DEL 20 DE ABRIL DE 2026 AL 26 ABRIL DE 2026"
  //   "SEMANA DEL 4 DE MAYO DE 2026 AL 10 DE MAYO DE 2026"
  const reSemana = /SEMANA DEL\s+(\d{1,2})\s+(?:DE\s+)?([A-ZÁÉÍÓÚÑ]+)(?:\s+DE\s+(\d{4}))?\s+AL\s+(\d{1,2})\s+(?:DE\s+)?([A-ZÁÉÍÓÚÑ]+)\s+DE\s+(\d{4})/gi
  const semanas = [...text.matchAll(reSemana)]
  if (semanas.length === 0) return { diurnas: [], nocturnas: [] }
  const target = today.getTime()
  let mejor = null
  for (const s of semanas) {
    const diaIni = parseInt(s[1], 10)
    const mesIniName = s[2].toLowerCase()
    const yearIni = s[3] ? parseInt(s[3], 10) : parseInt(s[6], 10)
    const diaFin = parseInt(s[4], 10)
    const mesFinName = s[5].toLowerCase()
    const yearFin = parseInt(s[6], 10)
    const mesIni = MESES.findIndex(m => m === mesIniName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    const mesFin = MESES.findIndex(m => m === mesFinName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    if (mesIni < 0 || mesFin < 0) continue
    const ini = new Date(yearIni, mesIni, diaIni).getTime()
    const fin = new Date(yearFin, mesFin, diaFin, 23, 59).getTime()
    if (target >= ini && target <= fin) {
      mejor = { idx: s.index, end: fin, ini }
      break
    }
  }
  // Fallback: la primera semana del PDF (es la mas reciente publicada).
  if (!mejor) {
    mejor = { idx: semanas[0].index }
  }
  // Bloque = desde inicio semana hasta proxima "SEMANA DEL" o fin texto.
  const start = mejor.idx
  let end = text.length
  for (const s of semanas) {
    if (s.index > start) { end = s.index; break }
  }
  const block = text.slice(start, end)
  // Separar URGENCIA DE DÍA / URGENCIA DE NOCHE.
  const idxNoche = block.search(/URGENCIA\s+DE\s+NOCHE/i)
  const blockDia = idxNoche >= 0 ? block.slice(0, idxNoche) : block
  const blockNoche = idxNoche >= 0 ? block.slice(idxNoche) : ''
  const extract = (b, dest) => {
    // Cada farmacia inicia con »; capturar hasta el siguiente » o fin.
    const items = b.split(/(?=^»|\n»)/m).slice(1)
    for (const item of items) {
      // Limpiar saltos de linea internos.
      const linea = item.replace(/^»\s*/, '').replace(/\s+/g, ' ').trim()
      if (!linea) continue
      // Quitar anotaciones de restriccion de dia al inicio (Solo X, Excepto X).
      // Estas anotaciones son informativas — las dejamos en la direccion para
      // que el usuario las vea.
      // Cortar la direccion: hasta " - T:" o " T:" o "T:" o telefono al final.
      let dir = linea
      // Orden importante: PRIMERO restricciones (que van al final), DESPUES tel.
      // Quitar restricciones del final ("Sólo Miércoles.", "Excepto Sábado.")
      dir = dir.replace(/\s*(?:S[oó]lo|Excepto)\s+[A-Za-záéíóúñ]+(?:\s+y\s+[A-Za-záéíóúñ]+)?\.?\s*$/i, '').trim()
      // Quitar tel: " - T: 954..." o "T: 954..." o " 954-..." o variantes.
      dir = dir.replace(/[\s\-,\.]+T[\.:]?\s*\d[\d\s\-]*\s*\.?\s*$/i, '')
      dir = dir.replace(/[\s\-,]+\d{9}\s*\.?\s*$/, '')
      dir = dir.replace(/[\s\-,]+\d{3}[\s\-]\d{3}[\s\-]\d{3}\s*\.?\s*$/, '')
      // Quitar punto final si quedo
      dir = dir.replace(/[\s\-,\.]+$/, '').trim()
      if (dir.length < 5) continue
      // Detectar telefono en la linea original.
      let tel = ''
      const mTel = linea.match(/T[\.:]?\s*(\d{3}[\s-]*\d{3}[\s-]*\d{3})/i)
      if (mTel) tel = mTel[1].replace(/[\s-]/g, '')
      else {
        const mTel2 = linea.match(/(\d{3}[\s-]\d{3}[\s-]\d{3})/)
        if (mTel2) tel = mTel2[1].replace(/[\s-]/g, '')
      }
      dest.push({ municipio: 'Sevilla', direccion: dir, telefono: tel })
    }
  }
  const diurnas = []
  const nocturnas = []
  extract(blockDia, diurnas)
  extract(blockNoche, nocturnas)
  return { diurnas, nocturnas }
}

function extraerTelefono(direccion) {
  // (954770068), (95-4184228), (954775151-666123456), etc.
  const m = direccion.match(/\(([\d\-\s]+)\)/)
  if (!m) return ''
  const tel = m[1].replace(/[\-\s]/g, '').slice(0, 9)
  return tel.length === 9 ? tel : ''
}

// OCR de un PDF escaneado con cache por hash. Devuelve el texto plano
// concatenado de todas las paginas. Lazy-load de las deps OCR para no
// pagar el coste de import si no hay zonas escaneadas en el run.
async function ocrPdf(buf, zona) {
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  const cacheFile = resolve(OCR_CACHE_DIR, `${zona}-${hash}.txt`)
  if (existsSync(cacheFile)) {
    return readFileSync(cacheFile, 'utf8')
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const { createWorker } = await import('tesseract.js')

  // pdfjs transfiere el ArrayBuffer subyacente — clonar para no invalidar.
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise
  const worker = await createWorker('spa')
  let allText = ''
  try {
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const viewport = page.getViewport({ scale: 2.0 })
      const canvas = createCanvas(viewport.width, viewport.height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      const png = canvas.toBuffer('image/png')
      const { data } = await worker.recognize(png)
      allText += data.text + '\n'
    }
  } finally {
    await worker.terminate()
  }
  mkdirSync(OCR_CACHE_DIR, { recursive: true })
  writeFileSync(cacheFile, allText)
  return allText
}

// Tesseract pierde habitualmente la primera letra de palabras frecuentes en
// direcciones (Carretera, Camino, Santa, Paseo, Avda, Juan, ...). Corregir
// prefijos cuando el patron es inequivoco (mejora geocoding y legibilidad).
function corregirOcrPrefijos(dir) {
  const fixes = [
    [/^Anta\b/i, 'Santa'],
    [/^Aseo\b/i, 'Paseo'],
    [/^Arretera\b/i, 'Carretera'],
    [/^Vda(\.?)\b/i, 'Avda$1'],
    [/^Uan\b/i, 'Juan'],
    [/^Amino\b/i, 'Camino'],
    [/^Arrera\b/i, 'Carrera'],
    [/^Alle\b/i, 'Calle'],
    [/^Laza\b/i, 'Plaza'],
    [/^Tra(\.?)\b/i, 'Ctra$1'],
    [/^Ntro\b/i, 'Nuestro'],
  ]
  for (const [re, rep] of fixes) {
    if (re.test(dir)) return dir.replace(re, rep)
  }
  return dir
}

// Parser para PDFs escaneados (5 zonas). El PDF cubre el trimestre con
// pares Dia+Noche por dia, en orden cronologico. Indice del par = dia
// transcurrido desde el 1 del primer mes del trimestre (0-indexed).
//
// Formato OCR de cada par (despues de tesseract):
//   "Dia(de9:30a22:00)\n a <direccion>, N (TELEFONO9DIG) - <nombre>\n"
//   "Noche(de22:00a09:30)\n o <direccion>, N (TELEFONO9DIG) - <nombre>\n"
function parseDiaScanned(text, today, municipio) {
  // Capturar (Dia|Noche), direccion (hasta el "(tel)"), telefono y nombre.
  // Permitimos ruido al inicio de la linea de farmacia (bullet OCR raro
  // como "o", "a", "1", "$", etc.) y caracteres acentuados en la dir.
  const re = /(Dia|Noche)\s*\([^)]*\)[\s\S]*?(?:^|\n)\s*[^\n(]{0,3}([A-ZÁÉÍÓÚÑa-záéíóúñ][^()\n]+?)\s*\((\d{9})\)\s*-\s*([^\n]+)/gim
  const dias = []
  const noches = []
  for (const m of text.matchAll(re)) {
    const tipo = m[1].toLowerCase()
    const dirCruda = m[2].trim().replace(/\s+/g, ' ')
    const direccion = corregirOcrPrefijos(dirCruda)
    const telefono = m[3]
    const target = tipo === 'dia' ? dias : noches
    target.push({ municipio, direccion, telefono })
  }
  // Calcular indice = dias desde el 1 del primer mes del trimestre.
  const monthStart = today.getMonth() - (today.getMonth() % 3)
  const trimestreStart = new Date(today.getFullYear(), monthStart, 1)
  const idx = Math.floor((today - trimestreStart) / 86400000)
  const out = { diurnas: [], nocturnas: [] }
  if (dias[idx]) out.diurnas.push(dias[idx])
  if (noches[idx]) out.nocturnas.push(noches[idx])
  return out
}

function limpiarDireccion(direccion) {
  // Quitar (telefono) del final.
  return direccion.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

async function main() {
  const d = new Date()
  const t = trimestre(d)
  const mes = MESES[d.getMonth()]
  const year = d.getFullYear()
  const target = d.getDate()
  console.log(`Descargando guardias provincia Sevilla — T${t} ${year}, dia ${target} ${mes}...`)

  // Descargar las 9 zonas en paralelo.
  const pdfs = await Promise.allSettled(ZONAS.map(z => fetchPdf(z, t)))
  const farmacias = []
  for (let i = 0; i < ZONAS.length; i++) {
    const zona = ZONAS[i]
    const result = pdfs[i]
    if (result.status === 'rejected') {
      console.log(`  ${zona}: FAIL ${result.reason.message}`)
      continue
    }
    const muniUnico = ZONA_MUNICIPIO_UNICO[zona]
    const muniEscaneado = ZONAS_ESCANEADAS[zona]
    let diurnas = []
    let nocturnas = []
    if (zona === ZONA_CAPITAL) {
      // Sevilla capital — formato semanal por zonas (CENTRO, NERVIÓN...).
      const parser = new PDFParse({ data: result.value })
      const r = await parser.getText()
      ;({ diurnas, nocturnas } = parseDiaCapital(r.text, d))
    } else if (muniEscaneado) {
      // PDF escaneado — pipeline OCR + parser secuencial por dia.
      const text = await ocrPdf(result.value, zona)
      ;({ diurnas, nocturnas } = parseDiaScanned(text, d, muniEscaneado))
    } else if (muniUnico) {
      // Formato simple — un solo municipio con bullets Ŀ.
      const parser = new PDFParse({ data: result.value })
      const r = await parser.getText()
      ;({ diurnas, nocturnas } = parseDiaSimple(r.text, target, year, muniUnico))
    } else {
      const parser = new PDFParse({ data: result.value })
      const r = await parser.getText({ itemJoiner: '@@@' })
      ;({ diurnas, nocturnas } = parseDia(r.text, target, mes, year))
    }
    console.log(`  ${zona}: ${diurnas.length} diurnas, ${nocturnas.length} nocturnas`)
    for (const f of diurnas) farmacias.push({ ...f, zona, horario: 'Diurna 9:30-22:00' })
    for (const f of nocturnas) farmacias.push({ ...f, zona, horario: 'Nocturna 22:00-9:30' })
  }
  if (farmacias.length < 5) throw new Error(`Solo ${farmacias.length} farmacias detectadas. Parser fallido?`)

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (const f of farmacias) {
    const dirLimpia = limpiarDireccion(f.direccion)
    const key = `${dirLimpia} | ${f.municipio}`
    if (cache[key]) {
      f.coord = cache[key]
      continue
    }
    const coord = await geocode(dirLimpia, f.municipio)
    if (coord) {
      cache[key] = coord
      f.coord = coord
      nuevas++
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (nuevas > 0) saveCache(cache)

  const guardias = []
  // Dedupe por direccion+municipio. Si una farmacia tiene turno diurno Y
  // nocturno (24h), combinamos los horarios.
  const seen = new Map()
  for (const f of farmacias) {
    if (!f.coord) continue
    const dirLimpia = limpiarDireccion(f.direccion)
    const tel = f.telefono || extraerTelefono(f.direccion)
    const k = `${dirLimpia.toLowerCase()} | ${f.municipio.toLowerCase()}`
    if (seen.has(k)) {
      const idx = seen.get(k)
      const prev = guardias[idx]
      if (!prev[6].toLowerCase().includes(f.horario.split(' ')[0].toLowerCase())) {
        prev[6] += ` y ${f.horario.toLowerCase()}`
      }
      continue
    }
    seen.set(k, guardias.length)
    guardias.push([
      f.coord[0],
      f.coord[1],
      `Farmacia de guardia · ${titleCase(dirLimpia)}`.slice(0, 140),
      f.municipio,
      tel,
      '',
      f.horario,
      '',
    ])
  }

  if (guardias.length < 5) throw new Error(`Solo ${guardias.length} con coord. Abortamos.`)

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaceuticosdesevilla.es',
    territorio: 'sevilla',
    count: guardias.length,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardias guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
