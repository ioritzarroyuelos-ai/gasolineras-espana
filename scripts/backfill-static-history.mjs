#!/usr/bin/env node
// ============================================================
// backfill-static-history.mjs — historico de 1 ano como JSON estatico.
// ============================================================
// Descarga N dias desde el endpoint historico del Ministerio y genera
// archivos JSON por provincia en public/data/history/. Cloudflare Pages
// los sirve via CDN gratis (no toca D1, no consume free tier de writes).
//
// Por que JSON estatico y no D1:
//   - D1 free tier: 100k writes/dia. 365 dias × 11k estaciones × 4 fuels =
//     ~16M filas → ~160 dias para aplicar. Inviable.
//   - Pages assets: gratis, ilimitado, cacheado en edge automaticamente.
//   - Trade-off: si quieres anadir mas dias hay que regenerar todo (no es
//     append-only). Para "1 ano fijo + cron diario actualiza D1" funciona.
//
// Arquitectura runtime:
//   - JSON estaticos = historico fijo (ej. ultimos 365 dias hasta ayer del run)
//   - D1 = datos diarios recientes (cron sigue escribiendo como antes)
//   - Endpoint /api/history/:stationId mergea ambas fuentes:
//     * Lee del JSON los puntos hasta su 'to' date.
//     * Lee de D1 los puntos posteriores.
//     * Devuelve la union.
//
// Uso:
//   # Probar primero con 14 dias (solo 1-2 archivos por provincia, rapido):
//   node scripts/backfill-static-history.mjs --days 14
//
//   # Ano completo (~30-40 min descarga, ~3-5 MB gzip total):
//   node scripts/backfill-static-history.mjs --days 365
//
// Output:
//   public/data/history/{provincia_id}.json     — series por estacion (con dedupe)
//   public/data/history/median/{provincia_id}.json — mediana provincial por dia
//   public/data/history/index.json              — metadata del backfill
//
// Formato de los archivos: ver buildProvinceFile() y buildMedianFile() abajo.

import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'
const OUT_DIR = resolve(ROOT, 'public/data/history')
const OUT_DIR_MEDIAN = join(OUT_DIR, 'median')

// ---- Logica de parseo (duplicada de src/lib/history.ts) ----
// El script es Node puro sin tsx para no arrastrar la toolchain TS al CI.
// Si los tests de history.test.ts pasan, el contrato esta validado.
const FUEL_MAP = {
  'Precio Gasolina 95 E5':  '95',
  'Precio Gasolina 98 E5':  '98',
  'Precio Gasoleo A':       'diesel',
  'Precio Gasoleo Premium': 'diesel_plus',
}
const FUEL_CODES = Object.values(FUEL_MAP)

function parsePriceString(raw) {
  if (!raw) return null
  const s = String(raw).trim().replace(',', '.')
  if (!s) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return n
}

function eurosToCents(euros) {
  return Math.round(euros * 1000)
}

// ---- CLI args ----
function parseArgs(argv) {
  const args = {
    days: 365,
    endDate: null,    // null = ayer (UTC)
    delay: 1500,      // ms entre requests
  }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--days' && argv[i+1]) { args.days = parseInt(argv[++i], 10); continue }
    if (a === '--end' && argv[i+1]) { args.endDate = argv[++i]; continue }
    if (a === '--delay' && argv[i+1]) { args.delay = parseInt(argv[++i], 10); continue }
    if (a === '-h' || a === '--help') {
      console.log('Uso: node scripts/backfill-static-history.mjs [--days N] [--end YYYY-MM-DD] [--delay MS]')
      process.exit(0)
    }
  }
  return args
}

