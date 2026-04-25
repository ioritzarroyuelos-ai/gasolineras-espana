#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de la provincia de Santa Cruz
// de Tenerife desde la API JSON pública del COF Tenerife.
//
// Cubre las 4 islas occidentales: Tenerife, La Palma, La Gomera y El Hierro
// (53 municipios en el listado, agrupados todos bajo la provincia 38).
//
// Fuente:
//   1) GET https://www.coftenerife.es/farmacias/controller/server.php/api/municipios
//      → JSON [{IdTermino, Termino, TipoTermino:"M"}, ...] con los 53
//        municipios de la provincia.
//   2) GET .../api/municipios/<IdTermino>/open/now
//      → JSON con farmacias abiertas/de guardia ahora en ese municipio,
//        incluyendo lat/lng nativas, telefono, horario textual.
//      Header `Authorization: ` (vacío) requerido — el cliente JS lo manda
//      siempre porque la API valida que el header exista.
//
// CAVEAT — sin info de provincia "santa cruz de tenerife":
//   La provincia es la 38 pero el `IdTermino=38` corresponde al municipio
//   "santa cruz de tenerife" (la capital). Para cobertura completa
//   iteramos los 53 municipios.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-tenerife.json')

const API_BASE = 'https://www.coftenerife.es/farmacias/controller/server.php/api'
const REFERER = 'https://www.coftenerife.es/farmacias/'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Santa Cruz de Tenerife (incluye Tenerife + La Palma +
// La Gomera + El Hierro). Defensa contra coords basura.
const BBOX = { minLat: 27.5, maxLat: 28.9, minLng: -18.3, maxLng: -16.1 }

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Referer': REFERER,
  'User-Agent': USER_AGENT,
  'Authorization': '', // vacío pero presente — el cliente JS lo manda asi
}

async function fetchJson(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  throw lastErr
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

async function main() {
  console.log('Descargando guardias Tenerife — coftenerife.es API JSON...')

  const municipios = await fetchJson(`${API_BASE}/municipios`)
  console.log(`  ${municipios.length} municipios detectados`)
  if (municipios.length < 30) {
    throw new Error(`Solo ${municipios.length} municipios. La estructura cambio?`)
  }
  if (municipios.length > 100) {
    throw new Error(`Sospechoso: ${municipios.length} municipios. Max razonable ~80.`)
  }

  const dedupe = new Map()
  let descartadas = 0
  let errores = 0
  for (const m of municipios) {
    try {
      const farmacias = await fetchJson(`${API_BASE}/municipios/${m.IdTermino}/open/now`)
      if (!Array.isArray(farmacias)) continue
      for (const f of farmacias) {
        const lat = parseFloat(f.latitud)
        const lng = parseFloat(f.longitud)
        if (!isFinite(lat) || !isFinite(lng)) { descartadas++; continue }
        if (lat < BBOX.minLat || lat > BBOX.maxLat) { descartadas++; continue }
        if (lng < BBOX.minLng || lng > BBOX.maxLng) { descartadas++; continue }
        const id = f.idFarmacia || `${lat},${lng}`
        if (dedupe.has(id)) continue
        dedupe.set(id, { ...f, lat, lng })
      }
    } catch (e) {
      errores++
      // Fallos individuales toleramos — solo abortamos si caen todos.
    }
    // Pausa minima para no martillear el backend.
    await new Promise(r => setTimeout(r, 80))
  }
  console.log(`  ${dedupe.size} farmacias unicas, ${descartadas} fuera bbox, ${errores} municipios con error`)

  if (errores > municipios.length * 0.5) {
    throw new Error(`Demasiados errores (${errores}/${municipios.length}). API caida?`)
  }
  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const titNombre = titleCase(f.nombreFarmacia || '')
    const dirRaw = f.direccion || ''
    const dirFinal = `${titNombre} · ${titleCase(dirRaw)}`.replace(/\s+·\s*$/, '')
    const telefono = String(f.telefono || '').replace(/\s+/g, '')
    const horario = (f.descripcionHorario || '').slice(0, 100)
    const horarioDesc = f.zonaGuardia ? `Zona: ${f.zonaGuardia}` : ''
    guardias.push([
      Math.round(f.lat * 1e5) / 1e5,
      Math.round(f.lng * 1e5) / 1e5,
      dirFinal.slice(0, 140),
      titleCase(f.municipio || ''),
      telefono,
      '', // CP no expuesto en este endpoint
      horario,
      horarioDesc,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'coftenerife.es',
    territorio: 'tenerife',
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
