#!/usr/bin/env node
// v1.31 — Descarga las farmacies de guardia de Lleida desde coflleida.cat.
// Es un ASP clasico (IIS) con encoding Windows-1252 que renderiza HTML
// estructurado por zonas geograficas + calendario mensual.
//
// Fuente:
//   1) GET https://www.coflleida.cat/cat/farmacies/farmacies.asp?Inicial=A
//      → HTML con todas las zonas que empiezan por la letra. Hay que
//        iterar A-V para sacar las ~120 zonas totales (cada zona = un
//        municipio o agrupacion de municipios).
//   2) GET .../farmacies.asp?Detall=Calendari&IdZona=NN&Any=YYYY&Mes=M&Dia=D
//      → HTML del calendario mensual de esa zona con bloque por dia.
//        Buscamos "DD de <mes_es>" (ej. "25 de abril"), y el siguiente bloque
//        farmacia tiene nombre, tipo guardia (DIA / NIT / DIA I NIT),
//        direccion, poblacion, telefono y coords Google Maps nativas en
//        `var point = new google.maps.LatLng(LAT, LNG);`.
//
// CAVEAT — encoding Windows-1252:
//   El servidor responde sin charset declarado pero el contenido usa
//   Windows-1252 (no UTF-8). Caracteres como `farmàcies` llegan como
//   `farm�cies` si decodificamos como UTF-8. Hay que usar TextDecoder
//   con 'windows-1252' o 'latin1' como fallback.
//
// CAVEAT — paginacion por inicial:
//   La pagina principal solo muestra zonas que empiezan por A. Hay un
//   menu de letras (A-V con huecos D, H, K, N, Q, U, X, Y, Z) que carga
//   las demas. Tenemos que enumerar todas para conseguir las ~120 zonas.
//
// CAVEAT — sin CP nativo:
//   Lleida no expone CP en el HTML. El campo CP queda vacio.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-lleida.json')

const BASE = 'https://www.coflleida.cat/cat/farmacies/farmacies.asp'
const USER_AGENT = 'cercaya-guardias/1.31 (+https://webapp-3ft.pages.dev)'

// Iniciales con farmacies. Las que no listan zonas (D, H, K, N, Q, U, X, Y, Z)
// las omitimos para no malgastar requests.
const INICIALES = ['A', 'B', 'C', 'E', 'F', 'G', 'I', 'J', 'L', 'M', 'O', 'P', 'R', 'S', 'T', 'V']

// Bbox provincia Lleida. Defensa contra coords basura del Google Maps init.
const BBOX = { minLat: 40.5, maxLat: 42.9, minLng: 0.2, maxLng: 1.8 }

// Mapeo numero de mes -> nombre en castellano (la web esta en catalan pero
// el bloque de calendario usa nombres de mes en castellano: "25 de abril").
const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function hoyParts() {
  const d = new Date()
  return {
    dia: d.getDate(),
    mes: d.getMonth() + 1,
    anyo: d.getFullYear(),
    diaMesEs: `${d.getDate()} de ${MESES_ES[d.getMonth()]}`,
  }
}

async function fetchHtml(url, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = await res.arrayBuffer()
      // Decode Windows-1252 (cae a latin1, mismo subset basico).
      return new TextDecoder('windows-1252').decode(buf)
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  throw lastErr
}

// Extrae todas las IdZona unicas iterando por inicial.
async function listarZonas() {
  const ids = new Set()
  for (const inicial of INICIALES) {
    const html = await fetchHtml(`${BASE}?Inicial=${inicial}`)
    const matches = html.match(/IdZona=(\d+)/g) || []
    for (const m of matches) {
      const id = parseInt(m.split('=')[1], 10)
      if (Number.isFinite(id)) ids.add(id)
    }
    await new Promise(r => setTimeout(r, 150))
  }
  return Array.from(ids).sort((a, b) => a - b)
}

