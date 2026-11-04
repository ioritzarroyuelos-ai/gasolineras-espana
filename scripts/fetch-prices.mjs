#!/usr/bin/env node
// Descarga un snapshot completo de precios del Ministerio y lo guarda en public/data/
// Pensado para ejecutarse desde GitHub Actions 2 veces al dia.
// Si la descarga falla, NO sobrescribe el snapshot anterior (termina con exit 1).

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construyeObservatorio } from './lib/observatorio-precalculo.mjs'
import { construyeGasolineras } from './lib/gasolineras-precalculo.mjs'
import { buildFuelTrends } from './lib/fuel-trends.mjs'

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

  // Leer las dos fotos antes de reemplazar ningún archivo. Una referencia de
  // abril no se compara con hoy: buildFuelTrends exige fechas reales recientes.
  function previousJson(name) {
    try { return JSON.parse(readFileSync(resolve(DATA_DIR, name), 'utf8')) } catch { return null }
  }
  const trends = buildFuelTrends(all, {
    previous: previousJson('trends.json'),
    previousSnapshot: previousJson('stations.json'),
    previousMeta: previousJson('snapshot-meta.json'),
  })

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

  // 4) Tendencia entre dos fotos oficiales recientes y de fecha distinta.
  const trendsPath = resolve(DATA_DIR, 'trends.json')
  writeFileSync(trendsPath, JSON.stringify(trends))
  console.log('  escrito ' + trendsPath + (trends.previous ? ' (dos fotos recientes)' : ' (esperando segunda foto reciente)'))

  // 5) Observatorio de precios pre-calculado (ver scripts/lib/observatorio-precalculo.mjs).
  //    Evita que /precios-carburantes tenga que parsear los 11,9 MB de
  //    stations.json en cada visita, que costaba 9,4 s medidos en produccion.
  const observatorio = construyeObservatorio(all)
  if (observatorio) {
    const obsPath = resolve(DATA_DIR, 'observatorio.json')
    const payload = JSON.stringify(observatorio)
    writeFileSync(obsPath, payload)
    console.log(`  escrito ${obsPath} (${Math.round(payload.length / 1024)} KB, ` +
      `${observatorio.g95.provincias.length} provincias, ${observatorio.g95.marcas.length} marcas)`)
  } else {
    // No abortamos: el Worker tiene camino de respaldo y el resto del snapshot
    // ya esta escrito y es valido.
    console.error('  AVISO: no se pudo construir el observatorio')
  }

  // 6) Resumen de gasolineras pre-calculado (M5): media nacional + recuento por
  //    provincia, para que la home y /gasolineras/ no parseen stations.json (12 MB).
  const gasResumen = construyeGasolineras(all)
  if (gasResumen) {
    const gasPath = resolve(DATA_DIR, 'gasolineras-resumen.json')
    const payload = JSON.stringify(gasResumen)
    writeFileSync(gasPath, payload)
    console.log(`  escrito ${gasPath} (${Math.round(payload.length / 1024)} KB)`)
  } else {
    console.error('  AVISO: no se pudo construir el resumen de gasolineras')
  }

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
