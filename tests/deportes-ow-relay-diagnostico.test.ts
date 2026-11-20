import { afterEach, describe, expect, it, vi } from 'vitest'
import { OW_DIAGNOSTIC_MAX_BYTES, OW_DIAGNOSTIC_SOURCES, OW_DIAGNOSTIC_TIMEOUT_MS, publicOwDiagnostic } from '../src/lib/deportes-ow-relay-diagnostico'
// @ts-expect-error Entrada JavaScript del Worker, probada con las APIs web.
import worker from '../workers/guardias.mjs'

const viewer = 'VISOR_PUBLICO_PRUEBA_123', api = (federation: string) => `https://esb.optimalwayconsulting.com/${federation}/1/${viewer}`
const responseSeason = btoa(JSON.stringify({ result: 'OK', messageData: [{ idSeason: '2026', active: 1 }] }))
function html(id: string, federation: string) {
  if (id === 'baleares') return '<script src="/main.js"></script>'
  if (id === 'bizkaia' || id === 'fbcyl') return '<script>var process = ' + JSON.stringify({ env: { REACT_APP_URL_ESB: api(federation) } }) + ';</script>'
  return '<script>var owbasket = ' + JSON.stringify({ 'owbasket-apis': [{ fede: { url: federation }, system: { url: 'esb' }, esb: { url: api(federation) } }] }) + ';</script>'
}
function fetcher(id = 'bizkaia') {
  const source = OW_DIAGNOSTIC_SOURCES[id]
  return vi.fn(async (url: RequestInfo | URL) => {
    if (String(url) === source.page) return new Response(html(id, source.federation))
    if (String(url) === 'https://www.fbib.es/main.js') return new Response('"' + api(source.federation) + '";"https://www.fbib.es/competicion/{id}/{round}"')
    if (String(url) === api(source.federation) + '/Season/getActiveWebVisibility') return new Response(responseSeason)
    throw Error('Destino inesperado: ' + url)
  })
}
function harness() {
  const stored = new Map<string, Response>(), jobs: Promise<unknown>[] = []
  const cache = { match: vi.fn(async (key: Request) => stored.get(key.url)?.clone()), put: vi.fn(async (key: Request, response: Response) => { stored.set(key.url, response) }) }
  vi.stubGlobal('caches', { default: cache })
  const run = (path = '/deportes/diagnostico/ow/bizkaia', init: RequestInit = {}) => worker.fetch(new Request('https://relay.example' + path, init), {}, { waitUntil: (p: Promise<unknown>) => jobs.push(p) }) as Promise<Response>
  return { run, jobs, cache }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('diagnóstico de red OW con destinos cerrados', () => {
  it.each(Object.entries(OW_DIAGNOSTIC_SOURCES))('consulta la configuración pública y sólo temporadas de %s', async (id, source) => {
    const request = fetcher(id), result = await publicOwDiagnostic(id, request)
    expect(result).toMatchObject({ id, correcto: true, temporadas: 1 })
    expect(request.mock.calls.length).toBe(id === 'baleares' ? 3 : 2)
    expect(String(request.mock.calls[0][0])).toBe(source.page)
    expect(String(request.mock.calls.at(-1)![0])).toBe(api(source.federation) + '/Season/getActiveWebVisibility')
    expect(JSON.stringify(result)).not.toContain(viewer)
    expect(JSON.stringify(result)).not.toContain('https://')
    for (const [, init] of request.mock.calls as unknown as [unknown, RequestInit][]) {
      expect(init).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store' })
      expect(new Headers(init.headers).has('Authorization')).toBe(false)
      expect(new Headers(init.headers).has('Cookie')).toBe(false)
    }
  })
  it('sólo consulta el grupo FBCYL fijo si la portada no publica su conexión', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('<select></select>')).mockResolvedValueOnce(new Response(html('fbcyl', 'fbcyl'))).mockResolvedValueOnce(new Response(responseSeason))
    expect(await publicOwDiagnostic('fbcyl', request)).toMatchObject({ correcto: true })
    expect(request.mock.calls[1][0]).toBe('https://www.fbcyl.es/competiciones/resultados/7569')
    expect(request).toHaveBeenCalledTimes(3)
  })
  it.each(['https://evil.example/fbcv/1/' + viewer, api('fnb'), api('fbcv') + '?url=https://evil.example'])('rechaza configuración que apunta fuera de la fuente: %s', async base => {
    const page = '<script>var owbasket = ' + JSON.stringify({ 'owbasket-apis': [{ fede: { url: 'fbcv' }, system: { url: 'esb' }, esb: { url: base } }] }) + ';</script>'
    const request = vi.fn().mockResolvedValue(new Response(page))
    expect(await publicOwDiagnostic('fbcv', request)).toMatchObject({ correcto: false, peticiones: [{ etapa: 'pagina' }, { etapa: 'validacion', codigo: 'SOURCE_CONFIG' }] })
    expect(request).toHaveBeenCalledOnce()
  })
  it.each([301,302,403,429,500])('termina en HTTP %s sin seguir redirecciones ni reintentar', async status => {
    const request = vi.fn().mockResolvedValue(new Response('No disponible', { status, headers: { Location: 'https://evil.example', 'Retry-After': '3600' } }))
    const result = await publicOwDiagnostic('bizkaia', request)
    expect(result).toMatchObject({ correcto: false, peticiones: [{ http: status, codigo: 'SOURCE_HTTP_' + status }] })
    expect(request).toHaveBeenCalledOnce()
  })
  it('cancela cuerpos demasiado grandes, aunque Content-Length no lo indique', async () => {
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(OW_DIAGNOSTIC_MAX_BYTES)); c.enqueue(new Uint8Array(1)) }, cancel })
    const result = await publicOwDiagnostic('bizkaia', vi.fn().mockResolvedValue(new Response(body)))
    expect(result).toMatchObject({ correcto: false, peticiones: [{ codigo: 'SOURCE_TOO_LARGE' }] })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('el límite de tiempo también cubre un cuerpo que deja de llegar', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('<html>')) }, cancel })
    const request = vi.fn().mockResolvedValue(new Response(body)), pending = publicOwDiagnostic('bizkaia', request)
    await vi.advanceTimersByTimeAsync(OW_DIAGNOSTIC_TIMEOUT_MS)
    expect(await pending).toMatchObject({ correcto: false, peticiones: [{ codigo: 'SOURCE_TIMEOUT' }] })
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('no expone excepciones de red ni el identificador del visor', async () => {
    const request = vi.fn().mockRejectedValue(Error(api('esf') + ' private internal detail'))
    const result = await publicOwDiagnostic('bizkaia', request)
    expect(result).toMatchObject({ correcto: false, peticiones: [{ codigo: 'SOURCE_NETWORK' }] })
    expect(JSON.stringify(result)).not.toContain(viewer)
    expect(JSON.stringify(result)).not.toContain('private')
  })
})

