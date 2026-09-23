// Robot de la vertical de política (corre en GitHub Actions, Node). Para cada
// elección del catálogo: baja el artículo de sondeos de Wikipedia (API
// action=parse), lo parsea, valida el candidato y, si pasa, escribe su JSON en
// public/data/politica/. Ante fallo, CONSERVA el último bueno y marca el estado
// (nunca convierte un fallo en "sin_sondeos"). Siempre regenera index.json desde
// el catálogo (independiente del scraper: las 19 territoriales aparecen siempre).
// Escribe politica-run.json (efímero, gitignored) para que el monitor avise.
//
// Uso: node scripts/fetch-politica.mjs [--solo <id>]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { parseSondeos } from './lib/politica-parse.mjs'
import { validaEleccion } from './lib/politica-validacion.mjs'
import { ELECCIONES } from './lib/politica-catalogo.mjs'

const SCHEMA_VER = 1
const UA = 'CercaYaBot/1.0 (+https://webapp-3ft.pages.dev; vertical política)'
const DIR = resolve('public/data/politica')
const LICENCIA = 'CC BY-SA 4.0'
const HOY = new Date()
const hoy = { anio: HOY.getUTCFullYear(), mes: HOY.getUTCMonth() + 1 }

const args = process.argv.slice(2)
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const yearOf = (iso) => parseInt(String(iso).slice(0, 4), 10)
const rutaFichero = (e) => (e.tipo === 'autonomica' ? `autonomicas/${e.id}.json` : `${e.id}.json`)

function enVedaCat(e) {
  if (!e.proxima.confirmada || !e.proxima.valor) return false
  const v = Date.parse(e.proxima.valor.slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(v)) return false
  const t = HOY.getTime()
  return t >= v - 5 * 86_400_000 && t < v + 86_400_000
}

function leeJson(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
  } catch {
    return null
  }
}
function escribeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(obj, null, 0))
}

async function fetchArticulo(wiki) {
  const u = new URL(`https://${wiki.lang}.wikipedia.org/w/api.php`)
  u.searchParams.set('action', 'parse')
  u.searchParams.set('page', wiki.articulo)
  u.searchParams.set('prop', 'text|revid')
  u.searchParams.set('format', 'json')
  u.searchParams.set('formatversion', '2')
  u.searchParams.set('redirects', '1')
  u.searchParams.set('maxlag', '5')
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } })
      if (r.status === 429 || r.status === 503) {
        await sleep(2000 * intento)
        continue
      }
      const j = await r.json()
      if (j.error) {
        if (j.error.code === 'maxlag') {
          await sleep(2000 * intento)
          continue
        }
        throw new Error(`API ${j.error.code}: ${j.error.info}`)
      }
      return { html: j.parse.text, revid: j.parse.revid, pageid: j.parse.pageid, titulo: j.parse.title }
    } catch (e) {
      if (intento === 3) throw e
      await sleep(1500 * intento)
    }
  }
  throw new Error('sin respuesta')
}

