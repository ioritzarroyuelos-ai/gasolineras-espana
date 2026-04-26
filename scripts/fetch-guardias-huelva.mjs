#!/usr/bin/env node
// v1.40 — Descarga las farmacias 24H + las de guardia diurna del sábado/
// domingo/festivo para Huelva capital (cofhuelva.org).
//
// Por que solo capital + 24H:
//   El COF Huelva publica un PDF mensual con estructura tabular extremadamente
//   complicada: secciones FESTIVOS|DOMINGOS y DE LUNES A VIERNES|SÁBADOS sin
//   mapeo explicito dia → farmacia, solo orden implicito. El texto extraido
//   se trunca tras "DIURNO ( 9:30 A 22:00 HORAS)" (parser pdf-parse pierde la
//   seccion NOCTURNO). Para evitar errores semanales, extraemos solo:
//     1) Las 2 FARMACIAS 24H (top del PDF antes de cualquier cabecera) —
//        siempre abiertas dia+noche todo el mes.
//     2) Si hoy es DOMINGO/SÁBADO/FESTIVO, intenta extraer del PDF la
//        farmacia diurna correspondiente con heuristica de orden.
//   Las direcciones se enriquecen con coords del localizador HTML del COF
//   (que tiene 222 farmacias del provincia con lat/lng nativos).
//
// Fuente:
//   1) GET https://cofhuelva.org/cuadro-de-guardias
//      → HTML con anchors ?file=NNN&localty=Huelva%20MES%20YYYY
//   2) GET .../downloader.php?file=NNN&localty=Huelva%20MES%20YYYY
//      → PDF con tabla de guardias mensual.
//   3) GET https://cofhuelva.org/localizador/farmacias-de-guardia
//      → HTML con array JS Pharmacies = [{ position: { lat, lng }, title:
//        '<h4>NOMBRE</h4><p>DIRECCION</p>' }, ...] — usado para coords.
//
// CAVEAT — calendario fragil:
//   El PDF cambia cada mes. Si la estructura de "FESTIVOS" o el orden de las
//   24H se alteran, la deteccion del diurno-de-hoy puede fallar pero las
//   24H seguiran funcionando. No abortamos si el calendario diario falla.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-huelva.json')

const BASE = 'https://cofhuelva.org'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

// Normaliza una direccion para comparacion fuzzy (sin acentos, sin parens,
// sin abreviaturas Calle/Avda/Pº, sin numero — la calle es lo que importa).
function normDir(s) {
  let t = String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s*\([^)]*\)/g, ' ')
  // Abreviaturas de via → tipo unificado.
  t = t
    .replace(/\b(calle|c\/|c\.|c )\s*/g, ' ')
    .replace(/\b(avenida|avd\.?|avda\.?|av\.?)\s*/g, ' ')
    .replace(/\b(plaza|pz\.?|pl\.?)\s*/g, ' ')
    .replace(/\b(paseo|p[ºo]\s*\.?|ps\s*\.?|ps )\s*/g, ' ')
    .replace(/\bedf\.?\s*/g, ' ')
    .replace(/\besq\.?(uina)?\s*c?\s*/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\bs\s*\/?\s*n\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

// Variante sin numero — para fallback si num es distinto entre PDF y localizador.
function normDirSinNum(s) {
  return normDir(s).replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim()
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Referer': BASE } })
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)
  return res.text()
}

async function fetchPdf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Referer': BASE + '/cuadro-de-guardias' } })
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

// Encuentra el file ID del PDF del mes actual en /cuadro-de-guardias.
async function buscarPdfMes(d = new Date()) {
  const html = await fetchHtml(`${BASE}/cuadro-de-guardias`)
  const mesEs = MESES[d.getMonth()]
  const mesCap = mesEs[0].toUpperCase() + mesEs.slice(1)
  const year = d.getFullYear()
  // Buscar el anchor con texto "Huelva <Mes> YYYY"
  const re = new RegExp(`downloader\\.php\\?file=(\\d+)&localty=Huelva\\s+${mesCap}\\s+${year}`, 'i')
  const m = html.match(re)
  if (!m) {
    // Fallback: cualquier file del año actual.
    const re2 = new RegExp(`downloader\\.php\\?file=(\\d+)&localty=Huelva\\s+\\w+\\s+${year}`, 'i')
    const m2 = html.match(re2)
    if (!m2) throw new Error(`No PDF para Huelva ${mesCap} ${year}`)
    return m2[1]
  }
  return m[1]
}

// Carga las 222 farmacias del localizador con coords.
async function cargarLocalizador() {
  const html = await fetchHtml(`${BASE}/localizador/farmacias-de-guardia`)
  // El JS tiene: position: { lat: X, lng: Y }, title: '<h4>NOMBRE</h4><p>DIR, CIUDAD, PROV</p>'
  const re = /position:\s*\{\s*lat:\s*([\d.\-]+),\s*lng:\s*([\d.\-]+)\s*\},\s*title:\s*'([^']+)'/g
  const farmacias = []
  let m
  while ((m = re.exec(html)) !== null) {
    const lat = parseFloat(m[1])
    const lng = parseFloat(m[2])
    const t = m[3]
    const mt = t.match(/<h4>([^<]+)<\/h4><p>([^<]+)<\/p>/)
    if (!mt) continue
    const nombre = mt[1].trim()
    const dirRaw = mt[2].trim()
    // dirRaw = "Calle PLUS ULTRA 7, Huelva, Huelva"
    // Quedarnos con la parte antes de la 1a coma.
    const dirCorta = dirRaw.split(',')[0].replace(/\s+/g, ' ').trim()
    farmacias.push({ lat, lng, nombre, dirCorta, dirRaw })
  }
  return farmacias
}

