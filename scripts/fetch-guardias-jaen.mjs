#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de Jaén capital desde el PDF
// mensual publicado por COF Jaén (farmaceuticosdejaen.es).
//
// Por que solo capital:
//   El COF Jaén tiene PDF mensual SOLO para Jaén capital (118 poblaciones,
//   id=46 capital). Los pueblos de la provincia tienen calendarios separados
//   por zona — fuera de scope MVP.
//
// Fuente:
//   1) POST https://www.farmaceuticosdejaen.es/paginas/Farmacias_Guardia.asp
//      data: formBuscar=si, idPoblacion=46
//      → HTML con anchors MostrarDocumento.asp?Documento=NN-GUARDIAS%20JAEN%20MES%20YYYY.pdf
//   2) GET .../MostrarDocumento.asp?Documento=<filename>&Tipo=Guardias
//      → PDF mensual con bloques diarios. Cada dia = numero + diaSemana +
//        5 farmacias (3 diurnas extended-hours + 2 nocturnas).
//
// CAVEAT — 5 farmacias/dia y mapping a horarios:
//   Las 3 primeras posiciones suelen ser DIURNAS (9:30-22h, algunas 24h).
//   Las 2 ultimas son NOCTURNAS (22-9:30). Esta heuristica puede fallar si
//   el COF cambia el formato — los horarios reales se pueden ver en pagina 3
//   del PDF (LISTADO INFORMATIVO con horarios ampliados).
//
// CAVEAT — dominio doble:
//   cofjaen.es redirige 308 a farmaceuticosdejaen.es. Usamos el destino
//   directamente para evitar el redirect.
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
const CACHE_FILE = resolve(CACHE_DIR, 'jaen-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-jaen.json')

const BASE = 'https://www.farmaceuticosdejaen.es'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

const BBOX = { minLat: 37.3, maxLat: 38.7, minLng: -4.3, maxLng: -2.1 }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

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

async function buscarPdfMes(d = new Date()) {
  const body = new URLSearchParams({ formBuscar: 'si', idPoblacion: '46', Buscar: 'Buscar' }).toString()
  const res = await fetch(`${BASE}/paginas/Farmacias_Guardia.asp`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/paginas/farmacias_guardia.asp`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Buscador HTTP ${res.status}`)
  const html = await res.text()
  // Anchors: MostrarDocumento.asp?Documento=04-GUARDIAS JAEN ABRIL 2026.pdf&Tipo=Guardias
  const re = /MostrarDocumento\.asp\?Documento=([^&"]+)&Tipo=Guardias/g
  const docs = [...html.matchAll(re)].map(m => m[1])
  if (docs.length === 0) throw new Error('Sin documentos en COF Jaén')
  // Buscar el del mes actual.
  const mes = MESES[d.getMonth()].toUpperCase()
  const year = d.getFullYear()
  const target = docs.find(doc => doc.toUpperCase().includes(mes) && doc.includes(String(year)))
  if (!target) {
    // Fallback: el mas reciente del año.
    const conYear = docs.filter(doc => doc.includes(String(year)) && /^\d/.test(doc))
    if (conYear.length === 0) throw new Error(`Sin PDF para ${mes} ${year}`)
    return conYear[conYear.length - 1]
  }
  return target
}

async function fetchPdf(filename) {
  const url = `${BASE}/paginas/MostrarDocumento.asp?Documento=${encodeURIComponent(filename)}&Tipo=Guardias`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Referer': `${BASE}/paginas/farmacias_guardia.asp` } })
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
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

async function geocode(direccion) {
  const variants = [direccion]
  const sinParens = direccion.replace(/\s*\([^)]*\)/g, '').trim()
  if (sinParens && sinParens !== direccion) variants.push(sinParens)
  // Normalizar nº → # para que Nominatim lo entienda mejor.
  const sinN = sinParens.replace(/\bnº\s*/gi, '').trim()
  if (sinN && !variants.includes(sinN)) variants.push(sinN)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, Jaén, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  return null
}

// Parsea el PDF buscando el bloque del dia actual.
// Estructura por dia: @@@<numDia>@@@ @@@<diaSemana>@@@@@@ + 5 lineas de direccion.
function parseDia(text, target) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  // Buscar la linea que tras separar por '@@@' tiene un numero como primer item
  // (puede llevar @@@ inicial o no segun pdf-parse).
  for (let i = 0; i < lines.length; i++) {
    const items = lines[i].split('@@@').map(s => s.trim()).filter(Boolean)
    if (items.length < 2) continue
    const num = parseInt(items[0], 10)
    if (!Number.isFinite(num) || String(num) !== items[0]) continue
    if (num !== target) continue
    // El items[1] deberia ser el diaSemana (Lunes/Martes/...).
    if (!/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(items[1])) continue
    // Recoger las siguientes lineas hasta el proximo dia o EOF.
    const dirs = []
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      const next = lines[j].split('@@@').map(s => s.trim()).filter(Boolean)
      // Si la siguiente linea empieza con un numero seguido de dia, parar.
      if (next.length >= 2 && /^\d{1,2}$/.test(next[0]) &&
          /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(next[1])) {
        break
      }
      for (const it of next) {
        if (it.length > 5 && /[a-zA-Záéíóúñ]/.test(it)) dirs.push(it)
      }
      if (dirs.length >= 5) break
    }
    return dirs.slice(0, 5)
  }
  return []
}

