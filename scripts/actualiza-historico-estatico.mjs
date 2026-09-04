#!/usr/bin/env node
// ============================================================
// actualiza-historico-estatico.mjs — anade dias a public/data/history/.
// ============================================================
// Dos modos:
//
//   1) Foto actual (lo que corre el bot tras fetch-prices.mjs):
//        node scripts/actualiza-historico-estatico.mjs [--fecha YYYY-MM-DD]
//      Aplica public/data/stations.json con la fecha de hoy (UTC). Las dos
//      fotos del dia (07:00 y 19:00 UTC) se aplican las dos: la segunda
//      sustituye a la primera, como INSERT OR REPLACE en D1.
//
//   2) Relleno desde el archivo del Ministerio (una vez, o para tapar huecos):
//        node scripts/actualiza-historico-estatico.mjs --desde 2026-04-26 --hasta 2026-09-03 [--delay 1500]
//      Descarga cada dia de /EstacionesTerrestresHist/dd-mm-yyyy y lo aplica en
//      orden. Un dia sin datos se salta (el Worker rehidrata propagando el
//      ultimo precio, asi que no deja hueco visible).
//
// En ambos modos todo se calcula en memoria y los ficheros se escriben al final:
// si algo falla a mitad, en disco queda lo anterior intacto. Un fallo termina
// con exit 1 y el workflow restaura public/data/history con git antes de
// commitear la foto de precios.
//
// La logica vive en scripts/lib/historico-estatico.mjs (puro, con tests); aqui
// solo hay fichero y red.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { aplicaSnapshot, construyeIndex } from './lib/historico-estatico.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const HIST_DIR = join(DATA_DIR, 'history')
const MEDIAN_DIR = join(HIST_DIR, 'median')
const NACIONAL_PATH = join(HIST_DIR, 'national.json')
const BASE = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'

// Una foto normal trae ~33.000 precios (11.000 gasolineras x 3 combustibles de
// media). Por debajo de esto la descarga vino truncada y NO debe entrar en el
// historico: cambiaria la mediana provincial y la media nacional de ese dia.
const MIN_FILAS = 20000

function parseArgs(argv) {
  const args = { fecha: null, desde: null, hasta: null, delay: 1500 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--fecha' && argv[i + 1]) { args.fecha = argv[++i]; continue }
    if (a === '--desde' && argv[i + 1]) { args.desde = argv[++i]; continue }
    if (a === '--hasta' && argv[i + 1]) { args.hasta = argv[++i]; continue }
    if (a === '--delay' && argv[i + 1]) { args.delay = parseInt(argv[++i], 10); continue }
    if (a === '-h' || a === '--help') {
      console.log('Uso: node scripts/actualiza-historico-estatico.mjs [--fecha YYYY-MM-DD] | [--desde YYYY-MM-DD --hasta YYYY-MM-DD] [--delay MS]')
      process.exit(0)
    }
    throw new Error('argumento desconocido: ' + a)
  }
  if ((args.desde && !args.hasta) || (!args.desde && args.hasta)) throw new Error('--desde y --hasta van juntos')
  return args
}

function hoyUtc() {
  return new Date().toISOString().slice(0, 10)
}

function leeJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

// Carga los ficheros existentes. Provincias y medianas van por nombre de
// fichero (01.json ... 52.json); index.json y national.json no son provincias.
function cargaEstado() {
  const provincias = new Map()
  const medianas = new Map()
  if (existsSync(HIST_DIR)) {
    for (const f of readdirSync(HIST_DIR)) {
      const m = /^(\d{2})\.json$/.exec(f)
      if (!m) continue
      provincias.set(m[1], leeJson(join(HIST_DIR, f)))
      const mp = join(MEDIAN_DIR, f)
      if (existsSync(mp)) medianas.set(m[1], leeJson(mp))
    }
  }
  const nacional = existsSync(NACIONAL_PATH) ? leeJson(NACIONAL_PATH) : null
  return { provincias, medianas, nacional }
}

