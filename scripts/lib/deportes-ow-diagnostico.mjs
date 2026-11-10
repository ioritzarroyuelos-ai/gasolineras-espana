import { parse } from 'node-html-parser'
import { basePublicaBizkaia, respuestaBaloncestoOW } from './deportes-baloncesto-bizkaia.mjs'
import { basePublicaFbcv, basePublicaBaleares } from './deportes-baloncesto-fbcv.mjs'
import { basePublicaFbcyl } from './deportes-baloncesto-fbcyl.mjs'

// Diagnóstico acotado: reproduce el inicio público de cada lector, sin sesión
// privada, reintentos, relajación TLS ni publicación de datos deportivos.
export const FUENTES_DIAGNOSTICO_OW = Object.freeze([
  { id: 'bizkaia', pagina: 'https://bizkaiabasket.com/es/resultados-y-clasificaciones/' },
  { id: 'fbcyl', pagina: 'https://www.fbcyl.es/buscar_competicion' },
  { id: 'fbcv', fede: 'fbcv', pagina: 'https://www.fbcv.es/competiciones/calendario-resultados-y-clasificacion/' },
  { id: 'navarra', fede: 'fnb', pagina: 'https://www.fnbaloncesto.com/resultados-y-clasificaciones/' },
  { id: 'clm', fede: 'fbclm', pagina: 'https://fbclm.net/resultados-y-clasificaciones/' },
  { id: 'rioja', fede: 'frb', pagina: 'https://competicionesfrb.owbasket.com/' },
  { id: 'cantabria', fede: 'fecan', pagina: 'https://www.fecanbaloncesto.com/resultados-y-clasificaciones/' },
  { id: 'baleares', pagina: 'https://www.fbib.es/' },
])

const oculta = valor => String(valor).replace(/(https:\/\/esb\.optimalwayconsulting\.com\/[a-z]+\/1\/)[^/\s"'<>]+/g, '$1[identificador]').slice(0, 500)
export function causaSeguraOW(error) {
  const salida = [], vistos = new Set()
  function agrega(e) {
    if (!e || typeof e !== 'object' || vistos.has(e) || salida.length >= 6) return
    vistos.add(e)
    salida.push({ nombre: oculta(e.name || 'Error'), ...(e.code ? { codigo: oculta(e.code) } : {}), mensaje: oculta(e.message || 'Sin detalle') })
    for (const hijo of Array.isArray(e.errors) ? e.errors : []) agrega(hijo)
    agrega(e.cause)
  }
  agrega(error)
  return salida
}

async function textoLimitado(respuesta) {
  const maximo = 12 * 1024 * 1024
  if (Number(respuesta.headers.get('content-length')) > maximo) { await respuesta.body?.cancel(); throw Error('Respuesta demasiado grande para este diagnóstico') }
  if (!respuesta.body) throw Error('Respuesta sin cuerpo')
  const lector = respuesta.body.getReader(), decoder = new TextDecoder()
  let bytes = 0, texto = ''
  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximo) { await lector.cancel(); throw Error('Respuesta demasiado grande para este diagnóstico') }
      texto += decoder.decode(value, { stream: true })
    }
    return texto + decoder.decode()
  } finally { lector.releaseLock() }
}

export async function diagnosticaFuenteOW(id, opciones = {}) {
  const fuente = FUENTES_DIAGNOSTICO_OW.find(f => f.id === id)
  if (!fuente) throw Error('Fuente de diagnóstico no permitida')
  const peticiones = [], reloj = opciones.reloj || Date.now, fetcher = opciones.fetcher || fetch
  const maximo = ['baleares', 'fbcyl'].includes(id) ? 3 : 2
  const consulta = async (url, etapa) => {
    if (peticiones.length >= maximo) throw Error('Se ha alcanzado el máximo de este diagnóstico')
    const inicio = reloj(), registro = { etapa, url: oculta(url) }
    peticiones.push(registro)
    try {
      const respuesta = await fetcher(url, { signal: AbortSignal.timeout(30000), headers: {
        'User-Agent': 'EspanaUtil/1.0 (+https://webapp-3ft.pages.dev/privacidad)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', Referer: fuente.pagina,
        ...(id !== 'baleares' || etapa !== 'pagina' ? { Origin: new URL(fuente.pagina).origin } : {}),
      } })
      registro.http = respuesta.status
      if (!respuesta.ok) { await respuesta.body?.cancel(); throw Error('Fuente HTTP ' + respuesta.status) }
      const texto = await textoLimitado(respuesta)
      registro.bytes = new TextEncoder().encode(texto).length
      return texto
    } catch (error) { registro.causa = causaSeguraOW(error); throw error }
    finally { registro.ms = reloj() - inicio }
  }
  try {
    const html = await consulta(fuente.pagina, 'pagina')
    let base
    if (id === 'bizkaia') base = basePublicaBizkaia(html).base
    else if (id === 'baleares') {
      if (!parse(html).querySelector('script[src="/main.js"]')) throw Error('Baleares no publica el script de su visor')
      base = basePublicaBaleares(await consulta('https://www.fbib.es/main.js', 'visor'))
    } else if (id === 'fbcyl') {
      try { base = basePublicaFbcyl(html) } catch {
        const grupo = opciones.grupoFbcyl
        if (!/^\d{1,15}$/.test(grupo || '')) throw Error('Falta un grupo conocido de FBCYL para localizar su API pública')
        base = basePublicaFbcyl(await consulta('https://www.fbcyl.es/competiciones/resultados/' + grupo, 'grupo'))
      }
    } else base = basePublicaFbcv(html, fuente.fede)
    const datos = respuestaBaloncestoOW(await consulta(base + '/Season/getActiveWebVisibility', 'api-temporada'))
    if (!Array.isArray(datos) || !datos.length) throw Error('La API pública no ha devuelto su lista de temporadas')
    return { id, correcto: true, peticiones }
  } catch (error) { return { id, correcto: false, peticiones, causa: causaSeguraOW(error) } }
}
