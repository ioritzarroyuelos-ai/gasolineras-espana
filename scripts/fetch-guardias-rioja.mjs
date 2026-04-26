#!/usr/bin/env node
// v1.29 — Descarga las farmacias de guardia de La Rioja desde el microsite
// publico de Riojasalud. Stack: HTML server-rendered con tablas Bootstrap.
//
// Fuente:
//   GET https://apps.riojasalud.es/farmacias_guardia/public/guardias/
//                                                    ?id_municipio=<ID>
//   → HTML con 8 tablas (una por dia rolling) por municipio cabecera.
//
// Iteramos los 9 municipios cabecera (Logroño, Haro, Calahorra, Najera,
// Arnedo, Alfaro, Ezcaray, Cervera, Sto Domingo) y extraemos solo las
// guardias de HOY.
//
// Estructura HTML:
//   <th class="col-md-10">DD/MM/YYYY -DIA_SEMANA</th><th>Horario</th>
//   <tr class="ahora|"><td>NOMBRE (DIRECCIÓN)</td><td>HH:MM -HH:MM</td></tr>
//
// CAVEAT — sin lat/lng/telefono:
//   El microsite NO incluye coordenadas ni telefono. Geocodificamos via
//   Nominatim cacheando por nombre+direccion en `scripts/cache/rioja-geo.json`.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'rioja-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-rioja.json')

const BASE = 'https://apps.riojasalud.es/farmacias_guardia/public/guardias/'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.29 (+https://webapp-3ft.pages.dev)'

const MUNICIPIOS = [
  { id: 3, nombre: 'Logroño' },
  { id: 4, nombre: 'Haro' },
  { id: 5, nombre: 'Alfaro' },
  { id: 6, nombre: 'Nájera' },
  { id: 7, nombre: 'Arnedo' },
  { id: 8, nombre: 'Calahorra' },
  { id: 9, nombre: 'Ezcaray' },
  { id: 10, nombre: 'Cervera del Río Alhama' },
  { id: 11, nombre: 'Santo Domingo de la Calzada' },
]

// Bbox provincia La Rioja (Logroño al norte, Cervera al este, Ezcaray al
// suroeste). Defensa contra geocodings que devuelvan otra provincia.
const BBOX = { minLat: 41.85, maxLat: 42.65, minLng: -3.4, maxLng: -1.65 }

function todayDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}

async function fetchHtml(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      // El header dice charset=off — body es UTF-8.
      return await res.text()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1500))
    }
  }
  throw lastErr
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

// Parsea las farmacias del HTML para una fecha concreta DD/MM/YYYY.
// Estructura: <th class="col-md-10">DD/MM/YYYY -DIA</th>...
//             <tr class="..."><td>NOMBRE (DIR)</td><td>HORARIO</td></tr>
function parseRiojaForDate(html, fecha) {
  const farmacias = []
  // Encontrar el bloque <table> que contiene la fecha de hoy. Cada tabla
  // empieza con <table class="table table-hover"> y termina con </table>.
  const reTabla = /<table\s+class="table table-hover">([\s\S]*?)<\/table>/g
  let t
  while ((t = reTabla.exec(html)) !== null) {
    const cuerpo = t[1]
    const mTh = cuerpo.match(/<th\s+class="col-md-10">([^<]+)<\/th>/)
    if (!mTh) continue
    const fechaTabla = mTh[1].trim().split(/\s+/)[0] // "25/04/2026"
    if (fechaTabla !== fecha) continue
    // Extraer cada <tr>...<td>nombre+dir</td><td>horario</td></tr>
    const reFila = /<tr[^>]*>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g
    let f
    while ((f = reFila.exec(cuerpo)) !== null) {
      const nombreYDir = decodeEntities(clean(f[1], 200))
      const horario = clean(f[2], 30)
      // Formato "Nombre (Dirección)". Hay parentesis anidados a veces:
      //   "Lda. Apellido (Avda Centro, 5 (Planta Baja))"
      // Cogemos desde el ultimo "(" antes del ")" final como direccion,
      // todo lo anterior como nombre.
      const idxLast = nombreYDir.lastIndexOf('(')
      let nombre = nombreYDir
      let direccion = ''
      if (idxLast > 0 && nombreYDir.endsWith(')')) {
        nombre = nombreYDir.slice(0, idxLast).trim()
        direccion = nombreYDir.slice(idxLast + 1, -1).trim()
        // Si hay parentesis no cerrados al final del nombre, simplificamos:
        // intentamos hallar el primer "(" que abre la direccion correctamente.
        const idxFirst = nombreYDir.indexOf('(')
        if (idxFirst > 0 && idxFirst !== idxLast) {
          // Hay parentesis anidados — todo desde el primer "(" es direccion.
          nombre = nombreYDir.slice(0, idxFirst).trim()
          direccion = nombreYDir.slice(idxFirst + 1, -1).trim()
        }
      }
      farmacias.push({ nombre, direccion, horario })
    }
  }
  return farmacias
}

