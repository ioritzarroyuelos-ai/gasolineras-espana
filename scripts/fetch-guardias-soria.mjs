#!/usr/bin/env node
// v1.32 — Descarga las farmacias de guardia de Soria desde cofsoria.es.
// Es WordPress con plantilla custom: HTML server-rendered con bloques
// `farmacia-item` que enlazan a una ficha individual con coords nativas
// en `L.map.setView([lat, lng], 16)`.
//
// Fuente:
//   1) GET https://www.cofsoria.es/ciudadanos/farmacias-de-guardia/
//      → HTML listado con bloques `<div class="farmacia-item">` y links
//        `<a href="?farmacia=N">Ver ficha</a>`. Cada bloque tiene
//        municipio, direccion (sin CP) y horario (icon-sol/icon-luna).
//   2) GET .../?farmacia=N
//      → HTML ficha con `<div class="ficha-municipio">`,
//        `<div class="ficha-direccion">CALLE, CP</div>`,
//        `<div class="ficha-titular">NOMBRE</div>`,
//        `<a href="tel:+34 975 ...">TELEFONO</a>`,
//        `<div class="ficha-dato-valor">TIPO_GUARDIA</div>`,
//        y `L.map('map').setView([LAT, LNG], 16)`.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-soria.json')

const LIST_URL = 'https://www.cofsoria.es/ciudadanos/farmacias-de-guardia/'
const USER_AGENT = 'cercaya-guardias/1.32 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Soria (margen generoso). Defensa contra coords basura.
const BBOX = { minLat: 41.0, maxLat: 42.3, minLng: -3.4, maxLng: -1.7 }

async function fetchHtml(url, attempts = 3) {
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
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  throw lastErr
}

function clean(s, max) {
  let t = String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

function parseCoord(latStr, lngStr) {
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Extrae todos los IDs de farmacia del listado.
function extraerIds(html) {
  const set = new Set()
  const re = /[?&]farmacia=(\d+)/g
  let m
  while ((m = re.exec(html)) !== null) set.add(parseInt(m[1], 10))
  return Array.from(set).sort((a, b) => a - b)
}

// Parsea la ficha individual y devuelve los datos. La estructura es:
//   <div class="ficha-header">
//     <div class="ficha-municipio">Municipio</div>
//     <div class="ficha-direccion">Tipo Calle Nombre, CP</div>
//     <div class="ficha-titular">NOMBRE</div>
//   </div>
//   <a href="tel:...">Telefono</a>
//   <div class="ficha-dato-label">Tipo de Guardia</div>
//   <div class="ficha-dato-valor">24HORAS|HASTA 22:00|...</div>
//   L.map('map').setView([lat, lng], 16)
function parseFicha(html) {
  const mMun = html.match(/<div\s+class="ficha-municipio">([\s\S]*?)<\/div>/i)
  const mDir = html.match(/<div\s+class="ficha-direccion">([\s\S]*?)<\/div>/i)
  const mTit = html.match(/<div\s+class="ficha-titular">([\s\S]*?)<\/div>/i)
  const mTel = html.match(/<a\s+href="tel:([^"]+)"/i)
  const mCoord = html.match(/L\.map\(['"]map['"]\)\.setView\(\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/i)

  // Tipo de guardia: el div ficha-dato-valor que sigue al label "Tipo de Guardia".
  let tipoGuardia = ''
  const idxTipo = html.indexOf('Tipo de Guardia')
  if (idxTipo !== -1) {
    const sub = html.slice(idxTipo, idxTipo + 600)
    const mTipo = sub.match(/<div\s+class="ficha-dato-valor"[^>]*>([\s\S]*?)<\/div>/i)
    if (mTipo) tipoGuardia = clean(mTipo[1])
  }

  if (!mCoord) return null
  const coord = parseCoord(mCoord[1], mCoord[2])
  if (!coord) return null

  // Direccion viene como "Calle MARQUES DE VADILLO, 42002" — separamos CP.
  const dirRaw = mDir ? clean(mDir[1]) : ''
  let direccion = dirRaw
  let cp = ''
  const mCP = dirRaw.match(/,\s*(\d{5})\s*$/)
  if (mCP) {
    cp = mCP[1]
    direccion = dirRaw.replace(/,\s*\d{5}\s*$/, '').trim()
  }

  // Telefono viene como "+34 975 211 183" — limpiamos espacios y prefijo.
  let telefono = mTel ? mTel[1].replace(/\s+/g, '').replace(/^\+34/, '') : ''

  return {
    municipio: mMun ? clean(mMun[1]) : '',
    direccion,
    cp,
    titular: mTit ? clean(mTit[1]) : '',
    telefono,
    tipoGuardia,
    coord,
  }
}

async function main() {
  console.log('Descargando guardias Soria — cofsoria.es...')

  const listHtml = await fetchHtml(LIST_URL)
  const ids = extraerIds(listHtml)
  console.log(`  ${ids.length} farmacias en el listado`)
  if (ids.length < 3) {
    throw new Error(`Solo ${ids.length} IDs detectados. La estructura cambio?`)
  }
  if (ids.length > 50) {
    throw new Error(`Sospechoso: ${ids.length} IDs. Max razonable ~30.`)
  }

  const dedupe = new Map()
  let descartadas = 0
  for (const id of ids) {
    try {
      const html = await fetchHtml(`${LIST_URL}?farmacia=${id}`)
      const f = parseFicha(html)
      if (!f) {
        descartadas++
        continue
      }
      const key = `${f.coord[0]},${f.coord[1]}`
      if (dedupe.has(key)) continue
      dedupe.set(key, f)
    } catch (e) {
      console.error(`    farmacia ${id}: ${e.message}`)
      descartadas++
    }
    await new Promise(r => setTimeout(r, 250))
  }
  console.log(`  ${dedupe.size} farmacias unicas, ${descartadas} descartadas`)

  if (dedupe.size < 3) {
    throw new Error(`Solo ${dedupe.size} farmacias validas. Abortamos.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const titNombre = titleCase(f.titular)
    const dirFinal = titNombre ? `${titNombre} · ${titleCase(f.direccion)}` : titleCase(f.direccion)
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      titleCase(f.municipio),
      f.telefono,
      f.cp,
      f.tipoGuardia,
      '',
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofsoria.es',
    territorio: 'soria',
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
