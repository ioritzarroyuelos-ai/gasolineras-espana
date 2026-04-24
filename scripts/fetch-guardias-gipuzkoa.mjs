#!/usr/bin/env node
// v1.10 — Descarga las farmacias de guardia de Gipuzkoa desde la API JSON
// del COF Gipuzkoa (cofgipuzkoa.pretools.net).
//
// Fuente:
//   Front (para obtener IDs de municipio):
//     https://www.cofgipuzkoa.eus/ciudadano/farmacias-gipuzkoa/farmacias-de-guardia-2/
//   API real:
//     POST https://cofgipuzkoa.pretools.net/buscarFarmaciasGuardia
//     body: { "municipio": "X,Y", "fecha": "YYYY-MM-DD", "festivos": [] }
//
// El front tiene un <select id="municipio"> con options cuyo value es
// "<zonaGuardia>,<zona13h>". Muchos municipios comparten los mismos pares
// (la guardia cubre una zona, no un municipio), asi que extraemos los pares
// UNICOS y hacemos un POST por cada uno. Luego deduplicamos por `id` (cada
// farmacia puede venir en varias consultas porque cubre varios municipios).
//
// IMPORTANTE: la API NO devuelve coordenadas. Para el mapa geocodeamos con
// Nominatim (OSM) a razon de 1 req/s (limite de Nominatim). Probamos varias
// estrategias de query porque las direcciones del COF vienen en mayusculas
// y a veces con abreviaturas raras.
//
// Rate limit: ~90 requests en total (una por farmacia unica). A 1.1s cada
// una son ~100s. Cache interno en memoria para no repetir. El workflow GHA
// corre semanalmente asi que el coste total es minimo.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <20 municipios unicos en el select → abort (API cambio).
//   - Si <30 guardias con coord resueltas → abort (Nominatim bloqueado?).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-gipuzkoa.json')

