#!/usr/bin/env node
// v1.41 — Descarga las farmacias de guardia de Palencia capital desde el PDF
// semanal publicado por COF Palencia (cofpalencia.org).
//
// El COF Palencia publica un PDF semanal por zona. Para Palencia capital cada
// PDF cubre una semana ("PALENCIA (del 20 al 26 de Abril)") con tabla diaria
// de 3 farmacias (diurna 10-22, otra diurna, nocturna 22-10).
//
// Por que solo capital:
//   La provincia tiene ~16 zonas rurales con calendario propio. La capital
//   concentra la mayor parte de la demanda. Cubrir el resto requiere parser
//   distinto por zona — fuera de scope MVP.
//
// Fuente:
//   1) GET https://www.cofpalencia.org/PUBLICO/CALENDARIOS%20DE%20GUARDIA/menu_calendarios_guardia.htm
//      → HTML con anchors PALENCIA (del N al M de MES) → calendarios%20de%20guardias%20<N>.pdf
//   2) GET .../calendarios%20de%20guardias%20<N>.pdf
//      → PDF tabular: dia | diurna 1 | diurna 2 | nocturna. Cada celda
//        nombre + direccion + (info opcional).
//
// CAVEAT — IDs PDF cambian cada semana:
//   El COF rotates IDs (23.pdf vs 25.pdf). Hay que parsear el HTML del menu
//   para encontrar el PDF que cubre la fecha actual.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'palencia-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-palencia.json')

const BASE = 'https://www.cofpalencia.org/PUBLICO/CALENDARIOS%20DE%20GUARDIA'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.41 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Palencia (margen generoso).
const BBOX = { minLat: 41.6, maxLat: 43.1, minLng: -5.2, maxLng: -3.6 }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_SEM = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) } catch { return {} }
}
function saveCache(c) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(c, null, 2))
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

// Encuentra el PDF de Palencia capital cuya semana cubre la fecha indicada.
async function buscarPdfCapital(d = new Date()) {
  const url = `${BASE}/menu_calendarios_guardia.htm`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Menu HTTP ${res.status}`)
  const html = await res.text()
  // Anchors tipo: <a href="calendarios%20de%20guardias%2025.pdf">PALENCIA (del 20 al 26 de Abril)
  const re = /<a\s+href="(calendarios%20de%20guardias%20\d+\.pdf)"[^>]*>\s*PALENCIA\s*([\s\S]*?)<\/a>/gi
  const semanas = []
  let m
  while ((m = re.exec(html)) !== null) {
    const href = m[1]
    const txt = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // Esperamos algo como "(del 20 al 26 de Abril)"
    const mm = txt.match(/del\s+(\d{1,2})(?:\s+de\s+(\w+))?\s+al\s+(\d{1,2})\s+de\s+(\w+)/i)
    if (!mm) continue
    const dIni = parseInt(mm[1], 10)
    const mesIni = (mm[2] || mm[4]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const dFin = parseInt(mm[3], 10)
    const mesFin = mm[4].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const idxMesIni = MESES.indexOf(mesIni)
    const idxMesFin = MESES.indexOf(mesFin)
    if (idxMesIni < 0 || idxMesFin < 0) continue
    semanas.push({ href, dIni, idxMesIni, dFin, idxMesFin })
  }
  if (semanas.length === 0) throw new Error('No se detectaron semanas de Palencia capital')
  // Encontrar la semana que cubre hoy.
  const day = d.getDate()
  const month = d.getMonth()
  const year = d.getFullYear()
  for (const s of semanas) {
    const ini = new Date(year, s.idxMesIni, s.dIni)
    let fin = new Date(year, s.idxMesFin, s.dFin)
    // Si fin < ini, la semana cruza año (no deberia pasar dentro de un PDF mensual).
    if (fin < ini) fin = new Date(year + 1, s.idxMesFin, s.dFin)
    const today = new Date(year, month, day)
    if (today >= ini && today <= fin) return s.href
  }
  // Fallback: la primera (mas vieja) semana publicada.
  return semanas[0].href
}

async function fetchPdf(href) {
  const url = `${BASE}/${href}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

async function geocodeOne(q) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (!isFinite(lat) || !isFinite(lng)) return null
    if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
    if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
    return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
  } catch { return null }
}

async function geocode(direccion) {
  const variants = [direccion]
  const sinParens = direccion.replace(/\s*\([^)]*\)/g, '').trim()
  if (sinParens && sinParens !== direccion) variants.push(sinParens)
  const primeraComa = sinParens.split(',').slice(0, 2).join(',').trim()
  if (primeraComa && !variants.includes(primeraComa)) variants.push(primeraComa)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, Palencia, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  return null
}