describe('ruta temporal del diagnóstico OW', () => {
  it.each(['/deportes/diagnostico/ow/__proto__','/deportes/diagnostico/ow/bizkaia?url=https://evil.example','/deportes/diagnostico/ow/bizkaia?','/deportes/diagnostico/ow/%62izkaia','/deportes/diagnostico/ow/bizkaia/','/deportes/otra'])('rechaza %s antes de consultar fuentes', async path => {
    const { run, cache } = harness(), request = vi.fn(); vi.stubGlobal('fetch', request)
    expect((await run(path)).status).toBe(404)
    expect(request).not.toHaveBeenCalled(); expect(cache.match).not.toHaveBeenCalled()
  })
  it.each(['POST','PUT','DELETE','HEAD','OPTIONS'])('rechaza %s', async method => {
    const { run } = harness(), request = vi.fn(); vi.stubGlobal('fetch', request)
    expect((await run('/deportes/diagnostico/ow/bizkaia', { method })).status).toBe(404)
    expect(request).not.toHaveBeenCalled()
  })
  it('sirve sólo el resumen JSON y conserva la fecha al reutilizar caché', async () => {
    const { run, jobs } = harness(), request = fetcher(); vi.stubGlobal('fetch', request)
    const first = await run(undefined, { headers: { Cookie: 'private', Authorization: 'Bearer private' } }), data = await first.json()
    expect(first.status).toBe(200); await Promise.all(jobs)
    expect(await (await run()).json()).toEqual(data)
    expect(request).toHaveBeenCalledTimes(2)
    expect(first.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(first.headers.has('Set-Cookie')).toBe(false)
  })
  it('no cachea fallos ni modifica el contrato de ITV y farmacias', async () => {
    const { run, cache } = harness(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('No', { status: 403 })))
    const response = await run()
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(cache.put).not.toHaveBeenCalled()
    expect((await run('/itv/fuentes/no-existe')).status).toBe(404)
    expect((await run('/no-existe')).status).toBe(404)
  })
})
