#!/usr/bin/env node
// v1.14 — Descarga las farmacias de guardia de Córdoba capital desde la web
// del COF Córdoba (cofco.org).
//
// Fuente:
//   https://www.cofco.org/guardias/paginas/Impresion.php
//   HTML imprimible que lista TODAS las farmacias de guardia de Córdoba
//   capital, organizadas por calendario (L-V, SAB, DOM, FESTIVO) y turno
//   (DIA 9:30-22:00, NOCHE 22:00-9:30 dia siguiente).
//
// Estructura:
//   <div class="fecha">CORDOBA DE LUNES A VIERNES</div>
//   <div class="fondodia"><table>...filas...</table></div>
//   <div class="fondonoche"><table>...filas...</table></div>
//   <div class="fecha">CORDOBA SABADOS</div>
//   ...
//
// Cada fila:
//   <tr class="pijamaoscuro|pijamaclaro">
//     <td class="farmacia"><b>CALLE, NUM</b></td>
//     <td class="bloque">REFERENCIA</td>
//     <td class="bloque">ZONA X</td>
//   </tr>
//
// IMPORTANTE: NO hay nombre, NO hay telefono, NO hay coordenadas. Solo
// direccion, una referencia textual ("Junto a Plaza El Potro"), y zona.
// Geocodeamos con Nominatim a 1 req/s. Mismo patron que Almeria/Girona.
//
// Algunas farmacias aparecen en varios calendarios/turnos — deduplicamos por
// (calle + zona) y combinamos los slots en un horarioGuardia legible:
//   "L-V D" = laborable diurno (9:30-22:00)
//   "L-V N" = laborable nocturno (22:00-9:30)
//   "SAB N" = sabado nocturno
//   etc.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si HTML <20KB → abort.
//   - Si <30 filas en total → abort (la web cambio).
//   - Si <15 farmacias geocodificadas → abort (Nominatim bloqueado?).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-cordoba.json')

const COF_URL = 'https://www.cofco.org/guardias/paginas/Impresion.php'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.14 (+https://webapp-3ft.pages.dev)'

async function fetchCOF(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COF_URL, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 20_000) throw new Error(`HTML sospechoso (${html.length} bytes, esperado >40KB)`)
      return html
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

// Decode entidades HTML basicas. Orden IMPORTA: `&amp;` se decodifica AL FINAL
// para evitar double-unescape (CodeQL marca el orden inverso como vulnerabilidad).
function decodeEntities(s) {
  if (!s) return ''
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/gi, 'Ñ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function clean(s, max) {
  let t = String(s || '')
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, '')
    if (next === t) break
    t = next
  }
  t = decodeEntities(t).replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Title case Unicode-aware (preserva acentos sin partirlos).
function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

// Normaliza el nombre de calendario al codigo corto:
//   "CORDOBA DE LUNES A VIERNES" → "L-V"
//   "CORDOBA SABADOS"             → "SAB"
//   "CORDOBA DOMINGOS"            → "DOM"
//   "CORDOBA FESTIVO 2 NOVIEMBRE" → "FESTIVO"
function diaCode(fechaTxt) {
  const t = (fechaTxt || '').toUpperCase()
  if (t.includes('LUNES A VIERNES')) return 'L-V'
  if (t.includes('SABADO')) return 'SAB'
  if (t.includes('DOMINGO')) return 'DOM'
  if (t.includes('FESTIVO')) return 'FESTIVO'
  return ''
}

// Bounding box capital Córdoba con margen razonable.
const BBOX_CO = { minLat: 37.78, maxLat: 37.95, minLng: -4.95, maxLng: -4.65 }

const geoCache = new Map()
async function geocode(calle) {
  const key = calle.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)

  // Limpieza para Nominatim:
  //   "AV.JESUS RESCATADO, S/N" → "Avenida Jesus Rescatado"
  //   "C/SOMEONE, 4"             → "Calle Someone 4"
  let calleNorm = calle
    .replace(/\bC\/\s*/gi, 'Calle ')
    .replace(/\bAV\.?\s*/gi, 'Avenida ')
    .replace(/\bAVDA\.?\s*/gi, 'Avenida ')
    .replace(/\bPZ?A\.?\s*/gi, 'Plaza ')
    .replace(/\bGTA\.?\s*/gi, 'Glorieta ')
    .replace(/\bCTRA\.?\s*/gi, 'Carretera ')
    .replace(/\bS\/N\b/gi, '')
    .replace(/,\s*$/, '')
    .replace(/\s+/g, ' ').trim()

  const queries = [
    `${calleNorm}, Córdoba, España`,
    `${calleNorm}, Cordoba`,
  ]

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
      for (const hit of arr) {
        const lat = parseFloat(hit.lat)
        const lng = parseFloat(hit.lon)
        if (!isFinite(lat) || !isFinite(lng)) continue
        if (lat < BBOX_CO.minLat || lat > BBOX_CO.maxLat) continue
        if (lng < BBOX_CO.minLng || lng > BBOX_CO.maxLng) continue
        const coord = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
        geoCache.set(key, coord)
        return coord
      }
    } catch {
      // swallow
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  geoCache.set(key, null)
  return null
}

