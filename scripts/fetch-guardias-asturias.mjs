#!/usr/bin/env node
// v1.28 — Descarga las farmacias de guardia del Principado de Asturias
// desde la web del COF Asturias (farmasturias.org). Stack: ASP clasico
// (IIS), HTML server-rendered (no SPA, no JSON).
//
// Fuente:
//   GET https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp
//                                                                  ?IdMenu=355
//   → HTML con bloques `<h6 class="LocalidadGuardias">` por farmacia con
//   `javascript:VerMapa('direccion','farmacia','domicilio','CP','municipio',
//                       'NumeroFarmacia','IdInterno')` + telefono.
//
// Coordenadas:
//   El listado NO trae lat/lng. Hay que llamar por farmacia a:
//   GET https://www.farmasturias.org/GESCOF/cms/Guardias/openstreetmap.asp
//                                                       ?Id=<IdInterno>&...
//   → HTML con `var longitudfarma=43.27` (NOMBRE INVERTIDO: ese valor
//   es la LATITUD real) y `var latitudfarma=-6.60` (la LONGITUD real).
//   Hay que swapear al consumir.
//
// Cacheamos por IdInterno en `scripts/cache/asturias-geo.json`. Una vez
// geocodificada una farmacia, no se vuelve a pedir.
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
const CACHE_FILE = resolve(CACHE_DIR, 'asturias-geo.json')
const OUT_FILE = resolve(DATA_DIR, 'guardias-asturias.json')

const LIST_URL = 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355'
const COORD_URL_BASE = 'https://www.farmasturias.org/GESCOF/cms/Guardias/openstreetmap.asp'
const USER_AGENT = 'cercaya-guardias/1.28 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Asturias — incluye costa (Cabo Penas), Picos de Europa al
// este, Cangas del Narcea al oeste, Mieres al sur.
const BBOX = { minLat: 42.85, maxLat: 43.85, minLng: -7.25, maxLng: -4.45 }

const PAUSE_MS = 200

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
}

async function fetchHtml(url, attempts = 4) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.text()
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1500))
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

// Decode HTML entities basicas (&aacute; &eacute; &ntilde; etc.) que
// aparecen en el listado. No hacemos full HTML decode, suficiente para
// los campos que usamos.
function decodeEntities(s) {
  return String(s || '')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

// Extrae las farmacias del listado HTML. Estructura:
//   <h4 class="MunicipioGuardias">ALLANDE</h4>
//   <h5 class="HorarioGuardias"><a name='09:30 - 22:00'>De 9,30 horas...</a></h5>
//   <h6 class="LocalidadGuardias">
//     ... onclick="javascript:VerMapa('AVDA...','RODRIGUEZ...','AVDA...','33880','ALLANDE','183','178')" ...
//     <span class="ico-telefono">Telefono:&nbsp;985807047</span>
//   </h6>
function parseListado(html) {
  const farmacias = []
  // Iteramos por bloques de municipio. Capturamos municipio y todo su
  // contenido hasta el siguiente h4 o fin. El HTML del COF lleva 2 espacios
  // entre <h4 y class= asi que usamos \s+ para tolerarlo.
  const reBloqueMunicipio = /<h4\s+class="MunicipioGuardias">([^<]+)<\/h4>([\s\S]*?)(?=<h4\s+class="MunicipioGuardias">|$)/g
  let m
  while ((m = reBloqueMunicipio.exec(html)) !== null) {
    const municipio = decodeEntities(clean(m[1], 60))
    const contenido = m[2]
    // Dentro de un municipio puede haber varios horarios (turnos).
    // Capturamos cada h5 + farmacias asociadas hasta el siguiente h5.
    const reBloqueHorario = /<h5\s+class="HorarioGuardias"><a\s+name='([^']*)'[^>]*>([^<]*)<\/a>([\s\S]*?)(?=<h5\s+class="HorarioGuardias">|$)/g
    let h
    while ((h = reBloqueHorario.exec(contenido)) !== null) {
      const horarioRange = clean(h[1], 30) // "09:30 - 22:00"
      const horarioDesc = decodeEntities(clean(h[2], 80))
      const bloqueFarmacias = h[3]
      // Extraer cada farmacia del bloque.
      const reFarmacia = /VerMapa\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\)/g
      let f
      let lastEndIndex = 0
      while ((f = reFarmacia.exec(bloqueFarmacias)) !== null) {
        const [, dir, far, dom, cp, mun, num, id] = f
        // El telefono esta en el siguiente span ico-telefono. Buscamos
        // adelante en el HTML.
        const tail = bloqueFarmacias.slice(f.index, f.index + 1500)
        const telMatch = tail.match(/ico-telefono[^>]*>[^<]*?(\d[\d\s]+\d)/)
        const telefono = telMatch ? clean(telMatch[1], 30).replace(/\s+/g, '') : ''
        farmacias.push({
          id,
          numero: num,
          direccion: decodeEntities(clean(dir, 200)),
          farmacia: decodeEntities(clean(far, 80)),
          domicilio: decodeEntities(clean(dom, 200)),
          cp: clean(cp, 5),
          municipio: decodeEntities(clean(mun, 60)) || municipio,
          telefono,
          horarioRange,
          horarioDesc,
        })
        lastEndIndex = f.index
      }
    }
  }
  return farmacias
}

