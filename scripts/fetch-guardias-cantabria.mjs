#!/usr/bin/env node
// v1.14 — Descarga las farmacias de guardia de Cantabria desde el API JSON
// publico del COF Cantabria.
//
// Fuente:
//   https://cofcantabria.org/COFGuardiasAPI/api/FarmaciasDeGuardia/Localidades
//   https://cofcantabria.org/COFGuardiasAPI/api/FarmaciasDeGuardia/{LOCALIDAD}?momento=ISO
//
// VENTAJA frente a otros COFs: el API ya devuelve coordenadas GPS en el campo
// "gps": "lat, lng". No hace falta geocodificar con Nominatim — el scraper
// es mucho mas rapido (segundos en vez de minutos).
//
// El API NO tiene endpoint global "todas las farmacias del dia". Hay que
// iterar por localidades cabecera. Cantabria tiene ~22 cabeceras conocidas
// con farmacia de guardia. Localidades pequeñas/rurales caen en zonas
// comarcales (e.g. SARON cubre toda la zona Pas/Pisueña, devuelve 26
// farmacias) — al deduplicar por farmaciaId no nos lleva problema.
//
// Turnos:
//   - Diurno: 09:00-22:00 (consulta con momento=hoy 12:00 UTC)
//   - Nocturno: 22:00-09:00 dia siguiente (consulta momento=hoy 23:00 UTC)
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <10 guardias unicas tras iterar todas las cabeceras → abort.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-cantabria.json')

const API_BASE = 'https://cofcantabria.org/COFGuardiasAPI/api/FarmaciasDeGuardia'
const USER_AGENT = 'cercaya-guardias/1.14 (+https://webapp-3ft.pages.dev)'

// Cabeceras conocidas de Cantabria con farmacia de guardia. Verificadas
// manualmente — devuelven >=1 farmacia el 25-04-2026. Localidades duplicadas
// (SARON, ARENAS DE IGUNA, LOS CORRALES DE BUELNA → mismo set comarcal) se
// deduplican por farmaciaId.
const CABECERAS = [
  'SANTANDER', 'TORRELAVEGA', 'REINOSA', 'CASTRO URDIALES',
  'LIENCRES', 'LAREDO', 'COMILLAS', 'SAN VICENTE DE LA BARQUERA',
  'SUANCES', 'COLINDRES', 'AMPUERO', 'CABEZON DE LA SAL',
  'RAMALES DE LA VICTORIA', 'POTES', 'SARON', 'RENEDO',
  'CAMARGO', 'MURIEDAS', 'NOJA', 'ARENAS DE IGUNA',
  'LOS CORRALES DE BUELNA', 'ASTILLERO, EL', 'SOLARES',
]

// Bounding box provincia Cantabria. Generosa para fronterizos con Asturias,
// Castilla y Leon (Burgos/Palencia) y Vizcaya.
const BBOX_S = { minLat: 42.8, maxLat: 43.6, minLng: -5.0, maxLng: -2.9 }

async function fetchLoc(localidad, momento, attempts = 3) {
  const url = `${API_BASE}/${encodeURIComponent(localidad)}?momento=${momento}`
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const arr = await res.json()
      if (!Array.isArray(arr)) throw new Error('no es array')
      return arr
    } catch (e) {
      if (i === attempts) {
        console.error(`    fallo ${localidad} ${momento}: ${e.message}`)
        return []
      }
      await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  return []
}

function parseGps(raw) {
  if (!raw) return null
  const m = String(raw).match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/)
  if (!m) return null
  const lat = parseFloat(m[1])
  const lng = parseFloat(m[2])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX_S.minLat || lat > BBOX_S.maxLat) return null
  if (lng < BBOX_S.minLng || lng > BBOX_S.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Convierte "2026-04-25T09:00:00" → "9:00".
function isoToHora(iso) {
  if (!iso) return ''
  const m = String(iso).match(/T(\d{2}):(\d{2})/)
  if (!m) return ''
  return `${parseInt(m[1], 10)}:${m[2]}`
}

function buildHorario(desde, hasta) {
  const d = isoToHora(desde)
  const h = isoToHora(hasta)
  if (!d || !h) return ''
  return `${d}-${h}`
}

// titular llega en mayusculas: "HERNÁNDEZ SANTOS, ISABEL"
// Pasarlo a Title Case (nombre/apellido capitalizados) para mostrar bien.
// Unicode-aware: \p{L} con flag /u captura letras acentuadas como una pieza
// continua (sin esto, \b parte "Hernández" en "Hern" + "á" + "ndez").
function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

async function main() {
  // Construir momentos UTC. Usamos el dia de ejecucion (cron lunes).
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const dia = `${yyyy}-${mm}-${dd}T12:00:00Z`
  const noche = `${yyyy}-${mm}-${dd}T23:00:00Z`

  console.log('Descargando guardias Cantabria (API REST)...')
  console.log(`  diurno: ${dia}`)
  console.log(`  nocturno: ${noche}`)

  const dedupe = new Map() // farmaciaId → entry
  let llamadas = 0
  let respuestasNoVacias = 0

  for (const turno of [dia, noche]) {
    for (const loc of CABECERAS) {
      llamadas++
      const arr = await fetchLoc(loc, turno)
      if (arr.length > 0) respuestasNoVacias++
      for (const f of arr) {
        if (!f.farmaciaId) continue
        // Si ya esta deduplicada y ya tiene horario diurno+nocturno, skip.
        const prev = dedupe.get(f.farmaciaId)
        if (prev) {
          // Misma farmacia en otro turno — anyadir el horario.
          const horarioNuevo = buildHorario(f.desde, f.hasta)
          if (horarioNuevo && !prev.horarios.has(horarioNuevo)) {
            prev.horarios.add(horarioNuevo)
          }
          continue
        }
        const coord = parseGps(f.gps)
        if (!coord) continue
        const horarios = new Set()
        const h = buildHorario(f.desde, f.hasta)
        if (h) horarios.add(h)
        dedupe.set(f.farmaciaId, {
          coord,
          titular: titleCase(clean(f.titular, 80)),
          direccion: clean(f.direccion, 120),
          comentarios: clean(f.comentarios, 60),
          telefono: clean(f.telefono, 30).replace(/\s+/g, ''),
          poblacion: titleCase(clean(f.localidad, 60)),
          horarios,
        })
      }
      // Pequeño delay para no saturar al servidor (~10 req/s max).
      await new Promise(r => setTimeout(r, 100))
    }
  }

  console.log(`  ${llamadas} llamadas, ${respuestasNoVacias} con datos, ${dedupe.size} farmacias unicas`)

  if (dedupe.size < 10) {
    throw new Error(`Solo ${dedupe.size} farmacias unicas. API cambio o problema. Abortamos.`)
  }
  if (dedupe.size > 200) {
    throw new Error(`Sospechoso: ${dedupe.size} farmacias. Max razonable ~100. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.titular} · ${f.direccion}`
    const horarioGuardia = Array.from(f.horarios).sort().join(' / ')
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.poblacion,
      f.telefono,
      '',
      horarioGuardia || '',
      f.comentarios,
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofcantabria.org',
    territorio: 'cantabria',
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
