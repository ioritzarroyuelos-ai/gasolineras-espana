#!/usr/bin/env node
// Descarga un snapshot completo de precios del Ministerio y lo guarda en public/data/
// Pensado para ejecutarse desde GitHub Actions 2 veces al dia.
// Si la descarga falla, NO sobrescribe el snapshot anterior (termina con exit 1).

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
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

  // 4) Tendencia nacional: mediana hoy vs anterior (por combustible y por CCAA).
  //    Guardamos en trends.json lo que el cliente leera para pintar el badge.
  //    Rotacion: el "current" actual pasa a "previous" en el siguiente ciclo,
  //    de forma que cada ejecucion del cron compara con 12h atras (las dos
  //    horas de fetch: 07h y 19h UTC).
  const trendsPath = resolve(DATA_DIR, 'trends.json')
  const FUEL_KEYS = {
    g95:    'Precio Gasolina 95 E5',
    g98:    'Precio Gasolina 98 E5',
    diesel: 'Precio Gasoleo A',
    glp:    'Precio Gases licuados del petróleo'
  }
  function parseP(s) { const n = parseFloat(String(s || '').replace(',', '.')); return isFinite(n) && n > 0 ? n : null }
  function median(arr) {
    const vals = arr.filter(Boolean).sort((a, b) => a - b)
    if (!vals.length) return null
    const m = Math.floor(vals.length / 2)
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2
  }
  const currentMedians = {}
  for (const [label, key] of Object.entries(FUEL_KEYS)) {
    currentMedians[label] = median(stations.map(s => parseP(s[key])))
  }
  // Por CCAA (para luego poder decir "En Bizkaia la gasolina esta 3c/L
  // por debajo de la media nacional").
  const byCcaa = {}
  for (const s of stations) {
    const ccaa = s.IDCCAA
    if (!ccaa) continue
    if (!byCcaa[ccaa]) byCcaa[ccaa] = { count: 0, fuel: {} }
    byCcaa[ccaa].count++
    for (const [label, key] of Object.entries(FUEL_KEYS)) {
      (byCcaa[ccaa].fuel[label] = byCcaa[ccaa].fuel[label] || []).push(parseP(s[key]))
    }
  }
  const ccaaMedians = {}
  for (const [id, info] of Object.entries(byCcaa)) {
    ccaaMedians[id] = { count: info.count, fuel: {} }
    for (const [label, vals] of Object.entries(info.fuel)) {
      ccaaMedians[id].fuel[label] = median(vals)
    }
  }
  // Rotacion: current → previous.
  let previous = null
  if (existsSync(trendsPath)) {
    try {
      const prev = JSON.parse(readFileSync(trendsPath, 'utf8'))
      previous = prev.current || null
    } catch { /* corrupto → empezamos limpio */ }
  }
  const trends = {
    generatedAt: new Date().toISOString(),
    ministryDate: all.Fecha,
    current: { ts: new Date().toISOString(), medians: currentMedians, ccaa: ccaaMedians },
    previous
  }
  writeFileSync(trendsPath, JSON.stringify(trends))
  console.log(`  escrito ${trendsPath}`)
  if (previous) {
    const deltas = []
    for (const [k, v] of Object.entries(currentMedians)) {
      const pv = previous.medians?.[k]
      if (v != null && pv != null) {
        const d = v - pv
        deltas.push(`${k}: ${d >= 0 ? '+' : ''}${d.toFixed(3)} €`)
      }
    }
    if (deltas.length) console.log('  deltas vs anterior: ' + deltas.join(', '))
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
