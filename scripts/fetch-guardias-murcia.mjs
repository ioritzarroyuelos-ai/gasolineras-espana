#!/usr/bin/env node
// v1.12 — Descarga las farmacias de guardia de la Region de Murcia desde la
// API publica del COF Region de Murcia (cofrm.com).
//
// Fuente:
//   https://guardias.cofrm.com/api/pharmacies
//   Endpoint JSON publico (sin auth) con las ~580 farmacias de la region.
//   Cada item trae el flag `isOnCallRotation` que indica si esta de guardia
//   HOY y `currentDaySchedule` con el horario.
//
// Formato de respuesta (campos usados):
//   [
//     { id, pharmacyNumber, name, address, town, phone, postalCode,
//       coordinateX, coordinateY,              // UTM zona 30N (metros)
//       currentDaySchedule: "09:30 - 13:45 | 17:30 - 20:30",
//       isOnCallRotation: true|false          // <- filtro principal
//     }, ...
//   ]
//
// Las coordenadas X/Y son UTM zona 30N (ETRS89/WGS84 compatible en la
// precision que necesitamos). Hay que convertirlas a lat/lng. La formula
// la metemos inline porque solo la necesitamos aqui — anyadir proj4 como
// dependencia para una provincia seria excesivo.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si la API no responde o devuelve <100 farmacias → abort (la region
//     tiene ~580).
//   - Si las de guardia son 0 o >150 → abort (rango tipico observado ~40-60).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-murcia.json')

const API_URL = 'https://guardias.cofrm.com/api/pharmacies'
const USER_AGENT = 'cercaya-guardias/1.12 (+https://webapp-3ft.pages.dev)'

async function fetchAPI(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(API_URL, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('respuesta no es array')
      if (data.length < 100) throw new Error(`solo ${data.length} farmacias (esperado ~580)`)
      return data
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

// UTM (zona 30N, WGS84) -> lat/lng. Basado en formulas de Karney/USGS,
// simplificadas para la precision que necesitamos (~1m, mas que suficiente
// para matchear con farmacias OSM en buckets de 11m).
//
// Parametros WGS84:
//   a = 6378137            (semi-eje mayor)
//   f = 1/298.257223563    (achatamiento)
//   k0 = 0.9996            (escala UTM)
//   falseEasting = 500000
//
// Meridiano central zona 30 = -3° (para toda la Region de Murcia)
function utm30nToLatLng(x, y) {
  const a = 6378137
  const f = 1 / 298.257223563
  const k0 = 0.9996
  const e2 = 2 * f - f * f           // e^2
  const ep2 = e2 / (1 - e2)          // e'^2
  const lon0 = -3 * Math.PI / 180    // meridiano central zona 30 en rad

  const X = x - 500000               // hemisferio norte: falseNorthing = 0
  const Y = y
  const M = Y / k0

  // Latitud auxiliar (footpoint)
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256))
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2))
  const phi1 = mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)

  const sinPhi1 = Math.sin(phi1)
  const cosPhi1 = Math.cos(phi1)
  const tanPhi1 = Math.tan(phi1)

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1)
  const T1 = tanPhi1 * tanPhi1
  const C1 = ep2 * cosPhi1 * cosPhi1
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5)
  const D = X / (N1 * k0)

  const phi = phi1
    - (N1 * tanPhi1 / R1)
    * (D * D / 2
       - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
       + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)

  const lam = lon0
    + (D
       - (1 + 2 * T1 + C1) * D ** 3 / 6
       + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120
      ) / cosPhi1

  return [phi * 180 / Math.PI, lam * 180 / Math.PI]
}

function clean(s, max) {
  // Strip tags en bucle (defensivo: los datos vienen de JSON API pero
  // por si algun campo incluye HTML escapado).
  let t = String(s || '')
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, '')
    if (next === t) break
    t = next
  }
  t = t.replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Normaliza "09:30 - 13:45 | 17:30 - 20:30" a "09:30-20:30" (primer inicio,
// ultimo cierre) — simplificacion pragmatica: el usuario ve "de 09:30 a
// 20:30" y el detalle real ya lo ve al llegar. Mismo formato que el resto
// de scrapers.
function parseHorario(raw) {
  if (!raw) return ''
  const matches = String(raw).match(/(\d{1,2}:\d{2})/g)
  if (!matches || matches.length < 2) return clean(raw, 40)
  const ini = matches[0]
  const fin = matches[matches.length - 1]
  return `${ini}-${fin}`
}

async function main() {
  console.log('Descargando farmacias de guardia de Murcia (COF Region de Murcia)...')
  const all = await fetchAPI()
  console.log(`  API devolvio ${all.length} farmacias en total`)

  const onCall = all.filter(p => p && p.isOnCallRotation === true)
  console.log(`  ${onCall.length} con isOnCallRotation=true`)

  if (onCall.length === 0) {
    throw new Error('Cero farmacias de guardia hoy. Murcia suele tener 40-60. Abortamos sin sobrescribir.')
  }
  if (onCall.length > 150) {
    throw new Error(`Sospechoso: ${onCall.length} de guardia. Max razonable ~100. Abortamos.`)
  }

  const guardias = []
  let sinCoord = 0
  for (const p of onCall) {
    const cx = Number(p.coordinateX)
    const cy = Number(p.coordinateY)
    if (!isFinite(cx) || !isFinite(cy) || cx === 0 || cy === 0) { sinCoord++; continue }

    const [lat, lng] = utm30nToLatLng(cx, cy)
    if (!isFinite(lat) || !isFinite(lng)) { sinCoord++; continue }

    // Bounding box Region de Murcia (lat 37.3-38.8, lng -2.4 a -0.6).
    // Generosa para incluir municipios fronterizos con Almeria y Alicante.
    if (lat < 37.3 || lat > 38.8 || lng < -2.4 || lng > -0.6) { sinCoord++; continue }

    const latR = Math.round(lat * 1e5) / 1e5
    const lngR = Math.round(lng * 1e5) / 1e5

    const titulo = clean(p.name || '', 80)
    const addrBase = clean(p.address || '', 120)
    const direccionFinal = titulo ? `${titulo} · ${addrBase}` : addrBase

    const poblacion = clean(p.town || '', 60)
    const telefono = clean(p.phone || '', 30)
    const cp = clean(p.postalCode || '', 10)
    const horarioGuardia = parseHorario(p.currentDaySchedule)
    // Desc: health zone si aporta (ej "11 - MURCIA/CENTRO"). Si no, ""
    const horDesc = clean(p.healthZone || p.municipality || '', 80)

    guardias.push([latR, lngR, direccionFinal.slice(0, 140), poblacion, telefono, cp, horarioGuardia, horDesc])
  }

  console.log(`  ${guardias.length} guardias validas (${sinCoord} descartadas por coord/bbox)`)

  if (guardias.length === 0) {
    throw new Error('Cero guardias validas tras conversion UTM + bbox. Abortamos.')
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofrm.com',
    territorio: 'murcia',
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