function escribeEstado(estado, ahora) {
  mkdirSync(MEDIAN_DIR, { recursive: true })
  let bytes = 0
  for (const [prov, fichero] of estado.provincias) {
    const s = JSON.stringify(fichero)
    writeFileSync(join(HIST_DIR, prov + '.json'), s)
    bytes += s.length
  }
  for (const [prov, fichero] of estado.medianas) {
    writeFileSync(join(MEDIAN_DIR, prov + '.json'), JSON.stringify(fichero))
  }
  if (estado.nacional) writeFileSync(NACIONAL_PATH, JSON.stringify(estado.nacional))
  writeFileSync(join(HIST_DIR, 'index.json'), JSON.stringify(construyeIndex(estado, ahora), null, 2))
  return bytes
}

function aplica(estado, snapshot, fecha, ahora) {
  const { estado: nuevo, resumen } = aplicaSnapshot(estado, snapshot, fecha, ahora)
  if (resumen.filas < MIN_FILAS) {
    throw new Error(`la foto de ${fecha} solo trae ${resumen.filas} precios (minimo ${MIN_FILAS}); descarga truncada, no se aplica`)
  }
  return { estado: nuevo, resumen }
}

// ---- Modo 2: archivo del Ministerio ----
function aMinisterio(iso) {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

async function fetchHist(iso, intentos = 4) {
  const url = BASE + '/EstacionesTerrestresHist/' + aMinisterio(iso)
  let ultimo
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      if (!json.Fecha || !Array.isArray(json.ListaEESSPrecio) || json.ListaEESSPrecio.length === 0) return null
      return json
    } catch (e) {
      ultimo = e
      console.error(`  ${iso}: intento ${i}/${intentos} fallo (${e.message})`)
      if (i < intentos) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw ultimo
}

function* diasEntre(desde, hasta) {
  const d = new Date(desde + 'T00:00:00Z')
  const fin = new Date(hasta + 'T00:00:00Z')
  if (isNaN(d.getTime()) || isNaN(fin.getTime()) || d > fin) throw new Error('rango de fechas invalido')
  while (d <= fin) {
    yield d.toISOString().slice(0, 10)
    d.setUTCDate(d.getUTCDate() + 1)
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const ahora = new Date()
  let estado = cargaEstado()
  console.log(`Historico cargado: ${estado.provincias.size} provincias, ${estado.medianas.size} medianas, nacional ${estado.nacional ? 'hasta ' + estado.nacional.to : 'ausente'}`)
  const toAntes = construyeIndex(estado, ahora).to
  console.log(`  cubre hasta: ${toAntes || '(vacio)'}`)

  if (args.desde) {
    let aplicados = 0
    let vacios = 0
    for (const iso of diasEntre(args.desde, args.hasta)) {
      process.stdout.write(`[${iso}] `)
      const t0 = Date.now()
      const snap = await fetchHist(iso)
      if (!snap) { console.log('sin datos'); vacios++; continue }
      const r = aplica(estado, snap, iso, ahora)
      estado = r.estado
      aplicados++
      console.log(`${r.resumen.filas} precios, ${r.resumen.provincias} provincias (${Date.now() - t0} ms)`)
      await new Promise(r => setTimeout(r, args.delay))
    }
    console.log(`Aplicados ${aplicados} dias, ${vacios} sin datos.`)
  } else {
    const fecha = args.fecha || hoyUtc()
    const snap = leeJson(join(DATA_DIR, 'stations.json'))
    const r = aplica(estado, snap, fecha, ahora)
    estado = r.estado
    console.log(`[${fecha}] ${r.resumen.filas} precios, ${r.resumen.provincias} provincias (foto del Ministerio: ${snap.Fecha})`)
  }

  const bytes = escribeEstado(estado, ahora)
  const idx = construyeIndex(estado, ahora)
  console.log(`Escrito: ${idx.provinces.length} provincias (${(bytes / 1024 / 1024).toFixed(1)} MB), cubre ${idx.from} → ${idx.to}, nacional ${idx.nacional ? idx.nacional.from + ' → ' + idx.nacional.to : '-'}`)
}

main().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
