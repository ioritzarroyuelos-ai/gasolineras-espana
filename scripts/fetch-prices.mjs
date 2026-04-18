#!/usr/bin/env node
// Descarga un snapshot completo de precios del Ministerio y lo guarda en public/data/
// Pensado para ejecutarse desde GitHub Actions 2 veces al dia.
// Si la descarga falla, NO sobrescribe el snapshot anterior (termina con exit 1).

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const BASE = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'

async function fetchJsonWithRetry(url, attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } catch (e) {
      lastErr = e
      console.error(`  intento ${i}/${attempts} fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 4000))
    }
  }
  throw lastErr
}

async function main() {
  console.log('Descargando estaciones del Ministerio...')
  const all = await fetchJsonWithRetry(BASE + '/EstacionesTerrestres/')
  const stations = all?.ListaEESSPrecio || []
  if (!Array.isArray(stations) || stations.length < 1000) {
    throw new Error(`Respuesta sospechosa: solo ${stations.length} estaciones`)
  }
  console.log(`  ${stations.length} estaciones recibidas (fecha: ${all.Fecha})`)

  mkdirSync(DATA_DIR, { recursive: true })

  // 1) Snapshot completo de estaciones
  const stationsPath = resolve(DATA_DIR, 'stations.json')
  writeFileSync(stationsPath, JSON.stringify(all))
  console.log(`  escrito ${stationsPath}`)

  // 2) Indice de municipios por provincia, derivado de las estaciones
  const byProv = {}
  for (const s of stations) {
    const idProv = s.IDProvincia
    const idMun  = s.IDMunicipio
    const mun    = s.Municipio
    if (!idProv || !idMun) continue
    if (!byProv[idProv]) byProv[idProv] = new Map()
    if (!byProv[idProv].has(idMun)) byProv[idProv].set(idMun, { IDMunicipio: idMun, Municipio: mun, IDProvincia: idProv })
  }
  const municipiosByProv = {}
  for (const k of Object.keys(byProv)) {
    municipiosByProv[k] = Array.from(byProv[k].values()).sort((a, b) => a.Municipio.localeCompare(b.Municipio))
  }
  const munPath = resolve(DATA_DIR, 'municipios.json')
  writeFileSync(munPath, JSON.stringify({ Fecha: all.Fecha, Data: municipiosByProv }))
  console.log(`  escrito ${munPath} (${Object.keys(municipiosByProv).length} provincias)`)

  // 3) Metadata con timestamp
  const metaPath = resolve(DATA_DIR, 'snapshot-meta.json')
  writeFileSync(metaPath, JSON.stringify({
    fetchedAt: new Date().toISOString(),
    ministryDate: all.Fecha,
    stationCount: stations.length
  }, null, 2))
  console.log(`  escrito ${metaPath}`)

  console.log('OK')
}

main().catch(err => {
  console.error('FATAL:', err.message)
  // Si ya existe un snapshot anterior, lo dejamos intacto
  if (existsSync(resolve(DATA_DIR, 'stations.json'))) {
    console.error('Conservando snapshot anterior.')
  }
  process.exit(1)
})
