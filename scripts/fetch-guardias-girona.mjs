#!/usr/bin/env node
// v1.13 — Descarga las farmacias de guardia de Girona desde la web del
// COF Girona (cofgi.org).
//
// Fuente:
//   https://www.cofgi.org/farmacies/farmacies-de-guardia
//   HTML server-rendered con tabla #pharmacies-of-guard-data-table.
//   Lista las farmacias de guardia "fins avui DD/MM/YYYY a les HH:MM"
//   (~20-70 farmacias segun el dia).
//
// Estructura por fila:
//   <tr class="pharmacy-detail" href="/farmacies/detall-guardia/ID">
//     <td>NOMBRE</td>
//     <td>POBLACIO</td>
//     <td class="pharmacy-guard-schedule">HORARIO ("Avui fins les HH:MM")</td>
//     <td></td>
//     <td>ADREÇA</td>
//     <td>TELEFON</td>
//     <td><i class="fa fa-info-circle"/></td>
//   </tr>
//
// IMPORTANTE: la pagina NO devuelve coordenadas. Geocodeamos con Nominatim
// a 1 req/s. Mismo patron que Gipuzkoa/Almeria.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si HTML <50KB → abort.
//   - Si <5 filas pharmacy-detail → abort.
//   - Si <5 geocodeadas → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-girona.json')

const COF_URL = 'https://www.cofgi.org/farmacies/farmacies-de-guardia'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.13 (+https://webapp-3ft.pages.dev)'

async function fetchCOF(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COF_URL, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ca-ES,ca;q=0.9,es;q=0.8',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 50_000) throw new Error(`HTML sospechoso (${html.length} bytes, esperado >100KB)`)
      return html
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

function clean(s, max) {
  let t = String(s || '')
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, '')
    if (next === t) break
    t = next
  }
  t = t.replace(/&amp;/g, '&').replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
       .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú')
       .replace(/&ntilde;/gi, 'ñ').replace(/&Ntilde;/gi, 'Ñ').replace(/&nbsp;/g, ' ')
       .replace(/&ccedil;/gi, 'ç').replace(/&Ccedil;/gi, 'Ç').replace(/&agrave;/gi, 'à')
       .replace(/&egrave;/gi, 'è').replace(/&igrave;/gi, 'ì').replace(/&ograve;/gi, 'ò')
       .replace(/&ugrave;/gi, 'ù')
  t = t.replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-záéíóúñüçàèìòù])/g, m => m.toUpperCase())
}

// Normaliza direccion catalana COF para Nominatim:
//   - "C/Figueres" → "Carrer Figueres"
//   - "Av/Verdaguer" → "Avinguda Verdaguer"
//   - "Pl. Major" → "Plaça Major"
//   - Quita contenido entre parentesis (barrios, info extra) que confunde a Nominatim
function normDirCa(s) {
  let t = String(s || '')
  t = t.replace(/\([^)]*\)/g, ' ')
  t = t.replace(/\bC\/\s*/gi, 'Carrer ')
       .replace(/\bAv\/?\.?\s+/gi, 'Avinguda ')
       .replace(/\bPl\.?\s+/gi, 'Plaça ')
       .replace(/\bPg\.?\s+/gi, 'Passeig ')
       .replace(/\bCtra\.?\s+/gi, 'Carretera ')
       .replace(/\bUrb\.?\s+/gi, 'Urbanització ')
  t = t.replace(/\s+/g, ' ').replace(/,\s*/g, ' ').trim()
  return t
}

// Extrae el horario crudo "Avui fins les 09:00" → "fins 09:00".
// Si no matchea formato esperado, devuelve el texto limpio truncado.
function parseHorario(raw) {
  const txt = clean(raw)
  const m = txt.match(/(?:fins\s+(?:les\s+)?)(\d{1,2}:\d{2})/i)
  if (m) return `fins ${m[1]}`
  // Fallback: cualquier HH:MM
  const m2 = txt.match(/(\d{1,2}:\d{2})/)
  if (m2) return m2[1]
  return clean(raw, 40)
}

// Bounding box provincia Girona. Generosa para fronterizos con Barcelona,
// Lleida y Francia.
const BBOX_GI = { minLat: 41.5, maxLat: 42.6, minLng: 1.5, maxLng: 3.4 }

