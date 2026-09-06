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
import { bajaAemet, normalizaAemet, frescuraTiempo } from './lib/tiempo.mjs'

const KEY = process.env.AEMET_API_KEY
if (!KEY) { console.error('Falta AEMET_API_KEY'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MUNI_FILE = resolve(ROOT, 'public', 'data', 'tiempo', 'municipios.json')
const OUT_DIR = resolve(ROOT, 'public', 'data', 'tiempo', 'snapshot')
const PAUSA_MS = 1500       // freno base entre municipios
const BACKOFF_429_MS = 30000  // espera al recibir 429 de AEMET

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const raw = JSON.parse(readFileSync(MUNI_FILE, 'utf8'))
const importantes = (raw.municipios || []).filter(m => m.imp)
console.log(`Municipios importantes a precachear: ${importantes.length}`)
if (importantes.length < 50 || importantes.length > 400) {
  throw new Error(`Numero raro de importantes (${importantes.length}); esperado ~145. Abortamos.`)
}

// El snapshot es SOLO de AEMET (su razon de ser es pre-cachear el dato oficial).
// AEMET limita el ritmo: ante 429 esperamos y reintentamos. Si aun asi falla, el
// municipio se SALTA (no se mete Open-Meteo) — ese se sirve bajo demanda, que ya
// da AEMET de uno en uno sin tocar el limite. Asi el snapshot nunca degrada.
async function aemetConReintentos(m) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      return normalizaAemet(await bajaAemet(m.ine, KEY), { ine: m.ine, nombre: m.nombre, provincia: m.provinciaNombre })
    } catch (e) {
      const msg = String(e.message || e)
      if (msg.includes('429') && intento < 3) { await sleep(BACKOFF_429_MS); continue }
      throw e
    }
  }
}

// Partimos del snapshot anterior (fresco) para NO perder cobertura si esta pasada
// no consigue algun municipio por el limite de AEMET (se re-mezcla con lo nuevo).
const porProvincia = new Map()  // slug -> { provincia, predicciones }
function cargaPrevio(slug, provincia) {
  if (porProvincia.has(slug)) return porProvincia.get(slug)
  const g = { provincia, predicciones: {} }
  try {
    const prev = JSON.parse(readFileSync(resolve(OUT_DIR, slug + '.json'), 'utf8'))
    for (const ine in (prev.predicciones || {})) {
      const p = prev.predicciones[ine]
      if (p && p.fuente === 'AEMET' && frescuraTiempo(p.elaborado).fiable) g.predicciones[ine] = p
    }
  } catch { /* sin snapshot previo */ }
  porProvincia.set(slug, g)
  return g
}

let ok = 0, saltados = 0
for (let i = 0; i < importantes.length; i++) {
  const m = importantes[i]
  const g = cargaPrevio(m.provinciaSlug, m.provinciaNombre)
  try {
    g.predicciones[m.ine] = await aemetConReintentos(m)
    ok++
  } catch (e) {
    saltados++  // se queda como estaba (previo fresco) o para bajo-demanda
    console.error(`  salta ${m.nombre} (${m.ine}): ${String(e.message || e).slice(0, 80)}`)
  }
  if (i < importantes.length - 1) await sleep(PAUSA_MS)
}

console.log(`  ${ok} con AEMET esta pasada, ${saltados} saltados (van bajo demanda)`)
// Contamos el total en el snapshot (nuevos + previos re-mezclados).
let totalSnap = 0
for (const [, g] of porProvincia) totalSnap += Object.keys(g.predicciones).length
if (totalSnap === 0) throw new Error('Snapshot vacio. Abortamos sin sobrescribir.')
console.log(`  total en el snapshot (con previos): ${totalSnap}`)

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
