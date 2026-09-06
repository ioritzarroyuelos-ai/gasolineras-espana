#!/usr/bin/env node
// Robot del snapshot del tiempo: precachea la predicción de los municipios
// "importantes" (población >= 50.000, ~145) para servir sus páginas al instante y
// sin llamada en frío. El resto de municipios va bajo demanda + caché en el borde.
//
// Lo lanza .github/workflows/fetch-tiempo.yml (cron), con AEMET_API_KEY de secreto.
// Fuente AEMET, con Open-Meteo de suplente (resuelvePrediccion). Freno entre
// municipios para respetar los límites de AEMET.
//
// Salida: public/data/tiempo/snapshot/<provinciaSlug>.json
//   { generado, provincia, predicciones: { "<ine>": Prediccion, ... } }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resuelvePrediccion } from './lib/tiempo.mjs'

const KEY = process.env.AEMET_API_KEY
if (!KEY) { console.error('Falta AEMET_API_KEY'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MUNI_FILE = resolve(ROOT, 'public', 'data', 'tiempo', 'municipios.json')
const OUT_DIR = resolve(ROOT, 'public', 'data', 'tiempo', 'snapshot')
const PAUSA_MS = 1200  // freno entre municipios (AEMET limita el ritmo)

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const raw = JSON.parse(readFileSync(MUNI_FILE, 'utf8'))
const importantes = (raw.municipios || []).filter(m => m.imp)
console.log(`Municipios importantes a precachear: ${importantes.length}`)
if (importantes.length < 50 || importantes.length > 400) {
  throw new Error(`Numero raro de importantes (${importantes.length}); esperado ~145. Abortamos.`)
}

// Agrupa las predicciones por provincia.
const porProvincia = new Map()  // slug -> { provincia, predicciones }
let ok = 0, fallos = 0

for (let i = 0; i < importantes.length; i++) {
  const m = importantes[i]
  try {
    const pred = await resuelvePrediccion(
      { ine: m.ine, nombre: m.nombre, provincia: m.provinciaNombre, lat: m.lat, lng: m.lng },
      { key: KEY, intentos: 2 },
    )
    const g = porProvincia.get(m.provinciaSlug) || { provincia: m.provinciaNombre, predicciones: {} }
    g.predicciones[m.ine] = pred
    porProvincia.set(m.provinciaSlug, g)
    ok++
  } catch (e) {
    fallos++
    console.error(`  ${m.nombre} (${m.ine}): ${String(e.message || e).slice(0, 100)}`)
  }
  if (i < importantes.length - 1) await sleep(PAUSA_MS)
}

console.log(`  ${ok} predicciones OK, ${fallos} fallos`)
if (ok === 0) throw new Error('Cero predicciones. Abortamos sin sobrescribir.')

mkdirSync(OUT_DIR, { recursive: true })
const generado = new Date().toISOString()
let ficheros = 0
for (const [slug, g] of porProvincia) {
  writeFileSync(
    resolve(OUT_DIR, slug + '.json'),
    JSON.stringify({ generado, provincia: g.provincia, predicciones: g.predicciones }),
  )
  ficheros++
}
console.log(`OK — ${ficheros} ficheros de snapshot en ${OUT_DIR}`)
