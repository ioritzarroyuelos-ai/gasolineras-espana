#!/usr/bin/env node
// v1.36 — Descarga las farmacias de guardia de Badajoz desde el portal central
// CGCOF (farmaciasguardia.farmaceuticos.com), id provincia=06.
//
// Badajoz delega en el portal central CGCOF, igual que Malaga y Zaragoza.
// Reusamos el helper compartido (`scripts/lib/cgcof.mjs`).
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
const CACHE_FILE = resolve(CACHE_DIR, 'badajoz-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-badajoz.json')

const PROVINCIA_ID = '06'
const PROVINCIA_NOMBRE = 'Badajoz'
const USER_AGENT = 'cercaya-guardias/1.36 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Badajoz (margen generoso).
const BBOX = { minLat: 37.9, maxLat: 39.7, minLng: -7.6, maxLng: -4.5 }

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
  console.log(`Descargando guardias Badajoz (CGCOF id=06) — fecha ${fecha}...`)

  const { cookies, zonas, referer } = await obtenerSesionYZonas(PROVINCIA_ID, USER_AGENT)
  console.log(`  ${zonas.length} zonas detectadas`)
  if (zonas.length < 10) {
    throw new Error(`Solo ${zonas.length} zonas para Badajoz. La estructura cambio?`)
  }

  // Recolectar todos los IDs unicos de farmacia.
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
  if (farmaciasMap.size < 5) {
    throw new Error(`Solo ${farmaciasMap.size} farmacias. Abortamos.`)
  }
  if (farmaciasMap.size > 300) {
    throw new Error(`Sospechoso: ${farmaciasMap.size} farmacias. Max razonable ~150.`)
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

  // Sin heuristica especial — Badajoz capital usa CP 06001-06011 sin sectores.
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

  if (guardias.length < 5) {
    throw new Error(`Solo ${guardias.length} con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaciasguardia.farmaceuticos.com',
    territorio: 'badajoz',
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
