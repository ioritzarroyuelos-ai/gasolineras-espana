#!/usr/bin/env node
// v1.13 — Descarga las farmacias de guardia de Almeria desde la web del
// COF Almeria (cofalmeria.com).
//
// Fuente:
//   https://www.cofalmeria.com/farmacias-guardia
//   ASP.NET WebForms server-rendered. La pagina lista TODAS las farmacias
//   de guardia del dia en una sola pagina (~70 farmacias). El control de
//   "Pagina 1 de 7" no se aplica al listado real — el listado completo ya
//   viene en la primera pagina (verificado contando <div class="FilaEntidades">).
//
// Estructura por farmacia:
//   <div class="FilaEntidades">
//     <h3><a href="/farmacias-guardia/slug">NOMBRE FECHA (HORARIO)</a></h3>
//     <dl class="EntidadesListado">
//       <dt>Direccion</dt>
//       <dd>CALLE NUM - LOCALIDAD - CP - PROVINCIA - PAIS</dd>
//       <dt>Telefono:</dt>
//       <dd>TELEFONO</dd>
//     </dl>
//   </div>
//
// La direccion viene con campos separados por " - ":
//   [direccion] - [localidad] - [CP] - [provincia] - [pais]
//
// La cabecera del <h3> trae nombre + fecha + horario:
//   "ALVAREZ MARTINEZ, MARIA JOSE 25/04/2026 (9:00:-9:00:)"
// El horario tiene `:` extras al final ("9:00:" en vez de "9:00") que limpiamos.
// Si inicio == fin tras limpieza es guardia 24h.
//
// IMPORTANTE: la pagina NO devuelve coordenadas. Geocodeamos con Nominatim
// a 1 req/s (~70 segundos). Mismo patron que Gipuzkoa.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si HTML <100KB → abort (la web cambio).
//   - Si <30 farmacias parseadas → abort.
//   - Si <20 geocodeadas → abort (Nominatim bloqueado?).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-almeria.json')

const COF_URL = 'https://www.cofalmeria.com/farmacias-guardia'
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
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 100_000) throw new Error(`HTML sospechoso (${html.length} bytes, esperado >300KB)`)
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
// para evitar double-unescape. Si empezamos por `&amp;` -> `&`, un input tipo
// `&amp;aacute;` (representacion literal de `&aacute;`) acabaria convertido en
// `á`, que no es lo que queremos. CodeQL marca el orden inverso como
// vulnerabilidad, con razon.
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
  // Strip tags en bucle hasta estabilizar.
  let t = String(s || '')
  for (let i = 0; i < 5; i++) {
    const next = t.replace(/<[^>]*>/g, '')
    if (next === t) break
    t = next
  }
  t = decodeEntities(t).replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Pasa "AV. PRINCIPE DE ASTURIAS" a "Av. Principe De Asturias" — case title.
// Mejor para Nominatim y para mostrar al usuario.
function titleCase(s) {
  return s.toLowerCase().replace(/\b([a-záéíóúñü])/g, m => m.toUpperCase())
}

// Limpia "9:00:" → "9:00", "21:30" → "21:30"
function normHora(s) {
  return String(s || '').replace(/:+$/, '').trim()
}

// Parsea "(9:00:-9:00:)" → "9:00-9:00", "(9:30:-21:30)" → "9:30-21:30".
// Si inicio == fin tras normalizar es guardia 24h, devolvemos "00:00-23:59".
function parseHorario(raw) {
  if (!raw) return ''
  const m = String(raw).match(/^\(?\s*(\d{1,2}:\d{2}):?\s*-\s*(\d{1,2}:\d{2}):?\s*\)?$/)
  if (!m) return clean(raw, 40)
  const ini = normHora(m[1])
  const fin = normHora(m[2])
  if (ini === fin) return '00:00-23:59'
  return `${ini}-${fin}`
}

// Parsea cabecera "<h3><a>NOMBRE FECHA (HORARIO)</a></h3>"
// Devuelve { nombre, horarioGuardia }
function parseTitulo(raw) {
  const txt = clean(raw)
  // Patron: NOMBRE_LARGO DD/MM/YYYY (HORARIO)
  const m = txt.match(/^(.+?)\s+\d{1,2}\/\d{1,2}\/\d{4}\s*\(([^)]+)\)\s*$/)
  if (!m) return { nombre: txt, horarioGuardia: '' }
  return {
    nombre: clean(m[1], 80),
    horarioGuardia: parseHorario('(' + m[2] + ')'),
  }
}

// Parsea direccion COF: "AV. PRINCIPE DE ASTURIAS, 34 - CAMPOHERMOSO - 04110 - ALMERIA - ESPAÑA"
function parseDireccion(raw) {
  const txt = clean(raw)
  const partes = txt.split(/\s*-\s*/).map(p => p.trim()).filter(Boolean)
  // [calle, localidad, cp, provincia, pais]
  const calle = titleCase(partes[0] || '').slice(0, 120)
  const localidad = titleCase(partes[1] || '').slice(0, 60)
  const cp = (partes[2] || '').match(/\b\d{5}\b/)?.[0] || ''
  return { calle, localidad, cp }
}

