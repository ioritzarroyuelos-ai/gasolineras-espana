// Catálogo diario. Las plazas libres se consultan bajo demanda y nunca se
// guardan como si una copia diaria fuese disponibilidad actual.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let compiled
export async function parkingApi() {
  if (!compiled) compiled = build({ stdin: { contents: "export * from './src/lib/aparcamientos'; export * from './src/lib/aparcamientos-datos';", resolveDir: root, loader: 'js' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' }).then(result => import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')))
  return compiled
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const genericError = 'No se pudo comprobar el catálogo oficial completo. Se conserva la última copia válida.'
const encoded = data => JSON.stringify(data) + '\n'
const digest = raw => ({ bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') })
async function previous(path, city, api, now) {
  try { const raw = await readFile(path, 'utf8'); return { raw, data: api.validaCatalogoParking(JSON.parse(raw), city, now) } } catch { return null }
}
export async function preparaCatalogoParking(city, old, { api, fetcher = fetch, clock = Date.now, sleep = pause } = {}) {
  api ??= await parkingApi()
  const copy = await api.descargaParking(city, { fetch: fetcher, timeoutMs: 15000 })
  const parsed = city === 'madrid' ? api.normalizaParkingMadrid(copy.raw, clock()) : api.normalizaParkingVigo(copy.raw, clock())
  if (parsed.length < (city === 'madrid' ? 50 : 8) || old && parsed.length < old.items.length * .7) throw Error('Catálogo incompleto')
  const saved = new Map((old?.items ?? []).map(item => [item.id, item]))
  let failed = 0
  const items = []
  for (const item of parsed) {
    const clean = api.parkingSoloFicha(item)
    if (city === 'madrid') {
      if (items.length) await sleep(1000)
      try {
        const id = item.id.slice('parking-madrid-'.length)
        const detail = await api.descargaParking(city, { fetch: fetcher, timeoutMs: 15000 }, id)
        Object.assign(clean, api.normalizaDetalleMadrid(detail.raw, id), { detalleConsultado: new Date(clock()).toISOString() })
      } catch {
        failed++
        const previous = saved.get(item.id)
        if (previous) Object.assign(clean, { capacidad: previous.capacidad, plazasPmr: previous.plazasPmr, horarioTexto: previous.horarioTexto, detalleConsultado: previous.detalleConsultado })
      }
    }
    items.push(clean)
  }
  const source = api.APARCAMIENTOS_FUENTES[city]
  return api.validaCatalogoParking({ schema: 1, fuenteId: city, nombre: source.nombre, consultado: new Date(clock()).toISOString(), fechaDatos: null, fuenteUrl: source.fuenteUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion, total: items.length, detallesPendientes: failed, items }, city, clock())
}
async function atomic(path, value) {
  const temp = path + '.tmp'
  await writeFile(temp, value, 'utf8')
  await rename(temp, path)
}
export async function actualizaAparcamientos({ directory = process.env.APARCAMIENTOS_DIR || resolve(root, 'public/data/aparcamientos'), fetcher = fetch, clock = Date.now, sleep = pause } = {}) {
  const api = await parkingApi()
  await mkdir(directory, { recursive: true })
  const results = await Promise.all(['madrid', 'vigo'].map(async city => {
    const path = resolve(directory, city + '.json'), old = await previous(path, city, api, clock())
    const source = api.APARCAMIENTOS_FUENTES[city]
    try {
      const data = await preparaCatalogoParking(city, old?.data, { api, fetcher, clock, sleep }), raw = encoded(data)
      if (Buffer.byteLength(raw) > 524288) throw Error('Catálogo demasiado grande')
      return { path, raw, old: old?.raw ?? null, state: { id: city, nombre: source.nombre, estado: data.detallesPendientes ? 'parcial' : 'actual', ultimoExito: data.consultado, fechaDatos: null, total: data.total, ...digest(raw), ...(data.detallesPendientes ? { error: 'Algunos servicios no se pudieron comprobar; cada ficha conserva su fecha de consulta.' } : {}) } }
    } catch {
      return { path, raw: null, old: old?.raw ?? null, state: { id: city, nombre: source.nombre, estado: old ? 'conservada' : 'error', ultimoExito: old?.data.consultado ?? null, fechaDatos: null, total: old?.data.total ?? 0, ...(old ? digest(old.raw) : { bytes: 0, sha256: null }), error: genericError } }
    }
  }))
  const report = { schema: 1, consultado: new Date(clock()).toISOString(), correcto: results.every(result => result.state.estado === 'actual'), fuentes: results.map(result => result.state) }
  const written = []
  try {
    for (const result of results) if (result.raw !== null) { await atomic(result.path, result.raw); written.push(result) }
    await atomic(resolve(directory, 'index.json'), encoded(report))
  } catch (error) {
    // Si falla la escritura del índice, sus hashes anteriores siguen describiendo
    // los ficheros anteriores. No dejamos un conjunto de versiones mezcladas.
    for (const result of written.reverse()) {
      if (result.old === null) await unlink(result.path).catch(() => {})
      else await atomic(result.path, result.old)
    }
    throw error
  }
  return report
}
async function main() {
  const result = await actualizaAparcamientos()
  console.log(JSON.stringify(result))
  if (!result.correcto) process.exitCode = 1
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error(genericError); process.exitCode = 1 })
