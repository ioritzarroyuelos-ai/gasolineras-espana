#!/usr/bin/env node
// v1.21 — Descarga las farmacias de guardia de Castilla-La Mancha (5
// provincias: Toledo, Ciudad Real, Albacete, Cuenca, Guadalajara) desde
// el endpoint backend del SESCAM que consume la app oficial Mi Salud
// Digital (sescam.jccm.es/misaluddigital/).
//
// Fuente:
//   GET https://sescam.jccm.es/pasarelacita/todasFarmacias.php
//                                          ?id=NN&fecha=DD/MM/YYYY
//   → JSON con farmacias de la zona (localidad + vecinas) cada una con:
//      LOCALIDAD, LICENCIADO, DIRECCION, CP, PROVINCIA, ENLOCALIDAD,
//      GEO_LAT, GEO_LONG, TELEFONO, GUARDIA (boolean).
//
// Por que iteramos por id:
//   El endpoint requiere un `id` (codigo interno SESCAM por localidad)
//   y devuelve la farmacia de esa localidad mas las vecinas que cubren
//   guardia. No hay endpoint global "todas las guardias del dia". Como
//   las respuestas se solapan (una farmacia de guardia aparece en muchas
//   busquedas vecinas), basta con dedupe por (LICENCIADO+DIRECCION+CP).
//
// Rango de ids:
//   El barrido empirico (id=1..1500) confirma que casi todos los ids 1-1300
//   devuelven datos. Iteramos hasta 1500 con cortes tempranos suaves.
//
// VENTAJA: coords nativas (lat/lng) en cada registro — no hace falta
// geocodificar.
//
// IMPORTANTE — encoding:
//   El servidor declara `Content-Type: text/html; charset=UTF-8` en la
//   cabecera pero los strings vienen en latin-1 (ISO-8859-1). Tengo que
//   leer el body como ArrayBuffer y decodificar con TextDecoder('latin1').
//
// IMPORTANTE — formato fecha:
//   Solo el formato DD/MM/YYYY funciona. ISO YYYY-MM-DD el server lo
//   interpreta mal y devuelve siempre GUARDIA=false.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
// Umbral defensivo:
//   - Si <30 guardias unicas tras dedupe → abort.
//   - Si >400 → abort (sospechoso, CLM no llega ni a 1300 farmacias).

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-clm.json')

const API_URL = 'https://sescam.jccm.es/pasarelacita/todasFarmacias.php'
const USER_AGENT = 'cercaya-guardias/1.21 (+https://webapp-3ft.pages.dev)'

// Bbox que cubre las 5 provincias de Castilla-La Mancha (margen generoso
// hacia los limites con CyL, Madrid, Aragon, Valencia, Murcia, Andalucia,
// Extremadura). Sirve de filtro defensivo contra coords corruptas.
const BBOX = { minLat: 37.9, maxLat: 41.4, minLng: -5.4, maxLng: -1.0 }

// Provincias validas. Algunas busquedas vecinas (id de localidad fronteriza)
// devuelven farmacias de provincias colindantes (Teruel, Albacete-Murcia,
// Toledo-Madrid). Filtramos por nombre para mantener el dataset limpio a las
// 5 provincias CLM. Comparamos en mayusculas porque la API responde asi.
const PROVINCIAS_CLM = new Set(['ALBACETE', 'CIUDAD REAL', 'CUENCA', 'GUADALAJARA', 'TOLEDO'])

// Rango de ids a barrer. La app oficial usa ids correlativos por localidad
// SESCAM. ~1300 localidades en CLM segun INE. Vamos generosos con 1500.
const ID_MIN = 1
const ID_MAX = 1500

// Pausa entre peticiones (ms). El servidor PHP es lento — 100ms es prudente
// para no saturar y mantener latencia razonable. ~1500 reqs * 100ms = 2.5min.
const PAUSE_MS = 100

// Reintentos por id. Si falla 3 veces seguidas, lo damos por perdido y
// seguimos. Una farmacia de guardia aparece en multiples busquedas vecinas
// asi que perder un id concreto rara vez pierde una guardia.
const RETRIES = 3

function todayDDMMYYYY() {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  return `${dd}/${mm}/${yy}`
}

