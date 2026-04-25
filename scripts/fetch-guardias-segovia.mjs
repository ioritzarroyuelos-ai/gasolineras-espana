#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de Segovia capital desde el PDF
// anual publicado por COF Segovia (cofsegovia.com).
//
// Por que solo capital:
//   El COF Segovia publica 4 PDFs separados (capital + Cuellar + El Espinar
//   + zona rural). El de la capital es el mas relevante para el caso de uso
//   tipico (~80k habitantes, mayoria de la demanda). Los rurales se podrian
//   sumar pero requieren parser distinto por PDF — fuera de scope MVP.
//
// Fuente:
//   1) GET https://cofsegovia.com/wp-content/uploads/2026/03/CALENDARIO-GUARDIAS-SEGOVIA-CAPITAL-2026.pdf
//      → PDF anual (21 paginas, una por quincena aprox.). Por cada dia hay
//        una fila con: 'lun/mar/.../dom, X de mes', farmacia diurna (10:15-22),
//        farmacia nocturna (22-10:15). Cada celda es nombre + direccion + tlf.
//
// CAVEAT — sin lat/lng:
//   El PDF no expone coords. Geocodificamos con Nominatim usando direccion
//   + 'Segovia'. Cache en `scripts/cache/segovia-geo.json` por dirección.
//
// CAVEAT — URL del PDF cambia anualmente:
//   El path incluye el año (2026/03/...-2026.pdf). Si el COF lo cambia
//   abortamos limpio. Para 2027 habra que actualizar la constante.
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
const CACHE_FILE = resolve(CACHE_DIR, 'segovia-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-segovia.json')

const PDF_URL = 'https://cofsegovia.com/wp-content/uploads/2026/03/CALENDARIO-GUARDIAS-SEGOVIA-CAPITAL-2026.pdf'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Segovia.
const BBOX = { minLat: 40.6, maxLat: 41.5, minLng: -4.6, maxLng: -3.4 }

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

async function fetchPdf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

async function geocode(direccion) {
  const q = `${direccion}, Segovia, España`
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

// Construye `dia, X de mes` que aparece en el PDF (en español, sin tilde
// en el dia siempre que el PDF no la escape — ej "lunes, 2 de febrero").
function fechaSegovia(d = new Date()) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  return `${dias[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`
}

// Parsea las lineas del PDF. Cada bloque diario son 3 lineas:
//   1) FARMACIA <nombre1> ... FARMACIA <nombre2>
//   2) <fecha>, <DIR1>, <DIR2>
//   3) [(info1)] Tfno: <TLF1> [(info2)] Tfno: <TLF2>
// Las celdas vienen separadas por '@@@' gracias a itemJoiner.
function parseDia(lines, target) {
  // Buscamos la linea con la fecha exacta (acepta sin tilde por si el PDF
  // varia el encoding).
  const targetNorm = target.toLowerCase().replace(/[áéíóú]/g, c => 'aeiou'['áéíóú'.indexOf(c)])
  for (let i = 1; i < lines.length - 1; i++) {
    const lineNorm = lines[i].toLowerCase().replace(/[áéíóú]/g, c => 'aeiou'['áéíóú'.indexOf(c)])
    if (!lineNorm.includes(targetNorm)) continue
    // Linea de fecha + direcciones. Items separados por '@@@'.
    const itemsFecha = lines[i].split('@@@').map(s => s.trim()).filter(Boolean)
    // Linea anterior: 2 nombres FARMACIA.
    const itemsNombre = lines[i - 1].split('@@@').map(s => s.trim()).filter(Boolean)
    // Linea siguiente: telefonos.
    const itemsTel = lines[i + 1].split('@@@').map(s => s.trim()).filter(Boolean)
    // itemsFecha[0] es 'sábado, 25 de abril' (y siguientes son las DIRs).
    // Nos quedamos con las que NO contengan 'de '+mes.
    const dirs = itemsFecha.slice(1).filter(s => !/^[a-záéíóú]+,/i.test(s))
    if (dirs.length < 1) return null
    const tels = itemsTel.filter(s => /Tfno|Tlf|tel|tel\./i.test(s)).map(s => s.replace(/[^\d]/g, ''))
    const nombres = itemsNombre.filter(s => /FARMACIA/i.test(s))
    return {
      diurna: dirs[0] ? { nombre: nombres[0] || '', direccion: dirs[0], telefono: tels[0] || '' } : null,
      nocturna: dirs[1] ? { nombre: nombres[1] || '', direccion: dirs[1], telefono: tels[1] || '' } : null,
    }
  }
  return null
}

async function main() {
  console.log('Descargando guardias Segovia (COF Segovia PDF anual capital)...')
  const data = await fetchPdf(PDF_URL)
  const parser = new PDFParse({ data })
  const r = await parser.getText({ itemJoiner: '@@@' })
  const lines = r.text.split('\n')
  console.log(`  PDF descargado, ${r.pages?.length || '?'} paginas, ${lines.length} lineas`)

  const target = fechaSegovia()
  console.log(`  Buscando: "${target}"`)
  const dia = parseDia(lines, target)
  if (!dia) throw new Error(`No encontrada la fecha "${target}" en el PDF. Estructura cambio?`)

  const farmacias = []
  if (dia.diurna && dia.diurna.direccion) farmacias.push({ ...dia.diurna, horario: 'Diurna 10:15-22:00' })
  if (dia.nocturna && dia.nocturna.direccion) farmacias.push({ ...dia.nocturna, horario: 'Nocturna 22:00-10:15' })
  // Dedupe por direccion + telefono (a veces diurna y nocturna son la misma).
  const seen = new Set()
  const dedupe = []
  for (const f of farmacias) {
    const k = `${f.direccion}|${f.telefono}`
    if (seen.has(k)) {
      // Combinar horario en la entrada existente.
      const prev = dedupe.find(x => `${x.direccion}|${x.telefono}` === k)
      if (prev) prev.horario += ` y ${f.horario.toLowerCase()}`
      continue
    }
    seen.add(k)
    dedupe.push(f)
  }
  console.log(`  ${dedupe.length} farmacias de guardia hoy`)
  if (dedupe.length === 0) throw new Error('Cero farmacias extraidas. Parser fallido?')

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (const f of dedupe) {
    const key = f.direccion
    if (cache[key]) {
      f.coord = cache[key]
      continue
    }
    process.stdout.write(`    geocoding "${key.slice(0, 40)}"... `)
    const coord = await geocode(f.direccion)
    if (coord) {
      cache[key] = coord
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
  for (const f of dedupe) {
    if (!f.coord) continue
    const dirFinal = f.nombre ? `${titleCase(f.nombre.replace(/^FARMACIA\s+/i, 'Farmacia '))} · ${titleCase(f.direccion)}` : titleCase(f.direccion)
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      'Segovia',
      f.telefono,
      '',
      f.horario,
      '',
    ])
  }

  if (guardias.length < 1) throw new Error('Cero con coord. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'cofsegovia.com',
    territorio: 'segovia',
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