// Pide openstreetmap.asp para una farmacia y extrae lat/lng. Recordar
// que el COF tiene los nombres de variable INVERTIDOS: el valor en
// `longitudfarma` es la LATITUD real.
async function fetchCoord(farmacia) {
  const params = new URLSearchParams({
    Dir: farmacia.direccion,
    Far: farmacia.farmacia,
    Dom: farmacia.domicilio,
    CP: farmacia.cp,
    Mun: farmacia.municipio.toUpperCase(),
    NO: farmacia.numero,
    Id: farmacia.id,
  })
  const url = `${COORD_URL_BASE}?${params.toString()}`
  const html = await fetchHtml(url)
  // Variables con nombres invertidos.
  const mLat = html.match(/var\s+longitudfarma\s*=\s*([-0-9.]+)/)
  const mLng = html.match(/var\s+latitudfarma\s*=\s*([-0-9.]+)/)
  if (!mLat || !mLng) return null
  const lat = parseFloat(mLat[1])
  const lng = parseFloat(mLng[1])
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

async function main() {
  console.log('Descargando guardias Asturias (farmasturias.org)...')
  const html = await fetchHtml(LIST_URL)
  console.log(`  ${html.length} bytes recibidos`)
  const farmacias = parseListado(html)
  console.log(`  ${farmacias.length} farmacias parseadas del HTML`)

  if (farmacias.length < 20) {
    throw new Error(`Solo ${farmacias.length} farmacias. La estructura cambio?`)
  }
  if (farmacias.length > 250) {
    throw new Error(`Sospechoso: ${farmacias.length} farmacias. Max razonable ~150. Abortamos.`)
  }

  // Dedupe por IdInterno + horarioRange (algunas farmacias pueden aparecer
  // dos veces en distintos turnos; las concatenamos en horario).
  const dedupe = new Map()
  for (const f of farmacias) {
    const key = String(f.id || `${f.farmacia}|${f.direccion}`)
    if (dedupe.has(key)) {
      const existing = dedupe.get(key)
      if (!existing.horario.includes(f.horarioRange)) {
        existing.horario = `${existing.horario} / ${f.horarioRange}`.slice(0, 80)
      }
      continue
    }
    dedupe.set(key, {
      id: f.id,
      numero: f.numero,
      nombre: titleCase(f.farmacia),
      direccion: f.direccion,
      domicilio: f.domicilio,
      cp: f.cp,
      municipio: titleCase(f.municipio),
      telefono: f.telefono,
      horario: f.horarioRange,
      horarioDesc: f.horarioDesc,
    })
  }
  console.log(`  ${dedupe.size} farmacias unicas tras dedupe`)

  // Geocoding via openstreetmap.asp con cache por IdInterno.
  const cache = loadCache()
  let geocodedNuevas = 0
  let descartadas = 0
  for (const f of dedupe.values()) {
    if (cache[f.id]) {
      f.coord = cache[f.id]
      continue
    }
    try {
      const coord = await fetchCoord(f)
      if (coord) {
        cache[f.id] = coord
        f.coord = coord
        geocodedNuevas++
        if (geocodedNuevas % 10 === 0) {
          process.stdout.write(`    ${geocodedNuevas} geocodificadas...\n`)
          saveCache(cache)
        }
      } else {
        descartadas++
      }
    } catch {
      descartadas++
    }
    await new Promise(r => setTimeout(r, PAUSE_MS))
  }
  if (geocodedNuevas > 0) {
    saveCache(cache)
    console.log(`  ${geocodedNuevas} farmacias geocodificadas y guardadas en cache`)
  }
  if (descartadas > 0) {
    console.log(`  ${descartadas} farmacias sin coord (openstreetmap.asp fallo)`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    if (!f.coord) continue
    const dirFinal = `${f.nombre} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      f.municipio,
      f.telefono,
      f.cp,
      f.horario,
      f.horarioDesc,
    ])
  }

  if (guardias.length < 10) {
    throw new Error(`Solo ${guardias.length} farmacias con coord. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'farmasturias.org',
    territorio: 'asturias',
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
