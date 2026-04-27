#!/usr/bin/env node
// v1.50 — Descarga las farmacias de guardia de la PROVINCIA de Palencia
// (capital + 13 zonas rurales) desde los PDFs publicados por COF Palencia
// (cofpalencia.org).
//
// El COF publica los calendarios en
//   https://www.cofpalencia.org/PUBLICO/CALENDARIOS%20DE%20GUARDIA/menu_calendarios_guardia.htm
// con dos formatos distintos:
//
//   1) SEMANAL  — Capital, Saldaña, Villada, Venta de Baños, Carrión.
//      Tabla con columnas DIURNA / NOCTURNA / 24H y filas semanales
//      "SEMANA (X DE MES) al (Y DE MES)". Parser exacto para hoy.
//
//   2) CALENDARIO — Aguilar, Baltañás, Cervera, Frómista, Guardo, Herrera,
//      Osorno, Paredes, Villamuriel, Villarramiel. Calendario trimestral
//      con asteriscos por dia y listado de farmacias rotativas. La
//      asociacion dia↔farmacia se pierde al extraer texto, asi que
//      publicamos TODAS las farmacias listadas con horario "Rotacion
//      zonal — consultar cofpalencia.org". Da cobertura geografica
//      aunque no la guardia exacta del dia.
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
const USER_AGENT = 'cercaya-guardias/1.50 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Palencia (margen generoso).
const BBOX = { minLat: 41.6, maxLat: 43.1, minLng: -5.2, maxLng: -3.6 }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_SEM = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']

