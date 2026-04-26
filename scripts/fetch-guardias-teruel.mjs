#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de Teruel desde
// cofteruel.org/ciudadanos/listado-de-farmacias/.
//
// Es WordPress server-rendered. Con `?gl=0&localidad=all&guardia=1&fecha=DD/MM/YYYY`
// devuelve el HTML con un `<ul class="category-box">` que contiene un
// `<li>` por farmacia de guardia con su nombre, localidad, slug a la ficha
// y horario textual.
//
// Fuente:
//   1) GET https://www.cofteruel.org/ciudadanos/listado-de-farmacias/?gl=0&localidad=all&guardia=1&fecha=DD/MM/YYYY
//      → HTML con dos `<ul class="category-box">`. El primero es el form;
//        el segundo contiene los `<li>` con las farmacias de guardia.
//   2) GET .../ficha-farmacia/<slug>/
//      → HTML con tabla "Dirección" / "Teléfono". Sin coords nativas.
//
// CAVEAT — sin lat/lng:
//   La ficha NO expone coords. Geocodificamos con Nominatim usando
//   direccion+localidad. Cache en `scripts/cache/teruel-geo.json` por slug.
//
// CAVEAT — Teruel pequena:
//   Provincia muy rural (~150k habitantes). Suele haber 15-25 farmacias
//   de guardia hoy. Si el filtro fecha cambiase la semantica habria que
//   ajustar BBOX y limites razonables.
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
const CACHE_FILE = resolve(CACHE_DIR, 'teruel-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-teruel.json')

const BASE = 'https://www.cofteruel.org'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Teruel (margen generoso).
const BBOX = { minLat: 39.9, maxLat: 41.4, minLng: -2.0, maxLng: 0.1 }

async function fetchHtml(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT, 'Accept': 'text/html',
          'Referer': `${BASE}/ciudadanos/listado-de-farmacias/`,
        },
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
// dos pases (CodeQL: double escaping or unescaping).
const HTML_ENTITIES = {
  '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&apos;': "'",
  '&lt;': '<', '&gt;': '>',
  '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í',
  '&oacute;': 'ó', '&uacute;': 'ú', '&ntilde;': 'ñ',
  '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í',
  '&Oacute;': 'Ó', '&Uacute;': 'Ú', '&Ntilde;': 'Ñ',
}