// Bounding box provincia Almeria. Generosa para fronterizos con Granada y Murcia.
const BBOX_AL = { minLat: 36.6, maxLat: 37.7, minLng: -3.2, maxLng: -1.5 }

const geoCache = new Map()
async function geocode(nombre, calle, localidad, cp) {
  const key = `${calle}||${localidad}||${cp}`.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)

  // 3 estrategias: con nombre, sin nombre, solo localidad+CP.
  const queries = [
    `${nombre} ${calle} ${cp} ${localidad}`,
    `${calle} ${cp} ${localidad}`,
    `${calle} ${localidad}`,
  ].map(q => q.replace(/\s+/g, ' ').trim()).filter(q => q.length > 5)

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
        if (lat < BBOX_AL.minLat || lat > BBOX_AL.maxLat) continue
        if (lng < BBOX_AL.minLng || lng > BBOX_AL.maxLng) continue
        const coord = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
        geoCache.set(key, coord)
        return coord
      }
    } catch {
      // swallow — siguiente query
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  geoCache.set(key, null)
  return null
}

// Extrae bloques <div class="FilaEntidades"> ... </div> contando profundidad
// de divs (manual para no romper con div anidados).
function extractFilas(html) {
  const filas = []
  const needle = '<div class="FilaEntidades">'
  let pos = 0
  while (true) {
    const start = html.indexOf(needle, pos)
    if (start === -1) break
    let depth = 1
    let i = start + needle.length
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', i)
      const nextClose = html.indexOf('</div>', i)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        i = nextOpen + 4
      } else {
        depth--
        i = nextClose + 6
      }
    }
    filas.push(html.slice(start, i))
    pos = i
  }
  return filas
}

async function main() {
  console.log('Descargando farmacias de guardia de Almeria (COF Almeria)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  const filas = extractFilas(html)
  console.log(`  ${filas.length} bloques FilaEntidades encontrados`)

  if (filas.length < 30) {
    throw new Error(`Solo ${filas.length} farmacias parseadas. Esperado ~70. La web cambio?`)
  }
  if (filas.length > 200) {
    throw new Error(`Sospechoso: ${filas.length} farmacias. Max razonable ~150. Abortamos.`)
  }

  const farmacias = []
  for (const fila of filas) {
    // <h3><a ...>TITULO</a></h3>
    const tituloMatch = fila.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/)
    const { nombre, horarioGuardia } = parseTitulo(tituloMatch ? tituloMatch[1] : '')

    // <dd id="...ddDireccion">DIR</dd>
    const dirMatch = fila.match(/<dd[^>]*ddDireccion[^>]*>([\s\S]*?)<\/dd>/)
    const { calle, localidad, cp } = parseDireccion(dirMatch ? dirMatch[1] : '')

    // <dd id="...ddTelefono">TEL</dd>
    const telMatch = fila.match(/<dd[^>]*ddTelefono[^>]*>([\s\S]*?)<\/dd>/)
    const telefono = clean(telMatch ? telMatch[1] : '', 30)

    if (!nombre || !calle) continue
    farmacias.push({ nombre, calle, localidad, cp, telefono, horarioGuardia })
  }

  console.log(`  ${farmacias.length} farmacias parseadas con datos completos`)

  if (farmacias.length < 30) {
    throw new Error(`Solo ${farmacias.length} farmacias con datos completos. Abortamos.`)
  }

  console.log(`Geocodificando con Nominatim (rate limit 1 req/s, estimado ~${Math.ceil(farmacias.length * 1.5)}s)...`)
  const guardias = []
  let sinCoord = 0
  let done = 0
  for (const f of farmacias) {
    done++
    const coord = await geocode(f.nombre, f.calle, f.localidad, f.cp)
    if (done % 10 === 0) console.log(`  ${done}/${farmacias.length} procesadas, ${guardias.length} OK, ${sinCoord} sin coord`)
    if (!coord) { sinCoord++; continue }

    const dirFinal = `${f.nombre} · ${f.calle}`
    guardias.push([
      coord[0],
      coord[1],
      dirFinal.slice(0, 140),
      f.localidad,
      f.telefono,
      f.cp,
      f.horarioGuardia,
      '',
    ])
  }

  console.log(`  ${guardias.length} guardias con coord (${sinCoord} sin resultado en Nominatim)`)

  if (guardias.length < 20) {
    throw new Error(`Solo ${guardias.length} guardias geocodeadas. Nominatim bloqueado o respuesta cambio. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofalmeria.com',
    territorio: 'almeria',
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