// Nombre normalizado de zona → patron en el menu HTML. Mapeo manual porque
// el menu tiene errores ortograficos y mayusculas variables.
// La pagina del menu es estable; si añaden zonas, este mapa lo reflejara.
const ZONAS_RURALES = [
  { name: 'Aguilar de Campoo',       menuRe: /AGUILAR\s+DE\s+CAMPOO/i,                fmt: 'CALENDARIO' },
  { name: 'Baltañás y Torquemada',   menuRe: /BALTAN[AÑ]?AS\s+Y\s+TORQUEMADA/i,        fmt: 'CALENDARIO' },
  { name: 'Carrión de los Condes',   menuRe: /CARRION\s+DE\s+LOS\s+CONDES/i,           fmt: 'SEMANAL', mensual: true },
  { name: 'Cervera de Pisuerga',     menuRe: /CERVERA\s+DE\s+PISUERGA/i,               fmt: 'CALENDARIO' },
  { name: 'Frómista',                menuRe: /FROMISTA/i,                              fmt: 'CALENDARIO' },
  { name: 'Guardo',                  menuRe: /GUARDO/i,                                fmt: 'CALENDARIO' },
  { name: 'Herrera de Pisuerga',     menuRe: /HERRERA\s+DE\s+PISUERGA/i,               fmt: 'CALENDARIO' },
  { name: 'Osorno',                  menuRe: /OSORNO/i,                                fmt: 'CALENDARIO' },
  { name: 'Paredes de Nava',         menuRe: /PAREDES\s+DE\s+NAVA/i,                   fmt: 'CALENDARIO' },
  { name: 'Saldaña',                 menuRe: /SALDA[NÑ]A/i,                            fmt: 'SEMANAL', mensual: true },
  { name: 'Villada',                 menuRe: /VILLADA/i,                               fmt: 'SEMANAL', mensual: true },
  { name: 'Villamuriel de Cerrato',  menuRe: /VILLAMURIEL\s+DE\s+CERRATO/i,            fmt: 'CALENDARIO' },
  { name: 'Villarramiel',            menuRe: /VILLARRAMIEL/i,                          fmt: 'CALENDARIO' },
  { name: 'Venta de Baños',          menuRe: /VENTA\s+DE\s+BA[NÑ]OS/i,                 fmt: 'SEMANAL', mensual: true },
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

// Parsea el menu HTML para extraer todos los anchors con su zona, mes y href.
async function fetchMenu() {
  const url = `${BASE}/menu_calendarios_guardia.htm`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Menu HTTP ${res.status}`)
  // El menu va en latin1 pese al meta — convertimos para preservar Ñ.
  const buf = await res.arrayBuffer()
  const decoder = new TextDecoder('iso-8859-1')
  const html = decoder.decode(buf)
  const re = /<a\s+href="(calendarios%20de%20guardias%20\d+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi
  const items = []
  let m
  while ((m = re.exec(html)) !== null) {
    const href = m[1]
    // Decodificar entidades HTML basicas (Ñ).
    const txt = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&Ntilde;/g, 'Ñ')
      .replace(/&ntilde;/g, 'ñ')
      .replace(/&aacute;/g, 'á')
      .replace(/&eacute;/g, 'é')
      .replace(/&iacute;/g, 'í')
      .replace(/&oacute;/g, 'ó')
      .replace(/&uacute;/g, 'ú')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    items.push({ href, txt })
  }
  return items
}

// Para zonas SEMANAL/CALENDARIO, decide que href usar dada la fecha de hoy.
// SEMANAL capital: anchor con "PALENCIA (del X al Y de MES)" — semana
//   directa.
// SEMANAL rural mensual (Saldaña, Villada, Venta de Baños, Carrión): anchor
//   con "<ZONA> MES" — un PDF por mes.
// CALENDARIO: un solo anchor por zona — el del trimestre actual.
function elegirHref(items, zona, today) {
  const month = today.getMonth()
  const monthName = MESES[month].toUpperCase()
  // Filtrar por nombre de zona.
  const candidatos = items.filter(it => zona.menuRe.test(it.txt))
  if (candidatos.length === 0) return null
  // Si la zona es SEMANAL mensual (Saldaña, Villada, Venta Baños, Carrion):
  //   el anchor es "<ZONA> <MES>" → buscar el del mes actual.
  if (zona.fmt === 'SEMANAL' && zona.mensual) {
    // ej. "SALDAÑA ABRIL", "VILLADA MAYO".
    const conMes = candidatos.find(it => normalize(it.txt).includes(normalize(monthName)))
    if (conMes) return conMes.href
    // Fallback: el primero (mes mas cercano).
    return candidatos[0].href
  }
  // Capital (SEMANAL semanal): anchor "PALENCIA (del X al Y de MES)".
  // Para capital usamos un patron exacto en main(), no por ZONAS_RURALES.
  // CALENDARIO: un solo anchor por zona, el del trimestre actual.
  return candidatos[0].href
}

// Capital: anchor "PALENCIA (del X al Y de MES)" — encuentra el que cubre hoy.
function elegirHrefCapital(items, today) {
  const reCap = /^PALENCIA\s*\(\s*del\s+(\d{1,2})(?:\s+de\s+(\w+))?\s+al\s+(\d{1,2})\s+de\s+(\w+)\s*\)/i
  const semanas = []
  for (const it of items) {
    const m = it.txt.match(reCap)
    if (!m) continue
    const dIni = parseInt(m[1], 10)
    const mesIni = m[2] ? normalize(m[2]) : normalize(m[4])
    const dFin = parseInt(m[3], 10)
    const mesFin = normalize(m[4])
    const idxMesIni = MESES.indexOf(mesIni)
    const idxMesFin = MESES.indexOf(mesFin)
    if (idxMesIni < 0 || idxMesFin < 0) continue
    semanas.push({ href: it.href, dIni, idxMesIni, dFin, idxMesFin })
  }
  if (semanas.length === 0) return null
  const day = today.getDate()
  const month = today.getMonth()
  const year = today.getFullYear()
  for (const s of semanas) {
    const ini = new Date(year, s.idxMesIni, s.dIni)
    let fin = new Date(year, s.idxMesFin, s.dFin)
    if (fin < ini) fin = new Date(year + 1, s.idxMesFin, s.dFin)
    const t = new Date(year, month, day)
    if (t >= ini && t <= fin) return s.href
  }
  return semanas[0].href
}

async function fetchPdf(href) {
  const url = `${BASE}/${href}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`PDF HTTP ${res.status} (${href})`)
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

async function geocode(direccion, pueblo) {
  const variants = []
  const sinParens = direccion.replace(/\s*\([^)]*\)/g, '').trim()
  if (sinParens) variants.push(sinParens)
  const primeraComa = sinParens.split(',').slice(0, 2).join(',').trim()
  if (primeraComa && !variants.includes(primeraComa)) variants.push(primeraComa)
  // Pueblos a probar: el dado, y si es compuesto ("X y Y") las partes.
  const pueblos = []
  if (pueblo) {
    pueblos.push(pueblo)
    const partes = pueblo.split(/\s+y\s+/i).map(p => p.trim()).filter(Boolean)
    if (partes.length > 1) pueblos.push(...partes)
  }
  pueblos.push('')  // sin pueblo (solo Palencia provincia)
  for (const p of pueblos) {
    for (const v of variants) {
      const q = p ? `${v}, ${p}, Palencia, España` : `${v}, Palencia, España`
      const coord = await geocodeOne(q)
      if (coord) return coord
      await new Promise(r => setTimeout(r, 1100))
    }
  }
  // Ultimo fallback: solo pueblo (centro del pueblo) si lo hay.
  if (pueblo) {
    for (const p of pueblos) {
      if (!p) continue
      const coord = await geocodeOne(`${p}, Palencia, España`)
      if (coord) return coord
      await new Promise(r => setTimeout(r, 1100))
    }
  }
  return null
}