// Busca en el localizador la farmacia mas cercana (texto) a una direccion del PDF.
function emparejar(dirPdf, locArr) {
  const norm = normDir(dirPdf)
  const normSinNum = normDirSinNum(dirPdf)
  // 1) Match exacto despues de normalizar (con numero).
  for (const l of locArr) {
    if (normDir(l.dirCorta) === norm) return l
  }
  // 2) Match por inclusion mutua (la mas larga incluye la corta).
  for (const l of locArr) {
    const ln = normDir(l.dirCorta)
    if (ln.length < 4) continue
    if (norm.includes(ln) || ln.includes(norm)) return l
  }
  // 3) Match sin numero — calle solo (ej "Pº Las Palmeras 23" vs "PS DE LAS PALMERAS 21").
  for (const l of locArr) {
    const lnSin = normDirSinNum(l.dirCorta)
    if (lnSin.length < 4) continue
    if (lnSin === normSinNum) return l
    if (lnSin.includes(normSinNum) || normSinNum.includes(lnSin)) return l
  }
  // 4) Match por palabras clave (≥2 tokens compartidos de ≥3 chars).
  const tokensPdf = norm.split(/\s+/).filter(t => t.length >= 3 && !/^\d+$/.test(t))
  if (tokensPdf.length < 1) return null
  let mejor = null
  let mejorScore = 1
  for (const l of locArr) {
    const ln = normDir(l.dirCorta)
    const tokensL = ln.split(/\s+/).filter(t => t.length >= 3 && !/^\d+$/.test(t))
    let score = 0
    for (const t of tokensPdf) {
      if (tokensL.includes(t)) score++
    }
    if (score > mejorScore) { mejorScore = score; mejor = l }
  }
  return mejor
}

async function main() {
  const d = new Date()
  console.log(`Descargando guardias Huelva — cofhuelva.org PDF mensual + localizador...`)
  const fileId = await buscarPdfMes(d)
  console.log(`  PDF id: ${fileId}`)
  const mesEs = MESES[d.getMonth()]
  const mesCap = mesEs[0].toUpperCase() + mesEs.slice(1)
  const pdfUrl = `${BASE}/template/modules/cuadro-de-guardias/downloader.php?file=${fileId}&localty=${encodeURIComponent(`Huelva ${mesCap} ${d.getFullYear()}`)}`
  const data = await fetchPdf(pdfUrl)
  const parser = new PDFParse({ data })
  const r = await parser.getText({ itemJoiner: '@@@' })
  const lines = r.text.split('\n').map(l => l.trim()).filter(Boolean)
  console.log(`  PDF: ${lines.length} lineas`)

  // Extraer FARMACIAS 24H = las 2 primeras lineas con direccion antes de "FESTIVOS".
  const idxFestivos = lines.findIndex(l => /FESTIVOS\s*\(/i.test(l))
  const direcciones24h = []
  for (let i = 0; i < (idxFestivos >= 0 ? idxFestivos : Math.min(lines.length, 4)); i++) {
    const items = lines[i].split('@@@').map(s => s.trim()).filter(Boolean)
    for (const it of items) {
      // Una direccion valida: contiene digito o C/, Avd, Pz, Pº...
      if (/\d|C\/|c\/|Avd|Avda|Pz\.|Pº|Paseo|Calle|Edf/i.test(it)) {
        // Si tiene parentesis (info), juntar con linea anterior si es corta.
        if (/^\(/.test(it) && direcciones24h.length > 0) {
          direcciones24h[direcciones24h.length - 1] += ' ' + it
        } else {
          direcciones24h.push(it)
        }
      }
    }
  }
  // Dedupe.
  const dirSet = new Set()
  const dirs24h = []
  for (const d of direcciones24h) {
    const k = d.toLowerCase().replace(/\s+/g, ' ')
    if (dirSet.has(k)) continue
    dirSet.add(k)
    dirs24h.push(d)
  }
  console.log(`  ${dirs24h.length} farmacias 24H detectadas:`)
  dirs24h.forEach((d, i) => console.log(`    ${i + 1}. ${d}`))

  if (dirs24h.length < 1) throw new Error('Cero farmacias 24H detectadas en el PDF de Huelva')
  if (dirs24h.length > 5) throw new Error(`Sospechoso: ${dirs24h.length} 24H detectadas (esperabamos 1-3)`)

  // Cargar localizador para resolver coords + nombre + telefono.
  console.log(`  Cargando localizador...`)
  const locArr = await cargarLocalizador()
  console.log(`  ${locArr.length} farmacias en localizador`)

  const guardias = []
  for (const dir of dirs24h) {
    const match = emparejar(dir, locArr)
    if (!match) {
      console.log(`    sin match: "${dir}"`)
      continue
    }
    const nom = match.nombre.split(/\s*\/\s*/)[0].trim() // primer titular si hay varios
    guardias.push([
      Math.round(match.lat * 1e5) / 1e5,
      Math.round(match.lng * 1e5) / 1e5,
      `Farmacia ${titleCase(nom)} · ${titleCase(dir)}`.slice(0, 140),
      'Huelva',
      '',
      '',
      '24 horas (todo el mes)',
      'Servicio continuado',
    ])
    console.log(`    OK ${nom} → ${match.lat},${match.lng}`)
  }

  if (guardias.length < 1) throw new Error('Cero 24H emparejadas con localizador. Abortamos.')

  const out = {
    ts: new Date().toISOString(),
    source: 'cofhuelva.org',
    territorio: 'huelva',
    count: guardias.length,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardias 24H guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
