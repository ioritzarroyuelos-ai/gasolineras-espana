#!/usr/bin/env node
// v1.30 — Descarga las farmacias de guardia (mas en general "abiertas
// ahora") de Caceres desde el portal del COF Caceres. Stack: Laravel +
// Hugo, sin Cloudflare, sin login. Requiere CSRF token + cookies de
// sesion obtenidos en el GET inicial.
//
// Fuente:
//   GET  https://farmacias.cofcaceres.es/  → CSRF + XSRF/laravel_session
//   POST https://farmacias.cofcaceres.es/buscar-farmacias-por-municipios
//        body: _token=<csrf>&municipio_id=<id>&buscar_abiertas=1
//   → HTML con div.row-item-listado-farmacia por farmacia. Coordenadas
//   en URL `google.es/maps/dir//<lat>,<lng>`.
//
// Estrategia:
//   El COF Caceres no tiene un endpoint "todas las guardias provincia".
//   Hay que iterar los 197 municipios. Con pausa 80ms son ~16s totales.
//   Cacheamos la lista de municipios validos en `scripts/cache/caceres-mun.json`
//   para evitar pedir municipios sin farmacias en futuras runs.
//
// CAVEAT — "Abierta" vs "guardia":
//   El COF marca solo "Diurna"/"Abierta" en sus badges. No hay una
//   etiqueta "guardia 24h" diferenciada — el filtro `buscar_abiertas=1`
//   devuelve todas las que estan abiertas en este momento (regulares
//   + guardia). Para CercaYa esto coincide con lo que quiere el usuario:
//   "donde puedo comprar paracetamol AHORA".
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const CACHE_DIR = resolve(__dirname, 'cache')
const CACHE_MUN_FILE = resolve(CACHE_DIR, 'caceres-mun.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-caceres.json')

const HOME_URL = 'https://farmacias.cofcaceres.es/'
const POST_URL = 'https://farmacias.cofcaceres.es/buscar-farmacias-por-municipios'
const USER_AGENT = 'cercaya-guardias/1.30 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Caceres (Trujillo, Plasencia, Coria, Hervas, Las Hurdes,
// Valle del Jerte). Defensa contra coords en otra provincia.
const BBOX = { minLat: 39.05, maxLat: 40.55, minLng: -7.55, maxLng: -5.0 }

const PAUSE_MS = 80

function loadCacheMun() {
  if (!existsSync(CACHE_MUN_FILE)) return null
  try {
    return JSON.parse(readFileSync(CACHE_MUN_FILE, 'utf8'))
  } catch {
    return null
  }
}

function saveCacheMun(cache) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_MUN_FILE, JSON.stringify(cache, null, 2))
}

async function fetchHome() {
  const res = await fetch(HOME_URL, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`GET home HTTP ${res.status}`)
  // Laravel manda Set-Cookie: XSRF-TOKEN=...; laravel_session=...
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || '']
  const cookieParts = []
  for (const c of setCookies) {
    if (!c) continue
    const m = c.match(/^([^=]+=[^;]+)/)
    if (m) cookieParts.push(m[1])
  }
  const cookie = cookieParts.join('; ')
  const html = await res.text()
  const tokenMatch = html.match(/name="_token"\s+value="([^"]+)"/)
  if (!tokenMatch) throw new Error('No CSRF token en home')
  // Tambien aprovechamos para leer la lista de municipios validos.
  const municipios = []
  const reMun = /<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g
  let m
  while ((m = reMun.exec(html)) !== null) {
    municipios.push({ id: parseInt(m[1], 10), nombre: m[2].trim() })
  }
  return { token: tokenMatch[1], cookie, municipios }
}

async function fetchMunicipio(id, token, cookie, attempts = 2) {
  const body = new URLSearchParams({
    _token: token,
    municipio_id: String(id),
    buscar_abiertas: '1',
  }).toString()
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(POST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': HOME_URL,
          'Cookie': cookie,
          'User-Agent': USER_AGENT,
        },
        body,
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, 800))
    }
  }
  throw lastErr
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

// Parse direccion estilo "AVDA. HEROES DE BALER, 9, 10004, CACERES"
// → { calle, cp, ciudad }.
function parseDireccion(raw) {
  const s = clean(raw, 200)
  const partes = s.split(',').map(p => p.trim()).filter(Boolean)
  let cp = ''
  let cpIdx = -1
  for (let i = partes.length - 1; i >= 0; i--) {
    if (/^\d{5}$/.test(partes[i])) {
      cp = partes[i]
      cpIdx = i
      break
    }
  }
  let ciudad = ''
  if (cpIdx >= 0 && cpIdx < partes.length - 1) {
    ciudad = partes.slice(cpIdx + 1).join(', ')
  }
  const calle = (cpIdx >= 0 ? partes.slice(0, cpIdx) : partes.slice(0, -1)).join(', ').trim()
  return { calle, cp, ciudad: titleCase(ciudad) }
}