const geoCache = new Map()
async function geocode(nombre, direccion, poblacion) {
  const key = `${direccion}||${poblacion}`.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)

  const dirNorm = normDirCa(direccion)
  const queries = [
    `${nombre} ${dirNorm} ${poblacion}`,
    `${dirNorm} ${poblacion}`,
    `${poblacion} ${dirNorm}`,
  ].map(q => q.replace(/\s+/g, ' ').trim()).filter(q => q.length > 5)

  for (const q of queries) {
    try {
      const url = `${NOMINATIM_URL}?format=json&countrycodes=es&limit=3&q=${encodeURIComponent(q)}`
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'Accept-Language': 'ca-ES,ca;q=0.9,es;q=0.8',
        },
      })
      if (!res.ok) continue
      const arr = await res.json()
      if (!Array.isArray(arr)) continue
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
      // swallow
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  geoCache.set(key, null)
  return null
}

// Extrae los <tr class="pharmacy-detail"> con sus <td> hijos.
// La estructura tiene atributos custom (`href` en <tr>, no estandar) — usamos
// un parser manual basado en busqueda secuencial.
function extractFilas(html) {
  const filas = []
  const needle = '<tr class="pharmacy-detail"'
  let pos = 0
  while (true) {
    const start = html.indexOf(needle, pos)
    if (start === -1) break
    const end = html.indexOf('</tr>', start)
    if (end === -1) break
    filas.push(html.slice(start, end + 5))
    pos = end + 5
  }
  return filas
}

// Extrae los <td>...</td> de una fila, en orden.
function extractCeldas(fila) {
  const celdas = []
  const re = /<td[^>]*>([\s\S]*?)<\/td>/g
  let m
  while ((m = re.exec(fila)) !== null) {
    celdas.push(m[1])
  }
  return celdas
}

async function main() {
  console.log('Descargando farmacias de guardia de Girona (COF Girona)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  const filas = extractFilas(html)
  console.log(`  ${filas.length} filas pharmacy-detail encontradas`)

  if (filas.length < 3) {
    throw new Error(`Solo ${filas.length} filas. Esperado >5. La web cambio?`)
  }
  if (filas.length > 300) {
    throw new Error(`Sospechoso: ${filas.length} filas. Max razonable ~200. Abortamos.`)
  }

  const farmacias = []
  for (const fila of filas) {
    const celdas = extractCeldas(fila)
    if (celdas.length < 5) continue
    // En la practica el regex de <td>...</td> no greedy se "come" la celda
    // vacia que hay entre horario y direccion porque la celda de horario
    // tiene <td>...</td> anidados en su contenido. Indices reales tras
    // observar el output:
    //   [0] nombre, [1] poblacion, [2] horario, [3] direccion, [4] telefono
    const nombre = clean(celdas[0], 80)
    const poblacion = clean(celdas[1], 60)
    const horarioGuardia = parseHorario(celdas[2])
    const direccion = titleCase(clean(celdas[3], 120))
    const telefono = clean(celdas[4], 30)

    if (!nombre || !direccion) continue
    farmacias.push({ nombre: titleCase(nombre), direccion, poblacion: titleCase(poblacion), telefono, horarioGuardia })
  }

  console.log(`  ${farmacias.length} farmacias parseadas con datos completos`)

  if (farmacias.length < 5) {
    throw new Error(`Solo ${farmacias.length} farmacias con datos completos. Abortamos.`)
  }

  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${Math.ceil(farmacias.length * 1.5)}s)...`)
  const guardias = []
  let sinCoord = 0
  let done = 0
  for (const f of farmacias) {
    done++
    const coord = await geocode(f.nombre, f.direccion, f.poblacion)
    if (done % 10 === 0) console.log(`  ${done}/${farmacias.length} procesadas, ${guardias.length} OK, ${sinCoord} sin coord`)
    if (!coord) { sinCoord++; continue }

    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      coord[0],
      coord[1],
      dirFinal.slice(0, 140),
      f.poblacion,
      f.telefono,
      '',
      f.horarioGuardia,
      '',
    ])
  }

  console.log(`  ${guardias.length} guardias con coord (${sinCoord} sin resultado en Nominatim)`)

  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofgi.org',
    territorio: 'girona',
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
