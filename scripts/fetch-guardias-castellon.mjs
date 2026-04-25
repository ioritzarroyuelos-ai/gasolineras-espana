#!/usr/bin/env node
// v1.27 — Descarga las farmacias de guardia de Castellon desde el endpoint
// JSP de cofcastellon.org. Stack: GlassFish + JSP + jQuery (no WordPress,
// no Angular). Requiere cookie JSESSIONID que sale del GET inicial.
//
// Fuente:
//   GET  https://www.cofcastellon.org/farmaciasGuardia.jsp  → setea cookie
//   POST https://www.cofcastellon.org/Farmacias
//        body: fecha=DD/MM/YYYY&pob=&p_clave=&gua=1&search_more=false
//   → JSON { data: [...] }. Cada item:
//     { id, farmacia, direccion, codpostal, poblacion, telefono,
//       horario, horarioFin, latitud, longitud }
//
// CAVEAT 1 — coords invertidas:
//   El JSON trae `latitud=-0.21` y `longitud=40.07` en realidad. Hay que
//   SWAPEAR (lat <- longitud, lng <- latitud) al consumir. Verificado
//   contra ubicacion fisica del COF Castellon.
//
// CAVEAT 2 — encoding ISO-8859-1:
//   `Content-Type: application/json;charset=ISO-8859-1`. Caracteres no-ASCII
//   llegan en latin-1. Decode manual con TextDecoder('latin1').
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-castellon.json')

const SESSION_URL = 'https://www.cofcastellon.org/farmaciasGuardia.jsp'
const API_URL = 'https://www.cofcastellon.org/Farmacias'
const REFERER = SESSION_URL
const USER_AGENT = 'cercaya-guardias/1.27 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Castellon (Comunidad Valenciana norte). Incluye costa
// (Vinaros, Benicasim) e interior (Morella, Vilafranca).
const BBOX = { minLat: 39.55, maxLat: 40.85, minLng: -0.85, maxLng: 0.45 }

function todayDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}

// Extrae JSESSIONID del header set-cookie del GET inicial.
async function getSessionCookie() {
  const res = await fetch(SESSION_URL, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`GET sesion HTTP ${res.status}`)
  const setCookie = res.headers.get('set-cookie') || ''
  const m = setCookie.match(/JSESSIONID=([^;]+)/)
  if (!m) throw new Error('No JSESSIONID en respuesta')
  return `JSESSIONID=${m[1]}`
}

async function fetchGuardias(cookie, fecha, attempts = 3) {
  const body = new URLSearchParams({
    fecha,
    pob: '',
    p_clave: '',
    gua: '1',
    search_more: 'false',
  }).toString()
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': REFERER,
          'Cookie': cookie,
          'User-Agent': USER_AGENT,
        },
        body,
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      // Encoding ISO-8859-1 declarado en respuesta — leemos como buffer
      // y decodificamos con latin1.
      const buf = await res.arrayBuffer()
      const text = new TextDecoder('latin1').decode(buf)
      return JSON.parse(text)
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 2000))
    }
  }
  throw lastErr
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

// SWAPEO de coords — el JSON trae latitud=lng_real, longitud=lat_real.
function parseCoord(rawLat, rawLng) {
  // Aplicamos el swap aqui mismo: lat real = rawLng, lng real = rawLat.
  const lat = parseFloat(rawLng)
  const lng = parseFloat(rawLat)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

async function main() {
  const fecha = todayDDMMYYYY()
  console.log(`Descargando guardias Castellon (${fecha}) — JSP+JSESSIONID...`)
  const cookie = await getSessionCookie()
  console.log(`  sesion JSP obtenida`)

  const data = await fetchGuardias(cookie, fecha)
  const lista = data?.data || []
  console.log(`  ${lista.length} registros recibidos`)

  if (lista.length < 5) {
    throw new Error(`Solo ${lista.length} registros. La API cambio?`)
  }
  if (lista.length > 200) {
    throw new Error(`Sospechoso: ${lista.length} registros. Max razonable ~80. Abortamos.`)
  }

  const dedupe = new Map()
  let descartadasCoord = 0
  for (const f of lista) {
    if (!f) continue
    const coord = parseCoord(f.latitud, f.longitud)
    if (!coord) {
      descartadasCoord++
      continue
    }
    const key = String(f.id || `${f.farmacia}|${f.direccion}`)
    if (dedupe.has(key)) continue
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.farmacia, 80)),
      direccion: clean(f.direccion, 120),
      municipio: titleCase(clean(f.poblacion, 60)),
      cp: clean(f.codpostal, 5),
      telefono: clean(f.telefono, 30).replace(/\s+/g, ''),
      horario: clean(f.horario, 100),
      horarioFin: clean(f.horarioFin, 60),
    })
  }

  if (descartadasCoord > 0) {
    console.log(`  ${descartadasCoord} registros descartados por coords fuera del bbox provincial`)
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias con coord validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      f.horario,
      f.horarioFin,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofcastellon.org',
    territorio: 'castellon',
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
