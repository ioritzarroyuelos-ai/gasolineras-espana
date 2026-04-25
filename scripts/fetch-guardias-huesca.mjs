#!/usr/bin/env node
// v1.23 — Descarga las farmacias de guardia de Huesca desde el endpoint
// publico del COF Huesca (ControllerFarmaciaGuardia con localizaFarmacias=1).
//
// Fuente:
//   GET https://www.cofhuesca.com/Procesar/procesar.php
//                                ?controller=ControllerFarmaciaGuardia
//                                &localizaFarmacias=1
//   → JSON [{ nombre, latitud, longitud, direccion, telefono, telefonoGL,
//             guardiaLocalizada, refuerzo }, ...]
//
// VENTAJA: array plano, una sola peticion, coordenadas nativas (string).
//
// CAVEAT — sin municipio:
//   El endpoint NO incluye municipio/poblacion. Para esos 20 registros
//   bastaria con reverse-geocoding via Nominatim, pero por simplicidad
//   MVP dejamos `poblacion` vacio. La direccion sale en la tarjeta y
//   ubica al usuario por el mapa.
//
// CAVEAT — refuerzo:
//   Algunas farmacias tienen `refuerzo: "FARMACIA DE GUARDIA EN SABIÑANIGO"`.
//   Lo guardamos en horarioGuardiaDesc para distinguir guardias normales
//   de refuerzo.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <5 farmacias → abort.
//   - Si >100 → abort (Huesca es provincia rural, ~190 farmacias totales).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-huesca.json')

const API_URL = 'https://www.cofhuesca.com/Procesar/procesar.php?controller=ControllerFarmaciaGuardia&localizaFarmacias=1'
const USER_AGENT = 'cercaya-guardias/1.23 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Huesca — incluye Pirineos al norte (Aragnouet/Benasque),
// Monegros al sur, Ribagorza al este, Cinco Villas al oeste. Sirve de
// defensa contra coordenadas corruptas.
const BBOX = { minLat: 41.55, maxLat: 42.95, minLng: -0.85, maxLng: 0.85 }

async function fetchGuardias(attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
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

async function main() {
  console.log('Descargando guardias Huesca (GET cofhuesca/ControllerFarmaciaGuardia)...')
  const lista = await fetchGuardias()
  console.log(`  ${Array.isArray(lista) ? lista.length : 0} registros recibidos`)

  if (!Array.isArray(lista) || lista.length < 5) {
    throw new Error(`Solo ${lista?.length || 0} registros. La API cambio?`)
  }
  if (lista.length > 100) {
    throw new Error(`Sospechoso: ${lista.length} registros. Max razonable ~50. Abortamos.`)
  }

  // Dedupe por nombre+direccion. Algunas farmacias podrian salir dos veces
  // si una misma sirve mañana+tarde, pero el endpoint las da una vez por dia.
  const dedupe = new Map()
  let descartadasCoord = 0
  for (const f of lista) {
    if (!f || !f.nombre) continue
    const coord = parseCoord(f.latitud, f.longitud)
    if (!coord) {
      descartadasCoord++
      continue
    }
    const nombre = titleCase(clean(f.nombre, 80))
    const direccion = clean(f.direccion, 120)
    const key = `${nombre}|${direccion}`
    if (dedupe.has(key)) continue
    dedupe.set(key, {
      coord,
      nombre,
      direccion,
      // telefonoGL es el movil de guardia localizada — preferible al fijo.
      telefono: clean(f.telefonoGL || f.telefono, 30).replace(/\s+/g, ''),
      refuerzo: clean(f.refuerzo, 80),
    })
  }

  if (descartadasCoord > 0) {
    console.log(`  ${descartadasCoord} registros descartados por coords fuera del bbox provincial`)
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 3) {
    throw new Error(`Solo ${dedupe.size} farmacias con coord validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      // El endpoint NO incluye municipio. Lo dejamos vacio — la card
      // mostrara solo la direccion.
      '',
      f.telefono,
      // Tampoco incluye CP.
      '',
      // No hay horario textual — solo booleano de guardia diaria.
      '',
      // Aprovechamos el slot de descripcion para guardar el refuerzo
      // (e.g. "FARMACIA DE GUARDIA EN SABIÑANIGO") si existe.
      f.refuerzo,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofhuesca.com',
    territorio: 'huesca',
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
