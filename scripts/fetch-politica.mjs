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
import { combinaSeguimiento, esSeguimientoSW, extraeSeguimientoGenerales } from './lib/politica-seguimiento.mjs'
import { completaResultadosOficiales } from './lib/politica-resultados-oficiales.mjs'
import { validaEleccion } from './lib/politica-validacion.mjs'
import { ELECCIONES } from './lib/politica-catalogo.mjs'
import { enVeda } from './lib/politica-veda.mjs'

const SCHEMA_VER = 1
const UA = 'CercaYaBot/1.0 (+https://webapp-3ft.pages.dev; vertical política)'
const DIR = resolve('public/data/politica')
const LICENCIA = 'CC BY-SA 4.0'
const HOY = new Date()
const diaMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(HOY)
const seguimiento29N = { lang: 'en', articulo: 'Opinion polling for the 2026 Spanish general election' }

const args = process.argv.slice(2)
const solo = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const yearOf = (iso) => parseInt(String(iso).slice(0, 4), 10)
const rutaFichero = (e) => (e.tipo === 'autonomica' ? `autonomicas/${e.id}.json` : `${e.id}.json`)

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

function procedenciaDe(wiki, art) {
  const url = 'https://' + wiki.lang + '.wikipedia.org/wiki/' + encodeURIComponent(art.titulo.replace(/ /g, '_'))
  return { wiki: wiki.lang, articulo: art.titulo, url, pageid: art.pageid, revid: art.revid, licencia: LICENCIA, obtenido: HOY.toISOString() }
}

function vigente(s) {
  return (!s.campoFin || s.campoFin <= diaMadrid) && (!s.publicacion || s.publicacion <= diaMadrid)
}

