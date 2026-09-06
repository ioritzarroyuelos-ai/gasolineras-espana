#!/usr/bin/env node
// TEMPORAL (Tarea 1 del plan del tiempo). Captura muestras REALES de AEMET y
// Open-Meteo para escribir los parsers contra datos de verdad, no inventados.
// Se ejecuta en GitHub Actions (.github/workflows/spike-tiempo.yml), que le pasa
// AEMET_API_KEY como secreto. Se borra al terminar la integración (Tarea 12).

import { mkdirSync, writeFileSync } from 'node:fs'

const KEY = process.env.AEMET_API_KEY
if (!KEY) { console.error('Falta AEMET_API_KEY'); process.exit(1) }

const UA = 'cercaya-tiempo-spike/1.0 (+https://webapp-3ft.pages.dev)'

// AEMET OpenData: dos pasos. La primera llamada (con api_key) devuelve
// { estado, datos: <url> }; el JSON real está en esa url.
async function aemet(path) {
  const r1 = await fetch('https://opendata.aemet.es/opendata/api' + path, {
    headers: { 'api_key': KEY, 'User-Agent': UA, 'Accept': 'application/json' },
  })
  const j1 = await r1.json()
  console.log(`  paso1 ${path} -> estado=${j1.estado}`)
  if (!j1.datos) throw new Error('sin campo datos: ' + JSON.stringify(j1).slice(0, 300))
  const r2 = await fetch(j1.datos, { headers: { 'User-Agent': UA } })
  const buf = await r2.arrayBuffer()
  // El JSON de datos suele venir en ISO-8859-1; decodificamos así para no romper acentos.
  const txt = new TextDecoder('iso-8859-1').decode(buf)
  return JSON.parse(txt)
}

const out = 'tests/fixtures/tiempo'
mkdirSync(out, { recursive: true })

console.log('AEMET diaria 28079 (Madrid)...')
const diaria = await aemet('/prediccion/especifica/municipio/diaria/28079')
writeFileSync(`${out}/aemet-diaria-28079.json`, JSON.stringify(diaria, null, 2))

console.log('AEMET maestro de municipios (guardo muestra de 20 + total)...')
const maestro = await aemet('/maestro/municipios')
const arr = Array.isArray(maestro) ? maestro : []
writeFileSync(`${out}/aemet-maestro-sample.json`, JSON.stringify(arr.slice(0, 20), null, 2))
console.log(`  maestro total: ${arr.length} municipios; claves de ejemplo: ${Object.keys(arr[0] || {}).join(', ')}`)

console.log('Open-Meteo (Madrid, por coordenadas)...')
const omUrl = 'https://api.open-meteo.com/v1/forecast?latitude=40.4168&longitude=-3.7038'
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max'
  + '&timezone=Europe%2FMadrid'
const om = await (await fetch(omUrl, { headers: { 'User-Agent': UA } })).json()
writeFileSync(`${out}/openmeteo-madrid.json`, JSON.stringify(om, null, 2))

console.log('OK — fixtures escritas en ' + out)
