import {readFileSync,writeFileSync,mkdirSync,renameSync,existsSync,readdirSync,openSync,fstatSync,closeSync,constants,realpathSync,unlinkSync,rmdirSync} from 'node:fs'
import {resolve,dirname,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {construyePreciosComparacion,validaIndicePreciosComparacion,validaBloquePreciosComparacion,MAX_BLOQUE_PRECIOS_BYTES} from './precios-comparacion.mjs'
const sha = raw => createHash('sha256').update(raw).digest('hex')

export async function preparaComparacionPrecios(snapshot, dir, options = {}) {
  let previousBundle = null, recuperada = false
  try { previousBundle = leeComparacionPrevia(dir) } catch { recuperada = true }
  // Sólo la referencia dañada es prescindible. La captura nueva pasa por todas
  // las validaciones: fechas, identidades, duplicados, tipos y tamaños.
  const comparison = await construyePreciosComparacion(snapshot,{...options,previousBundle})
  return {comparison,recuperada,previousId:previousBundle?.index.snapshotId || null}
}

export function leeComparacionPrevia(dir) {
  const path = resolve(dir,'index.json')
  if (!existsSync(path)) return null
  const raw = readFileSync(path)
  if (raw.byteLength > 32768) throw Error('Índice de precios demasiado grande')
  const index = JSON.parse(raw.toString('utf8'))
  if (!validaIndicePreciosComparacion(index,Date.parse(index.consultado))) throw Error('Índice anterior de precios inválido')
  const bloques = []
  for (const [bucket,descriptor] of Object.entries(index.shards).sort(([a],[b])=>a.localeCompare(b))) {
    const path = resolve(dir,descriptor.archivo)
    // Inspecciona y lee el mismo descriptor abierto: un cambio de ruta entre
    // ambas operaciones no puede sustituir el archivo validado por otro.
    const fd = openSync(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    let raw
    try {
      const stat = fstatSync(fd)
      if (!stat.isFile() || stat.size !== descriptor.bytes || stat.size > MAX_BLOQUE_PRECIOS_BYTES) throw Error('Bloque anterior de precios inválido')
      raw = readFileSync(fd)
    } finally { closeSync(fd) }
    if (sha(raw) !== descriptor.sha256) throw Error('La integridad de los precios anteriores no coincide')
    const block = JSON.parse(raw.toString('utf8'))
    if (!validaBloquePreciosComparacion(block,index,bucket)) throw Error('Contenido anterior de precios inválido')
    bloques.push(block)
  }
  return {index,bloques}
}

function escribeAtomico(path, content) {
  mkdirSync(dirname(path),{recursive:true})
  const temporary = path + '.tmp-' + process.pid
  writeFileSync(temporary,content)
  renameSync(temporary,path)
}
export function guardaComparacionPrecios(dir, result, previousId = null) {
  if (!validaIndicePreciosComparacion(result.index,Date.parse(result.index.consultado))) throw Error('No se publica un índice inválido')
  for (const artifact of result.artifacts) {
    const bucket = artifact.archivo.slice(-7,-5), descriptor = result.index.shards[bucket]
    if (!descriptor || descriptor.archivo !== artifact.archivo || Buffer.byteLength(artifact.content) !== descriptor.bytes || sha(artifact.content) !== descriptor.sha256
      || !validaBloquePreciosComparacion(JSON.parse(artifact.content),result.index,bucket)) throw Error('No se publica un bloque inválido')
  }
  if (result.artifacts.length !== 32 || new Set(result.artifacts.map(a=>a.archivo)).size !== 32) throw Error('Comparación incompleta')
  for (const artifact of result.artifacts) escribeAtomico(resolve(dir,artifact.archivo),artifact.content)
  // El índice se cambia al final, cuando todos sus archivos están completos.
  escribeAtomico(resolve(dir,'index.json'),JSON.stringify(result.index))
  // Sólo elimina versiones con nombre hash y los 32 nombres de archivo conocidos.
  // Nunca sigue enlaces, borra recursivamente ni sale de este directorio.
  const base = realpathSync(dir), keep = new Set([result.index.snapshotId,previousId])
  for (const entry of readdirSync(base,{withFileTypes:true})) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(entry.name) || keep.has(entry.name)) continue
    const target = resolve(base,entry.name), actual = realpathSync(target)
    if (actual !== target || !target.startsWith(base + sep)) continue
    const files = readdirSync(target,{withFileTypes:true})
    if (files.some(f=>!f.isFile() || f.isSymbolicLink() || !/^(?:[0-2][0-9]|3[01])\.json$/.test(f.name))) continue
    for (const file of files) unlinkSync(resolve(target,file.name))
    rmdirSync(target)
  }
}
