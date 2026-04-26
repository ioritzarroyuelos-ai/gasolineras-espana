#!/usr/bin/env node
// v1.25 — Descarga las farmacias de guardia de Baleares (Mallorca, Menorca,
// Eivissa, Formentera) desde el web service ASMX del COFIB.
//
// Fuente:
//   POST https://www.cofib.es/Scripts/ajax/FOWS.asmx/FarmaciesObertes
//   body { data:"YYYY-MM-DDT00:00:00", hora:N, nord, sud, est, oest, programa:"" }
//   → JSON { d: [...] }. Cada item:
//     { Nom, Adreça, Telefon, TextHorari, TextGuardia, Latitud, Longitud,
//       ObertaHorari, ObertaGuardia, NConselleria, ... }
//
// Estrategia:
//   Hacemos DOS llamadas para capturar guardia diurna + guardia nocturna 24h:
//     - hora=840 (14:00) → farmacias de guardia diurna
//     - hora=120 (02:00) → farmacias de guardia nocturna 24h
//   Bbox amplio cubre las 4 islas en cada llamada.
//   Filtramos por ObertaGuardia===true y dedupe por NConselleria.
//
// VENTAJA: dos POSTs sin auth, coords nativas, todas las islas cubiertas.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-baleares.json')

const API_URL = 'https://www.cofib.es/Scripts/ajax/FOWS.asmx/FarmaciesObertes'
const USER_AGENT = 'cercaya-guardias/1.25 (+https://webapp-3ft.pages.dev)'

// Bbox que cubre las 4 islas (Mallorca + Menorca + Eivissa + Formentera).
// Datos en grados decimales segun el web service ASP.NET.
const BOUNDS = { nord: 40.5, sud: 38.5, est: 4.5, oest: 1.0 }

// Bbox de validacion defensiva (margen sobre BOUNDS).
const BBOX = { minLat: 38.4, maxLat: 40.6, minLng: 0.9, maxLng: 4.6 }

function todayISO() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T00:00:00`
}

async function fetchHora(hora, fechaISO, attempts = 4) {
  const body = JSON.stringify({
    data: fechaISO,
    hora,
    nord: BOUNDS.nord,
    sud: BOUNDS.sud,
    est: BOUNDS.est,
    oest: BOUNDS.oest,
    programa: '',
  })
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': USER_AGENT,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
        body,
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      return data?.d || []
    } catch (e) {
      lastErr = e
      console.error(`    intento ${i}/${attempts} (hora=${hora}): ${e.message}`)
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

function parseCoord(rawLat, rawLng) {
  const lat = parseFloat(rawLat)
  const lng = parseFloat(rawLng)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// La adreca de COFIB suele venir como "PASQUAL RIBOT,52" o
// "PASQUAL RIBOT,52 (Entre Policlinica Miramar i PAC Son Piza)".
// No trae CP ni municipio explicitamente — los dejamos vacios.
function cleanAdreca(raw) {
  return clean(raw, 140)
}

async function main() {
  const fechaISO = todayISO()
  console.log(`Descargando guardias Baleares (${fechaISO}) — 2 llamadas (diurna + nocturna)...`)

  // Diurna 14:00 + nocturna 02:00. Algunos farmacias salen en ambas.
  const [diurna, nocturna] = await Promise.all([
    fetchHora(840, fechaISO),
    fetchHora(120, fechaISO),
  ])
  console.log(`  diurna 14:00 → ${diurna.length} farmacias (todas)`)
  console.log(`  nocturna 02:00 → ${nocturna.length} farmacias (24h)`)

  const todas = [...diurna, ...nocturna]
  // Solo nos interesan las farmacias con servicio de guardia activo.
  const guardia = todas.filter(f => f && f.ObertaGuardia === true)
  console.log(`  ${guardia.length} con ObertaGuardia=true (raw)`)

  if (guardia.length < 5) {
    throw new Error(`Solo ${guardia.length} guardias. La API cambio?`)
  }
  if (guardia.length > 500) {
    throw new Error(`Sospechoso: ${guardia.length} guardias. Max razonable ~150. Abortamos.`)
  }

  // Dedupe por NConselleria (codigo oficial de farmacia). Combinamos info
  // diurna + nocturna en una sola entrada.
  const dedupe = new Map()
  let descartadasCoord = 0
  for (const f of guardia) {
    const coord = parseCoord(f.Latitud, f.Longitud)
    if (!coord) {
      descartadasCoord++
      continue
    }
    const key = String(f.NConselleria || `${f.Nom}|${f.Adreça}`)
    if (dedupe.has(key)) {
      // Si ya existia, anexamos TextGuardia si es distinto.
      const existing = dedupe.get(key)
      const tg = clean(f.TextGuardia, 80)
      if (tg && !existing.horarioDesc.includes(tg)) {
        existing.horarioDesc = clean(`${existing.horarioDesc} / ${tg}`, 80)
      }
      continue
    }
    dedupe.set(key, {
      coord,
      nombre: titleCase(clean(f.Nom, 80)),
      direccion: cleanAdreca(f.Adreça),
      telefono: clean(f.Telefon, 30).replace(/\s+/g, ''),
      horario: clean(f.TextHorari, 80),
      horarioDesc: clean(f.TextGuardia, 80),
    })
  }

  if (descartadasCoord > 0) {
    console.log(`  ${descartadasCoord} registros descartados por coords fuera del bbox`)
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
      // El endpoint NO incluye municipio ni CP — los dejamos vacios.
      '',
      f.telefono,
      '',
      f.horario,
      f.horarioDesc,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofib.es',
    territorio: 'baleares',
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
