#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename, rm, readdir, lstat, realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { SERVICIOS_PUBLICOS_FUENTES, normalizaRefugios, normalizaSalasMadrid, validaFuentePublica, validaIndicePublicos, validaManifestPublicos, validaBusquedaPublicos, validaIdentidadesPublicas, normalizaBusquedaPublica, leeJsonPublico,
  SERVICIOS_PUBLICOS_LISTA_FILAS, SERVICIOS_PUBLICOS_MAPA_FILAS, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES, SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES, SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES, SERVICIOS_PUBLICOS_IDENTIDADES_FILAS, SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES } from './lib/servicios-publicos.mjs'
import { servicioTileId } from './lib/servicios.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ERROR_PUBLICO = 'No se ha podido verificar una copia completa y consistente de esta fuente. Se conserva la última copia válida, si existe.'
const fail = () => { throw Error(ERROR_PUBLICO) }
const PAGE = 1000
// El contrato admite hasta 200; el perfil real del Worker exige más margen.
const MAPA_TARGET_FILAS = 100
const REFUGIOS_FIELDS = ':id,nom,indicador_refugi,municipi,codi_municipi,latitud,longitud,accessibilitat,aigua,climatitzacio,area_descans,lavabo,adreca,informacio_web,tipologia,origen_identificador,ultima_actualitzacio'
async function download(url, { fetch: fetcher, method = 'GET', maxBytes = 1024 * 1024 }) {
  const response = await fetcher(url, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } })
  if (!response.ok) { try { await response.body?.cancel() } catch {} fail() }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) { try { await response.body?.cancel() } catch {} fail() }
  if (method === 'HEAD') return { headers: response.headers, text: '', bytes: 0 }
  if (!response.body) fail()
  const reader = response.body.getReader(), chunks = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) { await reader.cancel(); fail() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
  return { headers: response.headers, text: new TextDecoder('utf-8', { fatal: true }).decode(data), bytes }
}
async function json(url, io, maxBytes) { return leeJsonPublico((await download(url, { ...io, maxBytes })).text) }
function catMeta(meta, now) {
  const fields = ['nom', 'indicador_refugi', 'municipi', 'codi_municipi', 'latitud', 'longitud', 'ultima_actualitzacio']
  if (meta?.id !== '9gu7-iwci' || !Number.isSafeInteger(meta.rowsUpdatedAt) || meta.rowsUpdatedAt * 1000 > now || meta.rowsUpdatedAt < 946684800
    || !Number.isSafeInteger(meta.viewLastModified) || !Array.isArray(meta.columns) || fields.some(key => !meta.columns.some(c => c.fieldName === key))
    || meta.licenseId !== 'SEE_TERMS_OF_USE') fail()
  return { version: JSON.stringify([meta.rowsUpdatedAt, meta.viewLastModified, meta.columns.map(c => [c.fieldName, c.dataTypeName]), meta.licenseId]), fecha: new Date(meta.rowsUpdatedAt * 1000).toISOString() }
}
async function count(f, io) {
  const url = new URL(f.datosUrl); url.searchParams.set('$select', 'count(*)')
  const data = await json(url.href, io, 1024)
  if (!Array.isArray(data) || data.length !== 1 || !/^\d+$/.test(data[0]?.count)) fail()
  const total = Number(data[0].count)
  if (!Number.isSafeInteger(total) || total < f.min || total > f.max) fail()
  return total
}
export async function descargaRefugios(io = {}) {
  const opts = { fetch: io.fetch || fetch }, now = io.now ?? Date.now(), f = SERVICIOS_PUBLICOS_FUENTES[0]
  const before = catMeta(await json(f.metaUrl, opts, 1024 * 1024), now), total = await count(f, opts), rows = [], rowIds = new Set()
  let totalBytes = 0
  for (let offset = 0; offset < total; offset += PAGE) {
    const url = new URL(f.datosUrl)
    // El indicador municipal no es único. El identificador de fila Socrata
    // proporciona un desempate real y permite detectar páginas repetidas.
    url.searchParams.set('$limit', String(PAGE)); url.searchParams.set('$offset', String(offset)); url.searchParams.set('$order', ':id'); url.searchParams.set('$select', REFUGIOS_FIELDS)
    const page = await download(url.href, { ...opts, maxBytes: f.maxBytes }), data = leeJsonPublico(page.text)
    totalBytes += page.bytes
    if (totalBytes > f.maxBytes || !Array.isArray(data) || data.length !== Math.min(PAGE, total - offset)) fail()
    for (const row of data) {
      const id = row?.[':id']
      if (typeof id !== 'string' || !id || id.length > 128 || rowIds.has(id)) fail()
      rowIds.add(id)
    }
    rows.push(...data)
  }
  const afterCount = await count(f, opts), after = catMeta(await json(f.metaUrl, opts, 1024 * 1024), now)
  if (after.version !== before.version || afterCount !== total || rows.length !== total) fail()
  return normalizaRefugios(rows, before.fecha, now)
}
function fileMeta(headers, now) {
  const raw = headers.get('last-modified'), time = Date.parse(raw || ''), length = headers.get('content-length'), etag = headers.get('etag')
  const compressed = ![null, 'identity'].includes(headers.get('content-encoding'))
  if (!Number.isFinite(time) || time > now || time < Date.UTC(2000, 0) || length === null || !/^\d+$/.test(length) || Number(length) === 0) fail()
  // HEAD puede anunciar el gzip vacío (20 bytes) mientras GET anuncia el gzip
  // completo. Fetch ya entrega los bytes descomprimidos. En ese caso exigimos
  // ETag fuerte e idéntico; el límite se aplica al flujo descomprimido completo.
  if (compressed && (!etag || !/^"[^"\r\n]+"$/.test(etag))) fail()
  return { version: JSON.stringify([time, compressed ? null : length, etag]), fecha: new Date(time).toISOString(), bytes: compressed ? null : Number(length) }
}
export async function descargaSalasMadrid(io = {}) {
  const opts = { fetch: io.fetch || fetch }, now = io.now ?? Date.now(), f = SERVICIOS_PUBLICOS_FUENTES[1]
  const before = fileMeta((await download(f.datosUrl, { ...opts, method: 'HEAD', maxBytes: f.maxBytes })).headers, now)
  const response = await download(f.datosUrl, { ...opts, maxBytes: f.maxBytes }), during = fileMeta(response.headers, now)
  const after = fileMeta((await download(f.datosUrl, { ...opts, method: 'HEAD', maxBytes: f.maxBytes })).headers, now)
  if (before.version !== during.version || before.version !== after.version || during.bytes !== null && response.bytes !== during.bytes) fail()
  return normalizaSalasMadrid(leeJsonPublico(response.text), during.fecha, now)
}
export function compruebaContinuidadPublica(previous, next) {
  if (!previous) return
  if (previous.id !== next.id || Date.parse(next.fechaDatos) < Date.parse(previous.fechaDatos) || next.total < previous.total * 0.7
    || previous.conCoordenadas > 0 && next.conCoordenadas < previous.conCoordenadas * 0.7) fail()
}
async function readPrevious(path, id, now) {
  try {
    const raw = await readFile(path), data = validaFuentePublica(JSON.parse(raw.toString('utf8')), now)
    return data.id === id ? { data, raw, ...integrity(raw) } : null
  } catch { return null }
}
function integrity(raw) { return { bytes: Buffer.byteLength(raw), sha256: createHash('sha256').update(raw).digest('hex') } }
async function writeRawAtomic(path, raw) {
  const temporary = path + '.tmp-' + process.pid
  try { await writeFile(temporary, raw); await rename(temporary, path); return integrity(raw) }
  finally { await rm(temporary, { force: true }).catch(() => {}) }
}
async function writeAtomic(path, data) { return writeRawAtomic(path, JSON.stringify(data)) }
function pages(items, limit) {
  const result = []
  let rows = [], jsonRows = [], bytes = 2
  const flush = () => { if (rows.length) result.push({ rows, raw: '[' + jsonRows.join(',') + ']' }); rows = []; jsonRows = []; bytes = 2 }
  for (const row of items) {
    const raw = JSON.stringify(row), size = Buffer.byteLength(raw)
    if (size + 2 > SERVICIOS_PUBLICOS_MAX_SHARD_BYTES) fail()
    if (rows.length && (rows.length >= limit || bytes + size + 1 > SERVICIOS_PUBLICOS_MAX_SHARD_BYTES)) flush()
    bytes += size + (rows.length ? 1 : 0); rows.push(row); jsonRows.push(raw)
  }
  flush()
  return result
}
export function particionaFuentePublica(data, now = Date.now()) {
  validaFuentePublica(data, now)
  const sorted = [...data.items].sort((a, b) => a.municipio.localeCompare(b.municipio, 'es') || a.nombre.localeCompare(b.nombre, 'es') || a.id.localeCompare(b.id))
  const version = integrity(JSON.stringify({ particion: 4, listaFilas: SERVICIOS_PUBLICOS_LISTA_FILAS, mapaFilas: MAPA_TARGET_FILAS, identidadFilas: SERVICIOS_PUBLICOS_IDENTIDADES_FILAS, maxBytes: SERVICIOS_PUBLICOS_MAX_SHARD_BYTES, items: sorted })).sha256
  const artifacts = [], lists = [], search = [], references = [], identities = [], byZone = new Map(), map = {}
  function add(archivo, raw, total) { artifacts.push({ archivo, raw }); return { archivo, total, ...integrity(raw) } }
  pages(sorted, SERVICIOS_PUBLICOS_LISTA_FILAS).forEach((page, i) => {
    lists.push(add(`listas/${i}.json`, page.raw, page.rows.length))
    page.rows.forEach((p, position) => { search.push(normalizaBusquedaPublica(p.nombre + ' ' + p.municipio)); references.push([p.id, i, position]) })
  })
  references.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  for (let start = 0; start < references.length; start += SERVICIOS_PUBLICOS_IDENTIDADES_FILAS) {
    const rows = references.slice(start, start + SERVICIOS_PUBLICOS_IDENTIDADES_FILAS), raw = JSON.stringify(rows)
    if (Buffer.byteLength(raw) > SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES) fail()
    identities.push({ ...add(`identidades/${identities.length}.json`, raw, rows.length), desde: rows[0][0], hasta: rows.at(-1)[0] })
  }
  for (const item of sorted) if (item.lat !== null) {
    const zone = servicioTileId(item.lat, item.lon), rows = byZone.get(zone) || []
    rows.push(item); byZone.set(zone, rows)
  }
  for (const zone of [...byZone.keys()].sort()) map[zone] = pages(byZone.get(zone), Math.min(SERVICIOS_PUBLICOS_MAPA_FILAS, MAPA_TARGET_FILAS)).map((page, i) => add(`mapa/${zone}-${i}.json`, page.raw, page.rows.length))
  const searchRaw = JSON.stringify(search)
  if (Buffer.byteLength(searchRaw) > SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES) fail()
  const { items: _, ...meta } = data
  const manifest = validaManifestPublicos({ ...meta, version, listas: lists, mapa: map, busqueda: add('busqueda.json', searchRaw, search.length), identidades: identities }, now)
  validaBusquedaPublicos(search, manifest)
  identities.forEach((d, i) => validaIdentidadesPublicas(references.slice(i * SERVICIOS_PUBLICOS_IDENTIDADES_FILAS, (i + 1) * SERVICIOS_PUBLICOS_IDENTIDADES_FILAS), manifest, d))
  if (Buffer.byteLength(JSON.stringify(manifest)) > SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES) fail()
  return { manifest, artifacts }
}
async function optionalFile(path) { try { return await readFile(path) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function publishSource(data, dir, now, preserved = null) {
  const { manifest, artifacts } = particionaFuentePublica(data, now), base = resolve(dir, data.id, manifest.version)
  for (const file of artifacts) {
    const path = resolve(base, file.archivo)
    if (!path.startsWith(base + sep)) fail()
    await mkdir(dirname(path), { recursive: true }); await writeRawAtomic(path, file.raw)
  }
  const archivePath = resolve(dir, data.id + '.json'), manifestPath = resolve(dir, data.id, 'manifest.json')
  const oldArchive = await optionalFile(archivePath), oldManifest = await optionalFile(manifestPath)
  try {
    const hash = preserved ? { bytes: preserved.bytes, sha256: preserved.sha256 } : await writeAtomic(archivePath, data)
    const manifestHash = await writeAtomic(manifestPath, manifest)
    return { ...hash, manifestBytes: manifestHash.bytes, manifestSha256: manifestHash.sha256, version: manifest.version }
  } catch (error) {
    // Si falla una sustitución, restaurar ambos punteros fijos. Los archivos de
    // versión nueva no se usan hasta que existe un manifiesto e índice coherente.
    if (oldArchive !== null) await writeRawAtomic(archivePath, oldArchive); else await rm(archivePath, { force: true })
    if (oldManifest !== null) await writeRawAtomic(manifestPath, oldManifest); else await rm(manifestPath, { force: true })
    throw error
  }
}
async function cleanOldVersions(dir, id, keep) {
  if (!SERVICIOS_PUBLICOS_FUENTES.some(f => f.id === id) || !/^[a-f0-9]{64}$/.test(keep)) fail()
  const parent = resolve(dir, id), root = resolve(dir) + sep
  if (!parent.startsWith(root)) fail()
  const physicalRoot = await realpath(dir), physicalParent = await realpath(parent)
  if ((await lstat(parent)).isSymbolicLink() || physicalParent !== resolve(physicalRoot, id)) fail()
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name) || entry.name === keep) continue
    const target = resolve(parent, entry.name)
    if (!target.startsWith(parent + sep) || !target.startsWith(root)) fail()
    if (!(await realpath(target)).startsWith(physicalParent + sep)) fail()
    await rm(target, { recursive: true, force: true })
  }
}
export async function actualizaServiciosPublicos(options = {}) {
  const now = options.now ?? Date.now(), dir = resolve(options.dir || process.env.SERVICIOS_PUBLICOS_DIR || resolve(ROOT, 'public/data/servicios-publicos'))
  const io = { now, fetch: options.fetch || fetch }, fuentes = [], versions = new Map()
  await mkdir(dir, { recursive: true })
  for (const f of SERVICIOS_PUBLICOS_FUENTES) {
    const path = resolve(dir, f.id + '.json'), previous = await readPrevious(path, f.id, now)
    try {
      const next = await (f.id === 'refugios-cataluna' ? descargaRefugios(io) : descargaSalasMadrid(io))
      compruebaContinuidadPublica(previous?.data, next)
      const { version, ...hash } = await publishSource(next, dir, now)
      versions.set(f.id, version)
      fuentes.push({ id: f.id, nombre: f.nombre, estado: 'actual', ultimoExito: next.consultado, fechaDatos: next.fechaDatos, total: next.total, ...hash })
    } catch {
      // No copiar fechas del intento a la fuente conservada ni imprimir errores
      // arbitrarios de red: pueden incluir direcciones o contenidos privados.
      let retained = null
      if (previous) try { retained = await publishSource(previous.data, dir, now, previous); versions.set(f.id, retained.version) } catch {}
      const { version: _, ...hash } = retained || { bytes: 0, sha256: null, manifestBytes: 0, manifestSha256: null }
      fuentes.push({ id: f.id, nombre: f.nombre, estado: retained ? 'conservada' : 'error', ultimoExito: retained ? previous.data.consultado : null,
        fechaDatos: retained ? previous.data.fechaDatos : null, total: retained ? previous.data.total : 0, ...hash, error: ERROR_PUBLICO })
    }
  }
  const index = validaIndicePublicos({ schema: 1, consultado: new Date(now).toISOString(), fuentes }, now)
  await writeAtomic(resolve(dir, 'index.json'), index)
  for (const [id, version] of versions) await cleanOldVersions(dir, id, version)
  return { index, failed: fuentes.some(f => f.estado !== 'actual') }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  actualizaServiciosPublicos().then(({ index, failed }) => {
    for (const f of index.fuentes) console.log(`${f.nombre}: ${f.estado}; ${f.total} fichas; último éxito ${f.ultimoExito || 'ninguno'}.`)
    if (failed) process.exitCode = 1
  }).catch(() => { console.error('No se pudo guardar el estado de servicios públicos.'); process.exitCode = 1 })
}