// Parser SEMANAL capital — formato del PDF semanal de capital. Usa el dia
// de la semana + numero de dia para localizar la fila.
function parsePdfCapital(text) {
  const target1 = DIAS_SEM[new Date().getDay()]
  const target2 = `${new Date().getDate()} de ${MESES[new Date().getMonth()].toUpperCase()}`
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let idxDia = -1
  for (let i = 0; i < lines.length - 2; i++) {
    if (lines[i].toUpperCase() === target1 ||
        lines[i].toUpperCase().startsWith(target1 + ' ')) {
      const next2 = (lines[i + 1] + ' ' + (lines[i + 2] || '')).toUpperCase()
      if (next2.includes(target2.toUpperCase()) ||
          next2.includes(`${new Date().getDate()} DE ${MESES[new Date().getMonth()].toUpperCase()}`)) {
        idxDia = i
        break
      }
    }
  }
  if (idxDia === -1) return []
  let stopIdx = lines.length
  for (let i = idxDia + 3; i < lines.length; i++) {
    if (DIAS_SEM.includes(lines[i].toUpperCase())) { stopIdx = i; break }
  }
  const block = lines.slice(idxDia, stopIdx)
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
      if (cur.direccion) {
        farmacias.push(cur)
        cur = { nombre: '', direccion: '', info: '' }
      }
      cur.nombre = (cur.nombre ? cur.nombre + ' ' : '') + l
      continue
    }
    if (!cur.direccion) cur.direccion = l
    else cur.direccion += ' ' + l
  }
  if (cur.direccion) farmacias.push(cur)
  const horarios = ['Diurna 10:00-22:00 (turno 1)', 'Diurna 10:00-22:00 (turno 2)', 'Nocturna 22:00-10:00']
  return farmacias.map((f, i) => ({
    ...f,
    pueblo: 'Palencia',
    horario: horarios[i] || 'De guardia',
  }))
}

