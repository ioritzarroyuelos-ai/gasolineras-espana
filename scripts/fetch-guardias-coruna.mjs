#!/usr/bin/env node
// v1.11 — Descarga las farmacias de guardia de A Coruña desde la web del
// COF A Coruña (cofc.es).
//
// Fuente:
//   https://www.cofc.es/farmacia/index
//   Pagina ASP.NET con buscador + Google Maps. Todos los markers vienen
//   embebidos en el HTML dentro de una llamada JS:
//     mapaBuscadorFarmacias.addMarkers([{...},{...}])
//   Cada objeto ya trae latitud, longitud, direccion, telefono, horario y
//   nombrePoblacion — no hace falta geocodificar.
//
// Un dia normal salen ~90-100 farmacias. El HTML pesa ~200KB.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si addMarkers no aparece → la web cambio, abort.
//   - Si el array tiene <10 o >200 farmacias → abort (cifra esperada ~99).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-coruna.json')

const COF_URL = 'https://www.cofc.es/farmacia/index'
const USER_AGENT = 'cercaya-guardias/1.11 (+https://webapp-3ft.pages.dev)'

async function fetchCOF(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COF_URL, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9,gl;q=0.5',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 100_000) throw new Error(`HTML sospechoso (${html.length} bytes, esperado ~200KB)`)
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
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'))
  return isFinite(n) ? Math.round(n * 1e5) / 1e5 : NaN
}

function clean(s, max) {
  // Strip tags en bucle hasta estabilizar — defensivo contra tags anidados
  // aunque aqui no los esperamos (los datos vienen de un JSON, no de HTML).
  let t = String(s || '')
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, '')
    if (next === t) break
    t = next
  }
  t = t.replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Normaliza el horario "09:00 - 21:00 (Ahora cerrada)" o "09:00 - 09:30 (día posterior)"
// a "09:00-21:00" — consistente con Madrid/Alava.
function parseHorario(raw) {
  if (!raw) return ''
  const m = String(raw).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/)
  if (!m) return clean(raw, 40)
  return `${m[1]}-${m[2]}`
}

// Extrae el array JSON pasado a addMarkers([...]). Igual que en Alava,
// conteo manual de brackets porque hay {}/[] anidados y strings con comillas.
function extractMarkers(html) {
  const needle = 'addMarkers('
  const idx = html.indexOf(needle)
  if (idx === -1) return null
  const arrStart = idx + needle.length
  if (html[arrStart] !== '[') return null
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
          console.error(`    JSON.parse fallo: ${e.message}`)
          return null
        }
      }
    }
  }
  return null
}

async function main() {
  console.log('Descargando farmacias de guardia de A Coruña (COF A Coruña)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  console.log('Extrayendo JSON de addMarkers...')
  const markers = extractMarkers(html)
  if (!Array.isArray(markers)) {
    throw new Error('No se encontro o no pudo parsear el array addMarkers. La web cambio?')
  }
  console.log(`  ${markers.length} markers parseados`)

  if (markers.length < 10) {
    throw new Error(`Solo ${markers.length} markers. Esperado ~99. Abortamos.`)
  }
  if (markers.length > 200) {
    throw new Error(`Sospechoso: ${markers.length} markers. Max razonable ~150. Abortamos.`)
  }

  const guardias = []
  let sinCoord = 0
  for (const m of markers) {
    if (!m) { sinCoord++; continue }

    const lat = parseCoord(m.latitud)
    const lng = parseCoord(m.longitud)
    if (!isFinite(lat) || !isFinite(lng)) { sinCoord++; continue }

    // Bounding box provincia A Coruña (lat 42.3-43.8, lng -9.5 a -7.7).
    // Generosa para incluir municipios fronterizos con Lugo/Pontevedra.
    if (lat < 42.3 || lat > 43.8 || lng < -9.5 || lng > -7.7) { sinCoord++; continue }

    const titulo = clean(m.nombre || '', 80)
    const dirBase = clean(m.direccion || '', 120)
    const direccionFinal = titulo ? `${titulo} · ${dirBase}` : dirBase

    const poblacion = clean(m.nombrePoblacion || '', 60)
    const telefono = clean(m.telefono || '', 30)
    const cp = '' // El JSON no incluye CP
    const horarioGuardia = parseHorario(m.horario)
    const horDesc = clean(m.nombreGuardiaTipoTurno || '', 60)

    guardias.push([lat, lng, direccionFinal.slice(0, 140), poblacion, telefono, cp, horarioGuardia, horDesc])
  }

  console.log(`  ${guardias.length} guardias validas (${sinCoord} descartadas por coord/bbox)`)

  if (guardias.length < 10) {
    throw new Error(`Solo ${guardias.length} guardias validas. Abortamos sin sobrescribir.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofc.es',
    territorio: 'coruna',
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
