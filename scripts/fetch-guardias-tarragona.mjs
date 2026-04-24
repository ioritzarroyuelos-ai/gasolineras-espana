#!/usr/bin/env node
// v1.14 — Descarga las farmacias de guardia de Tarragona desde la web del
// COF Tarragona (coft.cat).
//
// Fuente:
//   https://coft.cat/font/gampliat.php?CODI=X  → farmacies amb horari ampliat
//   https://coft.cat/font/gpobles.php?CODI=X   → guardia activa hoy
//
// Tarragona usa un sistema rotativo complejo, sin endpoint global. Hay que
// iterar por capital de comarca (10 CODIs conocidos). El gampliat.php
// devuelve las farmacias con HORARI AMPLIAT (mas horas que el promedio,
// proxy razonable para "de guardia" en uso cotidiano). El gpobles.php
// devuelve la guardia rotativa de hoy.
//
// IMPORTANTE: la pagina DECLARA charset=ISO-8859-1 pero los bytes reales son
// UTF-8. Decodificamos como UTF-8 (que es lo que hace fetch().text() por
// defecto).
//
// CODIs verificados (capitales de comarca + algunos pueblos cabecera):
//   20=Reus, 34=Tortosa, 57=El Vendrell, 70=Valls, 88=Montblanc,
//   105=Amposta, 130=Tarragona, 146=Caseres (Terra Alta), 157=Mora d'Ebre,
//   170=Falset (Priorat)
//
// Estructura por farmacia:
//   <table class="table table-striped" id="tablaverde">
//     <thead><tr><th></th>
//       <th><a class='titularGuardia' href='mailto:ofNNN@coft.org'>NOMBRE</a></th>
//     </tr></thead>
//     <tbody>
//       <tr><td><b>Adreça</b></td><td>CALLE (<a>veure mapa</a>)</td></tr>
//       <tr><td><b>Població</b></td><td>POBLACION (CP: NNNNN)</td></tr>
//       <tr><td><b>Telèfon Urgències</b></td><td>...</td></tr>
//       <tr><td><b>Telèfon</b></td><td>NNNNNNNNN</td></tr>
//       <tr><td><b>Horari Normal</b></td><td>HORARIO</td></tr>
//       ...
//     </tbody>
//   </table>
//
// El email (mailto:ofNNN@coft.org) actua como ID unico — deduplicamos por el.
//
// Sin coordenadas → geocodeamos con Nominatim 1 req/s.
//
// Schema output:
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <5 farmacias parseadas → abort.
//   - Si <5 geocodeadas → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-tarragona.json')

const COF_BASE = 'https://coft.cat/font'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.14 (+https://webapp-3ft.pages.dev)'

const CODIS = [20, 34, 57, 70, 88, 105, 130, 146, 157, 170]

async function fetchPage(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ca-ES,ca;q=0.9,es;q=0.8',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      return html
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 2000))
    }
  }
  console.error(`    fallo ${url}: ${lastErr.message}`)
  return ''
}

// Decode entidades. `&amp;` al final para evitar double-unescape (CodeQL).
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
    .replace(/&ccedil;/gi, 'ç')
    .replace(/&Ccedil;/gi, 'Ç')
    .replace(/&agrave;/gi, 'à')
    .replace(/&egrave;/gi, 'è')
    .replace(/&igrave;/gi, 'ì')
    .replace(/&ograve;/gi, 'ò')
    .replace(/&ugrave;/gi, 'ù')
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

// Title case Unicode-aware (preserva tildes catalanes sin partirlos).
function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

// Normaliza direccion catalana para Nominatim:
//   "C/Figueres" → "Carrer Figueres", "Av/Verdaguer" → "Avinguda Verdaguer"
//   "Pl. Major" → "Plaça Major"
function normDirCa(s) {
  let t = String(s || '')
  t = t.replace(/\([^)]*\)/g, ' ')
  t = t.replace(/\bC\/\s*/gi, 'Carrer ')
       .replace(/\bAv\/?\.?\s+/gi, 'Avinguda ')
       .replace(/\bAvda\.?\s+/gi, 'Avinguda ')
       .replace(/\bPl\.?\s+/gi, 'Plaça ')
       .replace(/\bPg\.?\s+/gi, 'Passeig ')
       .replace(/\bCtra\.?\s+/gi, 'Carretera ')
       .replace(/\bUrb\.?\s+/gi, 'Urbanització ')
  t = t.replace(/\s+/g, ' ').replace(/,\s*/g, ' ').trim()
  return t
}

// Bbox provincia Tarragona generosa.
const BBOX_T = { minLat: 40.5, maxLat: 41.6, minLng: 0.0, maxLng: 1.8 }

