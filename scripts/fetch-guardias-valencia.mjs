#!/usr/bin/env node
// v1.20 — Descarga las farmacias de guardia de Valencia desde el portal
// publico del MICOF (Muy Ilustre Colegio Oficial de Farmaceuticos de
// Valencia).
//
// Fuente:
//   1. GET https://www.micof.es/ver/124/
//      → extraer cookie CAKEPHP + palabra del captcha (esta visible en
//      el HTML como "value=\"NNNNNN\" id=\"palabra_oculta_NNNNNN\"")
//   2. Para cada localidad cabecera:
//      GET https://www.micof.es/ver/124/?buscarGuardia=1
//                                        &buscarLocalidadCp=NOMBRE
//                                        &data[palabra_clave]=NNNNNN
//                                        &data[palabra_oculta]=NNNNNN
//      → HTML con un array JS `var distribuidores = [[...], [...], ...]`
//      donde cada item es:
//        ["", lat, lng, direccion, ciudad, cp, telefono, "", estado,
//         horario, "/farmacia/ver/ID?guardia=1"]
//
// Por que iteramos por localidad:
//   El portal MICOF limita resultados al area de la localidad (radio
//   amplio pero no cubre toda la provincia con una sola busqueda). Las
//   localidades grandes/cabecera devuelven 12-15 resultados y suelen
//   solapar — basta deduplicar por la URL "/farmacia/ver/ID".
//
// VENTAJA: las coords vienen NATIVAS en el HTML, no hace falta geocodificar.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <20 farmacias unicas tras dedupe → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-valencia.json')

const PAGE_URL = 'https://www.micof.es/ver/124/'
const USER_AGENT = 'cercaya-guardias/1.20 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Valencia (incluye Requena al oeste, Oliva al sur, Sagunto
// al norte y la costa al este).
const BBOX_V = { minLat: 38.7, maxLat: 40.0, minLng: -1.6, maxLng: 0.4 }

// Localidades cabecera para iterar. Cada una cubre su zona de guardia:
// la lista cubre la mayoria de comarcas de la provincia con solapamiento
// minimo (las dedupes resuelven los pocos overlaps).
const LOCALIDADES = [
  'Valencia', 'Sagunto', 'Xativa', 'Alzira', 'Sueca', 'Onteniente',
  'Aldaia', 'Cullera', 'Burjassot', 'Quart de Poblet', 'Carcaixent',
  'Catarroja', 'Mislata', 'Gandia', 'Torrent', 'Paterna', 'Manises',
  'Lliria', 'Requena', 'Utiel', 'Buñol', 'Chiva', 'Oliva', 'Tavernes de la Valldigna',
  'Algemesi', 'Massamagrell', 'Albal',
]

async function fetchPageWithCookie(attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(PAGE_URL, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
        redirect: 'follow',
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      // CAKEPHP cookie viene en Set-Cookie.
      const setCookies = res.headers.getSetCookie?.() || []
      const cookieHeader = setCookies
        .map(c => c.split(';')[0])
        .filter(Boolean)
        .join('; ')
      // Captcha "palabra_oculta_NNNNNN" — usamos el primero (suele haber 2,
      // uno para colegiados y otro para el publico — los dos valen). El
      // formato real es: id="palabra_oculta_NNN" value="NNN" (id ANTES de
      // value en el HTML del portal MICOF).
      const m = html.match(/id="palabra_oculta_\d+"\s+value="(\d{5,7})"/)
      if (!m) throw new Error('captcha palabra no encontrada en HTML')
      return { cookie: cookieHeader, palabra: m[1] }
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 2000))
    }
  }
  throw lastErr
}

async function fetchLocalidad(loc, palabra, cookie) {
  const params = new URLSearchParams({
    buscarGuardia: '1',
    buscarLocalidadCp: loc,
    'data[palabra_clave]': palabra,
    'data[palabra_oculta]': palabra,
  })
  const res = await fetch(`${PAGE_URL}?${params.toString()}`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html',
      'Referer': PAGE_URL,
      ...(cookie ? { 'Cookie': cookie } : {}),
    },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return await res.text()
}