// Extrae farmacias de la respuesta HTML de un municipio.
function parseMunicipio(html) {
  const farmacias = []
  // Cada farmacia es un div.row-item-listado-farmacia. Capturamos el bloque
  // hasta el siguiente div del mismo tipo (o final del listado).
  const reBloque = /<div\s+class="row mt-4 row-item-listado-farmacia">([\s\S]*?)(?=<div\s+class="row mt-4 row-item-listado-farmacia">|<div\s+class="col-12 text-center mt-5">|$)/g
  let b
  while ((b = reBloque.exec(html)) !== null) {
    const card = b[1]
    const nombreM = card.match(/<strong\s+class="d-block d-md-inline texto-rojizo">([^<]+)<\/strong>/)
    if (!nombreM) continue
    const nombre = clean(nombreM[1], 80)
    const dirM = card.match(/<i\s+class="fa fa-map-marker-alt[^"]*"><\/i>\s*([^<]+)/)
    const telM = card.match(/<i\s+class="fa fa-phone[^"]*"><\/i>\s*\n*\s*([^<]+)/)
    const coordM = card.match(/google\.es\/maps\/dir\/\/([0-9.\-]+),([0-9.\-]+)/)
    if (!coordM) continue
    const lat = parseFloat(coordM[1])
    const lng = parseFloat(coordM[2])
    if (!isFinite(lat) || !isFinite(lng)) continue
    if (lat < BBOX.minLat || lat > BBOX.maxLat) continue
    if (lng < BBOX.minLng || lng > BBOX.maxLng) continue
    const dirParseada = dirM ? parseDireccion(dirM[1]) : { calle: '', cp: '', ciudad: '' }
    const telefono = telM ? clean(telM[1], 30).replace(/[\s,]+/, '').replace(/[^0-9]+$/, '') : ''
    farmacias.push({
      coord: [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5],
      nombre: titleCase(nombre),
      direccion: dirParseada.calle,
      cp: dirParseada.cp,
      ciudad: dirParseada.ciudad,
      telefono,
    })
  }
  return farmacias
}

async function main() {
  console.log('Descargando guardias Caceres (cofcaceres Laravel)...')
  const { token, cookie, municipios: munList } = await fetchHome()
  console.log(`  CSRF + sesion obtenidos. Lista municipios = ${munList.length}`)

  // Si tenemos cache de municipios validos (con farmacias en runs previas),
  // limitamos a esos para acelerar. Si no, iteramos todos.
  let cacheMun = loadCacheMun()
  const municipiosAEvaluar = cacheMun?.idsValidos
    ? munList.filter(m => cacheMun.idsValidos.includes(m.id))
    : munList
  console.log(`  Iterando ${municipiosAEvaluar.length} municipios...`)

  const todas = []
  const idsConFarmacia = new Set()
  let procesados = 0
  let conFarmacia = 0
  for (const mun of municipiosAEvaluar) {
    try {
      const html = await fetchMunicipio(mun.id, token, cookie)
      const lista = parseMunicipio(html)
      if (lista.length > 0) {
        idsConFarmacia.add(mun.id)
        conFarmacia++
        for (const f of lista) {
          f.municipio = f.ciudad || titleCase(mun.nombre)
          todas.push(f)
        }
      }
    } catch {
      // ignoramos errores aislados
    }
    procesados++
    if (procesados % 20 === 0) {
      process.stdout.write(`    ${procesados} procesados, ${conFarmacia} con farmacia, ${todas.length} farmacias acumuladas\n`)
    }
    await new Promise(r => setTimeout(r, PAUSE_MS))
  }
  console.log(`  ${procesados} municipios procesados, ${conFarmacia} con guardia, ${todas.length} farmacias raw`)

  // Persistimos los ids validos para futuras runs (si no teniamos cache).
  if (!cacheMun?.idsValidos) {
    saveCacheMun({ ts: new Date().toISOString(), idsValidos: [...idsConFarmacia].sort((a, b) => a - b) })
    console.log(`  cache de ${idsConFarmacia.size} ids validos guardada`)
  }

  // Dedupe por (nombre+direccion+cp).
  const dedupe = new Map()
  for (const f of todas) {
    const key = `${f.nombre}|${f.direccion}|${f.cp}`.toLowerCase()
    if (dedupe.has(key)) continue
    dedupe.set(key, f)
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias. Esperado >20. Abortamos.`)
  }
  if (dedupe.size > 800) {
    throw new Error(`Sospechoso: ${dedupe.size} farmacias. Max razonable ~400. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      // El COF marca el horario en estructura compleja por dia — para MVP
      // dejamos vacio y guardamos "Abierta" en horarioDesc para indicar
      // que estaba abierta en el momento del scrape.
      '',
      'Abierta',
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'farmacias.cofcaceres.es',
    territorio: 'caceres',
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
