#!/usr/bin/env node
// v1.19 — Descarga las farmacias de guardia de Ceuta desde la API publica
// del COF Ceuta (plugin vcomm-buscador-farmacias, mismo schema que Cadiz).
//
// Fuente:
//   GET https://cofceuta.com/wp-json/vcomm/v1/farmacias/guardia
//   → mismo JSON que Cadiz: { informacion:[{fecha, soe, nombre, zona_guardia,
//     contactos_profesionales:[{ direccion, municipio, codigo_postal,
//     telefono, coordenadas:"[lat,lng]" }], horarios:[...] }] }
//
// VENTAJA: REST publico, sin auth, coords nativas. Tipico: 3 farmacias/dia
// (ciudad autonoma muy pequena).
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <2 farmacias unicas → abort. (Ceuta es chiquita, ~3 al dia.)

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-ceuta.json')

const API_URL = 'https://cofceuta.com/wp-json/vcomm/v1/farmacias/guardia'
const USER_AGENT = 'cercaya-guardias/1.19 (+https://webapp-3ft.pages.dev)'

// Bbox ciudad autonoma de Ceuta (incluye margen al perimetro fronterizo).
const BBOX_CE = { minLat: 35.83, maxLat: 35.93, minLng: -5.42, maxLng: -5.27 }

async function fetchGuardias(attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts}: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
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

function parseCoord(raw) {
  if (!raw) return null
  let arr
  try {
    arr = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(arr) || arr.length < 2) return null
  const lat = parseFloat(arr[0])
  const lng = parseFloat(arr[1])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX_CE.minLat || lat > BBOX_CE.maxLat) return null
  if (lng < BBOX_CE.minLng || lng > BBOX_CE.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

function fmtHora(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/)
  if (!m) return ''
  return `${parseInt(m[1], 10)}:${m[2]}`
}

function buildHorario(horarios) {
  if (!Array.isArray(horarios) || horarios.length === 0) return ''
  const slots = horarios
    .map(h => {
      const ini = fmtHora(h.hora_apertura)
      const fin = fmtHora(h.hora_cierre)
      if (!ini || !fin) return ''
      return `${ini}-${fin}`
    })
    .filter(Boolean)
  return Array.from(new Set(slots)).sort().join(' / ')
}

function buildHorarioDesc(horarios) {
  if (!Array.isArray(horarios) || horarios.length === 0) return ''
  const tipos = horarios.map(h => clean(h.tipo, 40)).filter(Boolean)
  return Array.from(new Set(tipos)).join(' / ').slice(0, 80)
}

async function main() {
  console.log('Descargando guardias Ceuta (GET vcomm/v1/farmacias/guardia)...')
  const data = await fetchGuardias()
  const lista = data?.informacion || []
  console.log(`  ${lista.length} registros recibidos`)

  if (lista.length < 2) {
    throw new Error(`Solo ${lista.length} registros. Esperado >=3. La API cambio?`)
  }
  if (lista.length > 50) {
    throw new Error(`Sospechoso: ${lista.length} registros. Max razonable ~10. Abortamos.`)
  }

  const dedupe = new Map()
  for (const f of lista) {
    if (!f.soe) continue
    const cp = (f.contactos_profesionales || [])[0]
    if (!cp) continue
    const coord = parseCoord(cp.coordenadas)
    if (!coord) continue
    const key = String(f.soe)
    if (dedupe.has(key)) continue
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.nombre, 80)),
      direccion: clean(cp.direccion, 120),
      telefono: clean(cp.telefono, 30).replace(/\s+/g, ''),
      municipio: titleCase(clean(cp.municipio, 60)),
      cp: clean(cp.codigo_postal, 5),
      horario: buildHorario(f.horarios),
      horarioDesc: buildHorarioDesc(f.horarios),
    })
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 2) {
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
      f.horarioDesc,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofceuta.com',
    territorio: 'ceuta',
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