// Parser SEMANAL rural — bloques "SEMANA (X DE MES) al (Y DE MES)".
function parsePdfSemanalRural(text, today) {
  const day = today.getDate()
  const month = today.getMonth()
  const year = today.getFullYear()
  // Capturar tanto "(X DE MES)" como "(X de MES)".
  const re = /SEMANA\s*\(\s*(\d{1,2})\s*(?:DE|de)?\s*(\w+)?\s*\)\s*al\s*\(\s*(\d{1,2})\s*(?:DE|de)?\s*(\w+)\s*\)/gi
  const matches = [...text.matchAll(re)]
  if (matches.length === 0) return []
  let bloqueElegido = null
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const dIni = parseInt(m[1], 10)
    const mesIni = m[2] ? normalize(m[2]) : normalize(m[4])
    const dFin = parseInt(m[3], 10)
    const mesFin = normalize(m[4])
    const idxMesIni = MESES.indexOf(mesIni)
    const idxMesFin = MESES.indexOf(mesFin)
    if (idxMesIni < 0 || idxMesFin < 0) continue
    const ini = new Date(year, idxMesIni, dIni)
    let fin = new Date(year, idxMesFin, dFin)
    if (fin < ini) fin = new Date(year + 1, idxMesFin, dFin)
    const today2 = new Date(year, month, day)
    if (today2 >= ini && today2 <= fin) {
      const start = m.index + m[0].length
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length
      bloqueElegido = text.slice(start, end)
      break
    }
  }
  if (!bloqueElegido) return []
  // Extraer farmacias del bloque. Cada farmacia tiene nombre (1+ lineas)
  // seguido de una linea con paren (direccion). El pueblo aparece dentro
  // del paren o tras el (en mayusculas).
  const linesRaw = bloqueElegido.split('\n').map(l => l.trim()).filter(Boolean)
  const lines = normalizarLineas(linesRaw)
  const farmacias = []
  let cur = { nombre: '', direccion: '', pueblo: '' }
  for (const l of lines) {
    if (l.includes('(')) {
      const dp = extraerDirPueblo(l)
      if (dp) {
        cur.direccion = dp.direccion
        if (dp.pueblo) cur.pueblo = dp.pueblo
        // Si nombre esta vacio, intentar tomar el texto antes del paren.
        if (!cur.nombre) {
          const before = l.slice(0, dp.parenIdx).trim()
          if (before) cur.nombre = before
        }
        farmacias.push({ ...cur })
        cur = { nombre: '', direccion: '', pueblo: '' }
        continue
      }
    }
    // Sin paren. Si todavia no hay direccion en cur, acumular como nombre.
    if (!cur.direccion) {
      // Si parece pueblo (UPPER, corto): puede ser
      //   (a) pueblo completo de farmacia previa sin pueblo
      //   (b) continuacion del pueblo previo (fragmentado: "CARRION DE LOS" + "CONDES")
      const esCortoMay = l.length < 40 && /^[A-ZÁÉÍÓÚÑ\s\.,/-]+$/.test(l) && !/[a-z]/.test(l)
      if (esCortoMay && farmacias.length > 0) {
        const ult = farmacias[farmacias.length - 1]
        if (!ult.pueblo) {
          ult.pueblo = l
          continue
        }
        // Continuacion: pueblo previo termina en preposicion ("DE LOS", "DE LA", "DEL").
        if (/\b(DE\s+LA|DE\s+LOS|DE\s+LAS|DEL|DE)\s*$/i.test(ult.pueblo)) {
          ult.pueblo = (ult.pueblo + ' ' + l).replace(/\s+/g, ' ').trim()
          continue
        }
      }
      cur.nombre = (cur.nombre ? cur.nombre + ' ' : '') + l
    }
  }
  if (cur.nombre && cur.direccion) farmacias.push({ ...cur })
  // Dedupe por (nombre+direccion).
  const seen = new Set()
  const out = []
  for (const f of farmacias) {
    const k = `${normalize(f.nombre)}|${normalize(f.direccion)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ...f, horario: 'De guardia (rotación semanal)' })
  }
  return out
}

// Junta lineas con parentesis sin cerrar (ej. "( Avda. de la" + "Estación,36").
// Permite que el contenido del paren se reparta en multiples lineas del PDF.
// Tambien junta lineas tipo "(PUEBLO)" con la linea anterior (formato Herrera:
// "NOMBRE - DIR" + "(PUEBLO)").
function normalizarLineas(lines) {
  const out = []
  let buffer = ''
  for (const l of lines) {
    const open = (l.match(/\(/g) || []).length
    const close = (l.match(/\)/g) || []).length
    if (buffer) {
      buffer += ' ' + l
      const o = (buffer.match(/\(/g) || []).length
      const c = (buffer.match(/\)/g) || []).length
      const cierraNuevaSecc = /^(SEMANA|GUARDIA|[A-Z][A-ZÁÉÍÓÚÑ\s]{3,}\s*$)/.test(l)
      if (o <= c) {
        out.push(buffer.replace(/\s+/g, ' ').trim())
        buffer = ''
      } else if (cierraNuevaSecc) {
        out.push((buffer + ')').replace(/\s+/g, ' ').trim())
        buffer = ''
      }
      continue
    }
    if (open > close) {
      buffer = l
      continue
    }
    // Linea que es SOLO "(PUEBLO)" — juntarla con la anterior (formato
    // "NOMBRE  DIR" + "(PUEBLO)") siempre que la anterior no contenga ya
    // un paren con direccion (es decir, la anterior tiene horario o nada).
    const soloParen = /^\(\s*[^)]+\s*\)\s*$/.test(l)
    if (soloParen && out.length > 0) {
      const ult = out[out.length - 1]
      // Si la anterior es texto sin paren con direccion (sin (.. ,N) o (..  /N))
      // o tiene solo parens de horario, juntar.
      const tieneParenDir = /\([^)]*(?:c\/|calle|avda|plaza|paseo|p[º°]|carretera|ctra|camino|nº|n°|carr|barrio|c\.|av\.|pza)/i.test(ult)
      if (!tieneParenDir && ult.length > 5) {
        out[out.length - 1] = (ult + ' ' + l).replace(/\s+/g, ' ').trim()
        continue
      }
    }
    out.push(l)
  }
  if (buffer) out.push((buffer + ')').replace(/\s+/g, ' ').trim())
  return out
}

// Para una linea con "(...)" y eventualmente texto antes/despues, extrae
// el contenido del paren si parece direccion (no telefono, no horario, no
// pueblo solo). Devuelve {direccion, pueblo} o null si el paren no es util.
function extraerDirPueblo(linea) {
  // Encontrar todos los parens en la linea (incluyendo sin cerrar).
  const all = [...linea.matchAll(/\(([^)]*)\)?/g)]
  for (const m of all) {
    const inside = m[1].trim()
    if (!inside) continue
    // Filtros: telefono solo, horario.
    if (/^[\d\s\-\.]+$/.test(inside)) continue
    if (/^\d{1,2}[:.]\d{2}/.test(inside)) continue
    if (/^de\s+\d/i.test(inside)) continue
    if (/^tlf|^tfno|^tel\b/i.test(inside)) continue
    if (/^\*$/.test(inside)) continue
    // Filtrar horarios tipo "10 a 22 h", "22 a 10 h", "10 NOCHE/10 MAÑANA",
    // "10 MAÑANA / 10 NOCHE", "9:30 a 20:00", "DE LUNES A VIERNES", etc.
    if (/^\d{1,2}\s*(:\d{2})?\s*(a|hasta|to)\s*\d{1,2}/i.test(inside)) continue
    if (/^\d{1,2}\s+(noche|mañana|tarde)/i.test(inside)) continue
    if (/^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)\s/i.test(inside)) continue
    if (/^DE\s+(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)/i.test(inside)) continue
    if (/horas?\b/i.test(inside) && /\d{1,2}/.test(inside) && !/\bnº?\s*\d/i.test(inside) && !/[a-z]\/[A-Z]/.test(inside)) continue
    // Si todo upper case y sin numeros → es pueblo, no direccion.
    const sinDigitos = !/\d/.test(inside)
    const todoMayus = /^[A-ZÁÉÍÓÚÑ\s\.,\-/]+$/.test(inside)
    if (sinDigitos && todoMayus && inside.length > 3) {
      // Pueblo dentro del paren. Direccion es lo que va antes del paren.
      const antes = linea.slice(0, m.index).trim()
      // El antes contiene NOMBRE + DIRECCION mezclados. Heuristica: la
      // direccion va detras del nombre y suele empezar tras "Avda/Plaza/C/Calle"
      // o un guion. Si no, el ultimo token con numero es la direccion.
      const mDireccion = antes.match(/((?:Avda?\.?|Plaza|Pza|C\/|Calle|Ctra\.?|Carretera|Paseo|Pº|Av\.?|nº|N°)\s*[^A-Z0-9].{3,80}?\d[\d\s\-,/.]*)$/i) ||
                          antes.match(/-\s*(.+?\d[\d\s\-,/.]*)$/) ||
                          antes.match(/(\S+\s+\S*\d[\d\s\-,]*)$/)
      const direccion = mDireccion ? mDireccion[1].trim() : antes
      if (!direccion || direccion.length < 3) return null
      return { direccion, pueblo: inside.trim(), parenIdx: m.index, parenEnd: m.index + m[0].length }
    }
    // Si tiene numeros → es direccion. Pueblo: tras el paren si existe.
    const tras = linea.slice(m.index + m[0].length).trim()
    let pueblo = ''
    // Limpiar prefijo "-" o ":" antes del pueblo (ej. "(dir) - CARRIÓN").
    const trasLimpio = tras
      .replace(/(TLF[Nº]?|TFNO|TLFO|TEL[ÉE]FONO)\s*[:°]?[\s\d\-\(\)]*/gi, '')
      .replace(/^[\s\-:·,]+/, '')
      .trim()
    const mP = trasLimpio.match(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s\.,\-/]{2,40})/)
    if (mP) pueblo = mP[1].trim()
    return { direccion: inside.trim(), pueblo, parenIdx: m.index, parenEnd: m.index + m[0].length }
  }
  return null
}

// Recolecta nombre extrayendo lineas previas (la propia + hasta 2 anteriores)
// limpiando prefijos GUARDIA.
function recolectarNombre(lineas, idx, propiaParenIdx) {
  const partes = []
  // Parte 1: lo que va antes del paren en la propia linea.
  const propia = lineas[idx].slice(0, propiaParenIdx).trim()
  if (propia) partes.push(propia)
  // Parte 2: lineas anteriores (max 2) que parezcan continuacion del nombre.
  for (let j = idx - 1; j >= Math.max(0, idx - 2); j--) {
    const prev = lineas[j]
    if (!prev) break
    if (/^L\s+M\s+M/.test(prev)) break
    if (/^\d/.test(prev)) break
    if (/^Z\.\s*B\.\s*S/i.test(prev)) break
    if (/^ESTA\s|^www\./i.test(prev)) break
    if (/^SERVICIO|^ILUSTRE|^OFICIAL|^DE PALENCIA$/i.test(prev)) break
    if (/^MES\s+DE/i.test(prev)) break
    if (/^A PARTIR|^URGENCIA/i.test(prev)) break
    if (/^Fines de semana/i.test(prev)) break
    if (/^\*\s*APERTURA/i.test(prev)) break
    if (/^Tel[éeÉE]fono|^TFNO|^TLF[NO]?[ºo°]?\s*[:°]/i.test(prev)) break
    if (/^PALENCIA(\s+CAPITAL)?\*?\s*$/i.test(prev)) break
    if (/^PALENCIA\s*\(\s*CAPITAL\s*\)\s*\*?\s*$/i.test(prev)) break
    // Linea de meses ("ABRIL MAYO JUNIO" o "ABRIL").
    if (/^(ABRIL|MAYO|JUNIO|JULIO|ENERO|FEBRERO|MARZO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)(\s+(ABRIL|MAYO|JUNIO|JULIO|ENERO|FEBRERO|MARZO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE))*\s*$/i.test(prev)) break
    if (/^GUARDIA\s+(24|DIURNA|NOCTURNA|N[ÓO]CTURNA)/i.test(prev) && !/[a-záéíóúñ]/.test(prev.replace(/^GUARDIA\s+(24\s*HORAS?|24H|DIURNA|N[ÓO]CTURNA|\([^)]*\))*\s*/i, '').trim())) break
    if (/^[A-Z][A-ZÁÉÍÓÚÑ\s\-/]{2,40}\*?$/.test(prev) && /^\(/.test(lineas[j-1] || '')) break
    if (prev.includes('(') && prev.includes(')')) break  // ya es otra farmacia
    partes.unshift(prev)
  }
  // Limpiar prefijos GUARDIA y horarios mezclados.
  let nombre = partes.join(' ')
    .replace(/^GUARDIA\s+(24\s*HORAS?|24H|DIURNA|N[ÓO]CTURNA)\s*\*?\s*(\([^)]*\)\s*)?/gi, '')
    .replace(/PALENCIA\*?\s*GUARDIA[^A-Za-zÁÉÍÓÚÑ]+\([^)]*\)\s*/gi, '')
    .replace(/^PALENCIA\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return nombre
}

// Parser CALENDARIO — extrae todas las farmacias listadas con direccion.
function parsePdfCalendario(text, zonaName) {
  const linesRaw = text.split('\n').map(l => l.trim()).filter(Boolean)
  const lines = normalizarLineas(linesRaw)
  const farmacias = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // Saltar lineas no-farmacia obvias.
    if (/^L\s+M\s+M\s+J/.test(l)) continue
    if (/^\d/.test(l) && !/[a-záéíóúñ]/.test(l)) continue
    if (/^(ABRIL|MAYO|JUNIO|JULIO|ENERO|FEBRERO|MARZO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)$/i.test(l)) continue
    if (/^Z\.\s*B\.\s*S\.?/i.test(l)) continue
    if (/^ILUSTRE|^OFICIAL|^DE PALENCIA$/i.test(l)) continue
    if (/^SERVICIO/i.test(l)) continue
    if (/^ESTA INFORMACI|^www\.|^CONSULTADA/i.test(l)) continue
    if (/^A PARTIR|^URGENCIA/i.test(l)) continue
    if (/^Fines de semana/i.test(l)) continue
    if (/^MES\s+DE/i.test(l)) continue
    if (/^\* APERTURA/i.test(l)) continue
    if (/^PALENCIA\*?$/i.test(l)) continue
    // Header "PALENCIA (CAPITAL) *" — indica que la guardia 24h cubre
    // la capital, NO una farmacia.
    if (/^PALENCIA\s*\(\s*CAPITAL\s*\)\s*\*?\s*$/i.test(l)) continue
    // Saltar lineas que son labels GUARDIA solos (sin paren).
    if (/^GUARDIA\s+(24|DIURNA|NOCTURNA)/i.test(l) && !l.includes('(')) continue

    if (!l.includes('(')) continue  // direccion vive en paren
    const dp = extraerDirPueblo(l)
    if (!dp) continue
    const direccion = dp.direccion
    if (!direccion || direccion.length < 3) continue

    // Patron "PUEBLO (DIR) [resto]": el "antes del paren" es texto UPPERCASE
    // sin numeros (un nombre de pueblo). En ese caso la entrada NO tiene
    // nombre individual de farmaceutico — solo pueblo + direccion (formato
    // tipico de Villarramiel, Frómista, Osorno).
    const before = l.slice(0, dp.parenIdx).trim()
      .replace(/^GUARDIA\s+(24\s*HORAS?|24H|DIURNA|N[ÓO]CTURNA)\s*\*?\s*(\([^)]*\))?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    // UPPERCASE puro sin numeros, sin iniciales tipo "C.B.", maximo 3 palabras
    // y sin apellidos terminados en EZ/IZ ni nombres tipicos.
    const palabras = before.split(/\s+/).filter(Boolean)
    const tieneApellidoEz = palabras.some(p => /^[A-ZÁÉÍÓÚÑ]+(EZ|IZ|EZ\.?|IZ\.?)$/.test(p))
    const nombresPropios = /^(JUAN|JOSE|JOSÉ|MARIA|MARÍA|ANA|ISABEL|LUIS|ALBERTO|ANTONIO|MANUEL|CARLOS|FRANCISCO|JESUS|JESÚS|MIGUEL|JAVIER|PEDRO|RAMON|RAMÓN|DANIEL|HELENA|BLANCA|CARMEN|MARINA|ROSA|AUREA|ÁUREA|ENARA|IRENE|ANAHI|LORENZO|SOLEDAD|ALFONSO|GUADALUPE|DOÑA|DON)$/i
    const tieneNombrePropio = palabras.some(p => nombresPropios.test(p))
    const beforeEsPueblo = before.length > 0 && before.length < 50 &&
      /^[A-ZÁÉÍÓÚÑ\s\.,\-/]+$/.test(before) && !/\d/.test(before) &&
      !/^[A-Z]\.[A-Z]/.test(before) &&
      palabras.length <= 3 && !tieneApellidoEz && !tieneNombrePropio
    let nombre, pueblo
    if (beforeEsPueblo) {
      nombre = ''
      pueblo = before
    } else {
      nombre = recolectarNombre(lines, i, dp.parenIdx)
      pueblo = dp.pueblo || zonaName
      // Si la direccion esta dentro del nombre (formato Herrera "NOMBRE DIR (PUEBLO)"),
      // quitarla.
      if (direccion && nombre.includes(direccion)) {
        nombre = nombre.replace(direccion, '').replace(/\s+/g, ' ').trim()
      }
      // Si nombre esta vacio o claramente no es nombre de farmaceutico → skip.
      if (!nombre || nombre.length < 4) continue
      if (/^GUARDIA\s+(24|DIURNA|NOCTURNA)/i.test(nombre)) continue
      if (/^PALENCIA(\s+CAPITAL)?\*?$/i.test(nombre)) continue
      // Header "ABRIL MAYO JUNIO PALENCIA" o similares.
      if (/(ABRIL|MAYO|JUNIO|JULIO|ENERO|FEBRERO|MARZO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+(ABRIL|MAYO|JUNIO|JULIO|ENERO|FEBRERO|MARZO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)/i.test(nombre)) continue
      // Z.B.S.* en el nombre → header de zona.
      if (/Z\.\s*B\.\s*S\./i.test(nombre)) continue
    }
    farmacias.push({
      nombre,
      direccion,
      pueblo,
      horario: 'Rotación zonal — consultar cofpalencia.org',
    })
  }
  // Dedupe por (nombre+direccion).
  const seen = new Set()
  const out = []
  for (const f of farmacias) {
    const k = `${normalize(f.nombre)}|${normalize(f.direccion)}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
  }
  return out
}

