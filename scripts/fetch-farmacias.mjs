#!/usr/bin/env node
// v1.9 — Descarga farmacias de OpenStreetMap (Overpass API) y las guarda en
// public/data/farmacias.json. Misma estrategia que fetch-chargers.mjs.
//
// Por que OSM:
//   - No hay registro oficial nacional de farmacias publico con API. Los
//     colegios autonomicos (COFM, COF Bizkaia, etc.) publican listados pero
//     cada uno con su formato, sin API estandar, y cobertura desigual.
//   - OSM tiene ~22k farmacias con amenity=pharmacy en Espana (el dato
//     oficial son ~22.200 farmacias, asi que cobertura ~100%). Cada una con
//     name, addr:*, phone, opening_hours en la mayoria de casos.
//   - Datos libres CC-BY-SA 2.0. Atribucion en el footer del /farmacias/.
//   - Cron mensual porque las farmacias casi nunca mueven. Las guardias semanales
//     son otro data source (COFs) — no viven aqui.
//
// Diseno del output:
//   Array-of-arrays para minimizar overhead JSON. ~22k puntos = ~2.5MB raw,
//   ~700KB gzip. El frontend parsea una vez, filtra por radio desde la
//   ubicacion del usuario (Haversine), pinta los cercanos en el mapa.
//
//   [lat, lng, name, addr, phone, hours]
//
// Errores:
//   Si Overpass cae o devuelve menos de 10.000 puntos (sospechoso, ES tiene
//   ~22k), exit 1 sin sobrescribir. Mismo patron defensivo que el resto.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'farmacias.json')

// Overpass QL: busca nodes y ways con amenity=pharmacy dentro del area
// ISO3166-1=ES (peninsula + Baleares + Canarias + Ceuta/Melilla). "out center
// tags" para tener el centroide de los ways (que son edificios).
//
// healthcare=pharmacy es un tag alternativo que algunos mappers usan — lo
// incluimos tambien para no perder cobertura. Overpass deduplica por id.
const OVERPASS_QUERY = [
  '[out:json][timeout:180];',
  'area["ISO3166-1"="ES"][admin_level=2]->.es;',
  '(',
  '  node["amenity"="pharmacy"](area.es);',
  '  way["amenity"="pharmacy"](area.es);',
  '  node["healthcare"="pharmacy"](area.es);',
  '  way["healthcare"="pharmacy"](area.es);',
  ');',
  'out center tags;'
].join('\n')

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
]

const USER_AGENT = 'cercaya-farmacias/1.9 (+https://webapp-3ft.pages.dev)'

async function fetchOverpass(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    const endpoint = OVERPASS_ENDPOINTS[(i - 1) % OVERPASS_ENDPOINTS.length]
    try {
      console.log(`  intento ${i}/${attempts} — ${endpoint}`)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY)
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!data || !Array.isArray(data.elements)) {
        throw new Error('Respuesta Overpass sin campo "elements"')
      }
      return data.elements
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 10000))
    }
  }
  throw lastErr
}

// Compone la direccion desde los tags addr:* de OSM. Convencion OSM:
//   addr:street + addr:housenumber + addr:postcode + addr:city
// Algunas farmacias solo tienen addr:full. Cubrimos ambos casos.
function buildAddress(tags) {
  if (tags['addr:full']) return String(tags['addr:full']).substring(0, 120)
  const parts = []
  const street = tags['addr:street']
  const num = tags['addr:housenumber']
  if (street) parts.push(num ? `${street} ${num}` : street)
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:village']
  const cp = tags['addr:postcode']
  if (cp && city) parts.push(`${cp} ${city}`)
  else if (city) parts.push(city)
  else if (cp) parts.push(cp)
  return parts.join(', ').substring(0, 120)
}

// Normaliza telefono. OSM permite varios formatos: "+34 91 123 45 67",
// "911234567", "91 123 45 67". Dejamos pasar tal cual, maximo 30 chars.
// El cliente hara el tel: link sin mas logica.
function normalizePhone(raw) {
  if (!raw) return ''
  return String(raw).trim().substring(0, 30)
}

// Las horas en OSM siguen el formato opening_hours spec
// (https://wiki.openstreetmap.org/wiki/Key:opening_hours). Ejemplos:
//   "Mo-Fr 09:00-14:00,17:00-20:30; Sa 09:00-14:00"
//   "24/7"
//   "Mo-Sa 09:30-21:00"
//
// No intentamos parsear aqui — el frontend tiene una mini-lib para traducir
// a "Hoy: 09:00-14:00, 17:00-20:30" en castellano. Aqui solo guardamos el
// string crudo, truncado a 200 chars para no romper JSON con casos raros.
function normalizeHours(raw) {
  if (!raw) return ''
  return String(raw).trim().substring(0, 200)
}

async function main() {
  console.log('Descargando farmacias de OpenStreetMap (Overpass)...')
  const elements = await fetchOverpass()
  console.log(`  ${elements.length} elementos recibidos de Overpass`)
  if (elements.length < 10000) {
    throw new Error(`Respuesta sospechosa: solo ${elements.length} elementos (Espana suele tener ~22k). NO sobrescribimos farmacias.json.`)
  }

  const farmacias = []
  const seenIds = new Set()
  let skipped = 0
  for (const el of elements) {
    // Deduplicar: el mismo POI puede aparecer como node y como way si alguien
    // lo mapeo dos veces, o con amenity=pharmacy + healthcare=pharmacy. Usamos
    // type+id como clave unica.
    const key = `${el.type}:${el.id}`
    if (seenIds.has(key)) { skipped++; continue }
    seenIds.add(key)

    // nodes tienen lat/lon directo; ways tienen center.lat/lon
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat)
    const lng = el.lon != null ? el.lon : (el.center && el.center.lon)
    if (typeof lat !== 'number' || typeof lng !== 'number') { skipped++; continue }
    // Bounding box de Espana
    if (lat < 26 || lat > 44.5 || lng < -19 || lng > 5.5) { skipped++; continue }

    const tags = el.tags || {}
    const name = (tags.name || tags['name:es'] || tags.brand || 'Farmacia').substring(0, 80)
    const addr = buildAddress(tags)
    const phone = normalizePhone(tags.phone || tags['contact:phone'])
    const hours = normalizeHours(tags.opening_hours)

    farmacias.push([
      Math.round(lat * 1e5) / 1e5,   // 5 decimales = ~1m precision
      Math.round(lng * 1e5) / 1e5,
      name,
      addr,
      phone,
      hours
    ])
  }

  console.log(`  ${farmacias.length} farmacias validas (${skipped} descartadas: dup, sin coords o fuera de ES)`)

  const out = {
    ts: new Date().toISOString(),
    source: 'openstreetmap.org',
    license: 'ODbL (OSM contributors)',
    count: farmacias.length,
    schema: ['lat', 'lng', 'name', 'addr', 'phone', 'hours'],
    farmacias
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${farmacias.length} farmacias guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
