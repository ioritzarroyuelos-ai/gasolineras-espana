#!/usr/bin/env node
// v1.37 — Descarga las farmacias de guardia de Valladolid desde
// ciudadanos.farmaceuticosdevalladolid.es/FarmaciasGuardia.aspx.
//
// El COF de Valladolid usa una pagina ASP.NET WebForms que ya expone los
// markers del mapa Google Maps en el HTML inicial como un array JS:
//   var markers = [
//     {
//       "title": 'TITULAR',
//       "lat": '41.625',
//       "lng": '-4.774',
//       "description": 'TITULAR<br />Calle X , 19 , Municipio<br />tlf.  , 983408069'
//     },
//     ...
//   ];
//
// Eso significa que NO hace falta geocodificar (ya vienen lat/lng) y el HTML
// trae todo lo necesario en una sola peticion. Para el MVP cogemos solo el
// listado por defecto (diurnas capital + provincia 24h + localizadas). La
// "guardia nocturna en la capital" requiere postback ASP.NET con ViewState
// y la dejamos fuera por simplicidad — para Valladolid capital noche el
// usuario verá las 24h de la provincia que cubren toda la zona.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-valladolid.json')

const URL_GUARDIAS = 'https://ciudadanos.farmaceuticosdevalladolid.es/FarmaciasGuardia.aspx'
const USER_AGENT = 'cercaya-guardias/1.37 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Valladolid (margen generoso).
const BBOX = { minLat: 41.0, maxLat: 42.2, minLng: -5.6, maxLng: -3.9 }

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

/** Decodifica entidades HTML basicas (&aacute;, &amp;, &nbsp;, etc.). */
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Parsea un marker del array JS y devuelve { lat, lng, titular, calle, municipio, telefono }. */
function parseMarker(matchObj) {
  const lat = parseFloat(matchObj.lat)
  const lng = parseFloat(matchObj.lng)
  if (!isFinite(lat) || !isFinite(lng)) return null
  const description = decodeHtmlEntities(matchObj.description)
  // Formato: "TITULAR<br />Calle X , 19 , Municipio<br />tlf.  , 983408069"
  const partes = description.split(/<br\s*\/?>/i).map(p => p.trim()).filter(Boolean)
  if (partes.length < 2) return null
  const titular = partes[0]
  // Linea 2: "Calle X , 19 , Municipio"  — separadores ", " o ","
  const segs = partes[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
  let calle = '', numero = '', municipio = ''
  if (segs.length >= 3) {
    calle = segs[0]
    numero = segs[1]
    municipio = segs.slice(2).join(', ')
  } else if (segs.length === 2) {
    calle = segs[0]
    municipio = segs[1]
  } else {
    calle = segs[0] || ''
  }
  // Linea 3: "tlf.  , 983408069" — extraer ultimos digitos
  let telefono = ''
  if (partes[2]) {
    const m = partes[2].match(/\d{6,12}/)
    if (m) telefono = m[0]
  }
  return { lat, lng, titular, calle, numero, municipio, telefono }
}

async function main() {
  console.log(`Descargando guardias Valladolid (COF)...`)

  const res = await fetch(URL_GUARDIAS, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const html = await res.text()

  // Extraer cada objeto del array `markers`. Los campos vienen en orden
  // title/lat/lng/description y separados por comas; usamos un regex suelto
  // que captura cada bloque entre `{` y `}` y luego parsea los pares.
  const markers = []
  const reBlock = /\{\s*"title":\s*'([^']*?)'\s*,\s*"lat":\s*'([^']*?)'\s*,\s*"lng":\s*'([^']*?)'\s*,\s*"description":\s*'([^']*?)'\s*\}/g
  let m
  while ((m = reBlock.exec(html)) !== null) {
    markers.push({ title: m[1], lat: m[2], lng: m[3], description: m[4] })
  }
  console.log(`  ${markers.length} markers detectados`)
  if (markers.length < 3) {
    throw new Error(`Solo ${markers.length} markers. Estructura cambio?`)
  }
  if (markers.length > 200) {
    throw new Error(`Sospechoso: ${markers.length} markers. Max razonable ~80.`)
  }

  const guardias = []
  for (const mk of markers) {
    const d = parseMarker(mk)
    if (!d) continue
    if (d.lat < BBOX.minLat || d.lat > BBOX.maxLat) continue
    if (d.lng < BBOX.minLng || d.lng > BBOX.maxLng) continue
    const calleNum = d.numero ? `${d.calle}, ${d.numero}` : d.calle
    const dirFinal = `${titleCase(d.titular)} · ${titleCase(calleNum)}`
    guardias.push([
      Math.round(d.lat * 1e5) / 1e5,
      Math.round(d.lng * 1e5) / 1e5,
      dirFinal.slice(0, 140),
      titleCase(d.municipio),
      d.telefono,
      '',
      // Sin distincion fiable DIA/NOCHE en el listado por defecto;
      // en otras provincias diferenciamos pero aqui dejamos vacio.
      '',
      '',
    ])
  }

  if (guardias.length < 3) {
    throw new Error(`Solo ${guardias.length} farmacias validas tras bbox. Abortamos.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'ciudadanos.farmaceuticosdevalladolid.es',
    territorio: 'valladolid',
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
