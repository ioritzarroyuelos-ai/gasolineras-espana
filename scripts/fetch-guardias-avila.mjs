#!/usr/bin/env node
// v1.38 — Descarga las farmacias de guardia de Avila desde el portal central
// CGCOF (farmaciasguardia.farmaceuticos.com), id provincia=05.
//
// Avila tiene ~18 zonas basicas de salud (Z.B.S. Avila Ciudad, Arenas de
// San Pedro, Burgohondo, Candeleda, Cebreros, Gredos, Lanzahita,
// Madrigal, Muñico, Piedrahita, Sotillo de la Adrada...). El portal
// muestra "GUARDIAS TODO EL DIA DE 9:30 H. DE HOY A 9:30 H. DE MAÑANA"
// — sin distincion DIA/NOCHE — asi que tipoGuardia se queda vacio.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  obtenerSesionYZonas, fetchHtmlGuardias, fetchDatosFarmacia,
  extraerFarmaciasDelHtml, geocodeNominatim, fechaCgcof,
} from './lib/cgcof.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'avila-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-avila.json')

const PROVINCIA_ID = '05'
const PROVINCIA_NOMBRE = 'Avila'
const USER_AGENT = 'cercaya-guardias/1.38 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Avila (margen generoso; provincia interior pequeña).
const BBOX = { minLat: 40.0, maxLat: 41.0, minLng: -5.7, maxLng: -4.4 }

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch { return {} }
}
function saveCache(c) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2))
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

async function main() {
  const fecha = fechaCgcof()
  console.log(`Descargando guardias Avila (CGCOF id=05) — fecha ${fecha}...`)

  const { cookies, zonas, referer } = await obtenerSesionYZonas(PROVINCIA_ID, USER_AGENT)
  console.log(`  ${zonas.length} zonas detectadas`)
  if (zonas.length < 10) {
    throw new Error(`Solo ${zonas.length} zonas para Avila. La estructura cambio?`)
  }

  const farmaciasMap = new Map()
  for (const z of zonas) {
    try {
      const html = await fetchHtmlGuardias(PROVINCIA_ID, z.id, fecha, cookies, referer, USER_AGENT)
      const items = extraerFarmaciasDelHtml(html)
      for (const it of items) {
        if (!farmaciasMap.has(it.id)) farmaciasMap.set(it.id, { id: it.id, tipos: new Set() })
        if (it.tipo) farmaciasMap.get(it.id).tipos.add(it.tipo)
      }
    } catch (e) {
      console.error(`    zona ${z.id} (${z.nombre}): ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 120))
  }
  console.log(`  ${farmaciasMap.size} farmacias unicas detectadas`)
  if (farmaciasMap.size < 1) {
    throw new Error(`Cero farmacias. Abortamos.`)
  }
  if (farmaciasMap.size > 100) {
    throw new Error(`Sospechoso: ${farmaciasMap.size} farmacias. Max razonable ~50.`)
  }

  const detalles = []
  for (const f of farmaciasMap.values()) {
    try {
      const d = await fetchDatosFarmacia(PROVINCIA_ID, f.id, cookies, referer, USER_AGENT)
      if (d && d.direccion) {
        d.id = f.id
        d.tipoGuardia = Array.from(f.tipos).join(' / ')
        detalles.push(d)
      }
    } catch (e) {
      // Toleramos perdidas individuales.
    }
    await new Promise(r => setTimeout(r, 100))
  }
  console.log(`  ${detalles.length} fichas obtenidas`)

  for (const d of detalles) d.zona = ''

  const cache = loadCache()
  let nuevas = 0
  let descartadas = 0
  for (const d of detalles) {
    if (cache[d.id]) {
      d.coord = cache[d.id]
      continue
    }
    process.stdout.write(`    geocoding ${d.id} (${d.municipio.slice(0,30)})... `)
    const munQ = d.cp ? `${d.cp} ${d.municipio}` : d.municipio
    const coord = await geocodeNominatim(d.direccion, munQ, PROVINCIA_NOMBRE, BBOX, USER_AGENT)
    if (coord) {
      cache[d.id] = coord
      d.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      const fb = await geocodeNominatim('', d.municipio, PROVINCIA_NOMBRE, BBOX, USER_AGENT)
      if (fb) {
        cache[d.id] = fb
        d.coord = fb
        nuevas++
        console.log(`OK (fallback) ${fb[0]},${fb[1]}`)
      } else {
        descartadas++
        console.log('FAIL')
      }
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (nuevas > 0) {
    saveCache(cache)
    console.log(`  ${nuevas} farmacias geocodificadas (cache actualizada)`)
  }

  const guardias = []
  for (const d of detalles) {
    if (!d.coord) continue
    const dirFinal = `${titleCase(d.titular)} · ${titleCase(d.direccion)}`
    guardias.push([
      d.coord[0],
      d.coord[1],
      dirFinal.slice(0, 140),
      titleCase(d.municipio),
      d.telefono,
      d.cp,
      d.tipoGuardia,
      '',
    ])
  }

  if (guardias.length < 1) {
    throw new Error(`Cero con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaciasguardia.farmaceuticos.com',
    territorio: 'avila',
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
