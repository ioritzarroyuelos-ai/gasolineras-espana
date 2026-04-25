#!/usr/bin/env node
// v1.50 — Descarga las farmacias de guardia de la PROVINCIA de Jaén desde
// los PDFs publicados por COF Jaén (farmaceuticosdejaen.es).
//
// El COF tiene un buscador donde se selecciona idPoblacion (118 valores) y
// devuelve los PDFs disponibles. Los municipios grandes tienen PDF dedicado;
// los pequeños comparten PDF zonal.
//
// Por ahora cubrimos los municipios grandes (capital + Linares, Úbeda, Baeza,
// Andújar, Martos, Alcalá la Real). Con esto cubrimos > 50% de la población
// de la provincia.
//
// Formatos de PDF detectados:
//   1) Jaén capital — bloques "@@@<num>@@@<dia>@@@@@@" + 5 farmacias por dia.
//   2) Andújar — "<num> <dia> <nombre>\t<direccion>".
//   3) Baeza/Úbeda — "<DD/MM/YYYY> <dia> <nombre>\t<direccion>[-tel]".
//   4) Linares — formato complejo con horarios (8:30/9:00/9:30) — fuera de
//      scope.
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
const CACHE_FILE = resolve(CACHE_DIR, 'jaen-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-jaen.json')

const BASE = 'https://www.farmaceuticosdejaen.es'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.50 (+https://webapp-3ft.pages.dev)'

const BBOX = { minLat: 37.3, maxLat: 38.7, minLng: -4.3, maxLng: -2.1 }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_SEM = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO']

// Municipios principales con su idPoblacion. Los pequeños se ignoran porque
// comparten PDF zonal o no tienen PDF.
//
// Martos y Alcalá la Real publican PDF en formato matriz calendario
// (rotación semanal con tabla de 7 columnas) que no es parseable con
// regex línea-a-línea. Se omiten hasta tener parser de calendario.
const MUNICIPIOS = [
  { id: 46, nombre: 'Jaén',          formato: 'CAPITAL'  },
  { id: 6,  nombre: 'Andújar',       formato: 'ANDUJAR'  },
  { id: 10, nombre: 'Baeza',         formato: 'BAEZA'    },
  { id: 82, nombre: 'Úbeda',         formato: 'BAEZA'    },
]

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

// Buscador: POST con idPoblacion → HTML con anchors a PDFs.
async function buscarPdfs(idPoblacion) {
  const body = new URLSearchParams({ formBuscar: 'si', idPoblacion: String(idPoblacion), Buscar: 'Buscar' }).toString()
  const res = await fetch(`${BASE}/paginas/Farmacias_Guardia.asp`, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE}/paginas/farmacias_guardia.asp`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Buscador HTTP ${res.status}`)
  const html = await res.text()
  const re = /MostrarDocumento\.asp\?Documento=([^&"]+)&Tipo=Guardias/g
  return [...html.matchAll(re)].map(m => m[1])
}

// Para municipios capital/Andújar: PDF mensual → buscar el del mes actual.
function elegirPdfMensual(docs, d) {
  const mes = MESES[d.getMonth()].toUpperCase()
  const year = d.getFullYear()
  const target = docs.find(doc => doc.toUpperCase().includes(mes) && doc.includes(String(year)))
  if (target) return target
  // Fallback: el mas reciente del año (excluyendo BORRADOR).
  const conYear = docs.filter(doc => doc.includes(String(year)) && !/BORRADOR/i.test(doc))
  return conYear[conYear.length - 1] || docs[0]
}

// Para Baeza/Úbeda/Martos/Alcalá: PDF anual unico — el primero que no sea BORRADOR.
function elegirPdfAnual(docs, d) {
  const year = d.getFullYear()
  const conYear = docs.filter(doc => doc.includes(String(year)) && !/BORRADOR/i.test(doc))
  if (conYear.length > 0) return conYear[0]
  return docs.find(d => !/BORRADOR/i.test(d)) || docs[0]
}

async function fetchPdf(filename) {
  const url = `${BASE}/paginas/MostrarDocumento.asp?Documento=${encodeURIComponent(filename)}&Tipo=Guardias`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Referer': `${BASE}/paginas/farmacias_guardia.asp` },
    redirect: 'follow',
  })
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

async function geocode(direccion, municipio) {
  const variants = []
  const sinParens = direccion.replace(/\s*\([^)]*\)/g, '').trim()
  const sinTel = sinParens.replace(/[-\s]+\d{9}\s*$/, '').replace(/\s+/g, ' ').trim()
  if (sinTel) variants.push(sinTel)
  if (sinParens && !variants.includes(sinParens)) variants.push(sinParens)
  // Quitar "nº" y números para mejor match de Nominatim.
  const sinN = sinTel.replace(/\bnº\s*/gi, '').trim()
  if (sinN && !variants.includes(sinN)) variants.push(sinN)
  // Quitar S/N y todo lo que sigue (e.g., "S/N – Edf. Virgen de la Capilla").
  const sinSN = sinTel.replace(/,?\s*S\/N.*$/i, '').trim()
  if (sinSN && !variants.includes(sinSN)) variants.push(sinSN)
  // Sin numero al final (e.g., "C/JULIO BUREL Nº35" → "C/JULIO BUREL").
  const sinNum = sinTel.replace(/[,]?\s*nº?\s*\d+.*$/i, '').trim()
  if (sinNum && !variants.includes(sinNum)) variants.push(sinNum)
  // Apellido con doble L (BUREL → BURELL en Baeza es real).
  const dobleL = sinNum.replace(/L\b/g, 'LL')
  if (dobleL && dobleL !== sinNum && !variants.includes(dobleL)) variants.push(dobleL)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, ${municipio}, Jaén, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  return null
}

