import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { registerServiciosRoutes } from '../src/routes/servicios'
import { buscaDireccionServicio, leeBusquedaDireccion, CARTOCIUDAD_MAX_RESPONSE } from '../src/lib/cartociudad'

const portal = { id: '13.PV.MUN_280790145199', type: 'portal', address: 'CALLE MAYOR 1, Madrid', lat: 40.416461, lng: -3.704658, muni: 'Madrid', muniCode: '28079', postalCode: '28013', countryCode: '011', refCatastral: 'no-publicar', geom: 'no-publicar' }
const postal = { id: '8001', type: 'Codpost', address: '08001', postalCode: '08001', lat: 0, lng: 0, countryCode: '011' }
function app() { const instance = new Hono<{ Bindings: Env }>(); registerServiciosRoutes(instance); return instance }
afterEach(() => vi.unstubAllGlobals())
describe('búsqueda puntual con CartoCiudad', () => {
  it('devuelve opciones verificadas para elegir y no expone campos catastrales', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json([portal, { ...portal, id: 'otro-portal', address: 'CALLE MAYOR 1 B, Madrid' }]))
    const results = await buscaDireccionServicio('calle mayor 1 madrid', { fetch: fetcher })
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({ id: portal.id, tipo: 'portal', nombre: portal.address, lat: portal.lat, lng: portal.lng, precision: 'portal', municipio: 'Madrid', ine: '28079', cp: '28013' })
    const [url, options] = fetcher.mock.calls[0]
    expect(new URL(String(url)).origin).toBe('https://www.cartociudad.es')
    expect(new URL(String(url)).searchParams.get('limit')).toBe('5')
    expect(options?.headers).toEqual({ Accept: 'application/json' })
    expect(options?.redirect).toBe('manual')
  })
  it('resuelve el código postal con ceros iniciales y rotula el centro de zona', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/candidates?') ? Response.json([postal]) : Response.json({ ...postal, address: null, lat: 41.379802, lng: 2.16923 }))
    const results = await buscaDireccionServicio('08001', { fetch: fetcher })
    expect(results[0]).toMatchObject({ nombre: 'Código postal 08001', precision: 'zona', cp: '08001', lat: 41.379802, lng: 2.16923 })
    const resolve = new URL(String(fetcher.mock.calls[1][0]))
    expect(resolve.searchParams.get('id')).toBe('8001'); expect(resolve.searchParams.get('type')).toBe('Codpost')
    expect(resolve.searchParams.has('q')).toBe(false)
  })
  it('calle sin número se resuelve por ID y no aparenta ser un portal exacto', async () => {
    const calle = { ...portal, type: 'callejero', address: 'CALLE MAYOR, Madrid', lat: 0, lng: 0 }
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/candidates?') ? Response.json([calle]) : Response.json({ ...calle, lat: portal.lat, lng: portal.lng }))
    expect((await buscaDireccionServicio('calle mayor madrid', { fetch: fetcher }))[0].precision).toBe('zona')
  })
  it('no inventa coordenadas cuando la consulta no tiene coincidencias', async () => {
    expect(await buscaDireccionServicio('no existe', { fetch: async () => Response.json([]) })).toEqual([])
  })
  it.each(['ceros', 'fuera', 'extranjero', 'nan', 'forma', 'muchos', 'fecha-nombre', 'redirect', 'huge-header', 'huge-stream'])('rechaza datos del proveedor incomprobables: %s', async mode => {
    let value: any = [portal]
    if (mode === 'ceros') value = [{ ...portal, lat: 0, lng: 0 }]
    if (mode === 'fuera') value = [{ ...portal, lat: 50, lng: 15 }]
    if (mode === 'extranjero') value = [{ ...portal, countryCode: '010' }]
    if (mode === 'nan') value = [{ ...portal, lat: null }]
    if (mode === 'forma') value = { resultados: [portal] }
    if (mode === 'muchos') value = Array.from({ length: 6 }, () => portal)
    if (mode === 'fecha-nombre') value = [{ ...portal, address: 'bad\u0000name' }]
    const fetcher = async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://otro.example' } }) : mode === 'huge-header' ? new Response('[]', { headers: { 'Content-Length': String(CARTOCIUDAD_MAX_RESPONSE + 1) } }) : mode === 'huge-stream' ? new Response(new Uint8Array(CARTOCIUDAD_MAX_RESPONSE + 1)) : Response.json(value)
    await expect(buscaDireccionServicio('calle mayor 1', { fetch: fetcher })).rejects.toThrow()
  })
  it('un CP sin geometría o con otro identificador no entra como resultado válido', async () => {
    for (const found of [postal, { ...postal, id: 'otro', lat: 40, lng: -3 }]) {
      const fetcher = async (url: string | URL | Request) => String(url).includes('/candidates?') ? Response.json([postal]) : Response.json(found)
      await expect(buscaDireccionServicio('08001', { fetch: fetcher })).rejects.toThrow()
    }
  })
  it('interrumpe una consulta que no responde y aborta la petición', async () => {
    let signal: AbortSignal | null | undefined
    const fetcher = (_url: string | URL | Request, options?: RequestInit) => { signal = options?.signal; return new Promise<Response>(() => {}) }
    await expect(buscaDireccionServicio('calle mayor', { fetch: fetcher, timeoutMs: 10 })).rejects.toThrow('tiempo')
    expect(signal?.aborted).toBe(true)
  })
  it.each(['{}', '{', '{"q":"ab"}', '{"q":"calle","lat":40}', '{"q":"calle\\n1"}', JSON.stringify({ q: 'a'.repeat(1100) })])('valida el cuerpo antes de hacer consultas: %s', async body => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const response = await app().request('/api/servicios/buscar-direccion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect(response.status).toBe(400); expect(fetcher).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('no acepta la dirección en la URL ni un cuerpo de formulario', async () => {
    const instance = app(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect((await instance.request('/api/servicios/buscar-direccion?q=calle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"q":"calle"}' })).status).toBe(400)
    expect((await instance.request('/api/servicios/buscar-direccion', { method: 'POST', body: 'q=calle' })).status).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('respuesta del formulario tiene atribución, no-store y error claro si cae la fuente', async () => {
    const fetcher = vi.fn(async () => Response.json([portal])); vi.stubGlobal('fetch', fetcher)
    const request = () => app().request('/api/servicios/buscar-direccion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"q":"calle mayor 1 madrid"}' })
    const response = await request(), body = await response.json() as any
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.atribucion).toContain('CC BY 4.0'); expect(body.resultados).toHaveLength(1)
    fetcher.mockRejectedValue(Error('private query must not leak'))
    const failed = await request(); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private query')
  })
  it('normaliza espacios sin alterar el contenido de la consulta', async () => {
    const req = new Request('https://test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"q":"  Calle  Mayor 1  "}' })
    expect(await leeBusquedaDireccion(req)).toBe('Calle Mayor 1')
  })
})