async function geocodeNominatim(direccion, localidad) {
  const q = `${direccion}, ${localidad}, La Rioja, España`
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
  } catch {
    return null
  }
}

async function main() {
  const fecha = todayDDMMYYYY()
  console.log(`Descargando guardias La Rioja (${fecha}) — 9 municipios cabecera...`)

  const todas = []
  for (const m of MUNICIPIOS) {
    try {
      const html = await fetchHtml(`${BASE}?id_municipio=${m.id}`)
      const lista = parseRiojaForDate(html, fecha)
      console.log(`  ${m.nombre} (id=${m.id}): ${lista.length} farmacias hoy`)
      for (const f of lista) {
        f.localidad = m.nombre
        todas.push(f)
      }
      await new Promise(r => setTimeout(r, 500))
    } catch (e) {
      console.error(`  ${m.nombre}: ERROR ${e.message}`)
    }
  }

  console.log(`  ${todas.length} farmacias raw (antes de dedupe)`)

  // Dedupe por nombre+direccion+localidad. Una farmacia con tramos diurno
  // y nocturno aparece dos veces — concatenamos horarios.
  const dedupe = new Map()
  for (const f of todas) {
    const key = `${f.nombre}|${f.direccion}|${f.localidad}`.toLowerCase()
    if (dedupe.has(key)) {
      const existing = dedupe.get(key)
      if (!existing.horario.includes(f.horario)) {
        existing.horario = `${existing.horario} / ${f.horario}`.slice(0, 80)
      }
      continue
    }
    dedupe.set(key, { ...f })
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias. La estructura cambio?`)
  }

  // Geocoding via Nominatim con cache por nombre+direccion+localidad.
  const cache = loadCache()
  let geocodedNuevas = 0
  let descartadas = 0
  for (const f of dedupe.values()) {
    const cacheKey = `${f.nombre}|${f.direccion}|${f.localidad}`.toLowerCase()
    if (cache[cacheKey]) {
      f.coord = cache[cacheKey]
      continue
    }
    const dirSinAnotaciones = f.direccion.replace(/\([^)]*\)/g, '').trim()
    process.stdout.write(`    geocoding "${f.nombre.slice(0, 40)}" (${f.localidad})... `)
    let coord = await geocodeNominatim(dirSinAnotaciones, f.localidad)
    if (!coord) coord = await geocodeNominatim('', f.localidad)
    if (coord) {
      cache[cacheKey] = coord
      f.coord = coord
      geocodedNuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      descartadas++
      console.log('FAIL')
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (geocodedNuevas > 0) {
    saveCache(cache)
    console.log(`  ${geocodedNuevas} farmacias geocodificadas y guardadas en cache`)
  }
  if (descartadas > 0) {
    console.log(`  ${descartadas} farmacias sin coord (Nominatim fallo)`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    if (!f.coord) continue
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.localidad,
      // Sin telefono ni CP en el microsite.
      '',
      '',
      f.horario,
      // No hay descripcion textual de la guardia mas alla del horario.
      '',
    ])
  }

  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} farmacias con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'apps.riojasalud.es',
    territorio: 'rioja',
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