function clean(s, max) {
  let t = String(s || '').replace(/\s+/g, ' ').trim()
  // Decodificar entidades HTML basicas que aparecen en el HTML servidor.
  t = t.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
       .replace(/&agrave;/g, 'à').replace(/&egrave;/g, 'è').replace(/&ograve;/g, 'ò')
       .replace(/&iacute;/g, 'í').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é')
       .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
       .replace(/&Agrave;/g, 'À').replace(/&Egrave;/g, 'È').replace(/&Ograve;/g, 'Ò')
       .replace(/&Iacute;/g, 'Í').replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É')
       .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
       .replace(/&iexcl;/g, '¡').replace(/&iquest;/g, '¿')
       .replace(/&middot;/g, '·').replace(/&#224;/g, 'à').replace(/&#232;/g, 'è')
       .replace(/&#233;/g, 'é').replace(/&#243;/g, 'ó').replace(/&#225;/g, 'á')
       .replace(/&#237;/g, 'í').replace(/&#250;/g, 'ú').replace(/&#231;/g, 'ç')
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ')
       .replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function parseCoord(latStr, lngStr) {
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  if (!isFinite(lat) || !isFinite(lng)) return null
  if (lat < BBOX.minLat || lat > BBOX.maxLat) return null
  if (lng < BBOX.minLng || lng > BBOX.maxLng) return null
  return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
}

// Parsea el bloque del calendario para encontrar farmacias del dia indicado.
// El HTML estructura cada dia como:
//   <td ...>DD de mes</td>   ← marcador del dia
//   ...separadores...
//   <div class="farmacia"><div class="dades">
//     <a ...><b>NOMBRE</b></a><br/>
//     <b>DIA I NIT</b><br/>     ← tipo guardia (puede no estar)
//     DIRECCION<br/>
//     POBLACION<br/>
//     Tel. ... TELEFONO<br/>
//   </div>...
//   var point = new google.maps.LatLng(LAT, LNG);
//
// El bloque siguiente al "DD de mes" son las farmacias activas hoy.
function extraerFarmaciasDelDia(html, diaMesEs) {
  const out = []
  const idxDia = html.indexOf(diaMesEs)
  if (idxDia === -1) return out
  // Buscar el siguiente "DD de <mes>" para acotar el bloque del dia actual.
  const siguienteFecha = html.slice(idxDia + diaMesEs.length).search(/\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/)
  const fin = siguienteFecha === -1 ? html.length : (idxDia + diaMesEs.length + siguienteFecha)
  const bloque = html.slice(idxDia, fin)

  // Cada farmacia es un <div class="farmacia">...</div> con su <script> con LatLng despues.
  const reFarmacia = /<div\s+class="farmacia">([\s\S]*?)<\/script>/g
  let m
  while ((m = reFarmacia.exec(bloque)) !== null) {
    const subBloque = m[1]
    // Nombre: dentro del <a><b>NOMBRE</b></a>
    const mNombre = subBloque.match(/<a\s+HREF="[^"]*IdFarmacia=\d+[^"]*"[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/a>/i)
    const nombre = mNombre ? clean(mNombre[1], 100) : ''

    // Tipo de guardia: <b>DIA I NIT</b> o <b>DIA</b> o <b>NIT</b>. Opcional.
    const mTipo = subBloque.match(/<\/a>\s*<br\s*\/?>([\s\S]*?)<br\s*\/?>([\s\S]*?)<br\s*\/?>([\s\S]*?)<br\s*\/?>/i)
    let tipoGuardia = ''
    let direccion = ''
    let poblacion = ''
    let telefono = ''
    if (mTipo) {
      // Estructura cuando hay tipo:
      //  ...<br/>TIPO<br/>DIRECCION<br/>POBLACION<br/>TELEFONO<br/>
      const seg1 = clean(mTipo[1])
      const seg2 = clean(mTipo[2])
      const seg3 = clean(mTipo[3])
      // Si seg1 parece tipo guardia ("DIA", "NIT", "DIA I NIT") lo separamos;
      // si no, era ya direccion (caso sin tipo explicito).
      if (/^(DIA|NIT|DIA I NIT)$/i.test(seg1)) {
        tipoGuardia = seg1.toUpperCase()
        direccion = seg2
        poblacion = seg3
      } else {
        direccion = seg1
        poblacion = seg2
      }
    }

    // Telefono: "Tel. ... NNNNNNNNN" — extraemos el primer numero de 9 digitos.
    const mTel = subBloque.match(/(?:Tel\.\s*Farm[^:]*:\s*|Tel[^:]*:\s*)?(\d{9})/i)
    if (mTel) telefono = mTel[1]

    // Coords Google Maps en el <script> que sigue al div.
    const mCoord = m[0].match(/google\.maps\.LatLng\(\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\)/)
    const coord = mCoord ? parseCoord(mCoord[1], mCoord[2]) : null

    if (!nombre || !coord) continue

    out.push({
      nombre,
      direccion,
      poblacion,
      telefono,
      coord,
      tipoGuardia,
    })
  }
  return out
}

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

async function main() {
  const { dia, mes, anyo, diaMesEs } = hoyParts()
  console.log(`Descargando guardies Lleida (${dia}/${mes}/${anyo}) — ASP coflleida.cat...`)

  const zonas = await listarZonas()
  console.log(`  ${zonas.length} zonas detectadas`)
  if (zonas.length < 50) {
    throw new Error(`Solo ${zonas.length} zonas. La estructura del menu cambio?`)
  }

  const dedupe = new Map()
  let descartadasCoord = 0
  let zonasConGuardia = 0
  for (const id of zonas) {
    try {
      const html = await fetchHtml(`${BASE}?Detall=Calendari&IdZona=${id}&Any=${anyo}&Mes=${mes}&Dia=${dia}`)
      const farms = extraerFarmaciasDelDia(html, diaMesEs)
      if (farms.length > 0) zonasConGuardia++
      for (const f of farms) {
        const key = `${f.coord[0]},${f.coord[1]}|${f.nombre}`
        if (dedupe.has(key)) continue
        dedupe.set(key, f)
      }
    } catch (e) {
      console.error(`    zona ${id}: ${e.message}`)
    }
    // Pausa corta para no martillear el ASP.
    await new Promise(r => setTimeout(r, 180))
  }
  console.log(`  ${zonasConGuardia} zonas con guardia hoy, ${dedupe.size} farmacias unicas`)

  if (descartadasCoord > 0) {
    console.log(`  ${descartadasCoord} descartadas por coords fuera del bbox`)
  }
  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias detectadas. Abortamos.`)
  }
  if (dedupe.size > 200) {
    throw new Error(`Sospechoso: ${dedupe.size} farmacias. Max razonable ~150.`)
  }

  const guardias = []
  for (const f of dedupe.values()) {
    const dirFinal = `${titleCase(f.nombre)} · ${f.direccion}`
    guardias.push([
      f.coord[0],
      f.coord[1],
      dirFinal.slice(0, 140),
      titleCase(f.poblacion),
      f.telefono,
      '', // CP no expuesto en el HTML
      f.tipoGuardia || '',
      '',
    ])
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'coflleida.cat',
    territorio: 'lleida',
    count: guardias.length,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardies guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