async function main() {
  console.log(`Descargando guardias Palencia capital — cofpalencia.org...`)
  const href = await buscarPdfCapital()
  console.log(`  PDF semanal: ${href}`)
  const data = await fetchPdf(href)
  const parser = new PDFParse({ data })
  const r = await parser.getText()

  // El target es el dia (LUNES 20) sin 'DE ABRIL' porque el PDF lo separa
  // en lineas (LUNES / 20 de ABRIL). Buscamos las lineas en orden cercano.
  const target1 = `${DIAS_SEM[new Date().getDay()]}`
  const target2 = `${new Date().getDate()} de ${MESES[new Date().getMonth()].toUpperCase()}`
  console.log(`  Buscando dia: ${target1} + ${target2}`)
  const lines = r.text.split('\n').map(l => l.trim()).filter(Boolean)
  // Buscar el dia que tenga ambas etiquetas en proximidad (idx y idx+1 o +2).
  let idxDia = -1
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i].toUpperCase() === target1 ||
        lines[i].toUpperCase().startsWith(target1 + ' ')) {
      // Confirmar que la siguiente linea o linea+1 contiene la fecha.
      const next2 = (lines[i + 1] + ' ' + (lines[i + 2] || '')).toUpperCase()
      if (next2.includes(target2.toUpperCase()) ||
          next2.includes(`${new Date().getDate()} DE ${MESES[new Date().getMonth()].toUpperCase()}`)) {
        idxDia = i
        break
      }
    }
  }
  if (idxDia === -1) throw new Error(`No encontrado el dia ${target1} ${target2} en el PDF`)
  // Bloque del dia: hasta la siguiente cabecera de dia o fin.
  let stopIdx = lines.length
  for (let i = idxDia + 3; i < lines.length; i++) {
    if (DIAS_SEM.includes(lines[i].toUpperCase())) { stopIdx = i; break }
  }
  const block = lines.slice(idxDia, stopIdx)
  console.log(`  Bloque dia: ${block.length} lineas`)

  // Extraer farmacias del bloque. Un bloque tipico tiene:
  //   LUNES / 20 de / ABRIL / <nombre1> / <nombre1-cont?> / <dir1> / (info1?) /
  //                          / <nombre2> / <dir2> / (info2?) / <nombre3> / <dir3> / (info3?)
  // Heuristica: una "farmacia" empieza con una linea de texto sin numeros que
  // no es DIA ni MES, y termina cuando aparece una linea con numero/dir.
  const farmacias = []
  let cur = { nombre: '', direccion: '', info: '' }
  for (let i = 3; i < block.length; i++) {
    const l = block[i]
    const tieneNumero = /\d/.test(l)
    const esParens = /^\(/.test(l)
    if (esParens) {
      cur.info = (cur.info ? cur.info + ' ' : '') + l
      continue
    }
    if (!tieneNumero && !esParens) {
      // Linea de nombre. Si ya tenemos farmacia con direccion, push.
      if (cur.direccion) {
        farmacias.push(cur)
        cur = { nombre: '', direccion: '', info: '' }
      }
      cur.nombre = (cur.nombre ? cur.nombre + ' ' : '') + l
      continue
    }
    // Linea con numero → es direccion (o continuacion de direccion).
    if (!cur.direccion) {
      cur.direccion = l
    } else {
      cur.direccion += ' ' + l
    }
  }
  if (cur.direccion) farmacias.push(cur)

  console.log(`  ${farmacias.length} farmacias detectadas`)
  if (farmacias.length === 0) throw new Error('Cero farmacias en el bloque diario')
  if (farmacias.length > 6) throw new Error(`Sospechoso: ${farmacias.length} farmacias en un dia`)

  const horarios = ['Diurna 10:00-22:00 (turno 1)', 'Diurna 10:00-22:00 (turno 2)', 'Nocturna 22:00-10:00']

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (let i = 0; i < farmacias.length; i++) {
    const f = farmacias[i]
    f.horario = horarios[i] || 'De guardia'
    const dirKey = f.direccion
    if (cache[dirKey]) {
      f.coord = cache[dirKey]
      continue
    }
    process.stdout.write(`    geocoding "${dirKey.slice(0, 40)}"... `)
    const coord = await geocode(f.direccion)
    if (coord) {
      cache[dirKey] = coord
      f.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      console.log('FAIL')
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (nuevas > 0) saveCache(cache)

  const guardias = []
  for (const f of farmacias) {
    if (!f.coord) continue
    const nom = f.nombre.trim() ? `Farmacia ${titleCase(f.nombre)}` : 'Farmacia de guardia'
    guardias.push([
      f.coord[0],
      f.coord[1],
      `${nom} · ${titleCase(f.direccion)}`.slice(0, 140),
      'Palencia',
      '',
      '',
      f.horario,
      f.info ? f.info.replace(/[()]/g, '').slice(0, 80) : '',
    ])
  }

  if (guardias.length < 1) throw new Error('Cero con coord. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'cofpalencia.org',
    territorio: 'palencia',
    count: guardias.length,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardias guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
