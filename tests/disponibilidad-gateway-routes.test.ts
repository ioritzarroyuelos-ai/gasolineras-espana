import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { registerDisponibilidadGatewayRoutes } from '../src/routes/disponibilidad-gateway'
import { derivaGatewayKey, gatewayCanonico, gatewayChallenge, gatewayDigest, gatewayFirma, gatewayValidaRespuesta, gatewayVerifica,
  GATEWAY_ORIGIN, GATEWAY_PATH_CHECK, GATEWAY_PATH_SEND, GATEWAY_REVISION, GATEWAY_SIGNATURE_HEADER } from '../scripts/lib/disponibilidad-gateway.mjs'
import type { GatewayCheck, GatewaySend } from '../scripts/lib/disponibilidad-gateway.mjs'

const NOW = Date.parse('2026-11-21T10:30:00.000Z')
const VERSION = '11111111-1111-4111-8111-111111111111', AVISO = '22222222-2222-4222-8222-222222222222'
const NONCE = '33333333-3333-4333-8333-333333333333', ATTEMPT = '44444444-4444-4444-8444-444444444444'
const botToken = ['123456', 'x'.repeat(32)].join(':'), cron = 'mock-gateway-root-' + 'x'.repeat(20)
const check = (): GatewayCheck => ({ schema: 1, environment: 'production', op: 'check', nonce: NONCE, issuedAt: NOW, expiresAt: NOW + 30000 })
const send = (): GatewaySend => ({ ...check(), op: 'send', chat: 12345, modo: 'temporal', avisoId: AVISO, version: AVISO, event: 'temporal:' + AVISO,
  attempt: ATTEMPT, workerVersion: VERSION, fuente: 'aparcamientos-madrid', lugarId: 'parking-madrid-72', objetivo: 'plazas',
  ficha: { nombre: 'Centro <b>"&</b>', cantidad: 7, fechaDato: new Date(NOW - 60000).toISOString(), caduca: new Date(NOW + 240000).toISOString(), lat: 40.42, lon: -3.7 } })
const getMe = () => Response.json({ ok: true, result: { id: 123456, is_bot: true, username: 'GasolinerasAlertasBot' } })
const sent = () => Response.json({ ok: true, result: { message_id: 42, chat: { id: 12345 } } })