const geoCache = new Map()
async function geocode(direccion, poblacion) {
  const key = `${direccion}||${poblacion}`.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)

  const dirNorm = normDirCa(direccion)
  const queries = [
    `${dirNorm}, ${poblacion}`,
    `${poblacion}, ${dirNorm}`,
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
        if (lat < BBOX_T.minLat || lat > BBOX_T.maxLat) continue
        if (lng < BBOX_T.minLng || lng > BBOX_T.maxLng) continue
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

// Extrae cada bloque <table class="table table-striped" ... id="tablaverde">.
// La estructura tiene scripts/HTML que confunden parsers genericos, asi que
// usamos busqueda secuencial por marcador.
function extractTablas(html) {
  const tablas = []
  const reInicio = /<table[^>]*class="[^"]*table-striped[^"]*"[^>]*id="tablaverde"[^>]*>/g
  let m
  while ((m = reInicio.exec(html))) {
    const start = m.index
    const end = html.indexOf('</table>', start + m[0].length)
    if (end === -1) break
    tablas.push(html.slice(start, end + 8))
  }
  return tablas
}

function parseTabla(tabla) {
  // Titular (en thead): <a class='titularGuardia' href='mailto:ofNNN@coft.org'>NOMBRE</a>
  const tit = tabla.match(/<a class=['"]titularGuardia['"][^>]*href=['"]mailto:([^'"]+)['"][^>]*>([^<]+)<\/a>/i)
  if (!tit) return null
  const email = tit[1].toLowerCase()
  const nombre = clean(tit[2], 100)

  // Filas <tr><td><b>LABEL</b></td><td>VALOR</td></tr>
  const filas = [...tabla.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*<b>([^<]+)<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)]
  const datos = {}
  for (const f of filas) {
    const label = clean(f[1]).toLowerCase()
    const valor = clean(f[2], 200)
    datos[label] = valor
  }

  // El campo Adreça viene con un link "(veure mapa)" que clean() ya quita el
  // tag pero deja el texto literal. Eliminamos el rastro.
  const adreca = (datos['adreça'] || datos['adreca'] || '')
    .replace(/\(\s*veure\s+mapa\s*\)/gi, '')
    .replace(/\s+/g, ' ').trim()
  const poblacionRaw = datos['població'] || datos['poblacio'] || ''
  const telefono = (datos['telèfon'] || datos['telefon'] || '').replace(/\s+/g, '')
  const horari = datos['horari'] || datos['horari normal'] || ''
  const observacions = datos['observacions'] || ''

  // Población viene como "Reus (CP: 43205)" → extraer nombre y CP.
  let poblacion = poblacionRaw
  let cp = ''
  const cpMatch = poblacionRaw.match(/^(.+?)\s*\(\s*CP\s*:\s*(\d{5})\s*\)/i)
  if (cpMatch) {
    poblacion = cpMatch[1].trim()
    cp = cpMatch[2]
  }

  // Horario: "Ininterromput de 09:00:00 a 22:00:00" → "9:00-22:00"
  const horMatch = horari.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s+a\s+(\d{1,2}):(\d{2})/i)
  let horarioGuardia = horari
  if (horMatch) {
    const ini = `${parseInt(horMatch[1], 10)}:${horMatch[2]}`
    const fin = `${parseInt(horMatch[3], 10)}:${horMatch[4]}`
    horarioGuardia = (ini === fin) ? '00:00-23:59' : `${ini}-${fin}`
  }

  if (!nombre || !adreca) return null
  return { email, nombre, adreca, poblacion, cp, telefono, horarioGuardia, observacions }
}

async function main() {
  console.log('Descargando guardias Tarragona (COF Tarragona)...')
  const dedupe = new Map() // email → entry

  for (const codi of CODIS) {
    for (const tipo of ['gampliat', 'gpobles']) {
      const url = `${COF_BASE}/${tipo}.php?CODI=${codi}`
      const html = await fetchPage(url)
      if (!html) continue
      const tablas = extractTablas(html)
      for (const t of tablas) {
        const f = parseTabla(t)
        if (!f) continue
        if (dedupe.has(f.email)) continue // primera aparicion gana
        dedupe.set(f.email, f)
      }
    }
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias. Esperado >30. La web cambio?`)
  }
  if (dedupe.size > 200) {
    throw new Error(`Sospechoso: ${dedupe.size} farmacias. Max razonable ~100. Abortamos.`)
  }

  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${dedupe.size * 2}s)...`)
  const guardias = []
  let sinCoord = 0
  let done = 0
  for (const f of dedupe.values()) {
    done++
    const coord = await geocode(f.adreca, f.poblacion)
    if (done % 10 === 0) console.log(`  ${done}/${dedupe.size} procesadas, ${guardias.length} OK, ${sinCoord} sin coord`)
    if (!coord) { sinCoord++; continue }

    const dirFinal = `${titleCase(f.nombre)} · ${f.adreca}`
    guardias.push([
      coord[0],
      coord[1],
      dirFinal.slice(0, 140),
      titleCase(f.poblacion),
      f.telefono,
      f.cp,
      f.horarioGuardia,
      f.observacions,
    ])
  }

  console.log(`  ${guardias.length} guardias con coord (${sinCoord} sin resultado en Nominatim)`)

  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'coft.cat',
    territorio: 'tarragona',
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