// Extrae el array `var distribuidores = [...]` del HTML. Cada item es
// un array con 11 columnas (la 0 esta vacia, 1=lat, 2=lng, 3=dir,
// 4=ciudad, 5=cp, 6=tel, 7=?, 8=estado, 9=horario, 10=URL/?guardia=1).
function extractDistribuidores(html) {
  // Match no greedy del bloque hasta el primer `]];` que cierra el array
  // exterior. El array contiene strings con escapes JS, asi que parsearlo
  // como JSON requiere normalizar las barras `\/` (que son JSON-validas) y
  // confiar en que no hay caracteres especiales en los strings.
  const m = html.match(/var\s+distribuidores\s*=\s*(\[\[[\s\S]*?\]\])\s*;/)
  if (!m) return []
  let raw = m[1]
  // En JSON, `\/` es valido pero algunos parsers se quejan si hay
  // un solo `\` en el medio del string. JS escapa correctamente todos los
  // caracteres especiales en arrays generados por servidor PHP. Probemos
  // JSON.parse directo.
  try {
    return JSON.parse(raw)
  } catch {
    // Fallback: a veces hay numeros sin comillas (lat/lng) y strings con
    // entidades. JSON.parse maneja numeros bien. Si falla, intentamos
    // limpiar caracteres problematicos comunes.
    raw = raw.replace(/\\\//g, '/')
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }
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
  if (lat < BBOX_V.minLat || lat > BBOX_V.maxLat) return null
  if (lng < BBOX_V.minLng || lng > BBOX_V.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Extrae el ID de "/farmacia/ver/NNN?guardia=1" para deduplicar.
function farmaciaId(urlPath) {
  const m = String(urlPath || '').match(/\/farmacia\/ver\/(\d+)/)
  return m ? m[1] : null
}

async function main() {
  console.log('Obteniendo cookie + palabra captcha del portal MICOF...')
  const { cookie, palabra } = await fetchPageWithCookie()
  console.log(`  cookie=${cookie ? 'OK' : 'vacio'} palabra=${palabra}`)

  console.log(`Iterando ${LOCALIDADES.length} localidades cabecera...`)
  const dedupe = new Map()
  let totalRaw = 0
  let totalErr = 0

  for (let i = 0; i < LOCALIDADES.length; i++) {
    const loc = LOCALIDADES[i]
    try {
      const html = await fetchLocalidad(loc, palabra, cookie)
      const items = extractDistribuidores(html)
      totalRaw += items.length
      for (const row of items) {
        if (!Array.isArray(row) || row.length < 11) continue
        const id = farmaciaId(row[10])
        if (!id) continue
        if (dedupe.has(id)) continue
        const coord = parseCoord(row[1], row[2])
        if (!coord) continue
        dedupe.set(id, {
          coord,
          direccion: clean(row[3], 120),
          municipio: titleCase(clean(row[4], 60)),
          cp: clean(row[5], 5),
          telefono: clean(row[6], 30).replace(/\s+/g, ''),
          estado: clean(row[8], 30),
          horario: clean(row[9], 60),
        })
      }
    } catch (e) {
      totalErr++
      console.error(`    ${loc}: ${e.message}`)
    }
    // Pequena pausa para no saturar el servidor (PHP/CakePHP puede ser
    // lento; suficiente con ~200ms entre peticiones).
    if (i < LOCALIDADES.length - 1) await new Promise(r => setTimeout(r, 250))
  }

  console.log(`  ${totalRaw} registros crudos / ${dedupe.size} unicos (${totalErr} localidades con error)`)

  if (dedupe.size < 20) {
    throw new Error(`Solo ${dedupe.size} farmacias unicas. Esperado >40. La estructura del HTML cambio?`)
  }
  if (dedupe.size > 600) {
    throw new Error(`Sospechoso: ${dedupe.size} farmacias. Max razonable ~250. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.direccion} · ${f.municipio}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      f.horario,
      f.estado,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'micof.es',
    territorio: 'valencia',
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