// Parser CAPITAL — bloques "@@@<num>@@@<dia>@@@" + 5 farmacias por dia.
function parsePdfCapital(text, target) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const items = lines[i].split('@@@').map(s => s.trim()).filter(Boolean)
    if (items.length < 2) continue
    const num = parseInt(items[0], 10)
    if (!Number.isFinite(num) || String(num) !== items[0]) continue
    if (num !== target) continue
    if (!/^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(items[1])) continue
    const dirs = []
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      const next = lines[j].split('@@@').map(s => s.trim()).filter(Boolean)
      if (next.length >= 2 && /^\d{1,2}$/.test(next[0]) &&
          /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)$/i.test(next[1])) {
        break
      }
      for (const it of next) {
        if (it.length > 5 && /[a-zA-Záéíóúñ]/.test(it)) dirs.push(it)
      }
      if (dirs.length >= 5) break
    }
    return dirs.slice(0, 5).map((direccion, k) => ({
      nombre: '',
      direccion,
      horario: k < 3 ? 'Diurna 9:30-22:00' : 'Nocturna 22:00-9:30',
    }))
  }
  return []
}

// Parser ANDUJAR — "<num> <dia> <nombre>\t<direccion>".
function parsePdfAndujar(text, target) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  // Ej: "25 Sábado D. Fernando Romero \tPlaza Vieja"
  // pdf-parse a veces convierte tab en espacios — buscar primer numero seguido
  // de dia.
  const re = /^(\d{1,2})\s+(Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo)\s+(.+)$/i
  for (const l of lines) {
    const m = l.match(re)
    if (!m) continue
    const num = parseInt(m[1], 10)
    if (num !== target) continue
    const resto = m[3]
    // Resto: "<nombre>\t<direccion>" o "<nombre> | <direccion>".
    // Heuristica: el nombre suele ser corto (1-4 palabras) y la direccion
    // contiene calle/avenida/plaza/numero. Separar por dos o mas espacios
    // (que tipicamente representan una tabulacion en PDF).
    const partes = resto.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean)
    if (partes.length >= 2) {
      return [{ nombre: partes[0], direccion: partes.slice(1).join(' ').trim(), horario: 'De guardia' }]
    }
    // Fallback: parsear "<NOMBRE> <CALLE/AVDA/PZ ...>"
    const mD = resto.match(/^(.+?)\s+(C\/|Calle|Avda?\.?|Av\.?|Pza?\.?|Plaza|Pº|Paseo|P\.?\s*Mayor|Pol\.|Carretera|Ctra\.?)\s*(.+)$/i)
    if (mD) {
      return [{ nombre: mD[1].trim(), direccion: (mD[2] + ' ' + mD[3]).trim(), horario: 'De guardia' }]
    }
    return [{ nombre: '', direccion: resto.trim(), horario: 'De guardia' }]
  }
  return []
}