const FRONT_URL = 'https://www.cofgipuzkoa.eus/ciudadano/farmacias-gipuzkoa/farmacias-de-guardia-2/'
const API_URL = 'https://cofgipuzkoa.pretools.net/buscarFarmaciasGuardia'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.10 (+https://webapp-3ft.pages.dev)'

// Tipos de guardia mapeados a etiquetas humanas (corto para que quepa en la UI).
const TIPO_DESC = {
  '694c2fd7-6c2f-ed11-9db1-0022489d69fc': 'Día',
  '107665e3-7832-ed11-9db1-0022489c80ec': 'Noche',
  'c46368dd-7832-ed11-9db1-0022489c80ec': 'Refuerzo',
  '13h': '13 horas',
}

async function fetchText(url, opts = {}, attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9,eu;q=0.5',
          ...(opts.headers || {}),
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (e) {
      lastErr = e
      console.error(`    fallo intento ${i}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw lastErr
}

// Normaliza direccion COF para Nominatim: pasa a titulo, quita abreviaturas
// raras, convierte "Mª" en "M", etc. Ej "CALLE IDIAQUEZ,  4" → "Calle Idiaquez 4".
function normDir(s) {
  return String(s || '')
    .replace(/M[ªa]\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s+/g, ', ')
    .trim()
}

// Bounding box aprox Gipuzkoa. Generosa para no perder farmacias del borde
// con Bizkaia, Araba, Navarra o Francia.
const BBOX_GI = { minLat: 42.9, maxLat: 43.5, minLng: -2.6, maxLng: -1.7 }

// Geocodifica con Nominatim. Prueba 2 estrategias: primero con nombre y
// direccion + poblacion, luego solo direccion + poblacion. La primera suele
// acertar con la farmacia exacta (Nominatim indexa amenity=pharmacy con
// nombres de titulares). Cache en memoria por clave (nombre+direccion) para
// dedupe entre tipos (misma farmacia de Dia y de 13h).
const geoCache = new Map()
async function geocode(nombre, direccion, poblacion) {
  const key = `${nombre}||${direccion}||${poblacion}`.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)

  const queries = [
    `${nombre} ${normDir(direccion)} ${poblacion}`,
    `${normDir(direccion)} ${poblacion}`,
  ].filter(q => q.trim().length > 5)

  for (const q of queries) {
    try {
      const url = `${NOMINATIM_URL}?format=json&countrycodes=es&limit=3&q=${encodeURIComponent(q)}`
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      })
      if (!res.ok) continue
      const arr = await res.json()
      if (!Array.isArray(arr)) continue
      // Primer hit dentro de la bounding box de Gipuzkoa.
      for (const hit of arr) {
        const lat = parseFloat(hit.lat)
        const lng = parseFloat(hit.lon)
        if (!isFinite(lat) || !isFinite(lng)) continue
        if (lat < BBOX_GI.minLat || lat > BBOX_GI.maxLat) continue
        if (lng < BBOX_GI.minLng || lng > BBOX_GI.maxLng) continue
        const coord = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
        geoCache.set(key, coord)
        return coord
      }
    } catch {
      // swallow — probamos el siguiente query
    }
    // Delay entre queries del mismo registro para no pegar a Nominatim.
    await new Promise(r => setTimeout(r, 1100))
  }
  geoCache.set(key, null)
  return null
}

async function main() {
  console.log('Descargando IDs de municipio del front COF Gipuzkoa...')
  const html = await fetchText(FRONT_URL)
  if (html.length < 10000) throw new Error(`HTML front sospechoso (${html.length} bytes)`)

  const selectMatch = html.match(/<select[^>]*id="municipio"[\s\S]*?<\/select>/)
  if (!selectMatch) throw new Error('No se encontro <select id="municipio"> en la web COF Gipuzkoa')

  const opts = selectMatch[0].match(/value="([^"]+)"/g) || []
  const pares = opts.map(o => o.match(/value="([^"]+)"/)[1]).filter(v => /^\d+,\d+$/.test(v))
  const paresUnicos = [...new Set(pares)]
  console.log(`  ${pares.length} options en select, ${paresUnicos.length} pares unicos`)

  if (paresUnicos.length < 15) {
    throw new Error(`Solo ${paresUnicos.length} municipios unicos. El select ha cambiado. Abortamos.`)
  }

  const hoy = new Date().toISOString().slice(0, 10)
  console.log(`  consultando API para fecha ${hoy}`)

  const porId = new Map()
  for (const municipio of paresUnicos) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
        body: JSON.stringify({ municipio, fecha: hoy, festivos: [] }),
      })
      if (!res.ok) { console.error(`    ${municipio}: HTTP ${res.status}`); continue }
      const data = await res.json()
      if (!Array.isArray(data)) continue
      for (const f of data) {
        if (!f || !f.id) continue
        // Mantener la entrada con tipo mas "util" — Dia > Noche > 13h >
        // Refuerzo. Si ya existe con un tipo, preferimos Dia/Noche sobre 13h.
        const existente = porId.get(f.id)
        if (!existente) porId.set(f.id, f)
      }
      process.stdout.write('.')
    } catch (e) {
      console.error(`    ${municipio}: ${e.message}`)
    }
  }
  console.log('')
  console.log(`  ${porId.size} farmacias unicas recibidas de la API`)

  if (porId.size < 30) {
    throw new Error(`Solo ${porId.size} farmacias. La API esta rota. Abortamos sin sobrescribir.`)
  }

  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${Math.ceil(porId.size * 1.2)}s)...`)
  const guardias = []
  let sinCoord = 0
  let done = 0
  for (const f of porId.values()) {
    done++
    const nombre = String(f.nombre || '').trim()
    const direccion = String(f.direccion || '').trim()
    const poblacion = String(f.poblacion || '').trim()
    const telefono = String(f.telefono || '').trim()
    const horarioGuardia = String(f.horario || '').trim()
    const tipoDesc = TIPO_DESC[f.tipo] || ''
    const barrio = String(f.barrio || '').trim()

    if (!nombre || !direccion) { sinCoord++; continue }

    const coord = await geocode(nombre, direccion, poblacion)
    if (done % 10 === 0) console.log(`  ${done}/${porId.size} procesadas, ${guardias.length} OK, ${sinCoord} sin coord`)
    if (!coord) { sinCoord++; continue }

    const dirFinal = (nombre ? nombre + ' · ' : '') + direccion
    const horDesc = [tipoDesc, barrio].filter(Boolean).join(' · ')
    guardias.push([
      coord[0],
      coord[1],
      dirFinal.slice(0, 140),
      poblacion.slice(0, 60),
      telefono.slice(0, 30),
      '',
      horarioGuardia.slice(0, 40),
      horDesc.slice(0, 120),
    ])
  }

  console.log(`  ${guardias.length} guardias con coord (${sinCoord} sin resultado en Nominatim)`)

  if (guardias.length < 30) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofgipuzkoa.pretools.net',
    territorio: 'gipuzkoa',
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
