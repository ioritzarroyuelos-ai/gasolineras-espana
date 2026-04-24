#!/usr/bin/env node
// v1.17 — Descarga las farmacias de guardia de Alicante desde la API REST
// publica del COF Alicante (plugin WP propio "wp-cofa").
//
// Fuente:
//   1. GET https://cofalicante.com/wp-json/wp-cofa/v1/locations
//      → array {name, value} de 141 municipios agrupados en 51 zonas unicas.
//      Las zonas (value) son codigos de 2 digitos no consecutivos.
//   2. Para cada zona unica:
//      GET https://cofalicante.com/wp-json/wp-cofa/v1/pharmacies?d=YYYY-MM-DD&l=NN
//      → array de farmacias de guardia (sin coords, requiere geocoding).
//
// VENTAJA: REST publico, sin auth, sin nonce, sin paginacion. La unica
// pega es la geocodificacion Nominatim (~68 farmacias = ~70s a 1 req/s).
//
// Schema input pharmacy (campos relevantes):
//   { code, name, location, address, pc, schedule, phone }
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <10 farmacias unicas → abort.
//   - Si <5 geocoded → abort (Nominatim baneado).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-alicante.json')

const API_BASE = 'https://cofalicante.com/wp-json/wp-cofa/v1'
const USER_AGENT = 'cercaya-guardias/1.17 (+https://webapp-3ft.pages.dev)'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

// Bbox provincia Alicante (incluye Pilar de la Horadada al sur, Banyeres
// de Mariola al norte interior y Tabarca como margen).
const BBOX_A = { minLat: 37.8, maxLat: 38.9, minLng: -1.4, maxLng: 0.3 }

async function fetchJSON(url, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 2000))
    }
  }
  throw lastErr
}

// Title case Unicode-aware.
function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Normaliza la direccion del COF (suelen venir tipo "AV. PADRE ESPLA, Nº35")
// a algo mas legible: "Avda. Padre Esplá, Nº35".
function normDir(s) {
  let t = clean(s, 120)
  // Abreviaturas comunes en mayusculas.
  t = t.replace(/^AV\./i, 'Avda.')
  t = t.replace(/^AVDA\./i, 'Avda.')
  t = t.replace(/^C\//i, 'C/')
  t = t.replace(/^CL\./i, 'C/')
  t = t.replace(/^PL\./i, 'Pl.')
  t = t.replace(/^PLAZA/i, 'Plaza')
  t = t.replace(/^CTRA\./i, 'Ctra.')
  t = t.replace(/^URB\./i, 'Urb.')
  t = t.replace(/^PASEO/i, 'Paseo')
  // Si todavia es ALL CAPS, pasar a title case.
  if (t === t.toUpperCase()) t = titleCase(t)
  return t
}

// "De 09:30:00 a 09:30:00" → "9:30-9:30" (24h).
// "De 09:00:00 a 22:00:00" → "9:00-22:00".
// "De 21:00:00 a 09:00:00" → "21:00-9:00".
function parseHorario(schedule) {
  if (!schedule) return ''
  const m = String(schedule).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*a\s*(\d{1,2}):(\d{2})/i)
  if (!m) return ''
  const ini = `${parseInt(m[1], 10)}:${m[2]}`
  const fin = `${parseInt(m[3], 10)}:${m[4]}`
  return `${ini}-${fin}`
}

async function geocode(address, location, pc) {
  const q = `${address}, ${pc} ${location}, Alicante, España`
  const url = `${NOMINATIM}?format=json&limit=1&addressdetails=0&countrycodes=es&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const arr = await res.json()
    if (!Array.isArray(arr) || arr.length === 0) return null
    const lat = parseFloat(arr[0].lat)
    const lng = parseFloat(arr[0].lon)
    if (!isFinite(lat) || !isFinite(lng)) return null
    if (lat < BBOX_A.minLat || lat > BBOX_A.maxLat) return null
    if (lng < BBOX_A.minLng || lng > BBOX_A.maxLng) return null
    return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
  } catch {
    return null
  }
}

async function main() {
  // Fecha YYYY-MM-DD UTC.
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const fecha = `${yyyy}-${mm}-${dd}`

  console.log(`Descargando zonas COF Alicante...`)
  const locations = await fetchJSON(`${API_BASE}/locations`)
  if (!Array.isArray(locations) || locations.length < 50) {
    throw new Error(`Esperaba >50 zonas, recibido ${locations?.length || 0}`)
  }
  const zonas = Array.from(new Set(locations.map(l => l.value).filter(Boolean)))
  console.log(`  ${zonas.length} zonas unicas (de ${locations.length} municipios)`)

  console.log(`Descargando guardias para fecha ${fecha} (${zonas.length} zonas)...`)
  // Iteramos las zonas en serie, con pequena pausa para ser buen vecino.
  // 51 zonas × ~150ms = ~8s. Razonable.
  const todas = []
  for (let i = 0; i < zonas.length; i++) {
    const z = zonas[i]
    try {
      const arr = await fetchJSON(`${API_BASE}/pharmacies?d=${fecha}&l=${z}`)
      if (Array.isArray(arr)) todas.push(...arr)
    } catch (e) {
      console.error(`    zona ${z}: ${e.message}`)
    }
    if (i < zonas.length - 1) await new Promise(r => setTimeout(r, 150))
  }
  console.log(`  ${todas.length} registros recibidos`)

  if (todas.length < 10) {
    throw new Error(`Solo ${todas.length} farmacias. Esperado >40. La API cambio?`)
  }
  if (todas.length > 300) {
    throw new Error(`Sospechoso: ${todas.length} farmacias. Max razonable ~120. Abortamos.`)
  }

  // Dedupe por code.
  const dedupe = new Map()
  for (const f of todas) {
    if (!f.code) continue
    const key = String(f.code)
    if (dedupe.has(key)) continue
    dedupe.set(key, {
      nombre: titleCase(clean(f.name, 80)),
      direccion: normDir(f.address),
      direccionRaw: clean(f.address, 120),
      municipio: titleCase(clean(f.location, 60)),
      municipioRaw: clean(f.location, 60),
      telefono: clean(f.phone, 30).replace(/\s+/g, ''),
      cp: clean(f.pc, 5),
      horario: parseHorario(f.schedule),
    })
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 10) {
    throw new Error(`Solo ${dedupe.size} farmacias unicas. Abortamos.`)
  }

  // Geocodificar en serie a 1 req/s para no enfadar a Nominatim.
  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${dedupe.size}s)...`)
  const guardias = []
  let i = 0
  let okCount = 0
  let failCount = 0
  for (const f of dedupe.values()) {
    i++
    const coord = await geocode(f.direccionRaw, f.municipioRaw, f.cp)
    if (coord) {
      const dirFinal = `${f.nombre} · ${f.direccion}`
      guardias.push([
        coord[0],
        coord[1],
        dirFinal.slice(0, 140),
        f.municipio,
        f.telefono,
        f.cp,
        f.horario,
        '',
      ])
      okCount++
    } else {
      failCount++
    }
    if (i % 10 === 0) {
      console.log(`  ${i}/${dedupe.size} procesadas, ${okCount} OK, ${failCount} sin coord`)
    }
    if (i < dedupe.size) await new Promise(r => setTimeout(r, 1100))
  }

  console.log(`  ${guardias.length} guardias con coord (${failCount} sin resultado en Nominatim)`)

  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofalicante.com',
    territorio: 'alicante',
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
