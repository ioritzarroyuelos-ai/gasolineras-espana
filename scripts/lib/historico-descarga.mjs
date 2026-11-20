import { fechaArchivoMinisterio, fechaSnapshot } from './historico-estatico.mjs'

const BASE = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestresHist/'
// En GitHub una captura válida tardó 25,6 s: casi todo fue la descarga del
// cuerpo. Este plazo cubre cabecera y JSON, y siempre termina con la petición.
export const HISTORICO_TIMEOUT_MS = 45000
const CONEXION = new Set(['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'])
class ErrorHttp extends Error {
  constructor(status) { super('HTTP '+status); this.status=status }
}
function temporal(error, profundidad=0) {
  if (!error || profundidad>4) return false
  if (error instanceof ErrorHttp) return error.status>=500 && error.status<=599
  if (typeof error.code==='string' && !CONEXION.has(error.code)) return false
  if (Array.isArray(error.errors) && error.errors.length) return error.errors.every(e=>temporal(e,profundidad+1))
  if (error.cause) return temporal(error.cause,profundidad+1)
  return error.name==='TimeoutError' || CONEXION.has(error.code)
}

export async function descargaSnapshotHistorico(iso, {intentos=4, fetcher=fetch,
  esperar=ms=>new Promise(resolve=>setTimeout(resolve,ms)), anotar=()=>{}}={}) {
  const url = new URL(BASE + fechaArchivoMinisterio(iso))
  if (!Number.isInteger(intentos) || intentos < 1 || intentos > 4) throw Error('Número de intentos histórico inválido')
  let ultimo
  for (let i=1; i<=intentos; i++) {
    const controller = new AbortController()
    const timer = setTimeout(()=>controller.abort(new DOMException('Tiempo de descarga agotado','TimeoutError')),HISTORICO_TIMEOUT_MS)
    try {
      const res = await fetcher(url,{headers:{Accept:'application/json'},signal:controller.signal})
      if (!res.ok) { await res.body?.cancel(); throw new ErrorHttp(res.status) }
      const json = await res.json()
      if (!json.Fecha || !Array.isArray(json.ListaEESSPrecio) || !json.ListaEESSPrecio.length) return null
      if (fechaSnapshot(json)!==iso) throw Error('Fecha oficial distinta del día solicitado')
      return json
    } catch (e) {
      ultimo = e
      anotar(`  ${iso}: intento ${i}/${intentos} fallo (${e.message})`)
      // Un 429 espera a la siguiente ejecución programada. Repetir de inmediato
      // no arregla restricciones HTTP, certificados ni contenido incorrecto.
      if (!temporal(e)) throw e
    } finally { clearTimeout(timer) }
    if (i<intentos) await esperar(i*3000)
  }
  throw ultimo
}
