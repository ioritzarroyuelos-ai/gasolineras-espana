import { parse } from 'node-html-parser'

// Diagnóstico cerrado de conectividad: no recibe URLs, sesiones ni consultas.
// Se retira antes de publicar si esta ruta no permite recuperar los lectores.
export const OW_DIAGNOSTIC_SOURCES: Readonly<Record<string, { page: string; federation: string }>> = Object.freeze({
  bizkaia: { page: 'https://bizkaiabasket.com/es/resultados-y-clasificaciones/', federation: 'esf' },
  fbcyl: { page: 'https://www.fbcyl.es/buscar_competicion', federation: 'fbcyl' },
  fbcv: { page: 'https://www.fbcv.es/competiciones/calendario-resultados-y-clasificacion/', federation: 'fbcv' },
  navarra: { page: 'https://www.fnbaloncesto.com/resultados-y-clasificaciones/', federation: 'fnb' },
  clm: { page: 'https://fbclm.net/resultados-y-clasificaciones/', federation: 'fbclm' },
  rioja: { page: 'https://competicionesfrb.owbasket.com/', federation: 'frb' },
  cantabria: { page: 'https://www.fecanbaloncesto.com/resultados-y-clasificaciones/', federation: 'fecan' },
  baleares: { page: 'https://www.fbib.es/', federation: 'fbib' },
})
export const OW_DIAGNOSTIC_MAX_BYTES = 12 * 1024 * 1024
export const OW_DIAGNOSTIC_TIMEOUT_MS = 30_000
const FBCYL_GROUP = 'https://www.fbcyl.es/competiciones/resultados/7569'
class DiagnosticError extends Error { constructor(readonly code: string) { super(code) } }
type Step = { etapa: string; http?: number; bytes?: number; ms: number; codigo?: string }
type Result = { id: string; correcto: boolean; comprobadoEn: string; peticiones: Step[]; temporadas?: number }

function baseFromConfig(id: string, html: string, federation: string) {
  let base: unknown
  if (id === 'baleares') {
    const bases = [...new Set(html.match(/https:\/\/esb\.optimalwayconsulting\.com\/fbib\/1\/[A-Za-z0-9_-]{10,100}/g) || [])]
    if (bases.length === 1 && html.includes('https://www.fbib.es/competicion/{id}/{round}')) base = bases[0]
  } else if (id === 'bizkaia' || id === 'fbcyl') {
    const raw = html.match(/"REACT_APP_URL_ESB"\s*:\s*("[^"\r\n]+")/)?.[1]
    if (raw) base = JSON.parse(raw)
  } else {
    const script = parse(html).querySelectorAll('script').map(s => s.text).find(s => /var owbasket = /.test(s))
    const config = JSON.parse(script?.match(/var owbasket = (\{[^\n]+\});/)?.[1] || 'null')?.['owbasket-apis']?.[0]
    if (config?.fede?.url === federation && config?.system?.url === 'esb') base = config?.esb?.url
  }
  if (typeof base !== 'string' || !/^https:\/\/esb\.optimalwayconsulting\.com\/[a-z]+\/1\/[A-Za-z0-9_-]{10,100}$/.test(base) || new URL(base).pathname.split('/')[1] !== federation) throw new DiagnosticError('SOURCE_CONFIG')
  return base
}

export async function publicOwDiagnostic(id: string, request: typeof fetch = fetch): Promise<Result | null> {
  if (!Object.hasOwn(OW_DIAGNOSTIC_SOURCES, id)) return null
  const source = OW_DIAGNOSTIC_SOURCES[id], steps: Step[] = []
  const read = async (url: string, etapa: string) => {
    const permitted = url === source.page || id === 'baleares' && url === 'https://www.fbib.es/main.js' || id === 'fbcyl' && url === FBCYL_GROUP ||
      /^https:\/\/esb\.optimalwayconsulting\.com\/[a-z]+\/1\/[A-Za-z0-9_-]{10,100}\/Season\/getActiveWebVisibility$/.test(url) && new URL(url).pathname.split('/')[1] === source.federation
    if (!permitted || steps.length >= (['baleares', 'fbcyl'].includes(id) ? 3 : 2)) throw new DiagnosticError('SOURCE_DESTINATION')
    const start = Date.now(), step: Step = { etapa, ms: 0 }, controller = new AbortController()
    steps.push(step)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DiagnosticError('SOURCE_TIMEOUT')) }, OW_DIAGNOSTIC_TIMEOUT_MS) })
    try {
      const download = async () => {
        const response = await request(url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { 'User-Agent': 'EspanaUtil/1.8 (+https://webapp-3ft.pages.dev/acerca)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', Referer: source.page, Origin: new URL(source.page).origin } })
        step.http = response.status; reader = response.body?.getReader()
        if (response.status !== 200) throw new DiagnosticError('SOURCE_HTTP_' + response.status)
        if (!reader) throw new DiagnosticError('SOURCE_EMPTY')
        if (Number(response.headers.get('Content-Length')) > OW_DIAGNOSTIC_MAX_BYTES) throw new DiagnosticError('SOURCE_TOO_LARGE')
        const decoder = new TextDecoder(); let text = '', length = 0
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > OW_DIAGNOSTIC_MAX_BYTES) throw new DiagnosticError('SOURCE_TOO_LARGE')
          text += decoder.decode(value, { stream: true })
        }
        step.bytes = length
        if (!length) throw new DiagnosticError('SOURCE_EMPTY')
        return text + decoder.decode()
      }
      return await Promise.race([download(), deadline])
    } catch (error) {
      step.codigo = error instanceof DiagnosticError ? error.code : 'SOURCE_NETWORK'
      throw error
    } finally {
      clearTimeout(timer); controller.abort(); step.ms = Date.now() - start
      if (reader) await reader.cancel().catch(() => {})
    }
  }
  try {
    const html = await read(source.page, 'pagina')
    let base: string
    if (id === 'baleares') {
      if (!parse(html).querySelector('script[src="/main.js"]')) throw new DiagnosticError('SOURCE_CONFIG')
      base = baseFromConfig(id, await read('https://www.fbib.es/main.js', 'visor'), source.federation)
    } else if (id === 'fbcyl') {
      try { base = baseFromConfig(id, html, source.federation) }
      catch { base = baseFromConfig(id, await read(FBCYL_GROUP, 'grupo'), source.federation) }
    } else base = baseFromConfig(id, html, source.federation)
    const raw = (await read(base + '/Season/getActiveWebVisibility', 'api-temporada')).trim()
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new DiagnosticError('SOURCE_FORMAT')
    const data = JSON.parse(atob(raw))
    if (data?.result !== 'OK' || !Array.isArray(data.messageData) || !data.messageData.length) throw new DiagnosticError('SOURCE_FORMAT')
    return { id, correcto: true, comprobadoEn: new Date().toISOString(), peticiones: steps, temporadas: data.messageData.length }
  } catch (error) {
    if (!steps.at(-1)?.codigo) steps.push({ etapa: 'validacion', ms: 0, codigo: error instanceof DiagnosticError ? error.code : 'SOURCE_FORMAT' })
    return { id, correcto: false, comprobadoEn: new Date().toISOString(), peticiones: steps }
  }
}
