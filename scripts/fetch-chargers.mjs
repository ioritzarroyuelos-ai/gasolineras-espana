#!/usr/bin/env node
// Ship 25.5 — Descarga puntos de recarga para coches electricos desde
// OpenStreetMap (Overpass API) y los guarda en public/data/chargers.json.
//
// Por que OSM Overpass vs OpenChargeMap:
//   - OCM ahora exige API key incluso para una sola request (HTTP 403 sin key),
//     y un secreto en un repo publico complica la colaboracion. Probamos con
//     OCM en el primer intento del deploy y devolvio 403 en los 5 retries.
//   - OSM Overpass API es anonima, con User-Agent educado. Cobertura en Espana:
//     ~5k nodos con amenity=charging_station (menor que OCM pero suficiente
//     para cubrir los operadores principales: Iberdrola, Repsol, Endesa, Tesla,
//     Ionity, Zunder, Wenea, etc.).
//   - Los datos de OSM tienen heterogeneidad (kW a veces en tag "maxpower",
//     "capacity", "socket:*:output" etc.), pero con un parser tolerante
//     cubrimos el 80% de los casos. Para el 20% restante mostramos "N/D".
//
// Diseno del output (idem Ship 25.5 original):
//   Formato array-of-arrays para minimizar overhead JSON. ~5k puntos
//   = ~280KB raw, ~80KB gzip. Frontend parsea esto una sola vez y los pinta
//   en una capa aparte del cluster de gasolineras.
//
//   [lat, lng, titulo, operador, maxKw, conectores]
//
// Errores:
//   Si Overpass cae o devuelve menos de 1000 puntos (sospechoso, ES tiene
//   ~5k), hacemos exit 1 sin sobrescribir el snapshot — mismo patron
//   defensivo que fetch-prices.mjs.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'chargers.json')

// Overpass QL: busca todos los nodos (y ways cerrados) con amenity=charging_station
// dentro del area ISO3166-1=ES. Area incluye peninsula + Baleares + Canarias
// + Ceuta/Melilla. "out body" devuelve tags + coords. "center" para los ways
// (que vuelven como poligono — queremos el punto medio para pintar un pin).
const OVERPASS_QUERY = [
  '[out:json][timeout:120];',
  'area["ISO3166-1"="ES"][admin_level=2]->.es;',
  '(',
  '  node["amenity"="charging_station"](area.es);',
  '  way["amenity"="charging_station"](area.es);',
  ');',
  'out center tags;'
].join('\n')

// Lista de mirrors Overpass. El principal (overpass-api.de) suele funcionar
// pero a veces se satura. Fallback a mirrors conocidos para reliability.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
]

// User-Agent educado: identifica la app y un email de contacto. Overpass
// rechaza requests anonimos o con UA sospechoso (curl/wget). Poner un nombre
// claro asegura que si hicieramos algo mal, el admin nos contacta en vez de
// bloquearnos.
const USER_AGENT = 'gasolineras-espana/1.8 (+https://webapp-3ft.pages.dev)'

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

// Normaliza el nombre de un conector al prefijo mas util para filtrar:
// CCS (coche electrico moderno), CHAdeMO (japones), T2 (Mennekes/Type 2),
// T1 (Type 1/SAE J1772), Tesla, Schuko (enchufe domestico). Otros pasan tal
// cual recortados.
function shortConnector(title) {
  if (!title) return ''
  const t = String(title).toUpperCase()
  if (t.includes('CCS') || t.includes('COMBO')) return 'CCS'
  if (t.includes('CHADEMO')) return 'CHAdeMO'
  if (t.includes('TESLA') || t.includes('SUPERCHARGER')) return 'Tesla'
  if (t.includes('TYPE2') || t.includes('TYPE_2') || t.includes('MENNEKES')) return 'T2'
  if (t.includes('TYPE1') || t.includes('TYPE_1') || t.includes('J1772')) return 'T1'
  if (t.includes('SCHUKO') || t.includes('CEE_BLUE')) return 'Schuko'
  if (t.includes('CEE')) return 'CEE'
  return String(title).length > 12 ? String(title).substring(0, 12) : String(title)
}

