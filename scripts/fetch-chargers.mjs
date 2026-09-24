#!/usr/bin/env node
// Descarga las electrolineras de España y escribe public/data/chargers.json.
//
// Fuente PRIMARIA (oficial): registro del MITERD publicado por la DGT en
// DATEX2 v3 — nacional, actualizado a diario, licencia CC BY. ~12k estaciones
// / ~35k puntos de recarga con tipo de conector y potencia.
//   https://nap.dgt.es/datex2/v3/miterd/EnergyInfrastructureTablePublication/electrolineras.xml
//
// Fuente SECUNDARIA (opcional): Open Charge Map (comunidad, CC BY-SA 4.0).
// Solo se consulta si existe el secreto OCM_API_KEY; rellena puntos que no
// estén en el registro oficial (dedup por cercanía ~100 m, gana la oficial).
// Sin la key, el snapshot sale 100% oficial (que ya es "todas las registradas").
//
// La lógica de parseo/normalización/fusión vive en scripts/lib/electrolineras.mjs
// (pura y testeada). Aquí solo hacemos red y disco.
//
// Errores: si el DATEX2 devuelve < MIN_SITES estaciones (sospechoso, España
// tiene ~12k), exit 1 SIN sobrescribir el snapshot — mismo patrón defensivo
// que fetch-prices.mjs.
//
// Testing local sin red (Node fetch va en sandbox): DGT_XML_FILE=/ruta/al.xml

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSites, normalizeOcm, dedup, toCompactRows, SCHEMA } from './lib/electrolineras.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'chargers.json')

const DGT_URL = 'https://nap.dgt.es/datex2/v3/miterd/EnergyInfrastructureTablePublication/electrolineras.xml'
const OCM_URL = 'https://api.openchargemap.io/v3/poi/?output=json&countrycode=ES&compact=true&verbose=false&maxresults=100000'
const USER_AGENT = 'gasolineras-espana/1.9 (+https://webapp-3ft.pages.dev)'

// Umbral defensivo: el registro oficial ronda las 12k estaciones. Si baja de
// esto (feed a medio publicar, error de la DGT), no pisamos el snapshot bueno.
const MIN_SITES = 5000

async function fetchText(url, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts} — ${url.slice(0, 60)}…`)
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml,text/xml,*/*' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 8000))
    }
  }
  throw lastErr
}

async function loadDgtXml() {
  const local = process.env.DGT_XML_FILE
  if (local) {
    console.log(`Leyendo DATEX2 desde fichero local: ${local}`)
    return readFileSync(local, 'utf8')
  }
  console.log('Descargando DATEX2 oficial de la DGT (MITERD)…')
  return fetchText(DGT_URL)
}

// OCM solo si hay key. Devuelve [] ante cualquier fallo (no bloquea el snapshot
// oficial). La key va como header X-API-Key.
async function loadOcm() {
  const key = process.env.OCM_API_KEY
  if (!key) {
    console.log('OCM_API_KEY no definido — snapshot solo con datos oficiales (DGT).')
    return []
  }
  try {
    console.log('Consultando Open Charge Map (complemento CC BY-SA)…')
    const res = await fetch(OCM_URL, { headers: { 'User-Agent': USER_AGENT, 'X-API-Key': key, Accept: 'application/json' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error(`  OCM falló (${e.message}) — seguimos solo con datos oficiales.`)
    return []
  }
}

async function main() {
  const xml = await loadDgtXml()
  const dgt = parseSites(xml)
  console.log(`  DGT: ${dgt.length} estaciones oficiales parseadas`)
  if (dgt.length < MIN_SITES) {
    throw new Error(`Solo ${dgt.length} estaciones (< ${MIN_SITES}). NO sobrescribimos chargers.json.`)
  }

  const ocmRaw = await loadOcm()
  const ocm = normalizeOcm(ocmRaw)
  if (ocm.length) console.log(`  OCM: ${ocm.length} puntos normalizados (antes de dedup)`)

  const merged = dedup(dgt, ocm)
  const addedFromOcm = merged.length - dgt.length
  const rows = toCompactRows(merged)

  const out = {
    ts: new Date().toISOString(),
    sources: ocm.length ? ['dgt.miterd', 'openchargemap.org'] : ['dgt.miterd'],
    count: rows.length,
    countByFuente: { dgt: dgt.length, ocm: addedFromOcm },
    // Documentado para que el cliente no adivine el orden de campos.
    schema: SCHEMA,
    chargers: rows,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${rows.length} electrolineras (${dgt.length} DGT + ${addedFromOcm} OCM) en ${OUT_FILE}`)
}

// Solo ejecuta main() si se corre directamente (no al importar en un test).
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch(e => {
    console.error('ERROR:', e.message)
    process.exit(1)
  })
}

export { main }
