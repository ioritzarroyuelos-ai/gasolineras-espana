import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { cargaTraficoSct, normalizaTraficoSct, fechaSct, SCT_GML, SCT_RSS, SCT_MAX_BYTES, type SctIO } from '../src/lib/trafico-sct'
import { parseSctXml } from '../src/lib/trafico-sct-xml'
import { registerTraficoRoutes } from '../src/routes/trafico'
import { buildTraficoPage } from '../src/html/trafico'

const now = Date.parse('2026-11-21T12:00:00Z')
const date = (seconds = 0) => new Date(now - seconds * 1000).toUTCString()
const published = 'Sat, 21 Nov 2026 12:00:00 GMT'
const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const item = (id = '1', title = 'Calçada restringida (Obres)') => '<item><guid>' + id + '</guid><pubDate>Mon, 02 Nov 2026 06:46:13 GMT</pubDate><title>' + escaped(title) + '</title><description>A-2 | JORBA | Sentit Oest | Punt km. 545-544.2</description></item>'
const rss = (items = item(), pubDate = published) => '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><pubDate>' + pubDate + '</pubDate>' + items + '</channel></rss>'
const feature = (id = '1', coordinates = '1.547,41.604') => '<gml:featureMember><cite:mct2_v_afectacions_data><cite:geom><gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326"><gml:coordinates decimal="." cs="," ts=" ">' + coordinates + '</gml:coordinates></gml:Point></cite:geom><cite:identificador>' + id + '</cite:identificador><cite:carretera>A-2</cite:carretera><cite:pk_inici>545</cite:pk_inici><cite:pk_fi>544.2</cite:pk_fi><cite:sentit>Decreixent</cite:sentit><cite:cap_a>LLEIDA</cite:cap_a><cite:descripcio_tipus>Obres</cite:descripcio_tipus><cite:causa>Reforçament de ferm</cite:causa></cite:mct2_v_afectacions_data></gml:featureMember>'
const gml = (items = feature()) => '<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:gml="http://www.opengis.net/gml">' + items + '</wfs:FeatureCollection>'
const download = (text: string, seconds = 0) => ({ text, consultado: new Date(now).toISOString(), modificado: date(seconds) })
const mocked = (r = rss(), g = gml()) => vi.fn(async (url: string | URL | Request, _options?: RequestInit) => new Response(String(url) === SCT_RSS ? r : g, { headers: { 'Last-Modified': published } }))
const app = () => { const instance = new Hono<{ Bindings: Env }>(); registerTraficoRoutes(instance); return instance }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('tráfico SCT: publicación actual y ubicación verificable', () => {
  it('une sólo los identificadores de las dos publicaciones, conserva fecha de obra y EPSG4326', async () => {
    const fetcher = mocked(), data = await cargaTraficoSct({ fetch: fetcher, now })
    expect(data).toMatchObject({ region: 'Cataluña', estado: 'actual', total: 1, conCoordenadas: 1, sinCoordenadas: 0, fechaDatos: new Date(now).toISOString() })
    expect(data.items[0]).toMatchObject({ id: 'sct-1', estado: 'publicada', fechaIncidencia: '2026-11-02T06:46:13.000Z', lon: 1.547, lat: 41.604, carretera: 'A-2', pkInicio: '545', pkFin: '544.2', tipo: 'Obres' })
    expect(data.items[0]).not.toHaveProperty('resuelta'); expect(data.items[0]).not.toHaveProperty('tramo')
    expect(data.atribucion).toContain('Servei Català de Trànsit')
    expect(data.licenciaUrl).toContain('/dades-obertes/llicencies')
    for (const [url, options] of fetcher.mock.calls) {
      expect([SCT_GML, SCT_RSS]).toContain(String(url))
      expect(options?.redirect).toBe('manual')
      expect(options?.headers).toEqual({ Accept: 'application/xml, application/rss+xml' })
    }
  })
  it('una obra antigua sólo se muestra si sigue en la publicación actual, sin inventar bajas', () => {
    const before = normalizaTraficoSct(download(rss()), download(gml()), now)
    const after = normalizaTraficoSct(download(rss('')), download(gml()), now)
    expect(before.items[0].fechaIncidencia).toBe('2026-11-02T06:46:13.000Z')
    expect(after).toMatchObject({ estado: 'actual', total: 0, items: [] })
    expect(JSON.stringify(after)).not.toContain('resuelta')
  })
  it('conserva en lista incidencias sin coordenadas y no une otros IDs', () => {
    const data = normalizaTraficoSct(download(rss(item('1') + item('2'))), download(gml(feature('1') + feature('3'))), now)
    expect(data).toMatchObject({ total: 2, conCoordenadas: 1, sinCoordenadas: 1 })
    expect(data.items[1]).toMatchObject({ id: 'sct-2', lat: null, lon: null })
    expect(data.items.map(p => p.id)).not.toContain('sct-3')
  })
  it.each(['0,0', '-3.7,40.4', '41.604,1.547'])('no sitúa un incidente en una coordenada dudosa: %s', coords => {
    const data = normalizaTraficoSct(download(rss()), download(gml(feature('1', coords))), now)
    expect(data.items[0]).toMatchObject({ lat: null, lon: null }); expect(data.sinCoordenadas).toBe(1)
  })
  it('mantiene texto sin reinterpretar HTML', () => {
    const data = normalizaTraficoSct(download(rss(item('1', '<img src=x onerror=alert(1)>'))), download(gml()), now)
    expect(data.items[0].nombre).toBe('<img src=x onerror=alert(1)>')
  })
  it('acepta afectaciones en ambos sentidos sin inventar un destino ausente', () => {
    const xml = gml().replace('<cite:cap_a>LLEIDA</cite:cap_a>', '').replace('Decreixent', 'Ambdos sentits')
    const data = normalizaTraficoSct(download(rss()), download(xml), now)
    expect(data.conCoordenadas).toBe(1); expect(data.items[0].hacia).toBeUndefined()
    expect(data.items[0].sentido).toBe('Ambdos sentits')
  })
  it.each(['rss-header', 'gml-header', 'channel', 'exacto'])('oculta la lista si caduca %s, sin fingir cero incidencias actuales', mode => {
    const r = download(rss(undefined, mode === 'channel' ? date(601) : published), mode === 'rss-header' ? 601 : mode === 'exacto' ? 600 : 0)
    const g = download(gml(), mode === 'gml-header' ? 601 : 0)
    const data = normalizaTraficoSct(r, g, now)
    expect(data).toMatchObject({ estado: 'sin_actualizar', items: [], total: 0 })
    expect(data.warnings.join(' ')).toContain('ocultado')
  })
  it('no mezcla geometrías con otra versión desincronizada', () => {
    const data = normalizaTraficoSct(download(rss()), download(gml(), 121), now)
    expect(data.estado).toBe('actual'); expect(data.items[0].lat).toBeNull()
  })
  it.each(['GMT', 'CET', 'CEST'])('interpreta explícitamente la zona horaria %s', zone => {
    expect(fechaSct('Sat, 21 Nov 2026 12:00:00 ' + zone, now)).toBe(now - (zone === 'CET' ? 3600000 : zone === 'CEST' ? 7200000 : 0))
  })
  it.each(['fecha ausente', 'futuro', 'fecha imposible', 'id repetido', 'id inválido', 'EPSG desconocido', 'muchas'])('rechaza datos incomprobables: %s', mode => {
    const r = download(rss()), g = download(gml())
    if (mode === 'fecha ausente') r.modificado = ''
    if (mode === 'futuro') g.modificado = date(-1)
    if (mode === 'fecha imposible') r.text = rss(undefined, 'Tue, 31 Feb 2026 12:00:00 GMT')
    if (mode === 'id repetido') r.text = rss(item('1') + item('1'))
    if (mode === 'id inválido') r.text = rss(item('../private'))
    if (mode === 'EPSG desconocido') g.text = gml().replace('#4326', '#25831')
    if (mode === 'muchas') r.text = rss(Array.from({ length: 2001 }, (_, n) => item(String(n))).join(''))
    expect(() => normalizaTraficoSct(r, g, now)).toThrow()
  })
  it.each([
    '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]><rss>&e;</rss>',
    '<!DOCTYPE x [<!ENTITY x "repeat">]><rss>&x;</rss>',
    '<rss><channel></rss>',
    '<rss/><rss/>',
    '<rss>&unknown;</rss>',
    '<rss>&#0;</rss>',
    '<rss foo="one" foo="two"/>',
    '<rss><![CDATA[<script>bad</script>]]></rss>',
    '<rss><?xml-stylesheet href="https://example.invalid"?></rss>',
    '<rss>&not-closed</rss>',
  ])('rechaza XML no soportado sin expandir entidades: %s', xml => {
    expect(() => parseSctXml(xml)).toThrow()
  })
  it.each(['redirect', 'html', 'large-header', 'large-stream', 'missing-date'])('acota una descarga inválida: %s', async mode => {
    const fetcher = async () => mode === 'redirect' ? new Response(null, { status: 302, headers: { Location: 'https://example.invalid', 'Last-Modified': published } })
      : mode === 'html' ? new Response('<html>error</html>', { headers: { 'Last-Modified': published } })
      : mode === 'large-header' ? new Response(rss(), { headers: { 'Last-Modified': published, 'Content-Length': String(SCT_MAX_BYTES + 1) } })
      : mode === 'missing-date' ? new Response(rss()) : new Response(new Uint8Array(SCT_MAX_BYTES + 1), { headers: { 'Last-Modified': published } })
    await expect(cargaTraficoSct({ fetch: fetcher, now })).rejects.toThrow()
  })
  it('aborta las dos peticiones que no terminan y espera su finalización', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const fetcher = (_url: string | URL | Request, options?: RequestInit) => { signals.push(options?.signal); return new Promise<Response>(() => {}) }
    await expect(cargaTraficoSct({ fetch: fetcher, now, timeoutMs: 10 })).rejects.toThrow()
    expect(signals).toHaveLength(2); expect(signals.every(s => s?.aborted)).toBe(true)
  })
  it('caché 60 s conserva fechas y recalcula caducidad', async () => {
    const entries = new Map<string, Response>()
    const cache: NonNullable<SctIO['cache']> = { match: async key => entries.get(key)?.clone(), put: async (key, value) => { entries.set(key, value.clone()) } }
    const fetcher = mocked(), first = await cargaTraficoSct({ fetch: fetcher, cache, now })
    const second = await cargaTraficoSct({ fetch: fetcher, cache, now: now + 59000 })
    expect(fetcher).toHaveBeenCalledTimes(2); expect(second.consultado).toBe(first.consultado)
    await cargaTraficoSct({ fetch: fetcher, cache, now: now + 60000 })
    expect(fetcher).toHaveBeenCalledTimes(4)
    const old = await cargaTraficoSct({ fetch: fetcher, cache, now: now + 601000 })
    expect(old.estado).toBe('sin_actualizar'); expect(old.items).toEqual([])
  })
  it('la API rechaza ubicación/otras regiones y nunca reenvía cookies', async () => {
    vi.setSystemTime(now); const fetcher = mocked(); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('caches', undefined)
    const instance = app()
    expect((await instance.request('/api/trafico/cataluna?lat=41')).status).toBe(400)
    expect((await instance.request('/api/trafico/madrid')).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await instance.request('/api/trafico/cataluna', { headers: { Cookie: 'private-session', 'CF-Connecting-IP': '192.0.2.1' } })
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/xml, application/rss+xml' })
  })
  it('una caída ofrece el enlace oficial sin publicar errores internos', async () => {
    vi.stubGlobal('fetch', async () => { throw Error('private error') }); vi.stubGlobal('caches', undefined)
    const response = await app().request('/api/trafico/cataluna')
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text(); expect(text).not.toContain('private error'); expect(text).toContain('cit.transit.gencat.cat')
  })
  it('directorio SSR distingue cobertura y no descarga incidencias al abrir el índice', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const response = await app().request('/trafico/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('El resto de España todavía no tiene cobertura')
    expect(fetcher).not.toHaveBeenCalled()
    expect((await app().request('/trafico')).status).toBe(301)
  })
  it('la página SSR conserva todos los incidentes, escapa HTML y carga el refresco automático', async () => {
    vi.setSystemTime(now); vi.stubGlobal('fetch', mocked(rss(item('1') + item('2', '<img src=x onerror=alert(1)>')), gml())); vi.stubGlobal('caches', undefined)
    const response = await app().request('/trafico/cataluna'), html = await response.text()
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-")
    expect(html.match(/data-incidencia=/g)).toHaveLength(2)
    expect(html).toContain('1 sin punto en el mapa'); expect(html).toContain('2026-11-02T06:46:13.000Z')
    expect(html).toContain('/static/trafico.js'); expect(html).toContain('data-caduca=')
    expect(html).toContain('data-evaluado-en="2026-11-21T12:00:00.000Z"')
    expect(html).not.toContain('<img src=x'); expect(html).toContain('&lt;img src=x')
  })
  it('el SSR no presenta un parte con fecha futura como actual aunque su vencimiento sea posterior',()=>{
    vi.setSystemTime(now)
    const original = normalizaTraficoSct(download(rss()),download(gml()),now)
    const html = buildTraficoPage({nonce:'test',canonical:'https://example.com/trafico/cataluna',data:{...original,fechaDatos:new Date(now+1000).toISOString(),caduca:new Date(now+601000).toISOString()}})
    expect(html).not.toContain('data-incidencia=')
    expect(html).toContain('El parte está pendiente de actualizar')
  })
  it('la API evalúa al responder y conserva las fechas de fuente y consulta en caché',async()=>{
    vi.setSystemTime(now)
    const values = new Map<string, Response>(), cache = { match: async (key: string) => values.get(key)?.clone(), put: async (key: string, response: Response) => { values.set(key, response) } }
    const fetcher = mocked(); vi.stubGlobal('fetch',fetcher);vi.stubGlobal('caches',{open:async()=>cache})
    const instance=app(),first=await(await instance.request('/api/trafico/cataluna')).json() as any
    vi.setSystemTime(now+30000)
    const response=await instance.request('/api/trafico/cataluna'),second=await response.json() as any
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(second.evaluadoEn).toBe(new Date(now+30000).toISOString())
    expect(second.consultado).toBe(first.consultado);expect(second.fechaDatos).toBe(first.fechaDatos);expect(second.caduca).toBe(first.caduca)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('error SSR muestra un aviso y 503, no un listado vacío como tráfico despejado', async () => {
    vi.stubGlobal('fetch', async () => { throw Error('private error') }); vi.stubGlobal('caches', undefined)
    const response = await app().request('/trafico/cataluna'), html = await response.text()
    expect(response.status).toBe(503); expect(html).toContain('Esto no significa que las carreteras estén libres')
    expect(html).not.toContain('0 incidencias'); expect(html).not.toContain('private error')
  })
})