// Parser BAEZA/UBEDA/MARTOS — "<DD/MM/YYYY> <dia> <nombre>\t<direccion>[-tel]".
function parsePdfBaeza(text, today) {
  const targetStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  // Tambien: "JUEVES 01/01/2026 NOMBRE DIR-tel" (el dia primero, luego fecha) — Ubeda.
  const reFechaPrim = /^(\d{2}\/\d{2}\/\d{4})\s+([A-ZÁÉÍÓÚÑ\u00C0-\u017F]+)\s+(.+)$/i
  const reDiaPrim   = /^([A-ZÁÉÍÓÚÑ\u00C0-\u017F]+)\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/i
  for (const l of lines) {
    const m1 = l.match(reFechaPrim)
    const m2 = l.match(reDiaPrim)
    let fecha, resto
    if (m1 && m1[1] === targetStr) {
      fecha = m1[1]
      resto = m1[3]
    } else if (m2 && m2[2] === targetStr) {
      fecha = m2[2]
      resto = m2[3]
    } else {
      continue
    }
    // resto: "<NOMBRE> <DIRECCION>[-TELEFONO]". Separar por tabs o 2+ espacios.
    const partes = resto.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean)
    if (partes.length >= 2) {
      return [{ nombre: partes[0], direccion: partes.slice(1).join(' ').trim(), horario: 'De guardia' }]
    }
    // Fallback: heuristica calle/avenida.
    const mD = resto.match(/^(.+?)\s+(C\/|Calle|Avda?\.?|Av\.?|Pza?\.?|Plaza|Pº|Paseo|Pol\.|Carretera|Ctra\.?)\s*(.+)$/i)
    if (mD) {
      return [{ nombre: mD[1].trim(), direccion: (mD[2] + ' ' + mD[3]).trim(), horario: 'De guardia' }]
    }
    return [{ nombre: '', direccion: resto.trim(), horario: 'De guardia' }]
  }
  return []
}

function extraerTelefono(direccion) {
  const m = direccion.match(/[-\s](\d{9})\s*$/)
  if (m) return m[1]
  return ''
}

function limpiarDireccion(direccion) {
  return direccion
    .replace(/[-\s]+\d{9}\s*$/, '')   // tel al final
    .replace(/\s+/g, ' ')
    .trim()
}

async function procesarMunicipio(mun, today) {
  console.log(`  ${mun.nombre} (id=${mun.id})`)
  const docs = await buscarPdfs(mun.id)
  if (docs.length === 0) {
    console.log(`    sin documentos`)
    return []
  }
  const filename = mun.formato === 'ANDUJAR' || mun.formato === 'CAPITAL'
    ? elegirPdfMensual(docs, today)
    : elegirPdfAnual(docs, today)
  console.log(`    PDF: ${filename}`)
  const data = await fetchPdf(filename)
  const parser = new PDFParse({ data })
  const opts = mun.formato === 'CAPITAL' ? { itemJoiner: '@@@' } : {}
  const r = await parser.getText(opts)
  let farms = []
  if (mun.formato === 'CAPITAL') farms = parsePdfCapital(r.text, today.getDate())
  else if (mun.formato === 'ANDUJAR') farms = parsePdfAndujar(r.text, today.getDate())
  else farms = parsePdfBaeza(r.text, today)
  console.log(`    ${farms.length} farmacias dia ${today.getDate()}`)
  return farms.map(f => ({ ...f, municipio: mun.nombre }))
}

async function main() {
  const today = new Date()
  console.log(`Descargando guardias provincia Jaén — farmaceuticosdejaen.es...`)

  const farmaciasAll = []
  for (const mun of MUNICIPIOS) {
    try {
      const farms = await procesarMunicipio(mun, today)
      farmaciasAll.push(...farms)
    } catch (e) {
      console.log(`    FAIL: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`Total farmacias detectadas: ${farmaciasAll.length}`)
  if (farmaciasAll.length < 3) throw new Error(`Solo ${farmaciasAll.length} farmacias. Parser fallido?`)

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (const f of farmaciasAll) {
    const dirLimpia = limpiarDireccion(f.direccion)
    const key = `${dirLimpia} | ${f.municipio}`
    if (cache[key]) {
      f.coord = cache[key]
      continue
    }
    process.stdout.write(`    geocoding "${dirLimpia.slice(0, 35)}" en ${f.municipio}... `)
    const coord = await geocode(dirLimpia, f.municipio)
    if (coord) {
      cache[key] = coord
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
  const seen = new Set()
  for (const f of farmaciasAll) {
    if (!f.coord) continue
    const dirLimpia = limpiarDireccion(f.direccion)
    const tel = extraerTelefono(f.direccion)
    const k = `${normalize(dirLimpia)}|${normalize(f.municipio)}`
    if (seen.has(k)) continue
    seen.add(k)
    const nom = f.nombre.trim() ? `Farmacia ${titleCase(f.nombre.replace(/^FARMACIA\s+/i, ''))}` : 'Farmacia de guardia'
    guardias.push([
      f.coord[0],
      f.coord[1],
      `${nom} · ${titleCase(dirLimpia)}`.slice(0, 140),
      f.municipio,
      tel,
      '',
      f.horario || 'De guardia',
      '',
    ])
  }

  if (guardias.length < 1) throw new Error('Cero con coord. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'farmaceuticosdejaen.es',
    territorio: 'jaen',
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
