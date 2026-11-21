// Catálogo diario mínimo de Metro Bilbao; el tiempo real se consulta bajo demanda.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TRANSPORTE_GTFS_URL = 'https://ctb-gtfs.s3.eu-south-2.amazonaws.com/metrobilbao.zip'
export const TRANSPORTE_GTFS_FUENTE = 'https://data.ctb.eus/dataset/horario-metro-bilbao'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export async function descargaCatalogoMetro({ fetcher = fetch, now = Date.now(), python = process.env.PYTHON || 'python' } = {}) {
  const response = await fetcher(TRANSPORTE_GTFS_URL, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
  const modified = response.headers.get('Last-Modified') || '', stamp = Date.parse(modified)
  if (!response.ok || !response.body || !Number.isFinite(stamp) || stamp > now || now - stamp >= 72 * 3600000) throw Error('GTFS sin fecha vigente comprobable')
  const length = response.headers.get('Content-Length')
  if (length && (!/^\d+$/.test(length) || +length > 10_000_000)) { void response.body.cancel(); throw Error('GTFS demasiado grande') }
  const reader = response.body.getReader(), chunks = []
  let bytes = 0
  try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 10_000_000) { void reader.cancel(); throw Error('GTFS demasiado grande') } chunks.push(next.value) } } finally { reader.releaseLock() }
  const archive = Buffer.concat(chunks), converted = spawnSync(python, [resolve(root, 'scripts/lib/transporte-gtfs.py')], { input: archive, timeout: 20000, maxBuffer: 4_000_000, windowsHide: true })
  if (converted.status !== 0 || converted.error) throw Error('No se pudo validar el GTFS oficial')
  const data = JSON.parse(converted.stdout.toString('utf8'))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)).replaceAll('-', '')
  if (data.schema !== 1 || data.inicio > today || data.fin < today) throw Error('GTFS fuera del calendario publicado')
  return { ...data, ts: new Date(now).toISOString(), fechaDatos: new Date(stamp).toISOString(), fuenteUrl: TRANSPORTE_GTFS_FUENTE,
    datosUrl: TRANSPORTE_GTFS_URL, atribucion: 'Consorcio de Transportes de Bizkaia (CTB) · Metro Bilbao', licencia: 'CC-BY-4.0',
    licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/', bytes, sha256: createHash('sha256').update(archive).digest('hex') }
}
export async function main() {
  const data = await descargaCatalogoMetro()
  if (!process.argv.includes('--check')) {
    const target = resolve(process.env.TRANSPORTE_DIR || resolve(root, 'public/data/transporte'), 'metro-bilbao.json')
    await mkdir(dirname(target), { recursive: true })
    const temporary = target + '.tmp'
    await writeFile(temporary, JSON.stringify(data) + '\n', 'utf8')
    await rename(temporary, target)
  }
  console.log(JSON.stringify({ fuente: 'Metro Bilbao', estaciones: Object.keys(data.estaciones).length, paradas: Object.keys(data.paradas).length,
    viajes: Object.keys(data.viajes).length, fechaDatos: data.fechaDatos, consultado: data.ts, bytesCatalogo: Buffer.byteLength(JSON.stringify(data)) }))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('No se pudo actualizar el catálogo de Metro Bilbao. Se conserva el archivo anterior.'); process.exitCode = 1 })
