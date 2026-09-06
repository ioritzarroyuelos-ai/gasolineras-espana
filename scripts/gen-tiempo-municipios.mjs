#!/usr/bin/env node
// Genera public/data/tiempo/municipios.json a partir del "maestro de municipios"
// de AEMET (una sola llamada). El maestro trae código, nombre, coordenadas y
// población de los ~8.100 municipios, así que de aquí sale: el índice del
// buscador, las coordenadas para Open-Meteo y la marca de "importante" (snapshot).
//
// Se ejecuta puntualmente (cuando cambia el maestro), vía
// .github/workflows/gen-tiempo-municipios.yml, que pasa AEMET_API_KEY como secreto.
// NO en cada pase (el maestro casi no cambia).

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { maestroAMunicipios } from './lib/tiempo.mjs'
import { PROVINCIAS_INE } from './lib/provincias-ine.mjs'

const KEY = process.env.AEMET_API_KEY
if (!KEY) { console.error('Falta AEMET_API_KEY'); process.exit(1) }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'public', 'data', 'tiempo', 'municipios.json')
const UA = 'cercaya-tiempo/1.0 (+https://webapp-3ft.pages.dev)'

// AEMET en dos pasos.
async function aemet(path) {
  const r1 = await fetch('https://opendata.aemet.es/opendata/api' + path, {
    headers: { 'api_key': KEY, 'User-Agent': UA, 'Accept': 'application/json' },
  })
  if (!r1.ok) throw new Error('paso1 HTTP ' + r1.status)
  const j1 = await r1.json()
  if (!j1 || !j1.datos) throw new Error('sin datos (estado ' + (j1 && j1.estado) + ')')
  const r2 = await fetch(j1.datos, { headers: { 'User-Agent': UA } })
  if (!r2.ok) throw new Error('paso2 HTTP ' + r2.status)
  const buf = await r2.arrayBuffer()
  return JSON.parse(new TextDecoder('iso-8859-1').decode(buf))
}

console.log('Descargando el maestro de municipios de AEMET...')
const maestro = await aemet('/maestro/municipios')
console.log(`  maestro: ${Array.isArray(maestro) ? maestro.length : 0} municipios`)

const municipios = maestroAMunicipios(maestro, PROVINCIAS_INE)
const imp = municipios.filter(m => m.imp).length
console.log(`  normalizados: ${municipios.length} (importantes: ${imp})`)

if (municipios.length < 7000) {
  throw new Error(`Solo ${municipios.length} municipios (esperado ~8.100). Abortamos sin sobrescribir.`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({
  generado: new Date().toISOString(),
  fuente: 'AEMET maestro/municipios',
  total: municipios.length,
  municipios,
}))
console.log('OK -> ' + OUT)