// Recorre el HTML secuencialmente. Mantiene contexto de dia+turno y para
// cada <tr> extrae las 3 columnas. Devuelve [{calle, referencia, zona, dia, turno}].
function extractFilas(html) {
  // Recolectamos todos los eventos en orden por posicion en el HTML.
  const events = []
  const reFecha = /<div class="fecha">([^<]+)<\/div>/g
  const reTurno = /(DE 9:30 DE LA MA[ÑN]ANA A 22:00 DE LA NOCHE|DE 22:00 DE LA NOCHE A 9:30 DEL DIA SIGUIENTE)/g
  const reFila = /<tr class=['"]pijama(?:oscuro|claro)['"][^>]*>([\s\S]*?)<\/tr>/g

  let m
  while ((m = reFecha.exec(html))) events.push({ pos: m.index, type: 'fecha', val: m[1] })
  while ((m = reTurno.exec(html))) {
    const turno = m[1].includes('22:00 DE LA NOCHE A') ? 'N' : 'D'
    events.push({ pos: m.index, type: 'turno', val: turno })
  }
  while ((m = reFila.exec(html))) events.push({ pos: m.index, type: 'fila', val: m[1] })

  events.sort((a, b) => a.pos - b.pos)

  const filas = []
  let dia = '', turno = ''
  for (const e of events) {
    if (e.type === 'fecha') dia = diaCode(e.val)
    else if (e.type === 'turno') turno = e.val
    else if (e.type === 'fila') {
      const tdMatches = [...e.val.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      if (tdMatches.length < 3) continue
      const calle = clean(tdMatches[0][1], 100)
      const referencia = clean(tdMatches[1][1], 80)
      const zona = clean(tdMatches[2][1], 60)
      if (!calle || calle.length < 3) continue
      filas.push({ calle, referencia, zona, dia, turno })
    }
  }
  return filas
}

async function main() {
  console.log('Descargando guardias Córdoba (COF Córdoba)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  const filas = extractFilas(html)
  console.log(`  ${filas.length} filas parseadas`)

  if (filas.length < 30) {
    throw new Error(`Solo ${filas.length} filas. Esperado >100. La web cambio?`)
  }
  if (filas.length > 300) {
    throw new Error(`Sospechoso: ${filas.length} filas. Max razonable ~200. Abortamos.`)
  }

  // Dedupe por (calle + zona). Combina slots de cada farmacia en horarioGuardia.
  const dedupe = new Map()
  for (const f of filas) {
    const key = `${f.calle.toLowerCase()}||${f.zona.toLowerCase()}`
    const slot = `${f.dia} ${f.turno}`.trim()
    if (dedupe.has(key)) {
      dedupe.get(key).slots.add(slot)
    } else {
      dedupe.set(key, {
        calle: f.calle,
        referencia: f.referencia,
        zona: f.zona,
        slots: new Set(slot ? [slot] : []),
      })
    }
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${dedupe.size * 2}s)...`)
  const guardias = []
  let sinCoord = 0
  let done = 0
  for (const f of dedupe.values()) {
    done++
    const coord = await geocode(f.calle)
    if (done % 10 === 0) console.log(`  ${done}/${dedupe.size} procesadas, ${guardias.length} OK, ${sinCoord} sin coord`)
    if (!coord) { sinCoord++; continue }

    const calleTitle = titleCase(f.calle)
    const dirFinal = f.referencia
      ? `${calleTitle} (${f.referencia})`
      : calleTitle
    const horarioGuardia = Array.from(f.slots).sort().join(' / ')

    guardias.push([
      coord[0],
      coord[1],
      dirFinal.slice(0, 140),
      'Córdoba',
      '',
      '',
      horarioGuardia,
      f.zona ? titleCase(f.zona.replace(/^ZONA\s+/i, '')) : '',
    ])
  }

  console.log(`  ${guardias.length} guardias con coord (${sinCoord} sin resultado en Nominatim)`)

  if (guardias.length < 15) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofco.org',
    territorio: 'cordoba',
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