async function harness() {
  const key = await derivaGatewayKey(cron)
  const state = { schema: 1, revision: 'disponibilidad-v1', gatewayRevision: GATEWAY_REVISION as string, versionId: VERSION, habilitado: true, configurado: true }
  const binding = {
    estado: vi.fn(async () => ({ ...state })),
    gatewayChallenge: vi.fn(async (input: { nonce: string; issuedAt: number; expiresAt: number }) => gatewayChallenge(key, input, VERSION)),
    claimGateway: vi.fn(async (_input: Record<string, unknown>) => true),
    leer: vi.fn(), guardar: vi.fn(), cancelar: vi.fn(), comprobar: vi.fn(),
  }
  const env = { CRON_TOKEN: cron, TELEGRAM_BOT_TOKEN: botToken, TELEGRAM_BOT_USERNAME: 'GasolinerasAlertasBot', DISPONIBILIDAD_ENABLED: 'true', DISPONIBILIDAD: binding } as unknown as Env
  const app = new Hono<{ Bindings: Env }>(); registerDisponibilidadGatewayRoutes(app)
  const network = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/getMe')) return getMe()
    if (url.endsWith('/sendMessage')) return sent()
    throw Error('Unexpected outbound request')
  })
  vi.stubGlobal('fetch', network)
  const request = async (payload: unknown, options: { raw?: string; signature?: string; url?: string; contentType?: string; length?: string; method?: string; signal?: AbortSignal } = {}) => {
    const path = (payload as { op?: unknown })?.op === 'check' ? GATEWAY_PATH_CHECK : GATEWAY_PATH_SEND
    const raw = options.raw ?? gatewayCanonico(payload)
    const signature = options.signature ?? await gatewayFirma(key, path, raw)
    const headers = { 'content-type': options.contentType ?? 'application/json', [GATEWAY_SIGNATURE_HEADER]: signature,
      ...(options.length === undefined ? {} : { 'content-length': options.length }) }
    return app.request(new Request(options.url ?? GATEWAY_ORIGIN + path, { method: options.method ?? 'POST', headers, body: options.method === 'GET' ? undefined : raw, signal: options.signal }), undefined, env)
  }
  const deliveryCalls = () => network.mock.calls.filter(([url]) => String(url).endsWith('/sendMessage'))
  return { key, state, binding, env, app, network, request, deliveryCalls }
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('pasarela Pages: comprobación de sólo lectura', () => {
  it('comprueba el bot propio y la clave del Worker aunque los avisos estén pausados, sin entrar en un DO', async () => {
    const h = await harness(); h.env.DISPONIBILIDAD_ENABLED = 'false'; h.state.habilitado = false; h.state.configurado = false
    const input = check(), response = await h.request(input), raw = await response.text(), data = JSON.parse(raw)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await gatewayVerifica(h.key, GATEWAY_PATH_CHECK, raw, response.headers.get(GATEWAY_SIGNATURE_HEADER)!, 'response')).toBe(true)
    expect(gatewayValidaRespuesta(data, input, await gatewayDigest(gatewayCanonico(input)), NOW)).not.toBeNull()
    expect(data.bot).toEqual({ expectedUsername: 'GasolinerasAlertasBot', credentialUsername: 'GasolinerasAlertasBot' })
    expect(h.binding.gatewayChallenge).toHaveBeenCalledExactlyOnceWith({ nonce: NONCE, issuedAt: NOW, expiresAt: NOW + 30000 })
    expect(h.network).toHaveBeenCalledOnce(); expect(h.deliveryCalls()).toHaveLength(0)
    for (const name of ['claimGateway', 'leer', 'guardar', 'cancelar', 'comprobar'] as const) expect(h.binding[name]).not.toHaveBeenCalled()
    expect(raw).not.toContain(botToken); expect(raw).not.toContain('123456')
  })
  it.each(['proof', 'version', 'nonce', 'window'])('no acepta un reto incompatible: %s', async failure => {
    const h = await harness()
    h.binding.gatewayChallenge.mockImplementation(async input => {
      const proof = await gatewayChallenge(h.key, input, VERSION)
      if (failure === 'proof') proof.signature = '0'.repeat(64)
      if (failure === 'version') proof.workerVersion = AVISO
      if (failure === 'nonce') proof.nonce = ATTEMPT
      if (failure === 'window') return gatewayChallenge(h.key, { ...input, issuedAt: NOW - 1, expiresAt: NOW + 20000 }, VERSION)
      return proof
    })
    const response = await h.request(check()); expect(response.status).toBe(503); expect(h.deliveryCalls()).toHaveLength(0)
  })
  it.each(['mismatch', 'invalid', 'network'])('getMe %s impide cualquier intento', async failure => {
    const h = await harness()
    h.network.mockImplementation(async () => {
      if (failure === 'network') throw Error(botToken + ' https://telegram.invalid/' + cron)
      return Response.json({ ok: true, result: { id: failure === 'invalid' ? -1 : 123456, is_bot: true, username: failure === 'mismatch' ? 'OtherBot' : 'GasolinerasAlertasBot' } })
    })
    const response = await h.request(check()); expect(response.status).toBe(503)
    expect(await response.text()).toBe('{"ok":false,"error":"gateway_unavailable"}')
    expect(h.binding.gatewayChallenge).not.toHaveBeenCalled(); expect(h.binding.claimGateway).not.toHaveBeenCalled()
  })
  it('el Worker antiguo sin reto no habilita la pasarela', async () => {
    const h = await harness(); h.env.DISPONIBILIDAD!.gatewayChallenge = undefined
    expect((await h.request(check())).status).toBe(503); expect(h.network).not.toHaveBeenCalled()
    expect(h.binding.claimGateway).not.toHaveBeenCalled()
  })
})