function extraerTelefono(direccion) {
  // (979122092), (979-122-092), TLFNº ( 979-870065 ), 678857050, etc.
  const ms = direccion.match(/(?:tlf|tfno|tlfo|tel)[^\d]*(\d[\d\-\s]{7,15})/i)
  if (ms) {
    const tel = ms[1].replace(/[\-\s]/g, '').slice(0, 9)
    if (tel.length === 9) return tel
  }
  // Numero suelto al final.
  const m2 = direccion.match(/\b(\d{9})\b/)
  if (m2) return m2[1]
  return ''
}

function limpiarDireccion(direccion) {
  return direccion
    .replace(/TLF[Nº]?\s*[:°]?\s*\([^)]*\)/gi, '')
    .replace(/TFNO\s*[:]+\s*\d[\d\-\s]*/gi, '')
    .replace(/TLFO\s*[:]+\s*\d[\d\-\s]*/gi, '')
    .replace(/TEL[ÉE]FONO[^,]*\d[\d\-\s]*/gi, '')
    .replace(/\bTFNO[^,]*?(?:\d{9}|\d{3}[-\s]?\d{3}[-\s]?\d{3})/gi, '')
    .replace(/^GUARDIA\s+(?:24\s*HORAS?|24H|DIURNA|NOCTURNA)\s*\*?\s*\([^)]*\)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const today = new Date()
  console.log(`Descargando guardias provincia Palencia — cofpalencia.org...`)
  const items = await fetchMenu()
  console.log(`  ${items.length} anchors en menu`)

  const farmaciasAll = []

  // 1) CAPITAL — semanal exacto.
  try {
    const hrefCap = elegirHrefCapital(items, today)
    if (!hrefCap) throw new Error('Sin href capital')
    console.log(`  capital: ${hrefCap}`)
    const data = await fetchPdf(hrefCap)
    const parser = new PDFParse({ data })
    const r = await parser.getText()
    const fs = parsePdfCapital(r.text)
    console.log(`    capital: ${fs.length} farmacias`)
    farmaciasAll.push(...fs.map(f => ({ ...f, zona: 'Palencia capital' })))
  } catch (e) {
    console.log(`  capital FAIL: ${e.message}`)
  }

  // 2) ZONAS RURALES.
  for (const zona of ZONAS_RURALES) {
    try {
      const href = elegirHref(items, zona, today)
      if (!href) {
        console.log(`  ${zona.name}: sin anchor en menu`)
        continue
      }
      console.log(`  ${zona.name} [${zona.fmt}]: ${href}`)
      const data = await fetchPdf(href)
      const parser = new PDFParse({ data })
      const r = await parser.getText()
      const text = r.text
      let fs = []
      if (zona.fmt === 'SEMANAL') {
        fs = parsePdfSemanalRural(text, today)
      } else {
        fs = parsePdfCalendario(text, zona.name)
      }
      console.log(`    ${fs.length} farmacias`)
      farmaciasAll.push(...fs.map(f => ({ ...f, zona: zona.name })))
    } catch (e) {
      console.log(`  ${zona.name} FAIL: ${e.message}`)
    }
    // Pequeño delay entre zonas para no saturar el servidor.
    await new Promise(r => setTimeout(r, 200))
  }

  console.log(`Total farmacias detectadas: ${farmaciasAll.length}`)
  if (farmaciasAll.length < 3) throw new Error('Demasiado pocas farmacias detectadas. Parser fallido.')

  // 3) Geocodificar.
  const cache = loadCache()
  let nuevas = 0
  for (const f of farmaciasAll) {
    const dirLimpia = limpiarDireccion(f.direccion)
    const pueblo = f.pueblo || ''
    const key = `${dirLimpia} | ${pueblo}`
    if (cache[key]) {
      f.coord = cache[key]
      continue
    }
    process.stdout.write(`    geocoding "${dirLimpia.slice(0, 35)}" pueblo="${pueblo.slice(0, 20)}"... `)
    const coord = await geocode(dirLimpia, pueblo)
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

  // 4) Construir output.
  const guardias = []
  const seen = new Set()
  for (const f of farmaciasAll) {
    if (!f.coord) continue
    const dirLimpia = limpiarDireccion(f.direccion)
    const tel = extraerTelefono(f.direccion)
    const k = `${normalize(dirLimpia)}|${normalize(f.pueblo || f.zona || '')}`
    if (seen.has(k)) continue
    seen.add(k)
    const pueblo = f.pueblo ? titleCase(f.pueblo) : (f.zona === 'Palencia capital' ? 'Palencia' : titleCase(f.zona))
    // Limpiar nombre — quitar parens huerfanos, restos de GUARDIA, "FARMACIA"
    // inicial (en cualquier posicion tras basura), zona mezclada al inicio.
    let nombreLimpio = f.nombre.trim()
      .replace(/^[\)\(\-\s,·]+/, '')
      .replace(/[\)\(\-\s,·]+$/, '')
      .replace(/\s*GUARDIA\s+(?:24\s*HORAS?|24H|DIURNA|N[ÓO]CTURNA)\s*\*?\s*(?:\([^)]*\))?\s*/gi, ' ')
      .replace(/^(?:[A-Z]+\)\s*)?FARMACIA\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    // Si el nombre empieza con la zona (ej "Cervera De Pisuerga Ana Garcia",
    // "Villamuriel Dª Guadalupe"), quitar la zona o la primera palabra de
    // la zona.
    const zonaTitle = titleCase(f.zona || '')
    if (zonaTitle && nombreLimpio.toLowerCase().startsWith(zonaTitle.toLowerCase() + ' ')) {
      nombreLimpio = nombreLimpio.slice(zonaTitle.length).trim()
    } else if (zonaTitle) {
      const primeraPalabraZona = zonaTitle.split(/\s+/)[0]
      if (primeraPalabraZona.length > 4 &&
          nombreLimpio.toLowerCase().startsWith(primeraPalabraZona.toLowerCase() + ' ')) {
        nombreLimpio = nombreLimpio.slice(primeraPalabraZona.length).trim()
      }
    }
    // Si el nombre todavia parece zona o contiene la palabra de la zona,
    // descartar.
    if (zonaTitle && normalize(nombreLimpio) === normalize(zonaTitle)) nombreLimpio = ''
    const nom = nombreLimpio ? `Farmacia ${titleCase(nombreLimpio)}` : 'Farmacia de guardia'
    guardias.push([
      f.coord[0],
      f.coord[1],
      `${nom} · ${titleCase(dirLimpia)}`.slice(0, 140),
      pueblo,
      tel,
      '',
      f.horario || 'De guardia',
      '',
    ])
  }

  if (guardias.length < 3) throw new Error(`Solo ${guardias.length} guardias geocodificadas. Abortamos.`)

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
