#!/usr/bin/env node
// v1.10 — Descarga las farmacias de guardia de Bizkaia desde la web ASP.NET
// del COF Bizkaia (cofbizkaia.net).
//
// Fuente:
//   https://www.cofbizkaia.net/Sec_DF/wf_DirectorioFarmaciaGuardialst.aspx?IdMenu=52
//   Un GET simple ya devuelve el HTML con las guardias de HOY renderizadas
//   server-side (ASP.NET WebForms con GridView). La fecha por defecto es la
//   del dia actual — si quieres otra, hace falta un POST con __VIEWSTATE
//   pero no es nuestro caso.
//
// Cada farmacia en el HTML viene en un bloque:
//   <div id="ctl00_ch_gridDatos_ctlNN_divResultados" class="ResultadosFarmaciasGuardia">
//     <h5>MUNICIPIO</h5>
//     <h6><a href="..." >NOMBRE</a> <a href="../Recursos/google.aspx?...coord=LAT;LNG">...</a></h6>
//     <dl>
//       <dt>Direccion:</dt><dd><span>DIRECCION</span></dd>
//       <dt>Telefono:</dt><dd><span>TELEFONO</span></dd>
//       <dt>Poblacion:</dt><dd><span>POBLACION</span></dd>
//       <dt>Zona:</dt><dd><span>ZONA</span></dd>
//       <dt>Horario</dt><dd><span>HORARIO</span></dd>
//     </dl>
//   </div>
//
// El COF suele listar ~180-200 farmacias por dia (dia + noche + festivos).
// Pero solo ~70-80% tienen coord asociada en el link a Google Maps — las
// demas no estan geocoded en su BD. Descartamos las sin coord porque sin
// lat/lng no sirven para filtro por proximidad GPS (caso de uso principal).
// Tipicamente salen ~135-150 guardias con coord.
//
// Umbral defensivo: <80 o >400 aborta sin sobrescribir.
//
// Schema del output:
//   public/data/guardias-bizkaia.json con formato compacto:
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//   (mismo schema que guardias-madrid.json para reutilizar codigo del frontend)

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-bizkaia.json')

const COF_URL = 'https://www.cofbizkaia.net/Sec_DF/wf_DirectorioFarmaciaGuardialst.aspx?IdMenu=52'
const USER_AGENT = 'cercaya-guardias/1.10 (+https://webapp-3ft.pages.dev)'

async function fetchCOF(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COF_URL, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9,eu;q=0.5',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (html.length < 10000) throw new Error(`HTML sospechoso (${html.length} bytes)`)
      return html
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

// Decodifica entidades HTML basicas sin pulir todo el set — la web usa pocas:
// &#209;=N_tilde, &#220;=U_dieresis, &aacute;, etc. Lo justo para nombres.
//
// Orden IMPORTA: `&amp;` se decodifica AL FINAL para evitar double-unescape.
// Si empezamos por `&amp;` -> `&`, un input tipo `&amp;lt;` (representacion
// literal de `&lt;`) acabaria convertido en `<`, que no es lo que queremos.
// CodeQL marca el orden inverso como vulnerabilidad, con razon.
function decodeEntities(s) {
  if (!s) return ''
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&aacute;/gi, 'a')
    .replace(/&eacute;/gi, 'e')
    .replace(/&iacute;/gi, 'i')
    .replace(/&oacute;/gi, 'o')
    .replace(/&uacute;/gi, 'u')
    .replace(/&ntilde;/gi, 'n')
    .replace(/&amp;/g, '&')
    .trim()
}

function clean(s, max) {
  const t = decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim()
  return max ? t.slice(0, max) : t
}

function parseCoord(raw) {
  if (raw == null) return NaN
  const n = parseFloat(String(raw).replace(',', '.'))
  return isFinite(n) ? Math.round(n * 1e5) / 1e5 : NaN
}

// Parsea un bloque ctl00_ch_gridDatos_ctlNN_divResultados. Devuelve null si
// faltan campos basicos (nombre/coord/direccion). Los bloques vienen en un
// orden consistente: primero h4 opcional (hora cabecera), luego h5 (municipio),
// h6 (nombre + link google maps con coord), y dl con el resto.
function parseBloque(html) {
  // La web del COF Bizkaia cambio (2026): ya no da coordenadas ni los ids
  // antiguos. Cada farmacia trae spans lbl<Campo>Detalle. Como el mapa se
  // retiro, guardamos sin coordenadas (0,0). "Cerrado" = no abierta hoy -> fuera
  // (en findes/festivos las abiertas SON la rotacion de guardia).
  const grab = (label) => {
    const m = html.match(new RegExp('id="[^"]*lbl' + label + '"[^>]*>([\\s\\S]*?)</span>'))
    return m ? clean(m[1], 140) : ''
  }
  const nombre = grab('FarmaciaNombre')
  const direccion = grab('Direccion')
  const poblacion = grab('Poblacion')
  const horario = grab('HorarioDetalle')
  const telefono = grab('TelefonoDetalle')
  if (!nombre && !direccion) return null
  if (!horario || /cerrad/i.test(horario)) return null
  const direccionFinal = nombre ? (direccion ? nombre + ' \u00b7 ' + direccion : nombre) : direccion
  return [0, 0, direccionFinal.slice(0, 140), poblacion, telefono, '', horario, '']
}

async function main() {
  console.log('Descargando farmacias de guardia de Bizkaia (COF Bizkaia)...')
  const html = await fetchCOF()
  console.log(`  HTML descargado (${html.length} bytes)`)

  // El lblTotal del panel de resultados dice cuantas hay en total. Sirve de
  // sanity check antes de parsear.
  const mTotal = html.match(/id="[^"]*lblTotal"[^>]*>(\d+)<\/span>/)
  const totalDeclarado = mTotal ? parseInt(mTotal[1], 10) : null
  if (totalDeclarado != null) console.log(`  total declarado por el COF: ${totalDeclarado}`)

  // Cada farmacia empieza en su span lblFarmaciaNombre; troceamos por ahi.
  const totalFarmacias = (html.match(/lblFarmaciaNombre"/g) || []).length
  console.log(`  ${totalFarmacias} farmacias en el HTML`)
  if (totalFarmacias < 50) {
    throw new Error(`Solo ${totalFarmacias} farmacias en el HTML (Bizkaia ~170). La web cambio? Abortamos sin sobrescribir.`)
  }
  const partes = html.split(/(?=id="[^"]*lblFarmaciaNombre")/)
  const guardias = []
  let cerradas = 0
  for (const parte of partes) {
    const row = parseBloque(parte)
    if (row) guardias.push(row)
    else cerradas++
  }

  console.log(`  ${guardias.length} abiertas hoy (de guardia); ${cerradas} cerradas/descartadas`)

  // No ponemos minimo alto: en domingo/festivo hay pocas abiertas. El sanity de
  // parseo va sobre totalFarmacias (arriba). Solo evitamos escribir vacio.
  if (guardias.length < 1) {
    throw new Error('Cero farmacias abiertas detectadas. Abortamos sin sobrescribir.')
  }
  if (guardias.length > 400) {
    throw new Error(`Sospechoso: ${guardias.length} farmacias. Abortamos sin sobrescribir.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofbizkaia.net',
    territorio: 'bizkaia',
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