describe('pasarela Pages: rechazo antes de reclamar y enviar', () => {
  it.each(['', 'z'.repeat(64), '0'.repeat(64)])('una firma incorrecta nunca consulta bot ni Worker', async signature => {
    const h = await harness(); expect((await h.request(send(), { signature })).status).toBe(401)
    expect(h.binding.estado).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled()
  })
  it('la firma no se puede usar con otro cuerpo, ruta ni rol', async () => {
    const h = await harness(), input = send(), raw = gatewayCanonico(input)
    const original = await gatewayFirma(h.key, GATEWAY_PATH_SEND, raw)
    expect((await h.request({ ...input, chat: 99999 }, { signature: original })).status).toBe(401)
    expect((await h.request(input, { signature: await gatewayFirma(h.key, GATEWAY_PATH_CHECK, raw) })).status).toBe(401)
    expect((await h.request(input, { signature: await gatewayFirma(h.key, GATEWAY_PATH_SEND, raw, 'response') })).status).toBe(401)
    expect(h.network).not.toHaveBeenCalled(); expect(h.binding.estado).not.toHaveBeenCalled()
  })
  it.each(['https://preview.webapp-3ft.pages.dev', 'http://webapp-3ft.pages.dev', GATEWAY_ORIGIN + ':8443'])('no funciona en otro origen: %s', async origin => {
    const h = await harness(); expect((await h.request(send(), { url: origin + GATEWAY_PATH_SEND })).status).toBe(404)
    expect(h.network).not.toHaveBeenCalled(); expect(h.binding.estado).not.toHaveBeenCalled()
  })
  it('no acepta query, GET ni contenido distinto de JSON', async () => {
    const h = await harness()
    expect((await h.request(send(), { url: GATEWAY_ORIGIN + GATEWAY_PATH_SEND + '?chat=1' })).status).toBe(404)
    expect((await h.request(send(), { method: 'GET' })).status).toBe(404)
    expect((await h.request(send(), { contentType: 'text/plain' })).status).toBe(400)
    expect(h.network).not.toHaveBeenCalled()
  })
  it.each(['duplicate', 'spaces', 'malformed', 'array'])('un JSON %s no pasa al DO aunque esté firmado', async form => {
    const h = await harness(), input = send(), normal = gatewayCanonico(input)
    const raw = form === 'duplicate' ? '{"chat":777,' + normal.slice(1) : form === 'spaces' ? ' ' + normal : form === 'malformed' ? '{' : '[]'
    expect((await h.request(input, { raw })).status).toBe(400); expect(h.binding.estado).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled()
  })
  it.each(['4097', '-1', 'NaN'])('rechaza Content-Length %s sin consumir ni reclamar', async length => {
    const h = await harness(); expect((await h.request(send(), { length })).status).toBe(400)
    expect(h.binding.estado).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled()
  })
  it('limita un cuerpo de petición detenido y uno mayor del máximo sin cabecera', async () => {
    const h = await harness(), aborted = new AbortController(), cancel = vi.fn()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(aborted.signal)
    const timer = setTimeout(() => aborted.abort(), 5)
    try {
      const request = new Request(GATEWAY_ORIGIN + GATEWAY_PATH_SEND, { method: 'POST', headers: { 'content-type': 'application/json', [GATEWAY_SIGNATURE_HEADER]: 'a'.repeat(64) }, body: new ReadableStream({ cancel }), duplex: 'half' } as RequestInit)
      expect((await h.app.request(request, undefined, h.env)).status).toBe(400); expect(cancel).toHaveBeenCalledOnce()
    } finally { clearTimeout(timer); timeout.mockRestore() }
    expect((await h.request(send(), { raw: 'x'.repeat(4097), signature: 'a'.repeat(64) })).status).toBe(400)
    expect(h.network).not.toHaveBeenCalled()
  })
  it.each(['extra', 'url', 'wrongId', 'wrongTarget', 'future', 'expired', 'longTtl', 'zero', 'coords', 'version'])('rechaza ficha/consentimiento inválido: %s', async mutation => {
    const h = await harness(), input: Record<string, any> = send()
    if (mutation === 'extra') input.text = 'send arbitrary text'
    if (mutation === 'url') input.ficha.enlace = 'https://evil.invalid'
    if (mutation === 'wrongId') input.lugarId = 'parking-vigo-72'
    if (mutation === 'wrongTarget') input.objetivo = 'bicis'
    if (mutation === 'future') input.ficha.fechaDato = new Date(NOW + 1).toISOString()
    if (mutation === 'expired') input.ficha.caduca = new Date(NOW).toISOString()
    if (mutation === 'longTtl') input.ficha.caduca = new Date(NOW + 300001).toISOString()
    if (mutation === 'zero') input.ficha.cantidad = 0
    if (mutation === 'coords') input.ficha.lat = 42
    if (mutation === 'version') input.version = ATTEMPT
    expect((await h.request(input)).status).toBe(400); expect(h.binding.estado).not.toHaveBeenCalled(); expect(h.network).not.toHaveBeenCalled()
  })
  it.each(['flag', 'workerFlag', 'configured', 'version', 'revision', 'missingClaim', 'binding', 'secret'])('no reclama al estar %s incompatible', async failure => {
    const h = await harness()
    if (failure === 'flag') h.env.DISPONIBILIDAD_ENABLED = 'false'
    if (failure === 'workerFlag') h.state.habilitado = false
    if (failure === 'configured') h.state.configurado = false
    if (failure === 'version') h.state.versionId = AVISO
    if (failure === 'revision') h.state.gatewayRevision = 'old'
    if (failure === 'missingClaim') (h.env.DISPONIBILIDAD as any).claimGateway = undefined
    if (failure === 'binding') h.env.DISPONIBILIDAD = undefined
    if (failure === 'secret') h.env.CRON_TOKEN = undefined
    expect((await h.request(send())).status).toBe(503); expect(h.network).not.toHaveBeenCalled()
  })
})

