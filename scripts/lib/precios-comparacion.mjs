// Fotos oficiales por estación. El Worker sólo descarga los cubos que necesita.
import { sourceTime } from './fuel-trends.mjs'

export const CUBOS_PRECIOS = 32
export const MAX_BLOQUE_PRECIOS_BYTES = 256 * 1024
const HORA = 3600000, FUTURO = 300000
const CAMPOS = ['Precio Gasolina 95 E5', 'Precio Gasolina 98 E5', 'Precio Gasoleo A', 'Precio Gasoleo Premium']
const SHA = /^[a-f0-9]{64}$/
const ID = /^[1-9][0-9]{0,8}$/
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const fresco = (value, now, horas) => iso(value) && now - Date.parse(value) >= -FUTURO && now - Date.parse(value) <= horas * HORA
const texto = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const vector = value => Array.isArray(value) && value.length === 4 && value.every(p => p === null || Number.isInteger(p) && p >= 1 && p <= 9999)
export const cuboPrecio = id => String(Number(id) % CUBOS_PRECIOS).padStart(2, '0')

function metaValida(meta, now, horas) {
  return !!meta && fresco(meta.fechaFuente, now, horas) && fresco(meta.consultado, now, horas)
    && sourceTime(meta.fechaMinisterio) === Date.parse(meta.fechaFuente)
    && Date.parse(meta.fechaFuente) <= Date.parse(meta.consultado) + FUTURO
}

export function validaIndicePreciosComparacion(value, now = Date.now()) {
  if (!value || value.schema !== 1 || !SHA.test(value.snapshotId || '') || !fresco(value.consultado, now, 26)
    || !metaValida(value.actual, now, 26) || Date.parse(value.actual.consultado) > Date.parse(value.consultado) + FUTURO
    || !value.shards || Object.keys(value.shards).length !== CUBOS_PRECIOS) return false
  if (value.anterior !== null && (!metaValida(value.anterior, now, 36)
    || Date.parse(value.anterior.fechaFuente) >= Date.parse(value.actual.fechaFuente)
    || Date.parse(value.actual.fechaFuente) - Date.parse(value.anterior.fechaFuente) > 26 * HORA
    || Date.parse(value.anterior.consultado) > Date.parse(value.actual.consultado))) return false
  let total = 0
  for (let n = 0; n < CUBOS_PRECIOS; n++) {
    const bucket = String(n).padStart(2, '0'), shard = value.shards[bucket]
    if (!shard || shard.archivo !== value.snapshotId + '/' + bucket + '.json' || !SHA.test(shard.sha256 || '')
      || !Number.isInteger(shard.bytes) || shard.bytes < 1 || shard.bytes > MAX_BLOQUE_PRECIOS_BYTES
      || !Number.isInteger(shard.total) || shard.total < 0 || shard.total > 3000) return false
    total += shard.total
  }
  return total > 0 && total <= 50000
}

export function validaBloquePreciosComparacion(value, index, bucket) {
  const descriptor = index?.shards?.[bucket]
  if (!descriptor || !value || value.schema !== 1 || value.snapshotId !== index.snapshotId || value.bucket !== bucket
    || !Array.isArray(value.filas) || value.filas.length !== descriptor.total) return false
  const ids = new Set()
  for (const row of value.filas) {
    if (!Array.isArray(row) || row.length !== 5 || typeof row[0] !== 'string' || !ID.test(row[0]) || cuboPrecio(row[0]) !== bucket || ids.has(row[0])
      || !texto(row[1], 160) || !texto(row[2], 120) || !vector(row[3]) || !vector(row[4])
      || index.anterior === null && row[4].some(p => p !== null)) return false
    ids.add(row[0])
  }
  return true
}