// Construye el fichero de una elección a partir del parse. Puede lanzar.
async function construyeEleccion(e) {
  const veda = enVedaCat(e)
  if (!e.wikiSondeos) {
    // Sin fuente de sondeos de la próxima: fichero mínimo (sin_sondeos).
    return {
      file: {
        schemaVer: SCHEMA_VER, id: e.id, tipo: e.tipo, ciclo: yearOf(e.ultimaFecha) + '',
        camara: e.camara, candidaturas: [],
        referencia: { fecha: e.ultimaFecha, escanos: [], fuente: `Wikipedia (${e.wikiResultados.articulo})` },
        sondeos: [], procedencia: { wiki: e.wikiResultados.lang, articulo: e.wikiResultados.articulo, url: '', licencia: LICENCIA, obtenido: HOY.toISOString() },
      },
      veda, incidencias: ['sin artículo de sondeos de la próxima'], filas: null,
    }
  }
  const art = await fetchArticulo(e.wikiSondeos)
  const url = `https://${e.wikiSondeos.lang}.wikipedia.org/wiki/${encodeURIComponent(e.wikiSondeos.articulo.replace(/ /g, '_'))}`
  const parsed = parseSondeos(art.html, { anioReferencia: yearOf(e.ultimaFecha), hoy })
  const candidaturas = parsed.candidaturas
  const referencia = parsed.referencia && parsed.referencia.escanos.length
    ? { fecha: e.ultimaFecha, escanos: parsed.referencia.escanos, fuente: `Wikipedia (${e.wikiSondeos.articulo})` }
    : { fecha: e.ultimaFecha, escanos: [], fuente: `Wikipedia (${e.wikiResultados.articulo})` }
  // En veda: no se publican sondeos (LOREG 69.7), también en el JSON.
  const sondeos = veda ? [] : parsed.sondeos
  const file = {
    schemaVer: SCHEMA_VER, id: e.id, tipo: e.tipo, ciclo: yearOf(e.ultimaFecha) + '',
    camara: e.camara, candidaturas, referencia, sondeos,
    procedencia: { wiki: e.wikiSondeos.lang, articulo: art.titulo, url, pageid: art.pageid, revid: art.revid, licencia: LICENCIA, obtenido: HOY.toISOString() },
  }
  if (veda) file.veda = true
  return { file, veda, incidencias: parsed.incidencias, filas: parsed.filas }
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const lista = solo ? ELECCIONES.filter((e) => e.id === solo) : ELECCIONES
  const fallos = []
  const revisiones = []
  const indexEntries = []

  for (const e of lista) {
    const ruta = resolve(DIR, rutaFichero(e))
    const anterior = leeJson(ruta)
    let estado = 'ok'
    let sondeosN = anterior ? (anterior.sondeos || []).length : 0
    let ultimoContenidoModificado = anterior?.ultimoContenidoModificado
    let fechaUltimoSondeo = anterior?.fechaUltimoSondeo ?? null
    try {
      const { file, veda, incidencias, filas } = await construyeEleccion(e)
      const val = validaEleccion(file, anterior, { enVeda: veda })
      if (!val.ok) {
        fallos.push({ id: e.id, motivo: val.motivo, diagnostico: val.diagnostico })
        estado = anterior ? 'desactualizado' : 'no_disponible'
        // conserva el anterior (no se sobrescribe)
      } else {
        if (val.revision) revisiones.push({ id: e.id, ...val.diagnostico })
        sondeosN = file.sondeos.length
        const fins = file.sondeos.map((s) => s.campoFin).filter(Boolean).sort()
        fechaUltimoSondeo = fins.length ? fins[fins.length - 1] : null
        const cambio = JSON.stringify(file.sondeos) !== JSON.stringify(anterior?.sondeos || [])
        ultimoContenidoModificado = cambio ? HOY.toISOString() : (anterior?.ultimoContenidoModificado || HOY.toISOString())
        file.ultimaComprobacionOk = HOY.toISOString()
        file.ultimoContenidoModificado = ultimoContenidoModificado
        file.fechaUltimoSondeo = fechaUltimoSondeo
        escribeJson(ruta, file)
        estado = veda ? 'ok' : sondeosN > 0 ? 'ok' : 'sin_sondeos'
        if (incidencias?.length) revisiones.push({ id: e.id, incidencias })
      }
    } catch (err) {
      fallos.push({ id: e.id, motivo: String(err.message || err) })
      estado = anterior ? 'desactualizado' : 'no_disponible'
    }

    indexEntries.push({
      id: e.id, tipo: e.tipo, nombre: e.nombre,
      ...(e.comunidad ? { comunidad: e.comunidad } : {}),
      ...(e.ciudadAutonoma ? { ciudadAutonoma: true } : {}),
      fecha: { valor: e.proxima.valor, confirmada: e.proxima.confirmada },
      estado,
      ...(fechaUltimoSondeo ? { fechaUltimoSondeo } : { fechaUltimoSondeo: null }),
      ...(ultimoContenidoModificado ? { ultimoContenidoModificado } : {}),
      ultimaComprobacionOk: fallos.some((f) => f.id === e.id) ? (anterior?.ultimaComprobacionOk || null) : HOY.toISOString(),
      ruta: `/data/politica/${rutaFichero(e)}`,
    })
    if (e.wikiSondeos) await sleep(800) // buen ciudadano con Wikipedia
  }

  // index.json coherente al final. En modo --solo, fusiona sobre el índice
  // existente (no clobbering); en modo completo, reemplaza.
  let elecciones = indexEntries
  if (solo) {
    const prev = leeJson(resolve(DIR, 'index.json'))
    const base = prev && Array.isArray(prev.elecciones) ? prev.elecciones : []
    const nuevos = new Map(indexEntries.map((x) => [x.id, x]))
    elecciones = [...base.map((x) => nuevos.get(x.id) || x)]
    for (const x of indexEntries) if (!base.some((b) => b.id === x.id)) elecciones.push(x)
  }
  const index = { schemaVer: SCHEMA_VER, generado: HOY.toISOString(), elecciones }
  escribeJson(resolve(DIR, 'index.json'), index)

  const run = { generado: HOY.toISOString(), total: lista.length, escritas: lista.length - fallos.length, fallos, revisiones }
  writeFileSync(resolve('politica-run.json'), JSON.stringify(run, null, 2))

  console.log(`política: ${run.escritas}/${run.total} elecciones OK, ${fallos.length} fallos, ${revisiones.length} avisos`)
  for (const f of fallos) console.log(`  FALLO ${f.id}: ${f.motivo}`)
  // No fallamos el proceso por fallos parciales (el monitor avisa); sí si todo peta.
  if (fallos.length === lista.length && lista.length > 1) {
    console.error('::error::todas las elecciones fallaron')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('::error::fetch-politica: ' + (e.message || e))
  process.exit(1)
})