// Construye el fichero de una elección a partir del parse. Puede lanzar.
async function construyeEleccion(e, veda, anterior) {
  if (!e.wikiSondeos) {
    // Sin fuente de sondeos de la próxima: fichero mínimo (sin_sondeos).
    return {
      file: {
        schemaVer: SCHEMA_VER, id: e.id, tipo: e.tipo, ciclo: yearOf(e.ultimaFecha) + '',
        camara: e.camara, candidaturas: [],
        referencia: { fecha: e.ultimaFecha, escanos: [], fuente: `Wikipedia (${e.wikiResultados.articulo})` },
        sondeos: [], procedencia: { wiki: e.wikiResultados.lang, articulo: e.wikiResultados.articulo, url: '', licencia: LICENCIA, obtenido: HOY.toISOString() },
      },
      incidencias: ['sin artículo de sondeos de la próxima'], filas: null,
    }
  }
  const art = await fetchArticulo(e.wikiSondeos)
  const parsed = parseSondeos(art.html, { anioReferencia: yearOf(e.ultimaFecha) })
  const candidaturas = parsed.candidaturas
  const referencia = parsed.referencia && parsed.referencia.escanos.length
    ? { fecha: e.ultimaFecha, escanos: parsed.referencia.escanos, fuente: `Wikipedia (${e.wikiSondeos.articulo})` }
    : { fecha: e.ultimaFecha, escanos: [], fuente: `Wikipedia (${e.wikiResultados.articulo})` }
  // En veda: no se publican sondeos (LOREG 69.7), también en el JSON.
  const sondeos = veda ? [] : parsed.sondeos.filter(vigente)
  const file = {
    schemaVer: SCHEMA_VER, id: e.id, tipo: e.tipo, ciclo: yearOf(e.ultimaFecha) + '',
    camara: e.camara, candidaturas, referencia, sondeos,
    procedencia: procedenciaDe(e.wikiSondeos, art),
  }
  let falloParcial
  if (!veda && e.id === 'generales' && e.proxima.valor === '2026-11-29') {
    let seguimiento = []
    try {
      const articulo = await fetchArticulo(seguimiento29N)
      const extra = extraeSeguimientoGenerales(articulo.html, candidaturas)
      seguimiento = extra.sondeos.filter(vigente)
      if (!seguimiento.length) throw new Error('no se ha podido verificar ninguna proyección vigente')
      file.procedenciasAdicionales = [{ ...procedenciaDe(seguimiento29N, articulo), camposFin: seguimiento.map(s => s.campoFin) }]
      parsed.incidencias.push(...extra.incidencias)
    } catch (err) {
      falloParcial = 'Seguimiento del Congreso (fuente adicional): ' + String(err.message || err)
      const mismaEleccion = anterior?.id === file.id && anterior.ciclo === file.ciclo && !anterior.veda
      const fuente = mismaEleccion && anterior.procedenciasAdicionales?.find(p => p.wiki === seguimiento29N.lang && p.articulo === seguimiento29N.articulo)
      if (fuente) {
        // Las primeras copias carecían de la lista de días: en ellas el
        // seguimiento se identifica por casa, cliente y publicación original.
        seguimiento = anterior.sondeos.filter(s => esSeguimientoSW(s) && vigente(s)
          && (fuente.camposFin ? fuente.camposFin.includes(s.campoFin) : Boolean(s.fuenteUrl)))
        if (seguimiento.length) file.procedenciasAdicionales = [fuente]
      }
    }
    file.sondeos = combinaSeguimiento(sondeos, seguimiento)
  }
  if (veda) file.veda = true
  return { file, incidencias: parsed.incidencias, filas: parsed.filas, falloParcial }
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
    const veda = enVeda(HOY.toISOString(), e.proxima)
    let estado = 'ok'
    let sondeosN = anterior ? (anterior.sondeos || []).length : 0
    let ultimoContenidoModificado = anterior?.ultimoContenidoModificado
    let fechaUltimoSondeo = anterior?.fechaUltimoSondeo ?? null
    let fechaUltimaPublicacion = anterior?.fechaUltimaPublicacion ?? null
    let ultimaComprobacionOk = anterior?.ultimaComprobacionOk ?? null
    try {
      const candidato = await construyeEleccion(e, veda, anterior)
      const { incidencias } = candidato
      const file = completaResultadosOficiales(candidato.file)
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
        fechaUltimaPublicacion = file.sondeos.map(s => s.publicacion).filter(Boolean).sort().at(-1) ?? null
        const cambio = ['sondeos', 'referencia', 'senado'].some(k => JSON.stringify(file[k]) !== JSON.stringify(anterior?.[k]))
        ultimoContenidoModificado = cambio ? HOY.toISOString() : (anterior?.ultimoContenidoModificado || HOY.toISOString())
        file.ultimaComprobacionOk = candidato.falloParcial
          ? (anterior?.id === file.id && anterior.ciclo === file.ciclo ? ultimaComprobacionOk : null)
          : HOY.toISOString()
        file.ultimoContenidoModificado = ultimoContenidoModificado
        file.fechaUltimoSondeo = fechaUltimoSondeo
        file.fechaUltimaPublicacion = fechaUltimaPublicacion
        escribeJson(ruta, file)
        ultimaComprobacionOk = file.ultimaComprobacionOk
        if (candidato.falloParcial) {
          fallos.push({ id: e.id, parcial: true, motivo: candidato.falloParcial })
          estado = 'desactualizado'
        } else {
          estado = veda ? 'ok' : sondeosN > 0 ? 'ok' : 'sin_sondeos'
        }
        if (incidencias?.length) revisiones.push({ id: e.id, incidencias })
      }
    } catch (err) {
      fallos.push({ id: e.id, motivo: String(err.message || err) })
      estado = anterior ? 'desactualizado' : 'no_disponible'
    }

    // Si la fuente falla justo al empezar la veda, el último archivo válido
    // conserva sus resultados electorales y su fecha de comprobación real.
    if (veda && estado === 'desactualizado' && anterior?.sondeos?.length) {
      fechaUltimoSondeo = null
      fechaUltimaPublicacion = null
      ultimoContenidoModificado = HOY.toISOString()
      escribeJson(ruta, { ...anterior, sondeos: [], veda: true, fechaUltimoSondeo, fechaUltimaPublicacion, ultimoContenidoModificado })
    }

    indexEntries.push({
      id: e.id, tipo: e.tipo, nombre: e.nombre,
      ...(e.comunidad ? { comunidad: e.comunidad } : {}),
      ...(e.ciudadAutonoma ? { ciudadAutonoma: true } : {}),
      fecha: e.proxima,
      estado,
      fechaUltimoSondeo, fechaUltimaPublicacion,
      ...(ultimoContenidoModificado ? { ultimoContenidoModificado } : {}),
      ultimaComprobacionOk,
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

  const noEscritas = fallos.filter(f => !f.parcial).length
  const run = { generado: HOY.toISOString(), total: lista.length, escritas: lista.length - noEscritas, fallos, revisiones }
  writeFileSync(resolve('politica-run.json'), JSON.stringify(run, null, 2))

  console.log(`política: ${run.escritas}/${run.total} elecciones escritas, ${fallos.length} fallos, ${revisiones.length} avisos`)
  for (const f of fallos) console.log(`  FALLO ${f.id}: ${f.motivo}`)
  // No fallamos el proceso por fallos parciales (el monitor avisa); sí si todo peta.
  if (noEscritas === lista.length && lista.length > 1) {
    console.error('::error::todas las elecciones fallaron')
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('::error::fetch-politica: ' + (e.message || e))
  process.exit(1)
})
