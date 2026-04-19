#!/usr/bin/env node
// ============================================================
// backfill-d1.mjs — genera SQL con el historico derivado de git.
// ============================================================
// Objetivo: poblar D1 con los precios historicos que ya tenemos "por accidente"
// en el repositorio. Como GitHub Actions commitea 2 veces/dia public/data/
// stations.json, cada commit es un snapshot datado del Ministerio. Recorriendo
// `git log` de ese fichero extraemos uno o dos puntos por dia y generamos
// SQL listo para D1, evitando empezar desde cero cuando se despliegue la
// feature de historico.
//
// Uso:
//   node scripts/backfill-d1.mjs [--out migrations/9999_backfill.sql] [--max-days 180]
//
// Luego:
//   npx wrangler d1 execute gasolineras-history \
//     --file=migrations/9999_backfill.sql --remote
//
// Deduplicacion por dia: si un dia tiene varios commits (el GHA corre 2 veces,
// mas los manuales), nos quedamos con el ULTIMO para que el dia represente el
// "cierre" de precios de ese dia.
//
// Consideraciones de tiempo/memoria:
//   - 180 dias × 2 snapshots/dia = ~360 iteraciones de git show.
//   - cada snapshot pesa ~2 MB (12k estaciones); leemos de golpe y luego
//     dejamos que el GC limpie. No acumulamos snapshots en RAM.
//   - El SQL generado sale ~150 MB con 180 dias. wrangler d1 execute lo
//     particiona automaticamente si pasas --file, asi que no hay que trocear
//     manualmente.

import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// ---- Reimplementacion de history.ts en JS puro ----
// Duplicamos la logica aqui para evitar dependencias (tsx, ts-node). Los
// tests unitarios de history.ts cubren el mismo contrato — si alguna de las
// dos se queda desincronizada, detectamos en el siguiente cron ingest que los
// precios del dia no matchean con el backfill. Vale la duplicacion por tener
// un script Node puro, self-contained.
const FUEL_MAP = {
  'Precio Gasolina 95 E5':  '95',
  'Precio Gasolina 98 E5':  '98',
  'Precio Gasoleo A':       'diesel',
  'Precio Gasoleo Premium': 'diesel_plus',
}

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

function snapshotToRows(snapshot, date) {
  if (!snapshot || typeof snapshot !== 'object') return []
  const list = snapshot.ListaEESSPrecio
  if (!Array.isArray(list)) return []
  const rows = []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const stationId = s['IDEESS']
    if (!stationId || !/^\d{1,10}$/.test(stationId)) continue
    for (const key of Object.keys(FUEL_MAP)) {
      const fuelCode = FUEL_MAP[key]
      const price = parsePriceString(s[key])
      if (price == null) continue
      rows.push({
        station_id: stationId,
        fuel_code: fuelCode,
        date,
        price_cents: eurosToCents(price),
      })
    }
  }
  return rows
}

