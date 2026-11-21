import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { cargaCamarasSct, normalizaCamarasSct, CAMARAS_SCT_XML, CAMARAS_MAX_BYTES, CAMARAS_MAX_AGE, type CamarasIO } from '../src/lib/camaras-sct'
import { registerCamarasRoutes } from '../src/routes/camaras'

const now = Date.parse('2026-11-21T12:00:00Z')
const checked = new Date(now).toISOString()
const date = (ago = 0) => new Date(now - ago).toUTCString()
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const sctUrl = 'http://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc85.gif'
function feature(source = 'SCT', url = sctUrl, coords = '2.17446844,41.46672443') {
  return '<gml:featureMember><cite:cameres><cite:geom><gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326"><gml:coordinates decimal="." cs="," ts=" ">' + coords + '</gml:coordinates></gml:Point></cite:geom><cite:carretera>C-58</cite:carretera><cite:municipi>MONTCADA I REIXAC</cite:municipi><cite:pk>1.82</cite:pk><cite:link>' + escape(url) + '</cite:link><cite:font>' + source + '</cite:font></cite:cameres></gml:featureMember>'
}
const xml = (rows = feature()) => '<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml">' + rows + '</wfs:FeatureCollection>'
const mocked = (text = xml(), modified = date()) => vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(text, { headers: { 'Last-Modified': modified } }))
const app = () => { const a = new Hono<{ Bindings: Env }>(); registerCamarasRoutes(a); return a }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('cámaras SCT: directorio oficial sin atribuir hora a las imágenes', () => {
  it('conserva ubicación EPSG4326, fuente e identidad; sólo descarga XML', async () => {
    const fetcher = mocked(), data = await cargaCamarasSct({ fetch: fetcher, now })
    expect(data).toMatchObject({ estado: 'actual', fechaDirectorio: checked, consultado: checked, total: 1, conCoordenadas: 1, excluidas: 0, duplicadas: 0 })
    expect(data.items[0]).toMatchObject({ id: 'camara-sct-nc85', lat: 41.46672443, lon: 2.17446844, pk: '1.82', horaImagen: null, fuenteImagen: 'SCT', ubicacion: 'publicada', urlCamara: sctUrl.replace('http:', 'https:') })
    expect(data.caduca).toBe(new Date(now + CAMARAS_MAX_AGE).toISOString())
    expect(data.licenciaUrl).toContain('/dades-obertes/llicencies')
    expect(data.atribucionImagenes).toContain('No se copian')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(CAMARAS_SCT_XML)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Accept: 'application/xml' } })
  })
  it('excluye Andorra y operadores no comprobados; combina duplicado exacto', () => {
    const data = normalizaCamarasSct(xml(feature() + feature() + feature('Andorra', 'https://imgs.mobilitat.ad/camera.jpg', '1.55929582,42.5217551') + feature('Otro')), date(), checked, now)
    expect(data).toMatchObject({ total: 1, excluidas: 2, duplicadas: 1, conCoordenadas: 1 })
  })
  it('normaliza Terrassa sin inventar una fecha de captura ni punto kilométrico', () => {
    const row = feature('Terrassa', 'https://emap.terrassa.cat/it_terrassa/cam01.jpeg?a=1\r\n', '2.00746247,41.5569824').replace('<cite:pk>1.82</cite:pk>', '')
    const data = normalizaCamarasSct(xml(row), date(), checked, now)
    expect(data.items[0]).toMatchObject({ id: 'camara-terrassa-cam01', horaImagen: null, fuenteImagen: 'Ajuntament de Terrassa' })
    expect(data.items[0].pk).toBeUndefined()
  })
  it('si un mismo identificador tiene ubicaciones contradictorias lo deja en lista sin punto', () => {
    const data = normalizaCamarasSct(xml(feature() + feature('SCT', sctUrl, '2.20,41.47') + feature()), date(), checked, now)
    expect(data).toMatchObject({ total: 1, duplicadas: 2, conCoordenadas: 0 })
    expect(data.items[0]).toMatchObject({ lat: null, lon: null, ubicacion: 'por_confirmar' })
    expect(data.items[0].municipio).toBeUndefined()
    expect(data.items[0].carretera).toBeUndefined()
  })
  it.each(['0,0', '41.46,2.17', '-3.7,40.4'])('conserva enlace sin colocar una coordenada dudosa: %s', coords => {
    const data = normalizaCamarasSct(xml(feature('SCT', sctUrl, coords)), date(), checked, now)
    expect(data.items[0]).toMatchObject({ lat: null, lon: null, ubicacion: 'por_confirmar' })
  })
  it.each([
    'https://mct.gencat.cat.evil.invalid/mct2bo/RenderService?sctidcam=nc1.gif',
    'https://user:password@mct.gencat.cat/mct2bo/RenderService?sctidcam=nc1.gif',
    'https://mct.gencat.cat:8443/mct2bo/RenderService?sctidcam=nc1.gif',
    'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc1.gif#script',
    'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc1.gif&extra=1',
    'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=nc1.gif&sctidcam=nc2.gif',
    'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=..%2fsecret.gif',
    'https://mct.gencat.cat/mct2bo/Other?sctidcam=nc1.gif',
    'javascript:alert(1)',
    'http://127.0.0.1/private',
  ])('nunca publica un destino ajeno o inseguro: %s', url => {
    const data = normalizaCamarasSct(xml(feature() + feature('SCT', url)), date(), checked, now)
    expect(data.total).toBe(1); expect(data.excluidas).toBe(1)
    expect(data.items[0].urlCamara).toBe(sctUrl.replace('http:', 'https:'))
  })
  it('un directorio caducado mantiene enlaces con aviso y sin rejuvenecer fechas', () => {
    const modified = date(CAMARAS_MAX_AGE), data = normalizaCamarasSct(xml(), modified, checked, now)
    expect(data.estado).toBe('sin_actualizar'); expect(data.total).toBe(1)
    expect(data.fechaDirectorio).toBe(new Date(now - CAMARAS_MAX_AGE).toISOString())
    expect(data.warnings.join(' ')).toContain('30 horas')
    expect(data.items[0].horaImagen).toBeNull()
  })
  it.each(['', date(-1000), 'Tue, 31 Feb 2026 12:00:00 GMT'])('no acepta fecha original ausente, futura o imposible: %s', modified => {
    expect(() => normalizaCamarasSct(xml(), modified, checked, now)).toThrow()
  })
  it.each([
    '<!DOCTYPE x [<!ENTITY camera SYSTEM "file:///private">]><x>&camera;</x>',
    '<!DOCTYPE x [<!ENTITY camera "repeat">]><x>&camera;</x>',
    '<wfs:FeatureCollection>',
    xml().replace('#4326', '#3857'),
    xml(''),
    xml(Array.from({ length: 501 }, () => feature()).join('')),
  ])('rechaza XML incompleto o no interpretable con seguridad', text => {
    expect(() => normalizaCamarasSct(text, date(), checked, now)).toThrow()
  })
  it.each(['redirect', 'oversize-header', 'oversize-body', 'missing-date'])('descarga acotada sin seguir redirecciones: %s', mode => {
    const fetcher = async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } })
      : mode === 'oversize-header' ? new Response(xml(), { headers: { 'Content-Length': String(CAMARAS_MAX_BYTES + 1), 'Last-Modified': date() } })
      : mode === 'oversize-body' ? new Response(new Uint8Array(CAMARAS_MAX_BYTES + 1), { headers: { 'Last-Modified': date() } }) : new Response(xml())
    return expect(cargaCamarasSct({ fetch: fetcher, now })).rejects.toThrow()
  })
  it('aborta una petición que no termina', async () => {
    let signal: AbortSignal | null | undefined
    const fetcher = (_url: string | URL | Request, options?: RequestInit) => { signal = options?.signal; return new Promise<Response>(() => {}) }
    await expect(cargaCamarasSct({ fetch: fetcher, now, timeoutMs: 10 })).rejects.toThrow()
    expect(signal?.aborted).toBe(true)
  })
  it('reutiliza una hora de caché, conserva fechas y recalcula la antigüedad', async () => {
    const entries = new Map<string, Response>()
    const cache: NonNullable<CamarasIO['cache']> = { match: async key => entries.get(key)?.clone(), put: async (key, value) => { entries.set(key, value.clone()) } }
    const fetcher = mocked(xml(), date(CAMARAS_MAX_AGE - 1000))
    const first = await cargaCamarasSct({ fetch: fetcher, cache, now })
    const cached = await cargaCamarasSct({ fetch: fetcher, cache, now: now + 2000 })
    expect(fetcher).toHaveBeenCalledTimes(1); expect(first.estado).toBe('actual'); expect(cached.estado).toBe('sin_actualizar')
    expect(cached.consultado).toBe(first.consultado); expect(cached.fechaDirectorio).toBe(first.fechaDirectorio)
    const rechecked = await cargaCamarasSct({ fetch: fetcher, cache, now: now + 3600000 })
    expect(fetcher).toHaveBeenCalledTimes(2); expect(rechecked.fechaDirectorio).toBe(first.fechaDirectorio)
    expect(rechecked.consultado).not.toBe(first.consultado)
  })
  it('una caché rota no impide consultar la fuente válida', async () => {
    const cache: NonNullable<CamarasIO['cache']> = { match: async () => new Response('broken', { headers: { 'X-EU-Consultado': checked, 'Last-Modified': date() } }), put: async () => { throw Error('cache unavailable') } }
    expect((await cargaCamarasSct({ fetch: mocked(), cache, now })).total).toBe(1)
  })
  it('API sin ubicación, sin cookies de terceros ni caché de navegador', async () => {
    vi.setSystemTime(now); const fetcher = mocked(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('caches', undefined)
    const instance = app()
    expect((await instance.request('/api/camaras/cataluna?lat=41')).status).toBe(400)
    expect((await instance.request('/api/camaras/madrid')).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await instance.request('/api/camaras/cataluna', { headers: { Cookie: 'private=yes', Authorization: 'Bearer private' } })
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/xml' })
    expect((await response.json()).total).toBe(1)
  })
  it('una fuente caída devuelve error y enlace oficial, no un directorio vacío engañoso', async () => {
    vi.stubGlobal('fetch', async () => { throw Error('secret upstream details') }); vi.stubGlobal('caches', undefined)
    const response = await app().request('/api/camaras/cataluna'), data = await response.json()
    expect(response.status).toBe(503); expect(data.fuenteUrl).toContain('3tzz-6b9y')
    expect(data).not.toHaveProperty('items'); expect(JSON.stringify(data)).not.toContain('secret')
  })
})
