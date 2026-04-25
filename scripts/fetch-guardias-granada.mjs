#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de Granada capital desde el PDF
// publicado por COF Granada (cofgranada.com).
//
// El COF Granada NO expone listado HTML estructurado: para una fecha + localidad
// el AJAX `Farmacias_Guardia-Buscador.asp` devuelve un href a un PDF concreto
// (`Documentos/guardias/<NOMBRE-FECHA>.pdf`). Para Granada capital el PDF cubre
// el dia o el fin de semana completo segun el calendario del COF.
//
// Por que solo capital:
//   El COF tiene PDFs distintos por cada localidad (172 municipios) y muchos
//   son listados anuales/fijos por farmacia titular sin distincion diaria.
//   Cubrir provincia entera multiplicaria 172x el riesgo de fragilidad.
//   La capital concentra ~70% de la demanda urbana de farmacia de guardia.
//
// Fuente:
//   1) POST https://www.cofgranada.com/Paginas/Farmacias_Guardia-Buscador.asp
//      data: BuscadorFarmaciasLocalidad=Granada, BuscadorFarmaciasFechaBuscar=DD/MM/YYYY
//      → HTML con un <a href="MostrarDocumento.asp?Documento=<NAME.pdf>...">
//   2) GET .../Documentos/guardias/<NAME.pdf>
//      → PDF con bloques: Diurno (sabado y domingo) / Solo sabado / Solo domingo /
//        Nocturno. Cada farmacia: direccion + (info opcional) + TLF.: <numero>.
//
// CAVEAT — sin nombre titular:
//   El PDF solo expone direccion + telefono (no titular). Mostramos
//   "Farmacia de guardia" como descriptor.
//
// CAVEAT — dia laboral vs fin de semana:
//   El COF cambia el formato del PDF segun el dia. Si hoy es laborable y el
//   PDF no tiene seccion DIURNO valida, devolvemos lo que extraigamos del
//   nocturno o abortamos.
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
const CACHE_FILE = resolve(CACHE_DIR, 'granada-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-granada.json')

const BASE = 'https://www.cofgranada.com'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Granada (margen generoso).
const BBOX = { minLat: 36.6, maxLat: 38.0, minLng: -4.5, maxLng: -2.2 }

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

