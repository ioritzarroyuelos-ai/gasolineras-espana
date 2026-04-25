#!/usr/bin/env node
// v1.33 — Descarga las farmacias de guardia de Zamora desde cofzamora.es.
// Es un Drupal con plantilla Jango. La home ya muestra la tabla
// `tablaPortadaGuardias` con las farmacias de servicio de URGENCIA actual,
// que es exactamente lo que necesitamos.
//
// Fuente:
//   1) GET https://www.cofzamora.es/
//      → HTML home con `<table id="tablaPortadaGuardias">` y filas
//        `<tr class="filaFarmacia">` que tienen Zona, Municipio,
//        nombre (`<span class="nombreFarmacia">`), direccion
//        (`<span class="direccionFarmacia">`) y link a ficha.
//   2) GET .../farmacia/<SLUG>
//      → HTML ficha con `detalleFarmaciaContenidoCampo`. Tiene telefono
//        completo (puede ser multiple, separado por -) y horario textual.
//        La ficha NO incluye coords.
//
// CAVEAT — sin lat/lng:
//   Hay que geocodificar con Nominatim usando direccion+municipio. Cache en
//   `scripts/cache/zamora-geo.json` por slug (estable).
//
// CAVEAT — pocas farmacias:
//   Zamora tiene ~5-8 farmacias de guardia simultaneas (provincia rural
//   pequena). El listado del home cambia cada dia con el cron del COF.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'zamora-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-zamora.json')

const HOME_URL = 'https://www.cofzamora.es/'
const FICHA_BASE = 'https://www.cofzamora.es/farmacia/'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.33 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Zamora (margen generoso). Defensa contra geocodings raros.
const BBOX = { minLat: 41.2, maxLat: 42.3, minLng: -7.0, maxLng: -5.1 }

async function fetchHtml(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  throw lastErr
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch { return {} }
}

function saveCache(c) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2))
}

// Decodificacion atomica para evitar el patron "decodifica &amp; primero,
// luego otras entidades" — un input como "&amp;aacute;" pasaria a "á" en
// dos pases (CodeQL: double escaping or unescaping). Procesamos cada
// entidad en una sola pasada con un callback.
const HTML_ENTITIES = {
  '&amp;': '&', '&nbsp;': ' ',
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í',
  '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í',
  '&Oacute;': 'Ó', '&Uacute;': 'Ú', '&Ntilde;': 'Ñ',
}

function clean(s, max) {
  let t = String(s || '').replace(/<[^>]+>/g, ' ')
  t = t.replace(/&[a-zA-Z]+;/g, m => HTML_ENTITIES[m] || m)
  t = t.replace(/[,]+\s*$/, '') // limpiar comas finales tipo "BAJO LA IGLESIA,"
       .replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

// Parsea la tabla principal del home. Cada `<tr class="filaFarmacia">` tiene
// las columnas que necesitamos.
function parseHome(html) {
  const out = []
  const reFila = /<tr\s+class="filaFarmacia">([\s\S]*?)<\/tr>/g
  let m
  while ((m = reFila.exec(html)) !== null) {
    const fila = m[1]
    const mZona = fila.match(/<th[^>]*class="zonaFarmacia"[^>]*>([\s\S]*?)<\/th>/i)
    const mMun = fila.match(/<th[^>]*class="municipioFarmacia"[^>]*>([\s\S]*?)<\/th>/i)
    const mNombre = fila.match(/<span\s+class="nombreFarmacia"[^>]*>([\s\S]*?)<\/span>/i)
    const mDir = fila.match(/<span\s+class="direccionFarmacia"[^>]*>([\s\S]*?)<\/span>/i)
    const mSlug = fila.match(/href="farmacia\/([A-Z0-9\-]+)"/i)
    if (!mNombre || !mMun) continue
    out.push({
      zona: mZona ? clean(mZona[1]) : '',
      municipio: mMun ? clean(mMun[1]) : '',
      nombre: clean(mNombre[1]),
      direccion: mDir ? clean(mDir[1]) : '',
      slug: mSlug ? mSlug[1] : '',
    })
  }
  return out
}

// Parsea la ficha individual para sacar telefono y horario completos.
function parseFicha(html) {
  const out = { telefono: '', horario: '' }
  // Telefono: <span class="detalleFarmaciaTituloCampo">Teléfono:</span>
  //          <span class="detalleFarmaciaContenidoCampo">980683383-663...</span>
  const mTel = html.match(/<span[^>]*detalleFarmaciaTituloCampo[^>]*>\s*Tel[^:]*:?\s*<\/span>\s*<span[^>]*detalleFarmaciaContenidoCampo[^>]*>([\s\S]*?)<\/span>/i)
  if (mTel) {
    // Tomar solo el primer numero antes del primer guion (el principal).
    const raw = clean(mTel[1])
    out.telefono = raw.split(/[-\s]+/).filter(s => /^\d{9}$/.test(s))[0] || raw.split(/[-]+/)[0].replace(/\s+/g, '')
  }
  // Horario: en la ultima clase fullContenedorHorarioFarmacia
  const mHor = html.match(/fullContenedorHorarioFarmacia[\s\S]*?horarioFarmacia[^>]*>([\s\S]*?)<\/span>/i)
  if (mHor) out.horario = clean(mHor[1], 100)
  return out
}

async function geocodeNominatim(direccion, municipio) {
  const q = `${direccion}, ${municipio}, Zamora, España`
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (!isFinite(lat) || !isFinite(lng)) return null
    if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
    if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
    return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
  } catch { return null }
}