// Escape SQL-safe (solo estamos escapando comillas simples en station_id y
// fuel_code, que son ambos cadenas de caracteres controlados — digitos y
// slugs ASCII). No recibimos user input; el resto de valores son enteros.
function escSql(s) {
  return String(s).replace(/'/g, "''")
}

function buildInsertSql(rows, rowsPerStmt = 250) {
  const parts = []
  for (let i = 0; i < rows.length; i += rowsPerStmt) {
    const chunk = rows.slice(i, i + rowsPerStmt)
    const values = chunk.map(r =>
      `('${escSql(r.station_id)}','${escSql(r.fuel_code)}','${escSql(r.date)}',${r.price_cents})`
    ).join(',')
    parts.push(
      `INSERT OR REPLACE INTO price_history (station_id, fuel_code, date, price_cents) VALUES ${values};`
    )
  }
  return parts.join('\n')
}

// ---- CLI args ----
function parseArgs(argv) {
  const args = { out: 'migrations/9999_backfill.sql', maxDays: 180 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out' && argv[i+1]) { args.out = argv[++i]; continue }
    if (a === '--max-days' && argv[i+1]) { args.maxDays = parseInt(argv[++i], 10); continue }
    if (a === '-h' || a === '--help') {
      console.log('Uso: node scripts/backfill-d1.mjs [--out FILE] [--max-days N]')
      process.exit(0)
    }
  }
  return args
}

// ---- Git helpers ----
function gitLines(cmd) {
  // stdio: inherit para el error, pipe para el stdout. Buffer grande porque
  // el listado de commits es corto pero `git show` de un JSON de 2 MB no lo es.
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

function listCommits(path, maxDays) {
  const since = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10)
  // %H = hash, %cI = ISO 8601 committer date con tz. --follow sigue renames
  // si algun dia movemos el fichero. -- <path> evita confundir el argumento.
  const raw = gitLines(`git log --follow --since="${since}" --format="%H|%cI" -- "${path}"`)
  return raw.map(l => {
    const [hash, iso] = l.split('|')
    return { hash, iso }
  })
}

function showFile(hash, path) {
  // buffer grande: el JSON es ~2 MB, growth potencial en el futuro.
  return execSync(`git show ${hash}:"${path}"`, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

// ---- Main ----
function main() {
  const args = parseArgs(process.argv)
  const dataPath = 'public/data/stations.json'

  console.log(`Buscando commits de ${dataPath} (ultimos ${args.maxDays} dias)...`)
  const commits = listCommits(dataPath, args.maxDays)
  if (commits.length === 0) {
    console.error('No hay commits que toquen ' + dataPath + '. Nada que hacer.')
    process.exit(0)
  }
  console.log(`  ${commits.length} commits encontrados`)

  // Agrupa por dia (YYYY-MM-DD en UTC). Nos quedamos con el commit mas
  // reciente de cada dia — es el que representa el "cierre" de precios.
  const byDate = new Map()
  for (const c of commits) {
    const date = new Date(c.iso).toISOString().slice(0, 10)
    const prev = byDate.get(date)
    if (!prev || new Date(c.iso) > new Date(prev.iso)) {
      byDate.set(date, c)
    }
  }
  console.log(`  ${byDate.size} dias unicos`)

  // Procesar cada dia y acumular filas. Logueamos progreso cada 20 dias
  // para no asustar al usuario en runs largos.
  const dates = Array.from(byDate.keys()).sort()
  const allRows = []
  let processed = 0
  for (const date of dates) {
    const { hash } = byDate.get(date)
    try {
      const raw = showFile(hash, dataPath)
      const json = JSON.parse(raw)
      const rows = snapshotToRows(json, date)
      for (const r of rows) allRows.push(r)
      processed += 1
      if (processed % 20 === 0) {
        console.log(`  ${processed}/${dates.length} dias procesados (${allRows.length} filas)`)
      }
    } catch (err) {
      console.warn(`  [skip] ${date} ${hash.slice(0,7)}: ${err.message}`)
    }
  }
  console.log(`Total: ${allRows.length} filas de ${processed} dias`)

  if (allRows.length === 0) {
    console.error('Sin filas extraidas — el snapshot historico esta vacio o todos los JSON son invalidos')
    process.exit(1)
  }

  const outPath = resolve(ROOT, args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  const header = [
    '-- Auto-generado por scripts/backfill-d1.mjs',
    `-- Generado: ${new Date().toISOString()}`,
    `-- Filas: ${allRows.length}`,
    `-- Dias: ${processed}`,
    `-- Commits origen: ${commits.length}`,
    '-- Aplicar: npx wrangler d1 execute gasolineras-history --file=' + args.out + ' --remote',
    '',
  ].join('\n')
  const sql = buildInsertSql(allRows, 250)
  writeFileSync(outPath, header + sql + '\n', 'utf8')
  console.log(`SQL escrito: ${outPath}`)
  console.log(`\nAplicar con:\n  npx wrangler d1 execute gasolineras-history --file=${args.out} --remote`)
}

main()