async function main() {
  const d = new Date()
  console.log(`Descargando guardias Jaén — farmaceuticosdejaen.es PDF mensual...`)
  const pdfName = await buscarPdfMes(d)
  console.log(`  PDF: ${pdfName}`)
  const data = await fetchPdf(pdfName)
  const parser = new PDFParse({ data })
  const r = await parser.getText({ itemJoiner: '@@@' })
  console.log(`  PDF: ${r.pages?.length} paginas`)

  const target = d.getDate()
  const dirs = parseDia(r.text, target)
  console.log(`  Dia ${target}: ${dirs.length} farmacias detectadas`)
  dirs.forEach((dir, i) => console.log(`    ${i + 1}. ${dir}`))
  if (dirs.length < 3) throw new Error(`Solo ${dirs.length} farmacias en el dia ${target}. Parser fallido?`)

  // Asignar horarios: posiciones 0-2 = diurna, 3-4 = nocturna.
  const horarios = ['Diurna 9:30-22:00', 'Diurna 9:30-22:00', 'Diurna 9:30-22:00', 'Nocturna 22:00-9:30', 'Nocturna 22:00-9:30']
  const farmacias = dirs.map((direccion, i) => ({ direccion, horario: horarios[i] || 'De guardia' }))

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (const f of farmacias) {
    if (cache[f.direccion]) {
      f.coord = cache[f.direccion]
      continue
    }
    process.stdout.write(`    geocoding "${f.direccion.slice(0, 40)}"... `)
    const coord = await geocode(f.direccion)
    if (coord) {
      cache[f.direccion] = coord
      f.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      console.log('FAIL')
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (nuevas > 0) saveCache(cache)

  const guardias = []
  // Dedupe por direccion (varias posiciones pueden coincidir).
  const seen = new Set()
  for (const f of farmacias) {
    if (!f.coord) continue
    const k = f.direccion.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(k)) {
      // Ya esta — pero combinar horario si es distinto turno.
      const prev = guardias.find(g => g[2].toLowerCase().includes(k))
      if (prev && !prev[6].toLowerCase().includes(f.horario.split(' ')[0].toLowerCase())) {
        prev[6] += ` y ${f.horario.toLowerCase()}`
      }
      continue
    }
    seen.add(k)
    guardias.push([
      f.coord[0],
      f.coord[1],
      `Farmacia de guardia · ${titleCase(f.direccion)}`.slice(0, 140),
      'Jaén',
      '',
      '',
      f.horario,
      '',
    ])
  }

  if (guardias.length < 1) throw new Error('Cero con coord. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaceuticosdejaen.es',
    territorio: 'jaen',
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