// Extrae kW de un tag OSM. Tags tipicos:
//   "22", "22 kW", "50kW", "22.5", "3.7 kW"
// Devuelve numero o 0 si no parseable.
function parseKw(raw) {
  if (raw == null) return 0
  const m = String(raw).replace(',', '.').match(/(\d+(?:\.\d+)?)/)
  if (!m) return 0
  const n = parseFloat(m[1])
  return isFinite(n) ? n : 0
}

// OSM usa varios tags para potencia (historia larga de convenciones). Probamos
// en orden de preferencia, cogemos el maximo.
function extractMaxKw(tags) {
  const candidates = []
  if (tags['maxpower']) candidates.push(parseKw(tags['maxpower']))
  if (tags['charging_station:output']) candidates.push(parseKw(tags['charging_station:output']))
  // Tags socket:*:output (ej. socket:type2:output=22 kW)
  for (const k of Object.keys(tags)) {
    if (/^socket:.+:output$/.test(k)) {
      candidates.push(parseKw(tags[k]))
    }
  }
  // capacity rara vez es kW, pero a veces la gente pone "22kW" ahi
  if (tags['capacity'] && /kw/i.test(String(tags['capacity']))) {
    candidates.push(parseKw(tags['capacity']))
  }
  return candidates.length ? Math.max.apply(null, candidates) : 0
}

// Extrae conectores presentes mirando tags socket:*=yes/N.
function extractConnectors(tags) {
  const set = new Set()
  for (const k of Object.keys(tags)) {
    const m = k.match(/^socket:([^:]+)$/)
    if (m && tags[k] && tags[k] !== 'no' && tags[k] !== '0') {
      const short = shortConnector(m[1])
      if (short) set.add(short)
    }
  }
  // socket:type = string con lista separada por ";" (ej. "type2;ccs;chademo")
  if (tags['socket:type']) {
    String(tags['socket:type']).split(/[;,]/).forEach(s => {
      const short = shortConnector(s.trim())
      if (short) set.add(short)
    })
  }
  return Array.from(set)
}

async function main() {
  console.log('Descargando puntos de recarga de OpenStreetMap (Overpass)...')
  const elements = await fetchOverpass()
  console.log(`  ${elements.length} elementos recibidos de Overpass`)
  if (elements.length < 1000) {
    throw new Error(`Respuesta sospechosa: solo ${elements.length} elementos (Espana suele tener ~5k). NO sobrescribimos chargers.json.`)
  }

  const chargers = []
  let skipped = 0
  for (const el of elements) {
    // nodes tienen lat/lon directo; ways tienen "center.lat/lon"
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat)
    const lng = el.lon != null ? el.lon : (el.center && el.center.lon)
    if (typeof lat !== 'number' || typeof lng !== 'number') { skipped++; continue }
    // Bounding box de Espana (mismo criterio que el validador del frontend)
    if (lat < 26 || lat > 44.5 || lng < -19 || lng > 5.5) { skipped++; continue }

    const tags = el.tags || {}
    const title = (tags.name || tags['name:es'] || tags.brand || 'Recargador eléctrico').substring(0, 60)
    const op = (tags.operator || tags['operator:ES'] || tags.network || '').substring(0, 30)
    const maxKw = extractMaxKw(tags)
    const conns = extractConnectors(tags)

    chargers.push([
      Math.round(lat * 1e5) / 1e5,   // 5 decimales = ~1m precision — suficiente y ahorra bytes
      Math.round(lng * 1e5) / 1e5,
      title,
      op,
      Math.round(maxKw),
      conns.join(',')
    ])
  }

  console.log(`  ${chargers.length} puntos validos (${skipped} descartados sin coords o fuera de ES)`)

  const out = {
    ts: new Date().toISOString(),
    source: 'openstreetmap.org',
    count: chargers.length,
    // Orden de campos en cada entry — documentado aqui para que el frontend
    // no tenga que adivinarlo. Mismo contrato que en client/map.ts.
    schema: ['lat', 'lng', 'title', 'operator', 'maxKw', 'connectors'],
    chargers
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${chargers.length} recargadores guardados en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
