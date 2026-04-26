#!/usr/bin/env node
// v1.24 — Descarga las farmacias de guardia de la provincia de Barcelona
// desde el endpoint publico de farmaguia.net (web oficial del COF Barcelona).
//
// Fuente:
//   GET https://www.farmaguia.net/desktop/data.html
//                              ?a=posicio&lat=41.3851&lon=2.1734
//                              &r=99999999999&l=10000
//   con headers X-Requested-With: XMLHttpRequest + Referer
//   → JSON { farmacias:[...] }. Cada item:
//     { NumeroFarmacia, Nom, Tipus, Latitud, Longitud, Distancia,
//       Adreca, Telefon, webAddress, mobile, whatsapp, Serveis,
//       Oberta, Guardia, HorariS, Horari }
//
// Estrategia:
//   Se piden TODAS las farmacias de la provincia (radio 99999999999, limit
//   10000) desde el centro de Barcelona. Despues filtramos por Guardia==='1'
//   localmente. ~2389 totales / ~56 de guardia/dia.
//
// VENTAJA: una sola peticion GET, sin auth, coords nativas, todas las
// farmacias provincia (~2300) en una respuesta.
//
// CAVEAT — Adreca:
//   Formato `CL RAMBLES,98  , 08002, BARCELONA` (calle, CP, ciudad
//   separados por coma). Parseamos con regex para extraer CP y municipio.
//
// CAVEAT — guardia limitada:
//   El endpoint marca solo ~56 farmacias como Guardia=1 al dia. Eso son
//   las "guardia 24h" + "guardia diurna prolongada". Coincide con el
//   patron de otros COFs catalanes.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-barcelona.json')

// Centro Barcelona ciudad. El radio enorme (99999999999) garantiza que el
// servidor devuelve toda la provincia (incluyendo Manresa, Granollers, Vic,
// Mataro, Vilanova, etc.).
const API_URL = 'https://www.farmaguia.net/desktop/data.html?a=posicio&lat=41.3851&lon=2.1734&r=99999999999&l=10000'
const REFERER = 'https://www.farmaguia.net/'
const USER_AGENT = 'cercaya-guardias/1.24 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Barcelona — incluye Berga al norte, Sitges al sur, Manresa
// al oeste, costa Maresme al este. Sirve de defensa contra coords corruptas.
const BBOX = { minLat: 41.20, maxLat: 42.45, minLng: 1.35, maxLng: 2.95 }

async function fetchFarmacias(attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': REFERER,
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw lastErr
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

function parseCoord(rawLat, rawLng) {
  const lat = parseFloat(rawLat)
  const lng = parseFloat(rawLng)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// "CL RAMBLES,98  , 08002, BARCELONA" → { calle, cp, ciudad }
// El separador es coma. La calle puede llevar coma intermedia (raro), por
// eso parseamos desde el final: CP es 5 digitos, ciudad es lo ultimo.
function parseAdreca(raw) {
  const s = clean(raw, 200)
  if (!s) return { calle: '', cp: '', ciudad: '' }
  const partes = s.split(',').map(p => p.trim()).filter(Boolean)
  // Buscamos el CP (5 digitos) desde el final.
  let cp = ''
  let ciudad = ''
  let cpIdx = -1
  for (let i = partes.length - 1; i >= 0; i--) {
    if (/^\d{5}$/.test(partes[i])) {
      cp = partes[i]
      cpIdx = i
      break
    }
  }
  if (cpIdx >= 0 && cpIdx < partes.length - 1) {
    ciudad = partes.slice(cpIdx + 1).join(', ')
  } else if (cpIdx === -1 && partes.length >= 2) {
    // Sin CP: la ultima parte es la ciudad.
    ciudad = partes[partes.length - 1]
  }
  const calleParts = cpIdx >= 0 ? partes.slice(0, cpIdx) : partes.slice(0, -1)
  const calle = calleParts.join(', ').trim()
  return { calle, cp, ciudad: titleCase(ciudad) }
}

async function main() {
  console.log('Descargando farmacias provincia Barcelona (farmaguia.net)...')
  const data = await fetchFarmacias()
  const lista = data?.farmacias || []
  console.log(`  ${lista.length} farmacias totales en provincia`)

  if (lista.length < 1000) {
    throw new Error(`Solo ${lista.length} farmacias. Esperado >2000. La API cambio?`)
  }

  // Filtrar solo las de guardia (Guardia === "1"). El resto vienen como null.
  const guardiaRaw = lista.filter(f => f && (f.Guardia === '1' || f.Guardia === 1))
  console.log(`  ${guardiaRaw.length} farmacias con Guardia=1`)

  if (guardiaRaw.length < 10) {
    throw new Error(`Solo ${guardiaRaw.length} guardias. Esperado >30. Abortamos.`)
  }
  if (guardiaRaw.length > 500) {
    throw new Error(`Sospechoso: ${guardiaRaw.length} guardias. Max razonable ~150. Abortamos.`)
  }

  // Dedupe por NumeroFarmacia.
  const dedupe = new Map()
  let descartadasCoord = 0
  for (const f of guardiaRaw) {
    const coord = parseCoord(f.Latitud, f.Longitud)
    if (!coord) {
      descartadasCoord++
      continue
    }
    const key = String(f.NumeroFarmacia || `${f.Nom}|${f.Adreca}`)
    if (dedupe.has(key)) continue
    const adr = parseAdreca(f.Adreca)
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.Nom, 80)),
      direccion: adr.calle,
      municipio: adr.ciudad,
      cp: adr.cp,
      telefono: clean(f.Telefon, 30).replace(/\s+/g, ''),
      horario: clean(f.Horari, 80),
      // El campo Serveis trae extras (MHDA, ortopedia, etc.) — info util
      // de descripcion de la farmacia.
      horarioDesc: clean(f.Serveis, 80),
    })
  }

  if (descartadasCoord > 0) {
    console.log(`  ${descartadasCoord} registros descartados por coords fuera del bbox provincial`)
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 10) {
    throw new Error(`Solo ${dedupe.size} farmacias con coord validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      f.horario,
      f.horarioDesc,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaguia.net',
    territorio: 'barcelona',
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
