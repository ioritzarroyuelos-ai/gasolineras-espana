import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITV_MAX_BYTES, ITV_PUBLIC_SOURCES, ITV_TIMEOUT_MS, publicItvSource } from '../src/lib/itv-relay'
// @ts-expect-error Entrada JavaScript del Worker, probada con las APIs web.
import worker from '../workers/guardias.mjs'

const pdf = new TextEncoder().encode('%PDF-1.7\nDocumento oficial de prueba')
function harness() {
  const entries = new Map<string, Response>()
  const cache = {
    match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => { entries.set(key.url, response) }),
  }
  vi.stubGlobal('caches', { default:cache })
  const jobs: Promise<unknown>[] = []
  const ctx = { waitUntil:vi.fn((promise: Promise<unknown>) => jobs.push(promise)) }
  const run = (path='/itv/fuentes/asturias', init: RequestInit={}) => worker.fetch(new Request('https://relay.example'+path,init),{},ctx) as Promise<Response>
  return { cache, jobs, run, ctx }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('respaldo de lectura ITV', () => {
  it.each(Object.entries(ITV_PUBLIC_SOURCES))('consulta únicamente el destino fijo de %s', async (id, url) => {
    const request = vi.fn().mockResolvedValue(new Response(id === 'itvasa' ? '<form action="./"></form>' : pdf))
    const result = await publicItvSource(id,request)
    expect(result?.source).toBe(url)
    expect(Number.isFinite(Date.parse(result!.fetchedAt))).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toBe(url)
    expect(request.mock.calls[0][1]).toMatchObject({method:'GET',redirect:'manual',credentials:'omit',cache:'no-store'})
    expect(new Headers(request.mock.calls[0][1].headers).has('Cookie')).toBe(false)
    expect(new Headers(request.mock.calls[0][1].headers).has('Authorization')).toBe(false)
  })

  it.each(['/itv/fuentes/__proto__','/itv/fuentes/https://otro.example','/itv/fuentes/asturias?url=https://otro.example','/itv/fuentes/asturias?','/itv/fuentes/%61sturias','/itv/fuentes/asturias/','/itv/desconocido'])('no consulta destinos para %s', async path => {
    const {run,cache}=harness()
    const request=vi.fn();vi.stubGlobal('fetch',request)
    const response=await run(path)
    expect(response.status).toBe(404)
    expect(request).not.toHaveBeenCalled()
    expect(cache.match).not.toHaveBeenCalled()
  })

  it.each(['POST','PUT','DELETE','HEAD','OPTIONS'])('no admite %s',async method=>{
    const {run}=harness();const request=vi.fn();vi.stubGlobal('fetch',request)
    expect((await run('/itv/fuentes/asturias',{method})).status).toBe(404)
    expect(request).not.toHaveBeenCalled()
  })

  it('sirve bytes como descarga, sin trasladar cookies ni cabeceras del visitante o del origen',async()=>{
    const {run,jobs,cache}=harness()
    const content='<script>window.evil=true</script><form action="./"></form>'
    const request=vi.fn().mockResolvedValue(new Response(content,{headers:{'Content-Type':'text/html','Set-Cookie':'sesion=secreto','Access-Control-Allow-Origin':'*'}}))
    vi.stubGlobal('fetch',request)
    const response=await run('/itv/fuentes/itvasa',{headers:{Cookie:'usuario=privado',Authorization:'Bearer privado',Range:'bytes=0-1'}})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(content)
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment;/)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('X-ITV-Source-Id')).toBe('itvasa')
    expect(response.headers.get('X-ITV-Source-Url')).toBe(ITV_PUBLIC_SOURCES.itvasa)
    for(const header of ['Set-Cookie','Access-Control-Allow-Origin'])expect(response.headers.has(header)).toBe(false)
    const forwarded=new Headers(request.mock.calls[0][1].headers)
    for(const header of ['Cookie','Authorization','Range'])expect(forwarded.has(header)).toBe(false)
    await Promise.all(jobs)
    expect(cache.put).toHaveBeenCalledOnce()
  })

  it('reutiliza los bytes durante cinco minutos sin cambiar su fecha de lectura',async()=>{
    const {run,jobs,cache}=harness()
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T20:00:00Z'))
    const request=vi.fn().mockResolvedValue(new Response(pdf));vi.stubGlobal('fetch',request)
    const first=await run();await Promise.all(jobs)
    vi.setSystemTime(new Date('2026-11-10T20:03:00Z'))
    const second=await run()
    expect(await second.text()).toBe(await first.text())
    expect(second.headers.get('X-ITV-Fetched-At')).toBe('2026-11-10T20:00:00.000Z')
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(request).toHaveBeenCalledOnce()
    expect(cache.put.mock.calls[0][0].url).toBe('https://relay.example/itv/fuentes/asturias')
  })

  it.each([301,302,403,429,500])('no sigue ni cachea una respuesta HTTP %s',async status=>{
    const {run,cache}=harness()
    const request=vi.fn().mockResolvedValue(new Response('no entregar',{status,headers:{Location:'https://otra.example'}}));vi.stubGlobal('fetch',request)
    const response=await run()
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({error:'Fuente no disponible',code:'SOURCE_HTTP_'+status})
    expect(request).toHaveBeenCalledOnce();expect(cache.put).not.toHaveBeenCalled()
  })

  it('rechaza una página HTML disfrazada de PDF y no cachea el error',async()=>{
    const {run,cache}=harness();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('<html>Acceso restringido</html>',{headers:{'Content-Type':'application/pdf'}})))
    const response=await run()
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({code:'SOURCE_FORMAT'})
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('limita bytes leídos aunque Content-Length mienta o no exista',async()=>{
    const cancel=vi.fn()
    const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(ITV_MAX_BYTES));c.enqueue(new Uint8Array(1))},cancel})
    const request=vi.fn().mockResolvedValue(new Response(body,{headers:{'Content-Length':'5'}}))
    await expect(publicItvSource('asturias',request)).rejects.toMatchObject({code:'SOURCE_TOO_LARGE'})
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rechaza un tamaño declarado excesivo antes de leer el cuerpo',async()=>{
    const cancel=vi.fn();const body=new ReadableStream<Uint8Array>({cancel})
    const request=vi.fn().mockResolvedValue(new Response(body,{headers:{'Content-Length':String(ITV_MAX_BYTES+1)}}))
    await expect(publicItvSource('asturias',request)).rejects.toMatchObject({code:'SOURCE_TOO_LARGE'})
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('el plazo incluye un cuerpo que deja de responder después de las cabeceras',async()=>{
    vi.useFakeTimers()
    const cancel=vi.fn();const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(pdf)},cancel})
    const request=vi.fn().mockResolvedValue(new Response(body))
    const pending=expect(publicItvSource('asturias',request)).rejects.toMatchObject({code:'SOURCE_TIMEOUT'})
    await vi.advanceTimersByTimeAsync(ITV_TIMEOUT_MS)
    await pending
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('tampoco espera indefinidamente si nunca llegan las cabeceras',async()=>{
    vi.useFakeTimers()
    const request=vi.fn().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('Abortado')))))
    const pending=expect(publicItvSource('itvasa',request)).rejects.toMatchObject({code:'SOURCE_TIMEOUT'})
    await vi.advanceTimersByTimeAsync(ITV_TIMEOUT_MS)
    await pending
  })

  it('no expone excepciones de red ni modifica TLS',async()=>{
    const {run,cache}=harness()
    const request=vi.fn().mockRejectedValue(Error('TLS CERT_HAS_EXPIRED detalle privado'));vi.stubGlobal('fetch',request)
    const response=await run()
    expect(await response.json()).toEqual({error:'Fuente no disponible',code:'SOURCE_NETWORK'})
    expect(cache.put).not.toHaveBeenCalled()
    expect(request.mock.calls[0][1]).not.toHaveProperty('dispatcher')
  })

  it('un fallo al guardar en caché no pierde la lectura correcta',async()=>{
    const {run,jobs,cache}=harness();cache.put.mockRejectedValueOnce(Error('cache caída'))
    vi.spyOn(console,'warn').mockImplementation(()=>{})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(pdf)))
    expect((await run()).status).toBe(200)
    await Promise.all(jobs)
    expect(console.warn).toHaveBeenCalledWith(JSON.stringify({source:'asturias',code:'ITV_CACHE_WRITE_FAILED'}))
  })

  it('mantiene el contrato y caché de farmacias separados de ITV',async()=>{
    const {run,jobs,cache}=harness()
    const request=vi.fn().mockResolvedValueOnce(new Response('Farmacias oficiales')).mockResolvedValueOnce(new Response(pdf));vi.stubGlobal('fetch',request)
    const pharmacy=await run('/asturias')
    expect(pharmacy.status).toBe(200)
    expect(await pharmacy.json()).toMatchObject({html:'Farmacias oficiales',source:'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355'})
    expect((await run()).status).toBe(200)
    await Promise.all(jobs)
    expect(cache.put.mock.calls.map(call=>call[0].url)).toEqual(['https://relay.example/asturias','https://relay.example/itv/fuentes/asturias'])
  })
})
