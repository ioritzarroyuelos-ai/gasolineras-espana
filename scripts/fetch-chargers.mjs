#!/usr/bin/env node
// Ship 25.5 — Descarga puntos de recarga para coches electricos desde
// OpenChargeMap (OCM) y los guarda en public/data/chargers.json.
//
// Por que OCM vs MITECO/OSM:
//   - OCM es una API REST con contrato estable, documentada y mantenida por
//     comunidad global. Cobertura en Espana ~18-20k puntos, incluye potencia
//     (kW) + tipo de conector + operador, que son los 3 datos criticos para
//     un usuario de coche electrico.
//   - MITECO no tiene API publica con tanto detalle.
//   - OSM (amenity=charging_station) esta bien para densidad urbana pero los
//     metadatos son inconsistentes (falta kW en la mitad de nodos).
//
// Diseno del output:
//   Formato array-of-arrays para minimizar overhead JSON. ~18k puntos a ~80B
//   cada uno = ~1.4 MB raw, ~400 KB gzip. Frontend parsea esto una sola vez
//   y los pinta en una capa aparte del cluster de gasolineras.
//
//   [lat, lng, titulo, operador, maxKw, conectores]
//
// Rate limiting OCM:
//   Sin API key, OCM limita a ~200 req/dia por IP. Un fetch con
//   maxresults=20000 es UNA sola request, asi que este script corre sin
//   problema sin key. Si se quiere incrementar la frecuencia o garantizar
//   reliability, definir OPENCHARGEMAP_KEY como env var (secreto en GHA).
//
// Errores:
//   Si OCM cae o devuelve menos de 5000 puntos (sospechoso, cuando OCM tiene
//   ~18k para ES), hacemos exit 1 sin sobrescribir el snapshot — mismo
//   patron defensivo que fetch-prices.mjs.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'chargers.json')

// OpenChargeMap API v3. Parametros:
//   output=json           - formato de respuesta
//   countrycode=ES        - solo Espana (incluye peninsula, Baleares, Canarias, Ceuta/Melilla)
//   maxresults=20000      - cap alto: Espana tiene ~18k puntos; cualquier numero superior
//                           da lo que haya.
//   compact=true          - omite metadata de referencia que no usamos
//   verbose=false         - omite comentarios + media para mas compactacion
const OCM_URL = 'https://api.openchargemap.io/v3/poi/' +
  '?output=json&countrycode=ES&maxresults=20000&compact=true&verbose=false'

const OCM_KEY = process.env.OPENCHARGEMAP_KEY || ''

async function fetchWithRetry(url, attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const headers = { 'Accept': 'application/json' }
      if (OCM_KEY) headers['X-API-Key'] = OCM_KEY
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      console.error(`  intento ${i}/${attempts} fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

// Normaliza el nombre de un conector al prefijo mas util para filtrar:
// CCS (coche electrico moderno), CHAdeMO (japones), T2 (Mennekes/Type 2),
// T1 (Type 1/SAE J1772), Tesla, Schuko (enchufe domestico). Otros pasan tal
// cual recortados. El objetivo es que el usuario pueda filtrar "solo CCS" o
// "solo T2" sin tener que lidiar con 30 variantes de string.
function shortConnector(title) {
  if (!title) return ''
  const t = title.toUpperCase()
  if (t.includes('CCS')) return 'CCS'
  if (t.includes('CHADEMO')) return 'CHAdeMO'
  if (t.includes('TESLA')) return 'Tesla'
  if (t.includes('TYPE 2') || t.includes('MENNEKES')) return 'T2'
  if (t.includes('TYPE 1') || t.includes('J1772')) return 'T1'
  if (t.includes('SCHUKO') || t.includes('CEE 7/4')) return 'Schuko'
  if (t.includes('CEE')) return 'CEE'
  return title.length > 12 ? title.substring(0, 12) : title
}

async function main() {
  console.log('Descargando puntos de recarga de OpenChargeMap...')
  const pois = await fetchWithRetry(OCM_URL)
  if (!Array.isArray(pois)) {
    throw new Error('Respuesta OCM no es array: ' + typeof pois)
  }
  console.log(`  ${pois.length} POIs recibidos de OCM`)
  if (pois.length < 1000) {
    throw new Error(`Respuesta sospechosa: solo ${pois.length} puntos (Espana suele tener ~18k). NO sobrescribimos chargers.json.`)
  }

  const chargers = []
  let skipped = 0
  for (const poi of pois) {
    const addr = poi.AddressInfo || {}
    const lat = typeof addr.Latitude === 'number' ? addr.Latitude : null
    const lng = typeof addr.Longitude === 'number' ? addr.Longitude : null
    if (lat == null || lng == null) { skipped++; continue }
    // Punto fuera de los limites razonables de Espana — descartamos (OCM a
    // veces tiene POIs que se colaron en paises vecinos por error de geocoder).
    if (lat < 26 || lat > 44.5 || lng < -19 || lng > 5.5) { skipped++; continue }

    const title = (addr.Title || '').substring(0, 60)
    const op = (poi.OperatorInfo && poi.OperatorInfo.Title) || ''
    const opShort = op.substring(0, 30)

    const conns = Array.isArray(poi.Connections) ? poi.Connections : []
    let maxKw = 0
    const types = new Set()
    for (const c of conns) {
      if (typeof c.PowerKW === 'number' && c.PowerKW > maxKw) maxKw = c.PowerKW
      const ct = c.ConnectionType && c.ConnectionType.Title
      const short = shortConnector(ct)
      if (short) types.add(short)
    }

    chargers.push([
      Math.round(lat * 1e5) / 1e5,   // 5 decimales = ~1m precision — suficiente y ahorra bytes
      Math.round(lng * 1e5) / 1e5,
      title,
      opShort,
      Math.round(maxKw),
      Array.from(types).join(',')
    ])
  }

  console.log(`  ${chargers.length} puntos validos (${skipped} descartados sin coords o fuera de ES)`)

  const out = {
    ts: new Date().toISOString(),
    source: 'openchargemap.org',
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