async function main() {
  console.log('Descargando guardias Zamora — cofzamora.es...')

  const home = await fetchHtml(HOME_URL)
  const filas = parseHome(home)
  console.log(`  ${filas.length} filas en tabla portada guardias`)
  if (filas.length < 2) {
    throw new Error(`Solo ${filas.length} farmacias detectadas. La estructura cambio?`)
  }
  if (filas.length > 50) {
    throw new Error(`Sospechoso: ${filas.length} filas. Max razonable ~15.`)
  }

  // Enriquecer cada con datos de su ficha (telefono completo, horario).
  for (const f of filas) {
    if (!f.slug) continue
    try {
      const html = await fetchHtml(`${FICHA_BASE}${f.slug}`)
      const detalle = parseFicha(html)
      f.telefono = detalle.telefono
      f.horario = detalle.horario
    } catch (e) {
      console.error(`    ficha ${f.slug}: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Geocodificar con cache.
  const cache = loadCache()
  let nuevas = 0
  let descartadas = 0
  for (const f of filas) {
    const key = f.slug || `${f.nombre}|${f.municipio}`
    if (cache[key]) {
      f.coord = cache[key]
      continue
    }
    process.stdout.write(`    geocoding ${f.municipio}... `)
    const coord = await geocodeNominatim(f.direccion, f.municipio)
    if (coord) {
      cache[key] = coord
      f.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      // Fallback: solo municipio.
      const fallback = await geocodeNominatim('', f.municipio)
      if (fallback) {
        cache[key] = fallback
        f.coord = fallback
        nuevas++
        console.log(`OK (fallback) ${fallback[0]},${fallback[1]}`)
      } else {
        descartadas++
        console.log('FAIL')
      }
    }
    await new Promise(r => setTimeout(r, 1100)) // Rate limit Nominatim
  }
  if (nuevas > 0) {
    saveCache(cache)
    console.log(`  ${nuevas} farmacias geocodificadas y guardadas en cache`)
  }
  if (descartadas > 0) console.log(`  ${descartadas} sin coord`)

  const guardias = []
  for (const f of filas) {
    if (!f.coord) continue
    const titNombre = titleCase(f.nombre)
    const dirFinal = `${titNombre} · ${titleCase(f.direccion || '')}`.replace(/\s+·\s*$/, '')
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      titleCase(f.municipio),
      f.telefono || '',
      '', // CP no expuesto
      f.horario || 'Servicio de urgencia',
      f.zona ? `Zona: ${f.zona}` : '',
    ])
  }

  if (guardias.length < 2) {
    throw new Error(`Solo ${guardias.length} con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofzamora.es',
    territorio: 'zamora',
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