// ---- Fetch helpers ----
function toMinisterioDateStr(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}-${mm}-${yyyy}`
}

function toIsoDateStr(d) {
  return d.toISOString().slice(0, 10)
}

async function fetchHist(dateStr, attempts = 4) {
  const url = BASE + '/EstacionesTerrestresHist/' + dateStr
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      // Si la API no tiene datos para ese dia devuelve { Fecha: null, Lista: [] }.
      if (!json.Fecha || !Array.isArray(json.ListaEESSPrecio) || json.ListaEESSPrecio.length === 0) {
        return null
      }
      return json
    } catch (e) {
      lastErr = e
      console.error(`  ${dateStr}: intento ${i}/${attempts} fallo (${e.message})`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw lastErr
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ---- Acumulador en memoria ----
// Estructura: byProvince[provincia_id][station_id][fuel_code] = [{date, cents}]
function appendDay(acc, snapshot, isoDate) {
  if (!snapshot || !Array.isArray(snapshot.ListaEESSPrecio)) return 0
  let added = 0
  for (const s of snapshot.ListaEESSPrecio) {
    if (!s || typeof s !== 'object') continue
    const stationId = s['IDEESS']
    const provinciaId = s['IDProvincia']
    if (!stationId || !/^\d{1,10}$/.test(stationId)) continue
    if (!provinciaId || !/^\d{1,2}$/.test(provinciaId)) continue
    const provKey = String(provinciaId).padStart(2, '0')

    let prov = acc[provKey]
    if (!prov) { prov = {}; acc[provKey] = prov }
    let st = prov[stationId]
    if (!st) { st = {}; prov[stationId] = st }

    for (const ministryKey of Object.keys(FUEL_MAP)) {
      const fuelCode = FUEL_MAP[ministryKey]
      const price = parsePriceString(s[ministryKey])
      if (price == null) continue
      let arr = st[fuelCode]
      if (!arr) { arr = []; st[fuelCode] = arr }
      arr.push({ date: isoDate, cents: eurosToCents(price) })
      added++
    }
  }
  return added
}

// ---- Builder de archivos por provincia ----
// Dedupe consecutivo: solo guardamos puntos donde el precio cambio respecto al
// anterior. Reduce el JSON ~5-10x sin perder informacion (un sparkline interpola
// entre puntos visibles, las "mesetas" se reconstruyen con el ultimo valor).
function dedupeConsecutive(points) {
  if (points.length === 0) return points
  // points ya viene ordenado por fecha (lo recorremos de viejo a nuevo).
  const out = [points[0]]
  let lastCents = points[0].cents
  for (let i = 1; i < points.length; i++) {
    if (points[i].cents !== lastCents) {
      out.push(points[i])
      lastCents = points[i].cents
    }
  }
  // Garantizamos punto final: si el ultimo dia tiene mismo precio que el anterior
  // dedupeado, igualmente lo anadimos para que el cliente sepa "hasta cuando".
  const last = points[points.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function buildProvinceFile(provKey, stationsObj, fromIso, toIso, days) {
  // Format compacto: stations[id][fuel] = [[YYYY-MM-DD, cents], ...].
  // La fecha como string ISO ocupa 10 bytes vs 3 bytes de un offset, pero es
  // legible en debug y el gzip la deduplica eficazmente. Mantenemos simple.
  const stations = {}
  for (const stationId of Object.keys(stationsObj)) {
    const fuels = stationsObj[stationId]
    const stEntry = {}
    for (const fuel of FUEL_CODES) {
      const pts = fuels[fuel]
      if (!pts || pts.length === 0) continue
      const dedup = dedupeConsecutive(pts)
      stEntry[fuel] = dedup.map(p => [p.date, p.cents])
    }
    if (Object.keys(stEntry).length > 0) stations[stationId] = stEntry
  }
  return {
    v: 1,
    provincia_id: provKey,
    from: fromIso,
    to: toIso,
    days,
    generated_at: new Date().toISOString(),
    stations,
  }
}

// Mediana provincial por dia, por combustible. La pre-calculamos aqui para que
// el endpoint /api/history/province/:id no tenga que cargar el JSON enorme,
// solo este mas pequeno.
function buildMedianFile(provKey, stationsObj, fromIso, toIso, days) {
  // byDate[fuel][date] = [cents, cents, ...]
  const byDate = {}
  for (const fuel of FUEL_CODES) byDate[fuel] = {}

  for (const stationId of Object.keys(stationsObj)) {
    const fuels = stationsObj[stationId]
    for (const fuel of FUEL_CODES) {
      const pts = fuels[fuel]
      if (!pts) continue
      for (const p of pts) {
        let arr = byDate[fuel][p.date]
        if (!arr) { arr = []; byDate[fuel][p.date] = arr }
        arr.push(p.cents)
      }
    }
  }

  // Para cada fuel, calculamos mediana por fecha (mismo algoritmo que el endpoint
  // actual: indice central, no media de los dos centrales — diferencia invisible
  // en sparkline a resolucion pixel y mas barato).
  const median = {}
  for (const fuel of FUEL_CODES) {
    const dates = Object.keys(byDate[fuel]).sort()
    const arr = []
    for (const date of dates) {
      const list = byDate[fuel][date]
      list.sort((a, b) => a - b)
      const mid = list[Math.floor(list.length / 2)]
      arr.push([date, mid])
    }
    if (arr.length > 0) median[fuel] = arr
  }

  return {
    v: 1,
    provincia_id: provKey,
    from: fromIso,
    to: toIso,
    days,
    generated_at: new Date().toISOString(),
    median,
  }
}

// ---- Main ----
async function main() {
  const args = parseArgs(process.argv)
  const today = new Date()
  let endDate
  if (args.endDate) {
    endDate = new Date(args.endDate + 'T00:00:00Z')
  } else {
    endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
  }
  if (isNaN(endDate.getTime())) {
    console.error('--end debe ser YYYY-MM-DD valido')
    process.exit(1)
  }

  const startDate = new Date(endDate.getTime())
  startDate.setUTCDate(startDate.getUTCDate() - (args.days - 1))

  const fromIso = toIsoDateStr(startDate)
  const toIso = toIsoDateStr(endDate)
  console.log(`Backfill ${args.days} dias: ${fromIso} → ${toIso}`)
  console.log(`Output: ${OUT_DIR}`)
  console.log(`Delay entre requests: ${args.delay}ms`)
  console.log()

  // Acumulador en memoria. Para 365 dias × 11k estaciones × 4 fuels son
  // ~16M puntos × 30 bytes ≈ 500 MB en RAM peak. Node x64 lo aguanta sin
  // problema (heap default 1.5 GB). Si fuera mas grande habria que streamear.
  const acc = {} // byProvince[provKey][stationId][fuel] = [{date, cents}]

  let totalPoints = 0
  let daysWithData = 0
  let daysEmpty = 0

  for (let i = 0; i < args.days; i++) {
    const day = new Date(startDate.getTime())
    day.setUTCDate(day.getUTCDate() + i)
    const ministerioStr = toMinisterioDateStr(day)
    const isoStr = toIsoDateStr(day)

    process.stdout.write(`[${i+1}/${args.days}] ${isoStr} ... `)
    const t0 = Date.now()
    let snap
    try {
      snap = await fetchHist(ministerioStr)
    } catch (e) {
      console.log(`ERROR ${e.message}`)
      continue
    }
    if (!snap) {
      console.log('sin datos')
      daysEmpty++
      continue
    }
    const added = appendDay(acc, snap, isoStr)
    totalPoints += added
    daysWithData++
    const ms = Date.now() - t0
    console.log(`${added} puntos (${ms}ms)`)

    if (i < args.days - 1) await sleep(args.delay)
  }

  console.log()
  console.log(`Descarga completada: ${totalPoints} puntos en ${daysWithData} dias`)
  console.log()

  // Escribir archivos por provincia. Ordenamos puntos por fecha antes de
  // dedupe — appendDay los anade en orden de iteracion (cronologico) pero
  // garantizamos por seguridad.
  console.log('Escribiendo archivos JSON...')
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })
  mkdirSync(OUT_DIR_MEDIAN, { recursive: true })

  const provKeys = Object.keys(acc).sort()
  let totalBytes = 0
  let totalBytesMedian = 0

  for (const provKey of provKeys) {
    const stationsObj = acc[provKey]
    // Ordenar puntos cronologicamente por estacion+fuel antes de dedupe.
    for (const stationId of Object.keys(stationsObj)) {
      for (const fuel of FUEL_CODES) {
        const arr = stationsObj[stationId][fuel]
        if (arr) arr.sort((a, b) => a.date.localeCompare(b.date))
      }
    }

    const provFile = buildProvinceFile(provKey, stationsObj, fromIso, toIso, args.days)
    const medianFile = buildMedianFile(provKey, stationsObj, fromIso, toIso, args.days)
    const provPath = join(OUT_DIR, provKey + '.json')
    const medianPath = join(OUT_DIR_MEDIAN, provKey + '.json')

    // Sin pretty-print: el JSON estatico se gzipa en CDN, las tabulaciones solo
    // anaden bytes que se descargan (no son tan eficientes con gzip como uno cree).
    const provJson = JSON.stringify(provFile)
    const medianJson = JSON.stringify(medianFile)
    writeFileSync(provPath, provJson)
    writeFileSync(medianPath, medianJson)

    const provBytes = Buffer.byteLength(provJson)
    const medianBytes = Buffer.byteLength(medianJson)
    totalBytes += provBytes
    totalBytesMedian += medianBytes
    const stationCount = Object.keys(provFile.stations).length
    console.log(`  ${provKey}: ${stationCount} estaciones, ${(provBytes / 1024).toFixed(0)} KB + mediana ${(medianBytes / 1024).toFixed(0)} KB`)
  }

  // Index para que el cliente/server sepa que provincias tenemos disponibles
  // y desde/hasta cuando. Permite al endpoint detectar "no hay JSON estatico
  // para esta provincia" sin un fetch fallido.
  const index = {
    v: 1,
    from: fromIso,
    to: toIso,
    days: args.days,
    generated_at: new Date().toISOString(),
    provinces: provKeys,
    total_points: totalPoints,
    days_with_data: daysWithData,
    days_empty: daysEmpty,
  }
  const indexPath = join(OUT_DIR, 'index.json')
  writeFileSync(indexPath, JSON.stringify(index, null, 2))

  console.log()
  console.log(`OK ${provKeys.length} provincias escritas`)
  console.log(`   Total estaciones: ${(totalBytes / 1024 / 1024).toFixed(2)} MB raw`)
  console.log(`   Total medianas:   ${(totalBytesMedian / 1024).toFixed(0)} KB raw`)
  console.log(`   (gzip en CDN reduce ~3-5x)`)
  console.log()
  console.log('Siguiente paso: commit + push para que Cloudflare Pages publique los nuevos assets.')
}

main().catch(e => { console.error(e); process.exit(1) })
