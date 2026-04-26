#!/usr/bin/env node
// v1.22 — Descarga las farmacias de guardia de Ourense desde la API publica
// del COF Ourense (plugin vcomm-buscador-farmacias, mismo patron que Cadiz,
// Ceuta y Las Palmas — REST publico SIN nonce ni cookies).
//
// Fuente:
//   GET https://www.cofourense.es/wp-json/vcomm/v1/farmacias/guardia
//                                                            ?estilo=completo
//   → JSON { informacion:[...], metadatos:{...} }. Cada item:
//   { fecha, soe, nombre, zona_guardia,
//     contactos_profesionales:[{ direccion, municipio, codigo_postal,
//                                telefono, coordenadas:"[lat, lng]",
//                                provincia }],
//     horario_habitual_farmacia:[...] }
//
// VENTAJA: una sola peticion GET, sin auth, con coordenadas nativas.
//
// IMPORTANTE — coordenadas malformadas:
//   El COF Ourense tiene errores de captura: alguna farmacia llega como
//   `[4.2188410,-779.9320]` (sin punto decimal en lat o con dos digitos
//   demas en lng). El BBOX provincial las descarta y no se cuelan en el
//   dataset, solo se loguea una advertencia.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-ourense.json')

const API_URL = 'https://www.cofourense.es/wp-json/vcomm/v1/farmacias/guardia?estilo=completo'
const USER_AGENT = 'cercaya-guardias/1.22 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Ourense — incluye Carballeda al norte, A Limia al sur,
// Verin al este, Celanova al oeste. Margen generoso pero excluye coords
// malformadas como `[4.21, -779.93]`.
const BBOX = { minLat: 41.85, maxLat: 42.65, minLng: -8.4, maxLng: -6.8 }

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

// Las coordenadas vienen como string `"[lat, lng]"`. JSON.parse las parsea
// como array. Validamos contra BBOX para descartar registros con typo.
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
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Horario habitual viene como `[{ tramos:[{ codigo, tipo, continuo:{inicio,fin},
// partido:{ma:{...}, ta:{...}} }] }]`. Para guardia simplificamos al primer
// tramo de cada dia tipo (LV, S, F).
function fmtHora(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/)
  if (!m) return ''
  return `${parseInt(m[1], 10)}:${m[2]}`
}

function buildHorario(habituales) {
  if (!Array.isArray(habituales) || habituales.length === 0) return ''
  const slots = []
  for (const h of habituales) {
    const tramos = h?.tramos || []
    for (const t of tramos) {
      if (t?.continuo) {
        const ini = fmtHora(t.continuo.inicio)
        const fin = fmtHora(t.continuo.fin)
        if (ini && fin) slots.push(`${ini}-${fin}`)
      }
      if (t?.partido?.ma) {
        const ini = fmtHora(t.partido.ma.inicio)
        const fin = fmtHora(t.partido.ma.fin)
        if (ini && fin) slots.push(`${ini}-${fin}`)
      }
    }
  }
  return Array.from(new Set(slots)).sort().join(' / ')
}

async function main() {
  console.log('Descargando guardias Ourense (GET vcomm/v1/farmacias/guardia)...')
  const data = await fetchGuardias()
  const lista = data?.informacion || []
  console.log(`  ${lista.length} registros recibidos`)

  if (lista.length < 5) {
    throw new Error(`Solo ${lista.length} registros. La API cambio?`)
  }
  if (lista.length > 200) {
    throw new Error(`Sospechoso: ${lista.length} registros. Max razonable ~80. Abortamos.`)
  }

  // Dedupe por soe (id). Cada registro suele tener 1 contacto profesional.
  const dedupe = new Map()
  let descartadasCoord = 0
  for (const f of lista) {
    if (!f.soe) continue
    const cp = (f.contactos_profesionales || [])[0]
    if (!cp) continue
    const coord = parseCoord(cp.coordenadas)
    if (!coord) {
      descartadasCoord++
      continue
    }
    const key = String(f.soe)
    if (dedupe.has(key)) continue
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.nombre, 80)),
      direccion: clean(cp.direccion, 120),
      telefono: clean(cp.telefono, 30).replace(/\s+/g, ''),
      municipio: titleCase(clean(cp.municipio, 60)),
      cp: clean(cp.codigo_postal, 5),
      horario: buildHorario(f.horario_habitual_farmacia),
      horarioDesc: clean(f.zona_guardia, 80),
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
      f.horarioDesc,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofourense.es',
    territorio: 'ourense',
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