async function fetchId(id, fecha) {
  const url = `${API_URL}?id=${id}&fecha=${encodeURIComponent(fecha)}`
  let lastErr
  for (let i = 1; i <= RETRIES; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      // El servidor declara UTF-8 pero envia latin-1. Decode manual.
      const buf = await res.arrayBuffer()
      const text = new TextDecoder('latin1').decode(buf)
      if (!text || text.length < 3) return []
      try {
        return JSON.parse(text)
      } catch {
        return []
      }
    } catch (e) {
      lastErr = e
      if (i < RETRIES) await new Promise(r => setTimeout(r, i * 1000))
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

// CP en CLM: Albacete 02xxx, Ciudad Real 13xxx, Cuenca 16xxx, Guadalajara
// 19xxx, Toledo 45xxx. La API devuelve a veces 4 digitos cuando empieza por
// 0 (e.g. "2200" en lugar de "02200"). Padding a 5 digitos.
function normCP(raw) {
  const s = String(raw || '').replace(/\D/g, '')
  if (!s) return ''
  return s.length === 4 ? '0' + s : s.slice(0, 5)
}

function parseCoord(rawLat, rawLng) {
  const lat = parseFloat(rawLat)
  const lng = parseFloat(rawLng)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

async function main() {
  const fecha = todayDDMMYYYY()
  console.log(`Descargando guardias CLM para fecha ${fecha} (SESCAM pasarelacita)...`)
  console.log(`  rango ids ${ID_MIN}..${ID_MAX} con pausa ${PAUSE_MS}ms`)

  const dedupe = new Map()
  let totalReqs = 0
  let totalErrors = 0
  let totalRecords = 0
  let totalGuardiaRaw = 0

  for (let id = ID_MIN; id <= ID_MAX; id++) {
    try {
      const items = await fetchId(id, fecha)
      totalReqs++
      if (!Array.isArray(items)) continue
      totalRecords += items.length
      for (const f of items) {
        if (!f || f.GUARDIA !== true) continue
        totalGuardiaRaw++
        // Filtrar farmacias de provincias colindantes (Teruel, Albacete-Murcia,
        // Toledo-Madrid). Comparamos en mayusculas trim — la API es consistente.
        const provRaw = String(f.PROVINCIA || '').toUpperCase().trim()
        if (!PROVINCIAS_CLM.has(provRaw)) continue
        const coord = parseCoord(f.GEO_LAT, f.GEO_LONG)
        if (!coord) continue
        const lic = clean(f.LICENCIADO, 80)
        const dir = clean(f.DIRECCION, 120)
        const cp = normCP(f.CP)
        if (!lic && !dir) continue
        const key = `${lic}|${dir}|${cp}`
        if (dedupe.has(key)) continue
        dedupe.set(key, {
          coord,
          licenciado: titleCase(lic),
          direccion: dir,
          municipio: titleCase(clean(f.LOCALIDAD, 60)),
          provincia: titleCase(clean(f.PROVINCIA, 30)),
          cp,
          telefono: clean(f.TELEFONO, 30).replace(/\s+/g, ''),
        })
      }
    } catch (e) {
      totalErrors++
      // No spameamos un log por cada id — solo cada 100 errores.
      if (totalErrors % 100 === 0) {
        console.error(`    id=${id} (${totalErrors} errores acumulados): ${e.message}`)
      }
    }
    if (id < ID_MAX) await new Promise(r => setTimeout(r, PAUSE_MS))
  }

  console.log(`  ${totalReqs} reqs OK / ${totalErrors} errores`)
  console.log(`  ${totalRecords} registros raw / ${totalGuardiaRaw} con GUARDIA=true / ${dedupe.size} unicos tras dedupe`)

  if (dedupe.size < 30) {
    throw new Error(`Solo ${dedupe.size} farmacias de guardia. Esperado >50. Cambio el endpoint?`)
  }
  if (dedupe.size > 400) {
    throw new Error(`Sospechoso: ${dedupe.size} guardias. Max razonable ~250. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.licenciado} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      // El endpoint NO da horario textual — el SESCAM solo marca booleano de
      // guardia diaria. Dejamos vacios los dos campos de horario.
      '',
      f.provincia, // Aprovechamos el slot horarioGuardiaDesc para guardar
                   // la provincia, util en la card del frontend.
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'sescam.jccm.es',
    territorio: 'clm',
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