function fechaGranada(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

async function buscarPdf(fecha) {
  const url = `${BASE}/Paginas/Farmacias_Guardia-Buscador.asp`
  const body = new URLSearchParams({
    BuscadorFarmaciasLocalidad: 'Granada',
    BuscadorFarmaciasFechaBuscar: fecha,
    Ubicacion: 'Paginas',
    Pruebas: 'no',
  }).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE}/Paginas/Farmacias_Guardia.asp`,
    },
    body,
  })
  if (!res.ok) throw new Error(`Buscador HTTP ${res.status}`)
  const html = await res.text()
  // Buscar todos los hrefs a MostrarDocumento.asp y quedarnos con el PDF
  // que tenga el nombre mas descriptivo (no vacio).
  const matches = [...html.matchAll(/MostrarDocumento\.asp\?Documento=([^&"]+)/gi)]
  const pdfs = []
  for (const m of matches) {
    const name = decodeURIComponent(m[1].replace(/\+/g, ' '))
    if (name && name.toLowerCase().endsWith('.pdf')) pdfs.push(name)
  }
  if (pdfs.length === 0) throw new Error('Buscador no devolvio PDFs')
  return pdfs[0] // El primer PDF es siempre el "actual" segun el orden del COF.
}

async function fetchPdf(name) {
  const url = `${BASE}/Documentos/guardias/${encodeURI(name)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Referer': `${BASE}/Paginas/Farmacias_Guardia.asp` },
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

async function geocode(direccion) {
  // Limpieza progresiva: original → sin parentesis → primera coma → calle base.
  const variants = []
  variants.push(direccion)
  const sinParens = direccion.replace(/\s*\([^)]*\)/g, '').trim()
  if (sinParens && sinParens !== direccion) variants.push(sinParens)
  const primeraComa = sinParens.split(',').slice(0, 2).join(',').trim()
  if (primeraComa && !variants.includes(primeraComa)) variants.push(primeraComa)
  for (const v of variants) {
    const coord = await geocodeOne(`${v}, Granada, España`)
    if (coord) return coord
    await new Promise(r => setTimeout(r, 1100))
  }
  return null
}

// Parsea el texto plano del PDF buscando bloques: encabezado de seccion +
// secuencia de farmacias (direccion + tlf). Cada farmacia ocupa 1-2 lineas.
// Heuristica: el TLF es la ancla. La "direccion real" es la primera linea
// previa que no sea info entre parentesis ni separador. Las (info) en la
// misma linea del TLF o una linea atras se ignoran como direccion principal.
function parsePdf(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const out = []
  let seccion = ''
  const teleRe = /TLF\.?:?\s*(\d[\d\s]+)/i
  // Una direccion "valida" empieza con letra mayuscula o numero/abreviatura
  // (CALLE, AVDA, CTRA, PLAZA, REYES, GRAN VIA...). Excluimos lineas que
  // empiecen con parentesis (info) o que sean separadores.
  const isDireccion = (s) => {
    if (!s) return false
    if (/^\(/.test(s)) return false
    if (/^-+/.test(s)) return false
    if (/^SOLO\s+/i.test(s)) return false
    if (/^SERVICIO\s+/i.test(s)) return false
    if (/^SÁBADO|^DOMINGO/i.test(s)) return false
    return true
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/SERVICIO\s+DE\s+URGENCIA\s+DIURNO/i.test(l)) { seccion = 'Diurna 9:30-22:00'; continue }
    if (/SERVICIO\s+DE\s+URGENCIA\s+NOCTURNO/i.test(l)) { seccion = 'Nocturna 22:00-9:30'; continue }
    if (!seccion) continue
    const tel = l.match(teleRe)
    if (!tel) continue
    // Buscar la direccion: prefijo de la linea actual hasta TLF si ese
    // prefijo es una direccion valida (no empieza con paréntesis); si no,
    // retroceder hasta la primera linea que sea direccion valida.
    const idxTel = l.search(teleRe)
    let direccion = l.slice(0, idxTel).trim().replace(/[.,]\s*$/, '')
    if (!isDireccion(direccion)) {
      direccion = ''
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const cand = lines[j].trim().replace(/[.,]\s*$/, '')
        if (isDireccion(cand)) { direccion = cand; break }
      }
    }
    if (!direccion) continue
    out.push({
      direccion,
      telefono: tel[1].replace(/\s+/g, ''),
      horario: seccion,
    })
  }
  // Dedup por (direccion + telefono).
  const seen = new Set()
  const dedupe = []
  for (const f of out) {
    const k = `${f.direccion.toLowerCase()}|${f.telefono}`
    if (seen.has(k)) {
      const prev = dedupe.find(x => `${x.direccion.toLowerCase()}|${x.telefono}` === k)
      if (prev && !prev.horario.includes(f.horario.split(' ')[0])) {
        prev.horario += ` y ${f.horario.toLowerCase()}`
      }
      continue
    }
    seen.add(k)
    dedupe.push(f)
  }
  return dedupe
}

async function main() {
  const fecha = fechaGranada()
  console.log(`Descargando guardias Granada (${fecha}) — cofgranada.com...`)
  const pdfName = await buscarPdf(fecha)
  console.log(`  PDF encontrado: ${pdfName}`)
  const data = await fetchPdf(pdfName)
  const parser = new PDFParse({ data })
  const r = await parser.getText()
  const farmacias = parsePdf(r.text)
  console.log(`  ${farmacias.length} farmacias detectadas`)
  if (farmacias.length < 3) throw new Error(`Solo ${farmacias.length} farmacias. Parser fallido?`)
  if (farmacias.length > 80) throw new Error(`Sospechoso: ${farmacias.length} farmacias.`)

  // Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  let descartadas = 0
  for (const f of farmacias) {
    if (cache[f.direccion]) {
      f.coord = cache[f.direccion]
      continue
    }
    process.stdout.write(`    geocoding "${f.direccion.slice(0, 40)}"... `)
    const coord = await geocode(f.direccion)
    if (coord) {
      cache[f.direccion] = coord
      f.coord = coord
      nuevas++
      console.log(`OK ${coord[0]},${coord[1]}`)
    } else {
      descartadas++
      console.log('FAIL')
    }
    await new Promise(r => setTimeout(r, 1100))
  }
  if (nuevas > 0) saveCache(cache)
  if (descartadas > 0) console.log(`  ${descartadas} sin coord`)

  const guardias = []
  for (const f of farmacias) {
    if (!f.coord) continue
    guardias.push([
      f.coord[0],
      f.coord[1],
      `Farmacia de guardia · ${titleCase(f.direccion)}`.slice(0, 140),
      'Granada',
      f.telefono,
      '',
      f.horario,
      '',
    ])
  }

  if (guardias.length < 1) throw new Error('Cero con coord. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'cofgranada.com',
    territorio: 'granada',
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
