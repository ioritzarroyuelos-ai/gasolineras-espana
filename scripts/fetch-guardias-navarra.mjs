#!/usr/bin/env node
// v1.26 — Descarga las farmacias de guardia de Navarra desde el portal de
// Datos Abiertos del Gobierno de Navarra (CKAN). Es la unica fuente oficial,
// sin auth, JSON limpio.
//
// Fuente:
//   GET https://datosabiertos.navarra.es/es/datastore/dump/<resource>?format=json
//   → CKAN dump JSON con structure { fields:[...], records:[[...]] }
//   → ~14 dias rolling (~450 filas) cubriendo hoy + 13 dias siguientes.
//   → Schema: _id, fecha (DD/MM/YYYY), desde, hasta, localidad, grupo,
//             direccion, farmacia, cod_Farmacia, telefono.
//
// CAVEAT — sin lat/lng:
//   El dataset NO incluye coordenadas. Hay que geocodificar via Nominatim
//   (OpenStreetMap, 1 req/s). Cacheamos por cod_Farmacia (codigo oficial
//   estable F0xxxx) en `scripts/cache/navarra-geo.json`. Solo geocodificamos
//   farmacias nuevas — el resto sale del cache.
//
// CAVEAT — fechas:
//   Formato DD/MM/YYYY como string (no ISO). Filtramos hoy en formato local.
//
// CAVEAT — duplicados por turno:
//   Una farmacia puede aparecer 2 veces hoy (turno diurno + nocturno).
//   Dedupe por cod_Farmacia, concatenando horarios.
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
const CACHE_FILE = resolve(CACHE_DIR, 'navarra-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-navarra.json')

const RESOURCE_ID = 'e309e89e-d62e-4222-b6fa-e81d0924a086'
const API_URL = `https://datosabiertos.navarra.es/es/datastore/dump/${RESOURCE_ID}?format=json`
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.26 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Navarra (margen generoso). Defensa contra geocodings que
// devuelvan coordenadas erroneas en otra provincia.
const BBOX = { minLat: 41.85, maxLat: 43.35, minLng: -2.55, maxLng: -0.7 }

function todayDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}

async function fetchDataset(attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const text = await res.text()
      // El dump puede llevar BOM al inicio si se pidio con bom=True; aqui
      // pedimos sin bom pero por si acaso lo limpiamos.
      const clean = text.replace(/^\uFEFF/, '')
      return JSON.parse(clean)
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw lastErr
}

// Carga cache existente o devuelve mapa vacio.
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

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Direcciones tipo "C/ Concejo de Olaz, 14 . Mendillorri - Fase 2".
// El " . " es separador de referencia (centro comercial, etc.).
// Quitamos esa parte para mejor geocoding.
function dirParaGeocoding(raw) {
  const s = clean(raw, 200)
  return s.split(' . ')[0].trim()
}

// Localidad bilingue "Pamplona / Iruña" → preferir el primer termino para
// geocoding (mejor cobertura en Nominatim).
function localidadParaGeocoding(raw) {
  const s = clean(raw, 80)
  return s.split(' / ')[0].trim()
}

async function geocodeNominatim(direccion, localidad) {
  const q = `${direccion}, ${localidad}, Navarra, España`
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
  const fechaHoy = todayDDMMYYYY()
  console.log(`Descargando guardias Navarra (CKAN datosabiertos)...`)
  console.log(`  filtrando por fecha ${fechaHoy}`)

  const dump = await fetchDataset()
  // CKAN dump: { fields: [{id, type}], records: [[v1, v2, ...]] }
  const fields = (dump?.fields || []).map(f => f.id)
  const records = dump?.records || []
  console.log(`  ${records.length} registros totales en dataset (14 dias)`)

  if (records.length < 100) {
    throw new Error(`Solo ${records.length} registros. La API cambio?`)
  }

  // Indices de campos relevantes.
  const idx = {
    fecha: fields.indexOf('fecha'),
    desde: fields.indexOf('desde'),
    hasta: fields.indexOf('hasta'),
    localidad: fields.indexOf('localidad'),
    grupo: fields.indexOf('grupo'),
    direccion: fields.indexOf('direccion'),
    farmacia: fields.indexOf('farmacia'),
    cod: fields.indexOf('cod_Farmacia'),
    telefono: fields.indexOf('telefono'),
  }

  // Filtrar a hoy.
  const hoyRaw = records.filter(r => r[idx.fecha] === fechaHoy)
  console.log(`  ${hoyRaw.length} registros para hoy ${fechaHoy}`)

  if (hoyRaw.length < 5) {
    throw new Error(`Solo ${hoyRaw.length} registros hoy. Esperado >20. Abortamos.`)
  }
  if (hoyRaw.length > 200) {
    throw new Error(`Sospechoso: ${hoyRaw.length} registros hoy. Max razonable ~80. Abortamos.`)
  }

  // Dedupe por cod_Farmacia, concatenando turnos.
  const dedupe = new Map()
  for (const r of hoyRaw) {
    const cod = String(r[idx.cod] || '').trim()
    if (!cod) continue
    const horario = `${r[idx.desde]}h-${r[idx.hasta]}h`
    if (dedupe.has(cod)) {
      const existing = dedupe.get(cod)
      if (!existing.horario.includes(horario)) {
        existing.horario = `${existing.horario} / ${horario}`
      }
      continue
    }
    dedupe.set(cod, {
      cod,
      nombre: titleCase(clean(r[idx.farmacia], 80)),
      direccion: clean(r[idx.direccion], 120),
      localidad: clean(r[idx.localidad], 60),
      grupo: clean(r[idx.grupo], 80),
      telefono: clean(r[idx.telefono], 30).replace(/\s+/g, ''),
      horario,
    })
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe por cod_Farmacia`)

  // Geocoding via Nominatim con cache.
  const cache = loadCache()
  let geocodedNuevas = 0
  let descartadas = 0
  for (const f of dedupe.values()) {
    if (cache[f.cod]) {
      f.coord = cache[f.cod]
      continue
    }
    const dir = dirParaGeocoding(f.direccion)
    const loc = localidadParaGeocoding(f.localidad)
    process.stdout.write(`    geocoding ${f.cod} (${loc})... `)
    const coord = await geocodeNominatim(dir, loc)
    if (coord) {
      cache[f.cod] = coord
      f.coord = coord
      geocodedNuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      // Fallback: solo localidad, sin direccion.
      const fallback = await geocodeNominatim('', loc)
      if (fallback) {
        cache[f.cod] = fallback
        f.coord = fallback
        geocodedNuevas++
        console.log(`OK (fallback localidad) ${fallback[0]},${fallback[1]}`)
      } else {
        descartadas++
        console.log('FAIL')
      }
    }
    // Rate limit Nominatim: 1 req/s. Respetuoso con OSM.
    await new Promise(r => setTimeout(r, 1100))
  }
  if (geocodedNuevas > 0) {
    saveCache(cache)
    console.log(`  ${geocodedNuevas} farmacias geocodificadas y guardadas en cache`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    if (!f.coord) continue
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      titleCase(f.localidad),
      f.telefono,
      // El dataset NO incluye CP — vacio.
      '',
      f.horario,
      f.grupo,
    ])
  }

  if (descartadas > 0) {
    console.log(`  ${descartadas} farmacias sin coord (geocoding fallo)`)
  }
  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} farmacias con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'datosabiertos.navarra.es',
    territorio: 'navarra',
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