describe('pasarela Pages: claim exacto y envío acotado', () => {
  it('reconstruye plantilla y enlaces, escapa HTML y reclama únicamente los once campos exactos', async () => {
    const h = await harness(), input = send(), response = await h.request(input), raw = await response.text(), data = JSON.parse(raw)
    expect(response.status).toBe(200); expect(data.estado).toBe('enviado'); expect(data.attempt).toBe(ATTEMPT)
    expect(await gatewayVerifica(h.key, GATEWAY_PATH_SEND, raw, response.headers.get(GATEWAY_SIGNATURE_HEADER)!, 'response')).toBe(true)
    expect(gatewayValidaRespuesta(data, input, await gatewayDigest(gatewayCanonico(input)), NOW)).not.toBeNull()
    expect(h.binding.claimGateway).toHaveBeenCalledExactlyOnceWith({ chat: input.chat, modo: input.modo, avisoId: AVISO, version: AVISO, event: input.event, attempt: ATTEMPT,
      workerVersion: VERSION, nonce: NONCE, issuedAt: NOW, expiresAt: NOW + 30000, digest: await gatewayDigest(gatewayCanonico(input)) })
    const [url, options] = h.deliveryCalls()[0], payload = JSON.parse(String(options?.body))
    expect(String(url)).toBe('https://api.telegram.org/bot' + encodeURIComponent(botToken) + '/sendMessage')
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual' }); expect(payload.chat_id).toBe(12345)
    expect(payload.text).toContain('Centro &lt;b&gt;&quot;&amp;&lt;/b&gt;'); expect(payload.text).not.toContain('<b>"&</b>')
    expect(payload.text).toContain('7 plazas libres totales'); expect(payload.text).toContain('No indica plazas PMR libres')
    expect(payload.text).toContain('21/11/2026 a las 11:29'); expect(payload.text).toContain('No es una reserva')
    expect(payload.text).toContain('https://webapp-3ft.pages.dev/cerca?categorias=aparcamientos-madrid&amp;servicio=parking-madrid-72&amp;lat=40.42&amp;lon=-3.7')
    expect(payload.text).toContain('https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios')
    expect(Object.keys(payload).sort()).toEqual(['chat_id', 'disable_web_page_preview', 'parse_mode', 'text'])
  })
  it('diario muestra cero real; parking sin coordenadas abre sólo la capa', async () => {
    const h = await harness(), input = send(); input.modo = 'diario'; input.event = 'diario:2026-11-21'; input.ficha.cantidad = 0; input.ficha.lat = null; input.ficha.lon = null
    expect((await h.request(input)).status).toBe(200)
    const text = JSON.parse(String(h.deliveryCalls()[0][1]?.body)).text
    expect(text).toContain('Resumen diario'); expect(text).toContain('0 plazas libres totales')
    expect(text).toContain('cerca?categorias=aparcamientos-madrid'); expect(text).not.toContain('servicio='); expect(text).not.toContain('lat=')
  })
  it.each(['aparcamientos-vigo', 'bicis-zaragoza'] as const)('reconstruye únicamente los enlaces de %s', async fuente => {
    const h = await harness(), input = send(); input.fuente = fuente
    Object.assign(input, fuente === 'aparcamientos-vigo' ? { lugarId: 'parking-vigo-4763', objetivo: 'plazas' } : { lugarId: 'gbfs-zaragoza-1', objetivo: 'anclajes' })
    Object.assign(input.ficha, fuente === 'aparcamientos-vigo' ? { lat: 42.23, lon: -8.72 } : { lat: 41.65, lon: -0.88 })
    expect((await h.request(input)).status).toBe(200)
    const text = JSON.parse(String(h.deliveryCalls()[0][1]?.body)).text
    expect(text).toContain(fuente === 'aparcamientos-vigo' ? 'https://datos-ckan.vigo.org/dataset/t-parking-real' : 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad')
  })
  it.each(['false', 'throw'])('claim %s nunca se interpreta como rechazo de Telegram ni se reintenta', async result => {
    const h = await harness(); h.binding.claimGateway.mockImplementation(async () => { if (result === 'throw') throw Error(botToken); return false })
    const response = await h.request(send()); expect(response.status).toBe(result === 'false' ? 409 : 503)
    expect(await response.json()).toEqual({ ok: false, error: 'gateway_unavailable' }); expect(h.deliveryCalls()).toHaveLength(0)
  })
  it('dos peticiones y un replay sólo permiten un claim y un envío', async () => {
    const h = await harness(); let claimed = false
    h.binding.claimGateway.mockImplementation(async () => { if (claimed) return false; claimed = true; return true })
    const responses = await Promise.all([h.request(send()), h.request(send())])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect((await h.request(send())).status).toBe(409); expect(h.deliveryCalls()).toHaveLength(1)
  })
  it.each(['getMe', 'claim', 'request'])('el dato o la petición que vencen durante %s no llegan a Telegram', async phase => {
    const h = await harness(), input = send()
    input.ficha.caduca = new Date(NOW + 1000).toISOString()
    if (phase === 'getMe') h.network.mockImplementation(async () => { vi.setSystemTime(NOW + 1000); return getMe() })
    if (phase === 'claim') h.binding.claimGateway.mockImplementation(async () => { vi.setSystemTime(NOW + 1000); return true })
    if (phase === 'request') { input.expiresAt = NOW + 500; h.binding.claimGateway.mockImplementation(async () => { vi.setSystemTime(NOW + 500); return true }) }
    expect((await h.request(input)).status).toBe(503); expect(h.deliveryCalls()).toHaveLength(0)
    if (phase === 'getMe') expect(h.binding.claimGateway).not.toHaveBeenCalled()
  })
  it.each(['getMe', 'claim'])('el abandono de la petición durante %s impide iniciar Telegram', async phase => {
    const h = await harness(), controller = new AbortController()
    if (phase === 'getMe') h.network.mockImplementation(async () => { controller.abort(); return getMe() })
    else h.binding.claimGateway.mockImplementation(async () => { controller.abort(); return true })
    expect((await h.request(send(), { signal: controller.signal })).status).toBe(503)
    expect(h.deliveryCalls()).toHaveLength(0)
    if (phase === 'getMe') expect(h.binding.claimGateway).not.toHaveBeenCalled()
  })
  it('un claim que responde después del límite puede estar consumido, pero no reanuda el envío', async () => {
    const h = await harness(); let finish: (value: boolean) => void = () => { throw Error('claim_not_started') }
    h.binding.claimGateway.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve }))
    const response = await h.request(send()); expect(response.status).toBe(503)
    expect(h.binding.claimGateway).toHaveBeenCalledOnce(); expect(h.deliveryCalls()).toHaveLength(0)
    finish(true); await Promise.resolve(); await Promise.resolve()
    expect(h.deliveryCalls()).toHaveLength(0)
  })
  it('conserva para ese intento el token verificado, y comprueba la rotación en la petición siguiente', async () => {
    const h = await harness(), rotated = ['987654', 'y'.repeat(32)].join(':')
    h.binding.claimGateway.mockImplementation(async () => { h.env.TELEGRAM_BOT_TOKEN = rotated; return true })
    expect((await h.request(send())).status).toBe(200); expect(String(h.deliveryCalls()[0][0])).toContain(encodeURIComponent(botToken))
    expect((await h.request(send())).status).toBe(200); expect(String(h.network.mock.calls[2][0])).toContain(rotated)
    expect(String(h.deliveryCalls()[1][0])).toContain(encodeURIComponent(rotated))
  })
  it.each([
    [429, { ok: false, error_code: 429, parameters: { retry_after: 90 } }, 'reintentar'],
    [403, { ok: false, error_code: 403 }, 'baja'], [503, { ok: false, error_code: 503 }, 'incierto'],
    [429, { ok: false, error_code: 403 }, 'incierto'], [200, { ok: true }, 'incierto'],
    [200, { ok: true, result: { message_id: 1, chat: { id: 999 } } }, 'incierto'],
    [302, { ok: false, error_code: 302 }, 'incierto'],
  ])('sólo clasifica la respuesta directa de Telegram HTTP%s como %s', async (status, body, expected) => {
    const h = await harness(); h.network.mockImplementation(async input => String(input).endsWith('/getMe') ? getMe() : Response.json(body, { status: Number(status) }))
    const response = await h.request(send()), data = await response.json()
    expect(response.status).toBe(200); expect(data.estado).toBe(expected); expect(data.espera).toBe(expected === 'reintentar' ? 90 : undefined)
    expect(h.deliveryCalls()).toHaveLength(1); expect(h.binding.claimGateway).toHaveBeenCalledOnce()
  })
  it('una respuesta perdida permanece incierta; ninguna excepción ni credencial se devuelve', async () => {
    const h = await harness(); h.network.mockImplementation(async input => { if (String(input).endsWith('/getMe')) return getMe(); throw Error(botToken + ':' + cron) })
    const response = await h.request(send()), text = await response.text()
    expect(response.status).toBe(200); expect(JSON.parse(text).estado).toBe('incierto'); expect(text).not.toContain(botToken); expect(text).not.toContain(cron)
    expect(h.deliveryCalls()).toHaveLength(1)
  })
  it('no firma una entrega si la respuesta llega después de vencer la petición', async () => {
    const h = await harness(); h.network.mockImplementation(async input => { if (String(input).endsWith('/getMe')) return getMe(); vi.setSystemTime(NOW + 30000); return sent() })
    const response = await h.request(send()); expect(response.status).toBe(503); expect(response.headers.get(GATEWAY_SIGNATURE_HEADER)).toBeNull()
    expect(h.deliveryCalls()).toHaveLength(1)
  })
})
