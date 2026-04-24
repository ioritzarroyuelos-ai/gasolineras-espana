#!/usr/bin/env node
// v1.15 — Descarga las farmacias de guardia de Pontevedra desde la API JSON
// pública del COF Pontevedra.
//
// Fuente:
//   POST https://farmacias.cofpo.org/farmaciasguardia.php
//        Content-Type: application/x-www-form-urlencoded
//        Body: search_fecha=DD/MM/YYYY
//   Devuelve un JSON plano con TODAS las farmacias de guardia del dia para
//   los 61 municipios que cubre el COF (sin paginación). Tipico: 70-110
//   registros (una farmacia puede aparecer 2 veces como Diurno + Nocturno).
//
// VENTAJA: el JSON ya incluye latitud/longitud nativas, sin necesidad de
// geocodificar. Mismo patron que Murcia/Cantabria.
//
// Schema input (campos relevantes):
//   { id, nombre, direccion, telefono, tipo (Diurno|Nocturno),
//     longitud, latitud, idmunicipio, municipio, fecha, observaciones }
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <10 farmacias unicas → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-pontevedra.json')

const API_URL = 'https://farmacias.cofpo.org/farmaciasguardia.php'
const USER_AGENT = 'cercaya-guardias/1.15 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Pontevedra (incluye margen para Vigo, Tui frontera y A
// Estrada limite con A Coruña).
const BBOX_P = { minLat: 41.8, maxLat: 43.1, minLng: -9.1, maxLng: -7.8 }

async function fetchGuardias(fechaDDMMYYYY, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
          'Accept-Language': 'es-ES,es;q=0.9,gl;q=0.8',
        },
        body: `search_fecha=${encodeURIComponent(fechaDDMMYYYY)}`,
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error('respuesta no es array')
      return data
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

function parseCoord(rawLat, rawLng) {
  const lat = parseFloat(rawLat)
  const lng = parseFloat(rawLng)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX_P.minLat || lat > BBOX_P.maxLat) return null
  if (lng < BBOX_P.minLng || lng > BBOX_P.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Normaliza el campo "tipo" del COF a etiqueta corta:
//   "Diurno"   → "D"
//   "Nocturno" → "N"
function tipoCode(tipo) {
  const t = String(tipo || '').toLowerCase()
  if (t.startsWith('diur')) return 'D'
  if (t.startsWith('noct')) return 'N'
  return tipo
}

// Extrae horario de las observaciones si las tiene, formato "9:30-22:00".
// Las observaciones suelen ser "De 9:30 h. a 22 h." o similar. Si no
// matchea, devuelve string vacio (el campo "tipo" ya da contexto suficiente).
function parseHorario(obs, tipo) {
  if (!obs) return tipoCode(tipo) === 'D' ? '9:00-22:00' : '22:00-9:00'
  const m = String(obs).match(/(\d{1,2})(?::(\d{2}))?\s*h?\.?\s*a\s*(\d{1,2})(?::(\d{2}))?/i)
  if (!m) return tipoCode(tipo) === 'D' ? '9:00-22:00' : '22:00-9:00'
  const ini = `${parseInt(m[1], 10)}:${m[2] || '00'}`
  const fin = `${parseInt(m[3], 10)}:${m[4] || '00'}`
  return `${ini}-${fin}`
}

async function main() {
  // Construir fecha DD/MM/YYYY del dia de ejecucion (UTC).
  const now = new Date()
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = now.getUTCFullYear()
  const fecha = `${dd}/${mm}/${yyyy}`

  console.log(`Descargando guardias Pontevedra (POST farmaciasguardia.php fecha=${fecha})...`)
  const data = await fetchGuardias(fecha)
  console.log(`  ${data.length} registros recibidos`)

  if (data.length < 10) {
    throw new Error(`Solo ${data.length} registros. Esperado >50. La API cambio?`)
  }
  if (data.length > 500) {
    throw new Error(`Sospechoso: ${data.length} registros. Max razonable ~200. Abortamos.`)
  }

  // Dedupe por id, fusionando los tipos (Diurno + Nocturno → "D / N").
  const dedupe = new Map()
  for (const f of data) {
    if (!f.id) continue
    const coord = parseCoord(f.latitud, f.longitud)
    if (!coord) continue

    const key = String(f.id)
    const tipo = tipoCode(f.tipo)
    const horario = parseHorario(f.observaciones, f.tipo)

    if (dedupe.has(key)) {
      const e = dedupe.get(key)
      if (tipo) e.tipos.add(tipo)
      if (horario) e.horarios.add(horario)
      continue
    }
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.nombre, 80)),
      direccion: clean(f.direccion, 120),
      telefono: clean(f.telefono, 30).replace(/\s+/g, ''),
      municipio: titleCase(clean(f.municipio, 60)),
      tipos: new Set(tipo ? [tipo] : []),
      horarios: new Set(horario ? [horario] : []),
      observaciones: clean(f.observaciones, 80),
    })
  }

  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 10) {
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
      '',
      horarioGuardia,
      f.observaciones,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofpo.org',
    territorio: 'pontevedra',
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
