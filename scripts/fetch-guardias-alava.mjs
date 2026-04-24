#!/usr/bin/env node
// v1.10 — Descarga las farmacias de guardia de Araba/Alava desde la web del
// COF Alava (cofalava.org).
//
// Fuente:
//   https://cofalava.org/farmacias-de-guardia/
//   La pagina carga un mapa con el plugin WP wp-google-map-gold. El JSON con
//   TODAS las farmacias de guardia del AÑO (~5900 entradas) viene embebido
//   dentro de un <script> inline en la misma pagina. No hay API separada.
//
// Formato del JSON inline:
//   "places":[
//     { "id":"...", "title":"NOMBRE", "address":"CALLE X, N",
//       "location":{ "lat":"42.8543418", "lng":"-2.6522101", "city":"...",
//                    "extra_fields":{ "horarios":"09:00-22:00", "fecha":"01/01/2026",
//                                     "telefono":"945...", "barrio":"...",
//                                     "poblacion":"Vitoria-Gasteiz", "zona":"..." } } },
//     ...
//   ]
//
// IMPORTANTE: el JSON tiene TODO el año asi que hay que filtrar por
// `extra_fields.fecha` igual a hoy (formato DD/MM/YYYY). Un dia normal
// salen ~15-25 farmacias. La pagina pesa 6.5MB (parseo ~1s).
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si el places total es <1000 → la web cambio, abort.
//   - Si las filtradas por fecha son 0 o >100 → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-alava.json')

const COF_URL = 'https://cofalava.org/farmacias-de-guardia/'
const USER_AGENT = 'cercaya-guardias/1.10 (+https://webapp-3ft.pages.dev)'

async function fetchCOF(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COF_URL, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9,eu;q=0.5',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 1_000_000) throw new Error(`HTML sospechoso (${html.length} bytes, esperado ~6.5MB)`)
      return html
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

function parseCoord(raw) {
  if (raw == null) return NaN
  const n = parseFloat(String(raw).replace(',', '.'))
  return isFinite(n) ? Math.round(n * 1e5) / 1e5 : NaN
}

function clean(s, max) {
  const t = String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Fecha hoy en formato DD/MM/YYYY (el que usa el COF Alava).
function fechaHoyDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd}/${mm}/${yyyy}`
}

// Extrae el array "places" del HTML. El JSON esta inline en un <script>
// largo con otras config. Buscamos el arranque "places":[ y encontramos el
// matching-bracket haciendo conteo manual (regex no basta con strings que
// contienen { } dentro).
function extractPlaces(html) {
  const start = html.indexOf('"places":[')
  if (start === -1) return null
  const arrStart = start + '"places":'.length
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inStr) { escape = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const json = html.slice(arrStart, i + 1)
        try { return JSON.parse(json) } catch (e) {
          console.error(`    JSON.parse fallo en posicion ${arrStart}: ${e.message}`)
          return null
        }
      }
    }
  }
  return null
}

async function main() {
  console.log('Descargando farmacias de guardia de Alava (COF Alava)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  console.log('Parseando JSON de places...')
  const places = extractPlaces(html)
  if (!Array.isArray(places)) {
    throw new Error('No se encontro o no pudo parsear el array "places" en el HTML. La web cambio?')
  }
  console.log(`  ${places.length} places parseadas`)

  if (places.length < 1000) {
    throw new Error(`Solo ${places.length} places. El COF suele tener ~5900 (todo el año). Abortamos.`)
  }

  const fechaHoy = fechaHoyDDMMYYYY()
  console.log(`  filtrando por fecha ${fechaHoy}`)

  const guardias = []
  let fueraFecha = 0
  let sinCoord = 0
  for (const p of places) {
    if (!p || !p.location) { fueraFecha++; continue }
    const loc = p.location
    const extra = loc.extra_fields || {}

    if (extra.fecha !== fechaHoy) { fueraFecha++; continue }

    const lat = parseCoord(loc.lat)
    const lng = parseCoord(loc.lng)
    if (!isFinite(lat) || !isFinite(lng)) { sinCoord++; continue }

    // Bounding box Araba (lat 42.3-43.2, lng -3.3 a -2.2). Generosa para los
    // bordes con La Rioja, Burgos y Bizkaia.
    if (lat < 42.3 || lat > 43.2 || lng < -3.3 || lng > -2.2) { sinCoord++; continue }

    const titulo = clean(p.title || '', 80)
    const addrBase = clean(p.address || '', 120)
    // "direccion-corta" del extra_fields suele ser mas legible que p.address
    const dirCorta = clean(extra['direccion-corta'] || '', 120)
    const direccionRaw = dirCorta || addrBase
    const direccionFinal = titulo ? `${titulo} · ${direccionRaw}` : direccionRaw

    const poblacion = clean(extra.poblacion || loc.city || '', 60)
    const telefono = clean(extra.telefono || '', 30)
    const cp = clean(loc.postal_code || '', 10)
    const horarioGuardia = clean(extra.horarios || '', 40)
    // Desc: zona + barrio si existen, sino vacio.
    const horDesc = [extra.zona || '', extra.barrio || ''].map(s => clean(s, 60)).filter(Boolean).join(' · ').slice(0, 120)

    guardias.push([lat, lng, direccionFinal.slice(0, 140), poblacion, telefono, cp, horarioGuardia, horDesc])
  }

  console.log(`  ${guardias.length} guardias para hoy (${fueraFecha} otra fecha, ${sinCoord} sin coord)`)

  if (guardias.length === 0) {
    throw new Error('Cero guardias para hoy. Araba siempre tiene al menos 3-5. Abortamos sin sobrescribir.')
  }
  if (guardias.length > 100) {
    throw new Error(`Sospechoso: ${guardias.length} guardias en Araba. Max razonable ~50. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofalava.org',
    territorio: 'alava',
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
