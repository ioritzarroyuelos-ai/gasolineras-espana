#!/usr/bin/env node
// v1.16 — Descarga las farmacias de guardia de Las Palmas (Gran Canaria,
// Lanzarote, Fuerteventura) desde la API WordPress publica del COF Las
// Palmas (vcomm-buscador-farmacias plugin).
//
// Fuente:
//   1. GET https://www.coflaspalmas.es/es/buscador-de-farmacias/
//      → extraer "nonce" del bloque vbf_vars + cookies de sesion
//   2. POST https://www.coflaspalmas.es/wp-admin/admin-ajax.php
//      Body: action=bearer_authentication_with_params&nonce=X
//            &vbf_req_endpoint=/farmacias-abiertas
//            &vbf_req_es_listado_geo=false
//            &vbf_req_solo_guardias=on
//      Devuelve un JSON con TODAS las guardias del dia con coordenadas
//      nativas (lat, lng), direccion, telefono, municipio, CP, tipo y
//      ventana horaria ISO. Tipico: ~28 farmacias/dia para los 3 archipielagos.
//
// VENTAJA: una sola peticion POST, sin paginacion, sin geocoding, sin
// captcha, sin auth. Mismo tier que Cantabria/Pontevedra.
//
// Schema input (campos relevantes):
//   { uuid, nombre, coordenadas:[lat,lng], telefono, direccion,
//     municipio, codigo_postal,
//     guardias:[{ tipo_guardia, guardia_horario_fecha_inicio,
//                 guardia_horario_fecha_fin }] }
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <5 farmacias unicas → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-laspalmas.json')

const PAGE_URL = 'https://www.coflaspalmas.es/es/buscador-de-farmacias/'
const AJAX_URL = 'https://www.coflaspalmas.es/wp-admin/admin-ajax.php'
const USER_AGENT = 'cercaya-guardias/1.16 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Las Palmas (Gran Canaria + Lanzarote + Fuerteventura).
// Margen amplio: La Graciosa (29.27N) y Punta Pesebre Fuerteventura (28.06N).
const BBOX_LP = { minLat: 27.6, maxLat: 29.5, minLng: -16.0, maxLng: -13.3 }

// Step 1: GET la pagina del buscador para obtener nonce + cookies. El
// nonce vive en una variable global JS:
//   <script>var vbf_vars = {"nonce":"abc123def","ajax_url":"..."};</script>
async function fetchNonceAndCookies() {
  const res = await fetch(PAGE_URL, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`GET pagina ${res.status}`)
  const html = await res.text()
  const m = html.match(/"nonce":"([a-f0-9]+)"/i)
  if (!m) throw new Error('nonce no encontrado en HTML')
  // Capturar cookies (Set-Cookie puede venir multiple veces).
  const setCookies = res.headers.getSetCookie?.() || []
  const cookieHeader = setCookies
    .map(c => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
  return { nonce: m[1], cookie: cookieHeader }
}

// Step 2: POST al endpoint AJAX con el nonce y la sesion. Reintentos por si
// el nonce caduca o la sesion se pierde (raro).
async function fetchGuardias(nonce, cookie, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const body = new URLSearchParams({
        action: 'bearer_authentication_with_params',
        nonce,
        vbf_req_endpoint: '/farmacias-abiertas',
        vbf_req_es_listado_geo: 'false',
        vbf_req_solo_guardias: 'on',
      }).toString()
      const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        'Referer': PAGE_URL,
        'Origin': 'https://www.coflaspalmas.es',
        'X-Requested-With': 'XMLHttpRequest',
      }
      if (cookie) headers['Cookie'] = cookie
      const res = await fetch(AJAX_URL, { method: 'POST', headers, body })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!data?.success) throw new Error('respuesta no success')
      return data.data
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw lastErr
}

// Title case Unicode-aware.
function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function parseCoord(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return null
  const lat = parseFloat(arr[0])
  const lng = parseFloat(arr[1])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX_LP.minLat || lat > BBOX_LP.maxLat) return null
  if (lng < BBOX_LP.minLng || lng > BBOX_LP.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// "2026-04-24 09:00:00" → "9:00"
function timeOf(iso) {
  if (!iso) return ''
  const m = String(iso).match(/(\d{1,2}):(\d{2})/)
  if (!m) return ''
  return `${parseInt(m[1], 10)}:${m[2]}`
}

// Convierte la lista de guardias en un horario human-readable. Por ejemplo
// "9:00-9:00" significa 24h (turno completo). Si hay 1 guardia → "ini-fin",
// si hay varias → join por " / ".
function buildHorario(guardias) {
  if (!Array.isArray(guardias) || guardias.length === 0) return ''
  const slots = guardias
    .map(g => {
      const ini = timeOf(g.guardia_horario_fecha_inicio)
      const fin = timeOf(g.guardia_horario_fecha_fin)
      if (!ini || !fin) return ''
      return `${ini}-${fin}`
    })
    .filter(Boolean)
  return Array.from(new Set(slots)).join(' / ')
}

async function main() {
  console.log('Obteniendo nonce + cookies del COF Las Palmas...')
  const { nonce, cookie } = await fetchNonceAndCookies()
  console.log(`  nonce=${nonce.slice(0, 8)}... cookie=${cookie ? 'OK' : 'vacio'}`)

  console.log('Descargando guardias Las Palmas (POST admin-ajax.php)...')
  const data = await fetchGuardias(nonce, cookie)

  // Estructura: data.data.informacion[0].contenido = [...farmacias]
  const informacion = data?.data?.informacion || []
  const farmaciasBlock = informacion.find(b =>
    /abiertas/i.test(b.titulo || '') || /guardia/i.test(b.titulo || '')
  )
  const lista = farmaciasBlock?.contenido || []
  console.log(`  ${lista.length} registros recibidos`)

  if (lista.length < 5) {
    throw new Error(`Solo ${lista.length} registros. Esperado >20. La API cambio?`)
  }
  if (lista.length > 200) {
    throw new Error(`Sospechoso: ${lista.length} registros. Max razonable ~80. Abortamos.`)
  }

  // Dedupe por uuid (cada uuid puede aparecer 1+ veces si hay multiples
  // ventanas horarias el mismo dia).
  const dedupe = new Map()
  for (const f of lista) {
    if (!f.uuid) continue
    const coord = parseCoord(f.coordenadas)
    if (!coord) continue
    const key = String(f.uuid)
    if (dedupe.has(key)) {
      const e = dedupe.get(key)
      const h = buildHorario(f.guardias)
      if (h) e.horarios.add(h)
      continue
    }
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.nombre, 80)),
      direccion: clean(f.direccion, 120),
      telefono: clean(f.telefono, 30).replace(/\s+/g, ''),
      municipio: titleCase(clean(f.municipio, 60)),
      cp: clean(f.codigo_postal, 5),
      horarios: new Set([buildHorario(f.guardias)].filter(Boolean)),
    })
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias con coord validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.nombre} · ${f.direccion}`
    const horarioGuardia = Array.from(f.horarios).sort().join(' / ')
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      horarioGuardia,
      '',
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'coflaspalmas.es',
    territorio: 'laspalmas',
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