const limpio = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
function milesimas(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,2}(?:[,.]\d{1,3})?$/.test(text)) return null
  const n = Math.round(Number(text.replace(',', '.')) * 1000)
  return Number.isInteger(n) && n > 0 && n <= 9999 ? n : null
}
function captura(snapshot, consultado) {
  const stamp = sourceTime(snapshot?.Fecha)
  if (!Number.isFinite(stamp) || !iso(consultado) || !Array.isArray(snapshot?.ListaEESSPrecio)) return null
  const rows = new Map()
  for (const item of snapshot.ListaEESSPrecio) {
    const id = String(Number(item.IDEESS))
    if (!ID.test(id) || rows.has(id)) throw Error('Identificador de estación inválido o repetido')
    rows.set(id, [id, limpio(item['Rótulo'], 160), limpio(item.Municipio, 120), CAMPOS.map(key => milesimas(item[key]))])
  }
  return { meta: {fechaFuente:new Date(stamp).toISOString(),fechaMinisterio:snapshot.Fecha,consultado}, rows }
}
async function hash(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}
function deBundle(bundle, anterior = false) {
  if (!bundle?.index || !Array.isArray(bundle.bloques) || bundle.bloques.length !== CUBOS_PRECIOS
    || !validaIndicePreciosComparacion(bundle.index, Date.parse(bundle.index.consultado))) return null
  const meta = anterior ? bundle.index.anterior : bundle.index.actual
  if (!meta) return null
  const rows = new Map(), buckets = new Set()
  for (const block of bundle.bloques) {
    if (buckets.has(block.bucket) || !validaBloquePreciosComparacion(block, bundle.index, block.bucket)) return null
    buckets.add(block.bucket)
    for (const row of block.filas) rows.set(row[0], [row[0], row[1], row[2], row[anterior ? 4 : 3]])
  }
  return { meta, rows }
}

export async function construyePreciosComparacion(snapshot, {now = new Date(), previousSnapshot, previousMeta, previousBundle} = {}) {
  const current = captura(snapshot, now.toISOString()), time = now.getTime()
  if (!current || !current.rows.size || !metaValida(current.meta, time, 26)) throw Error('Precios oficiales sin fecha reciente válida')
  const oldActual = deBundle(previousBundle)
  // Una repetición de la misma foto conserva su consulta original y su referencia.
  if (oldActual && oldActual.meta.fechaFuente === current.meta.fechaFuente) {
    if (oldActual.rows.size !== current.rows.size || [...current.rows].some(([id,row]) => JSON.stringify(row[3]) !== JSON.stringify(oldActual.rows.get(id)?.[3]))) {
      throw Error('La misma fecha oficial contiene precios diferentes; comparación rechazada')
    }
    current.meta = oldActual.meta
  } else if (oldActual && Date.parse(oldActual.meta.fechaFuente) > Date.parse(current.meta.fechaFuente)) {
    throw Error('La fuente ha devuelto una foto anterior a la ya publicada')
  }
  let rawPrevious = null
  if (previousMeta?.ministryDate === previousSnapshot?.Fecha) {
    // Un archivo anterior dañado no invalida una captura nueva correcta.
    // Se descarta esa referencia, nunca se rellenan sus huecos con precios supuestos.
    try { rawPrevious = captura(previousSnapshot, previousMeta?.fetchedAt) } catch { rawPrevious = null }
  }
  const candidates = [oldActual, deBundle(previousBundle, true), rawPrevious].filter(item => item && metaValida(item.meta,time,36)
    && Date.parse(item.meta.fechaFuente) < Date.parse(current.meta.fechaFuente)
    && Date.parse(current.meta.fechaFuente) - Date.parse(item.meta.fechaFuente) <= 26 * HORA
    && Date.parse(item.meta.consultado) <= Date.parse(current.meta.consultado))
    .sort((a,b) => Date.parse(b.meta.fechaFuente) - Date.parse(a.meta.fechaFuente))
  const prior = candidates[0] || null
  const rows = [...current.rows.values()].sort((a,b) => Number(a[0]) - Number(b[0])).map(row => [...row, prior?.rows.get(row[0])?.[3] || [null,null,null,null]])
  const snapshotId = await hash(JSON.stringify({actual:current.meta,anterior:prior?.meta || null,filas:rows}))
  const index = {schema:1,consultado:now.toISOString(),snapshotId,actual:current.meta,anterior:prior?.meta || null,shards:{}}
  const artifacts = [], bloques = []
  for (let n = 0; n < CUBOS_PRECIOS; n++) {
    const bucket = String(n).padStart(2,'0')
    const block = {schema:1,snapshotId,bucket,filas:rows.filter(row=>cuboPrecio(row[0])===bucket)}
    const content = JSON.stringify(block), bytes = new TextEncoder().encode(content).byteLength
    if (bytes > MAX_BLOQUE_PRECIOS_BYTES) throw Error('Bloque de precios demasiado grande')
    const archivo = snapshotId + '/' + bucket + '.json'
    index.shards[bucket] = {archivo,bytes,sha256:await hash(content),total:block.filas.length}
    artifacts.push({archivo,content}); bloques.push(block)
  }
  if (!validaIndicePreciosComparacion(index,time)) throw Error('Índice de comparación inválido')
  return {index,artifacts,bloques}
}
