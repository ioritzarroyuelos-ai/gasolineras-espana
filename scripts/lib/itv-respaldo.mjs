import { ITV_PUBLIC_SOURCES, ITV_MAX_BYTES } from '../../src/lib/itv-relay.ts'

const CONEXION = new Set(['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'])
// Sólo fallos de transporte. HTTP, certificados y respuestas inválidas no
// autorizan otra ruta de acceso; un AggregateError debe contener sólo conexiones.
export function permiteRespaldoItv(error, profundidad=0) {
  if (!error || profundidad>4) return false
  if (typeof error.code==='string' && !CONEXION.has(error.code)) return false
  if (error.cause && !permiteRespaldoItv(error.cause,profundidad+1)) return false
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.every(e=>permiteRespaldoItv(e,profundidad+1))
  if (error.name==='TimeoutError' || CONEXION.has(error.code)) return true
  return permiteRespaldoItv(error.cause,profundidad+1)
}

export async function descargarRespaldoItv(id, source, opciones={}) {
  if (!Object.hasOwn(ITV_PUBLIC_SOURCES,id) || ITV_PUBLIC_SOURCES[id]!==source) throw Error('Respaldo ITV: fuente no permitida')
  const origin=opciones.origin ?? process.env.ITV_RELAY_ORIGIN ?? 'https://espana-util-guardias.ioritz-arroyuelos.workers.dev'
  if (!/^https:\/\/espana-util-guardias(?:-pr-\d+|-preview)?\.ioritz-arroyuelos\.workers\.dev$/.test(origin)) throw Error('Respaldo ITV: origen no permitido')
  const url=origin+'/itv/fuentes/'+id
  // El Worker dispone de30s para el origen; dejamos margen al trayecto adicional.
  const response=await (opciones.fetcher || fetch)(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(35000)})
  const age=(opciones.ahora ?? Date.now())-Date.parse(response.headers.get('X-ITV-Fetched-At'))
  if (!response.ok || response.url && response.url!==url || response.headers.get('X-ITV-Source-Id')!==id
      || response.headers.get('X-ITV-Source-Url')!==source || !Number.isFinite(age) || age < -60000 || age > 360000 || !response.body) {
    await response.body?.cancel().catch(()=>{})
    throw Error('Respaldo ITV: respuesta sin origen o fecha válidos')
  }
  const reader=response.body.getReader(), chunks=[]
  let size=0
  for (;;) {
    const {value,done}=await reader.read()
    if (done) break
    size+=value.byteLength
    if (size>ITV_MAX_BYTES) { await reader.cancel(); throw Error('Respaldo ITV: documento demasiado grande') }
    chunks.push(value)
  }
  if (!size) throw Error('Respaldo ITV: documento vacío')
  const bytes=new Uint8Array(size)
  let offset=0
  for (const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length }
  return bytes
}
