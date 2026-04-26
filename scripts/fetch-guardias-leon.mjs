#!/usr/bin/env node
// v1.0 — Descarga la farmacia de guardia de La Bañeza (provincia de León)
// desde el PDF publicado por la Policía Local del Ayuntamiento.
//
// Cobertura: SOLO La Bañeza (~10k hab). El COF León (cofleon.es) tiene
// backend SOAP caído desde 2025 sin alternativa pública para León capital
// ni Ponferrada — esta es la unica fuente verificada para la provincia.
//
// Formato del PDF (https://www.aytobaneza.es/.../FarmaciasGuardia.pdf):
//   Bloque 1: lista de 5 farmacias A..E con nombre, dirección y teléfono.
//   Bloque 2: 12 mini-calendarios (uno por mes), cada celda "X N" donde
//             X es la letra de la farmacia y N el día del mes.
//
// Schema output:
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_FILE = resolve(CACHE_DIR, 'leon-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-leon.json')

const PDF_URL = 'https://www.aytobaneza.es/export/sites/aytobaneza/galerias/descargas/policia/FarmaciasGuardia.pdf'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.0 (+https://webapp-3ft.pages.dev)'

const BBOX = { minLat: 42.0, maxLat: 43.5, minLng: -7.5, maxLng: -4.5 }
const MUNICIPIO = 'La Bañeza'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

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

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

async function fetchPdf() {
  const res = await fetch(PDF_URL, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' })
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// Extrae la tabla de 5 farmacias A..E del texto del PDF.
function parseFarmacias(text) {
  // El PDF tiene 2 secciones de farmacias: una "decorada" con caracteres
  // entre cada letra y otra version limpia. Buscamos la limpia con regex.
  const farms = {}
  const re = /^([A-E])\)\s*(Lcd[oa]\.\s*[^\n]+?)\s*\n\s*Direcci[óo]n:\s*([^\n]+?)\s*\n\s*Tfno\.:?\s*([\d\s]+)$/gim
  for (const m of text.matchAll(re)) {
    const [, letra, nombre, direccion, tel] = m
    farms[letra] = {
      nombre: nombre.trim(),
      direccion: direccion.trim(),
      telefono: tel.replace(/\s+/g, '').trim(),
    }
  }
  return farms
}

// Encuentra la letra de la farmacia de guardia en la fecha indicada.
// Estrategia: localizar el bloque del mes y buscar "<LETRA> <DIA>".
function parseFechaGuardia(text, today) {
  const mesActual = MESES[today.getMonth()]
  const dia = today.getDate()
  // Localizar inicio del bloque: "<Mes> 2026" o "<Mes>"
  const reMes = new RegExp(`${mesActual}\\s+${today.getFullYear()}\\b`, 'i')
  const idxIni = text.search(reMes)
  if (idxIni < 0) {
    // Fallback: buscar solo nombre del mes (puede aparecer separado del año).
    const idx2 = text.toLowerCase().indexOf(mesActual.toLowerCase())
    if (idx2 < 0) return null
    return buscarLetraDia(text.slice(idx2, idx2 + 1500), dia)
  }
  // Limitar al siguiente mes para no leer del bloque siguiente.
  const reSiguiente = new RegExp(`(?:${MESES.join('|')})\\s+${today.getFullYear()}`, 'gi')
  const matches = [...text.matchAll(reSiguiente)]
  let idxFin = text.length
  for (const m of matches) {
    if (m.index > idxIni) { idxFin = m.index; break }
  }
  const bloque = text.slice(idxIni, idxFin)
  return buscarLetraDia(bloque, dia)
}

function buscarLetraDia(texto, dia) {
  // Formato: "A 25" "A 25\t" "A 25\n". Asegurar palabra completa para el dia.
  const re = new RegExp(`\\b([A-E])\\s+${dia}\\b`, 'g')
  for (const m of texto.matchAll(re)) {
    return m[1]
  }
  return null
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
  // Quitar "C/" prefix para mejor match.
  const sinPrefijo = direccion.replace(/^C\/\s*/i, '').trim()
  if (sinPrefijo !== direccion) variants.push(sinPrefijo)
  // Sin numero al final (e.g. "C/ Astorga, 4" → "Astorga").
  const sinNum = sinPrefijo.replace(/,?\s*\d+\s*$/, '').trim()
  if (sinNum && !variants.includes(sinNum)) variants.push(sinNum)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, ${MUNICIPIO}, León, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  return null
}

async function main() {
  const today = new Date()
  console.log(`Descargando guardia La Bañeza — aytobaneza.es...`)

  const data = await fetchPdf()
  const parser = new PDFParse({ data })
  const r = await parser.getText()
  const text = r.text

  const farmacias = parseFarmacias(text)
  if (Object.keys(farmacias).length === 0) {
    throw new Error('No se detectaron farmacias en el PDF')
  }
  console.log(`Farmacias detectadas: ${Object.keys(farmacias).join(', ')}`)

  const letra = parseFechaGuardia(text, today)
  if (!letra) {
    throw new Error(`No se encontró guardia para ${today.toISOString().slice(0, 10)}`)
  }
  const f = farmacias[letra]
  if (!f) throw new Error(`Letra ${letra} no tiene farmacia asociada`)
  console.log(`Hoy guardia: ${letra} = ${f.nombre} · ${f.direccion}`)

  // Geocodificar.
  const cache = loadCache()
  const key = `${f.direccion} | ${MUNICIPIO}`
  let coord = cache[key]
  if (!coord) {
    coord = await geocode(f.direccion)
    if (coord) {
      cache[key] = coord
      saveCache(cache)
    }
  }
  if (!coord) throw new Error(`Geocoding falló para ${f.direccion}`)

  const nombreLimpio = f.nombre.replace(/^Lcd[oa]\.\s+/i, '').trim()
  const guardias = [[
    coord[0],
    coord[1],
    `Farmacia ${titleCase(nombreLimpio)} · ${titleCase(f.direccion)}`.slice(0, 140),
    MUNICIPIO,
    f.telefono,
    '',
    'Diurna+Nocturna 9:00-9:00',
    '',
  ]]

  const out = {
    ts: new Date().toISOString(),
    source: 'aytobaneza.es',
    territorio: 'leon',
    count: guardias.length,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardia guardada en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
