#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de la provincia de Sevilla
// desde los PDFs trimestrales del COF Sevilla (farmaceuticosdesevilla.es).
//
// Por que solo provincia (sin capital):
//   El COF Sevilla publica 9 PDFs trimestrales — uno por zona farmaceutica
//   de la PROVINCIA (Aljarafe, Alcala de Guadaira, Alcala del Rio, brenes,
//   burguillos, cantillana, carmona, moron-osuna-estepa, sierranorte). La
//   capital de Sevilla no esta en estos PDFs (tiene otra organizacion no
//   publica). Asumimos que la capital se cubre via gasolineras.json (OSM)
//   y el resto de la provincia con guardias.
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
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'sevilla-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-sevilla.json')

const BASE = 'https://servicios.farmaceuticosdesevilla.es'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// BBOX provincia Sevilla. Provincia tiene 105 municipios — bbox holgado.
const BBOX = { minLat: 36.8, maxLat: 38.1, minLng: -6.6, maxLng: -4.5 }

// 9 zonas farmaceuticas de la provincia de Sevilla. Sus PDFs son fijos
// (mismo nombre cada trimestre). La grafia es la del COF: 'Aljarafe' tiene
// mayuscula, el resto minusculas.
const ZONAS = [
  'Aljarafe',
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
  const v1 = `${clean}, ${municipio}, Sevilla, España`
  let coord = await geocodeOne(v1)
  if (coord) return coord
  await new Promise(r => setTimeout(r, 1100))
  // Fallback: solo municipio (centro del pueblo) si la direccion no se
  // encuentra. Mejor algo que nada.
  const v2 = `${municipio}, Sevilla, España`
  coord = await geocodeOne(v2)
  return coord
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

function extraerTelefono(direccion) {
  // (954770068), (95-4184228), (954775151-666123456), etc.
  const m = direccion.match(/\(([\d\-\s]+)\)/)
  if (!m) return ''
  const tel = m[1].replace(/[\-\s]/g, '').slice(0, 9)
  return tel.length === 9 ? tel : ''
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
    let diurnas = []
    let nocturnas = []
    if (muniUnico) {
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
    const tel = extraerTelefono(f.direccion)
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