function clean(s, max) {
  let t = String(s || '').replace(/<[^>]+>/g, ' ')
  t = t.replace(/&[a-zA-Z]+;/g, m => HTML_ENTITIES[m] || m)
  t = t.replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function fechaTeruel(d = new Date()) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Parsea el HTML del listado y devuelve [{nombre, slug, localidad, horario}].
function parseListado(html) {
  // Quitar el form (que esta dentro del primer <ul.category-box>) para
  // simplificar. Los <li> reales estan en el segundo UL.
  const sinForm = html.replace(/<form[\s\S]*?<\/form>/gi, '')
  const ulMatches = [...sinForm.matchAll(/<ul[^>]*class="[^"]*category-box[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi)]
  const out = []
  for (const ul of ulMatches) {
    const lis = [...ul[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    for (const li of lis) {
      const inner = li[1]
      // Slug a ficha: <a href="https://www.cofteruel.org/ficha-farmacia/<slug>/"
      const mSlug = inner.match(/href="[^"]*\/ficha-farmacia\/([^"\/]+)\/?"/i)
      if (!mSlug) continue
      // Nombre titular: <h3>...</h3>
      const mNom = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
      const nombre = mNom ? clean(mNom[1], 100) : ''
      // Localidad: <div class="readinfo">LOCALIDAD</div>
      const mLoc = inner.match(/<div\s+class="readinfo"[^>]*>([\s\S]*?)<\/div>/i)
      const localidad = mLoc ? clean(mLoc[1], 80) : ''
      // Horario textual: el texto suelto tras `De guardia ` antes del cierre del div farmacia_info.
      const mHor = inner.match(/<div\s+class=['"]farmacia_info['"][^>]*>([\s\S]*?)<\/div>/i)
      let horario = ''
      if (mHor) {
        const sin = mHor[1].replace(/<h3[\s\S]*?<\/h3>/i, '').replace(/<[^>]+>/g, ' ')
        horario = clean(sin, 60)
      }
      out.push({
        slug: mSlug[1],
        nombre,
        localidad,
        horario,
      })
    }
  }
  return out
}

// Parsea la ficha individual y devuelve {direccion, telefono, municipio}.
// La tabla `<table class="datosfarmacia">` tiene filas
// `<th>Municipio</th><td>...</td>`, `<th>Dirección</th><td>...</td>`,
// `<th>Teléfono</th><td>...</td>`.
function parseFicha(html) {
  const out = { direccion: '', telefono: '', municipio: '' }
  const get = (label) => {
    const re = new RegExp(`<th[^>]*>${label}<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
    const m = html.match(re)
    return m ? clean(m[1]) : ''
  }
  out.municipio = get('Municipio')
  out.direccion = get('Direcci(?:ón|on)')
  const telRaw = get('Tel(?:éfono|efono)')
  if (telRaw) {
    const m = telRaw.match(/\d[\d\s]+/)
    if (m) out.telefono = m[0].replace(/\s+/g, '')
  }
  return out
}

async function geocodeNominatim(direccion, localidad) {
  const q = `${direccion}, ${localidad}, Teruel, España`
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
  const fecha = fechaTeruel()
  console.log(`Descargando guardias Teruel (${fecha}) — cofteruel.org...`)

  const url = `${BASE}/ciudadanos/listado-de-farmacias/?gl=0&localidad=all&guardia=1&fecha=${encodeURIComponent(fecha)}`
  const html = await fetchHtml(url)
  const items = parseListado(html)
  console.log(`  ${items.length} farmacias de guardia detectadas`)
  if (items.length < 1) {
    throw new Error('Cero farmacias detectadas. Estructura cambio?')
  }
  if (items.length > 100) {
    throw new Error(`Sospechoso: ${items.length} farmacias. Max razonable ~50.`)
  }

  // Enriquecer con direccion + telefono de cada ficha.
  for (const it of items) {
    try {
      const fHtml = await fetchHtml(`${BASE}/ficha-farmacia/${it.slug}/`)
      const det = parseFicha(fHtml)
      it.direccion = det.direccion
      it.telefono = det.telefono
    } catch (e) {
      // Toleramos perdidas individuales.
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Geocodificar con cache.
  const cache = loadCache()
  let nuevas = 0
  let descartadas = 0
  for (const it of items) {
    if (cache[it.slug]) {
      it.coord = cache[it.slug]
      continue
    }
    const muniQ = it.localidad || 'Teruel'
    process.stdout.write(`    geocoding ${it.slug.slice(0,30)} (${muniQ})... `)
    const coord = await geocodeNominatim(it.direccion, muniQ)
    if (coord) {
      cache[it.slug] = coord
      it.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      const fb = await geocodeNominatim('', muniQ)
      if (fb) {
        cache[it.slug] = fb
        it.coord = fb
        nuevas++
        console.log(`OK (fallback) ${fb[0]},${fb[1]}`)
      } else {
        descartadas++
        console.log('FAIL')
      }
    }
    await new Promise(r => setTimeout(r, 1100)) // Rate-limit Nominatim 1 req/s
  }
  if (nuevas > 0) {
    saveCache(cache)
    console.log(`  ${nuevas} farmacias geocodificadas (cache actualizada)`)
  }
  if (descartadas > 0) console.log(`  ${descartadas} sin coord`)

  const guardias = []
  for (const it of items) {
    if (!it.coord) continue
    const dirFinal = `${titleCase(it.nombre)} · ${titleCase(it.direccion || '')}`.replace(/\s+·\s*$/, '')
    guardias.push([
      it.coord[0],
      it.coord[1],
      dirFinal.slice(0, 140),
      titleCase(it.localidad),
      it.telefono || '',
      '', // CP no expuesto en la ficha
      it.horario || 'De guardia 24 horas',
      '',
    ])
  }

  if (guardias.length < 1) {
    throw new Error(`Cero con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofteruel.org',
    territorio: 'teruel',
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
