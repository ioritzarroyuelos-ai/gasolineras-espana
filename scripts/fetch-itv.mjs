#!/usr/bin/env node
// Descarga las estaciones de ITV y las deja normalizadas en public/data/itv.json.
//
// FUENTE PRINCIPAL: el buscador de ITV de la DGT se alimenta de un FeatureServer
// de ArcGIS publico (sin API key ni registro). Devuelve las ~470 estaciones en
// una sola peticion de ~300 KB. Licencia: Ley 37/2007 + RD 1495/2011, uso
// comercial permitido con atribucion.
//
// PARCHE: el dataset de la DGT NO tiene ninguna estacion de Castellon (0 de 470,
// comprobado). No es un problema de nomenclatura: es un hueco. Las tres fijas de
// esa provincia se sacan del portal de datos abiertos de la Generalitat
// Valenciana, que si las publica (con horario, aunque sin coordenadas).
//
// Si la fuente principal falla, NO se sobrescribe el fichero anterior.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')

const DGT_URL = 'https://services3.arcgis.com/TXNiwnLDifb5lMaR/ArcGIS/rest/services/ITV/FeatureServer/0/query'
  + '?where=1%3D1&outFields=*&f=geojson&outSR=4326'

const GVA_CSV = 'https://dadesobertes.gva.es/dataset/f5b0a27c-0ae5-41a4-93bb-d18ea34243ec'
  + '/resource/0881b4a5-62c7-483c-ba57-748c965f633d/download/estaciones-itv.csv'

// El campo Provincia de la DGT viene sucio: erratas del origen ("CUIDAD REAL"),
// exonimos en castellano ("LLERIDA", "ORENSE", "LA CORUÑA"), islas tratadas como
// provincia, y un unico registro en formato titulo. Se mapea a codigo INE, que
// es lo que usa el resto del proyecto (src/lib/provincias.ts).
const PROVINCIA_A_INE = {
  'ALAVA': '01', 'ALBACETE': '02', 'ALICANTE': '03', 'ALMERIA': '04', 'AVILA': '05',
  'BADAJOZ': '06',
  'MALLORCA': '07', 'IBIZA': '07', 'MENORCA': '07', 'FORMENTERA': '07', 'BALEARES': '07',
  'BARCELONA': '08', 'BURGOS': '09', 'CACERES': '10', 'CADIZ': '11', 'CASTELLON': '12',
  'CIUDAD REAL': '13', 'CUIDAD REAL': '13',            // errata en el origen
  'CORDOBA': '14',
  'LA CORUNA': '15', 'A CORUNA': '15', 'CORUNA': '15',
  'CUENCA': '16', 'GIRONA': '17', 'GERONA': '17', 'GRANADA': '18', 'GUADALAJARA': '19',
  'GUIPUZCOA': '20', 'GIPUZKOA': '20',
  'HUELVA': '21', 'HUESCA': '22', 'JAEN': '23', 'LEON': '24',
  'LLEIDA': '25', 'LLERIDA': '25', 'LERIDA': '25',
  'LA RIOJA': '26', 'LUGO': '27', 'MADRID': '28', 'MALAGA': '29', 'MURCIA': '30',
  'NAVARRA': '31',
  'ORENSE': '32', 'OURENSE': '32',
  'ASTURIAS': '33', 'PALENCIA': '34',
  'GRAN CANARIA': '35', 'FUERTEVENTURA': '35', 'LANZAROTE': '35', 'LAS PALMAS': '35',
  'PONTEVEDRA': '36', 'SALAMANCA': '37',
  'TENERIFE': '38', 'LA PALMA': '38', 'EL HIERRO': '38', 'LA GOMERA': '38',
  'SANTA CRUZ DE TENERIFE': '38',
  'CANTABRIA': '39', 'SEGOVIA': '40', 'SEVILLA': '41', 'SORIA': '42', 'TARRAGONA': '43',
  'TERUEL': '44', 'TOLEDO': '45', 'VALENCIA': '46', 'VALLADOLID': '47',
  'VIZCAYA': '48', 'BIZKAIA': '48',
  'ZAMORA': '49', 'ZARAGOZA': '50',
  'CIUDAD A. CEUTA': '51', 'CEUTA': '51',
  'CIUDAD A. MELILLA': '52', 'MELILLA': '52',
}

function sinAcentos(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// "OLIVENZA," viene con coma final en algun registro; de ahi el trim de puntuacion.
function claveProvincia(raw) {
  return sinAcentos(raw).toUpperCase().replace(/[.,;]+$/, '').replace(/\s+/g, ' ').trim()
}

function ineDeProvincia(raw) {
  return PROVINCIA_A_INE[claveProvincia(raw)] || null
}

function limpia(s) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  return t === 'null' ? '' : t
}

// El campo Info trae datos empotrados: "Líneas:5,post_title:...,Pin_city:JUNDIZ".
function lineasDeInfo(info) {
  const m = /L[íi]neas\s*:\s*(\d+)/i.exec(String(info || ''))
  return m ? parseInt(m[1], 10) : null
}

async function fetchConReintento(url, intentos = 4, tipo = 'json') {
  let ultimo
  for (let i = 1; i <= intentos; i++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': tipo === 'json' ? 'application/json' : 'text/csv' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return tipo === 'json' ? await res.json() : await res.text()
    } catch (e) {
      ultimo = e
      console.error(`  intento ${i}/${intentos} fallo: ${e.message}`)
      if (i < intentos) await new Promise(r => setTimeout(r, i * 3000))
    }
  }
  throw ultimo
}

function estacionesDeDGT(geojson) {
  const feats = geojson?.features
  if (!Array.isArray(feats) || feats.length < 100) {
    throw new Error(`Respuesta sospechosa de la DGT: ${feats?.length ?? 0} estaciones`)
  }
  const out = []
  const sinProvincia = new Set()
  for (const f of feats) {
    const p = f?.properties || {}
    const ine = ineDeProvincia(p.Provincia)
    if (!ine) { sinProvincia.add(String(p.Provincia)); continue }
    const coords = f?.geometry?.coordinates
    const lng = Array.isArray(coords) ? Number(coords[0]) : Number(p.Longitud)
    const lat = Array.isArray(coords) ? Number(coords[1]) : Number(p.Latitud)
    out.push({
      id: 'dgt-' + limpia(p.Codigo_centro),
      prov: ine,
      mun: limpia(p.Municipio),
      dir: limpia(p.Dirección),
      cp: limpia(p.Código_postal).padStart(5, '0'),
      tel: limpia(p.Teléfono_1),
      op: limpia(p.Autoescuela),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      lineas: lineasDeInfo(p.Info),
      horario: '',
      fuente: 'dgt',
    })
  }
  if (sinProvincia.size) {
    console.error('  AVISO: provincias sin mapear -> ' + Array.from(sinProvincia).join(', '))
  }
  return out
}

// CSV con separador ';' y todos los campos entrecomillados.
function parseCsv(texto) {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim())
  if (lineas.length < 2) return []
  const cabecera = lineas[0].split(';').map(h => h.replace(/^"|"$/g, '').trim())
  return lineas.slice(1).map(l => {
    const celdas = l.split(';').map(c => c.replace(/^"|"$/g, '').trim())
    const fila = {}
    cabecera.forEach((h, i) => { fila[h] = celdas[i] ?? '' })
    return fila
  })
}

// Solo las FIJAS de Castellon, y filtrando por CODIGO POSTAL, no por la columna
// provincia: hay filas etiquetadas CASTELLÓN cuyo municipio es Pilar de la
// Horadada, que es de Alicante. El CP es el unico campo fiable para esto.
function estacionesCastellonDeGVA(csv) {
  const filas = parseCsv(csv)
  const out = []
  for (const f of filas) {
    const cp = limpia(f.cp)
    if (!/^12\d{3}$/.test(cp)) continue
    if (!/FIJA/i.test(f.tipo_estacion || '')) continue
    out.push({
      id: 'gva-' + limpia(f.num_estacion),
      prov: '12',
      mun: limpia(f.municipio),
      dir: limpia(f.direccion),
      cp,
      tel: '',
      op: '',
      lat: null,          // la GVA no publica coordenadas
      lng: null,
      lineas: null,
      horario: limpia(f.horarios),
      fuente: 'gva',
    })
  }
  return out
}

async function main() {
  console.log('Descargando estaciones de ITV de la DGT...')
  const geo = await fetchConReintento(DGT_URL, 4, 'json')
  const estaciones = estacionesDeDGT(geo)
  console.log(`  ${estaciones.length} estaciones de la DGT`)

  // El parche es best-effort: si la GVA no responde, seguimos sin Castellon en
  // vez de tirar toda la actualizacion.
  try {
    const csv = await fetchConReintento(GVA_CSV, 2, 'csv')
    const cast = estacionesCastellonDeGVA(csv)
    if (cast.length) {
      estaciones.push(...cast)
      console.log(`  +${cast.length} de Castellon (GVA), que la DGT no trae`)
    } else {
      console.error('  AVISO: la GVA no devolvio estaciones fijas de Castellon')
    }
  } catch (e) {
    console.error(`  AVISO: parche de Castellon no aplicado (${e.message})`)
  }

  estaciones.sort((a, b) => a.prov.localeCompare(b.prov) || a.mun.localeCompare(b.mun, 'es'))

  const porProvincia = {}
  for (const e of estaciones) porProvincia[e.prov] = (porProvincia[e.prov] || 0) + 1

  mkdirSync(DATA_DIR, { recursive: true })
  const destino = resolve(DATA_DIR, 'itv.json')
  const payload = JSON.stringify({
    v: 1,
    generatedAt: new Date().toISOString(),
    fuentes: ['DGT (ArcGIS FeatureServer)', 'Generalitat Valenciana (datos abiertos)'],
    total: estaciones.length,
    estaciones,
  })
  writeFileSync(destino, payload)
  console.log(`  escrito ${destino} (${Math.round(payload.length / 1024)} KB)`)
  console.log(`  ${Object.keys(porProvincia).length} provincias con estacion`)
  console.log('OK')
}

main().catch(err => {
  console.error('FATAL:', err.message)
  if (existsSync(resolve(DATA_DIR, 'itv.json'))) {
    console.error('Conservando itv.json anterior.')
  }
  process.exit(1)
})
