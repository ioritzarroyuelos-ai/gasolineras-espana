import { describe, expect, it } from 'vitest'
// @ts-expect-error Las pruebas Node no amplían los tipos del navegador.
import { createHmac } from 'node:crypto'
import { derivaGatewayKey, gatewayCanonico, gatewayDigest, gatewayFirma, gatewayVerifica, gatewayValidaSolicitud, gatewayChallenge, gatewayValidaChallenge,
  gatewayValidaRespuesta, gatewayEnviar, GATEWAY_ORIGIN, GATEWAY_PATH_CHECK, GATEWAY_PATH_SEND, GATEWAY_REVISION, GATEWAY_SIGNATURE_HEADER,
  type GatewaySend, type GatewayCheck, type GatewaySendReply, type GatewayCheckReply } from '../scripts/lib/disponibilidad-gateway.mjs'

const now = Date.parse('2026-11-21T13:00:00Z')
// Se genera dentro de la prueba; nunca contiene una credencial de despliegue.
const material = await derivaGatewayKey('material-publico-exclusivo-de-esta-prueba-local')
const notice = 'd0392349-1482-4f54-8ba9-177179a57573', worker = 'ec59c908-0548-45d7-a024-d23e87d6272c'
function request(overrides: Partial<GatewaySend> = {}): GatewaySend {
  return { schema: 1, environment: 'production', op: 'send', nonce: crypto.randomUUID(), issuedAt: now, expiresAt: now + 30000,
    chat: 10, modo: 'temporal', avisoId: notice, version: notice, event: 'temporal:' + notice, attempt: crypto.randomUUID(), workerVersion: worker,
    fuente: 'aparcamientos-madrid', lugarId: 'parking-madrid-72', objetivo: 'plazas',
    ficha: { nombre: 'Aparcamiento municipal', cantidad: 2, fechaDato: new Date(now - 60000).toISOString(), caduca: new Date(now + 240000).toISOString(), lat: 40.4, lon: -3.7 }, ...overrides }
}
function reply(sent: GatewaySend, requestDigest: string, changes: Partial<GatewaySendReply> = {}): GatewaySendReply {
  return { schema: 1, environment: 'production', op: 'send', nonce: sent.nonce, issuedAt: now + 1, expiresAt: sent.expiresAt, revision: GATEWAY_REVISION,
    requestDigest, workerVersion: sent.workerVersion, attempt: sent.attempt, estado: 'enviado', ...changes }
}
async function response(sent: GatewaySend, changes: Partial<GatewaySendReply> = {}, status = 200) {
  const body = gatewayCanonico(reply(sent, await gatewayDigest(sent), changes))
  return new Response(body, { status, headers: { 'Content-Type': 'application/json', [GATEWAY_SIGNATURE_HEADER]: await gatewayFirma(material, GATEWAY_PATH_SEND, body, 'response') } })
}
describe('protocolo de disponibilidad: dominio, integridad y fecha', () => {
  it('deriva sólo la clave de este servicio con el dominio de producción exacto', async () => {
    const root = 'texto-publico-de-prueba-sin-uso-real'
    const expected = createHmac('sha256', root).update('espana-util:disponibilidad:gateway-key:v1:production:https://webapp-3ft.pages.dev').digest('hex')
    expect(await derivaGatewayKey(root)).toBe(expected)
    expect(await derivaGatewayKey(root + 'distinto')).not.toBe(expected)
    await expect(derivaGatewayKey('')).rejects.toThrow('invalid_gateway_root')
  })
  it('firma bytes exactos con separación de operación y emisor', async () => {
    const raw = gatewayCanonico(request()), signature = await gatewayFirma(material, GATEWAY_PATH_SEND, raw)
    expect(await gatewayVerifica(material, GATEWAY_PATH_SEND, raw, signature)).toBe(true)
    expect(await gatewayVerifica(material, GATEWAY_PATH_CHECK, raw, signature)).toBe(false)
    expect(await gatewayVerifica(material, GATEWAY_PATH_SEND, raw, signature, 'response')).toBe(false)
    expect(await gatewayVerifica(material, GATEWAY_PATH_SEND, raw + ' ', signature)).toBe(false)
    expect(await gatewayVerifica(material, GATEWAY_PATH_SEND, raw.replace('municipal', 'alterado'), signature)).toBe(false)
    expect(await gatewayVerifica(await derivaGatewayKey('otra-prueba-local'), GATEWAY_PATH_SEND, raw, signature)).toBe(false)
    expect(await gatewayVerifica(material, 'https://otro.invalid' + GATEWAY_PATH_SEND, raw, signature)).toBe(false)
  })
  it('canoniza para crear, pero no convierte un raw recibido antes del hash', async () => {
    expect(gatewayCanonico({ z: 1, a: { d: 3, b: 2 } })).toBe('{"a":{"b":2,"d":3},"z":1}')
    expect(await gatewayDigest({ a: 1 })).toBe(await gatewayDigest('{"a":1}'))
    expect(await gatewayDigest('{ "a": 1 }')).not.toBe(await gatewayDigest({ a: 1 }))
    expect(() => gatewayCanonico({ x: undefined })).toThrow()
  })
  it('no transforma los campos validados y permite cero sólo en el resumen diario', () => {
    const sent = request(); expect(gatewayValidaSolicitud(sent, 'send', now)).toBe(sent)
    const daily = request({ modo: 'diario', event: 'diario:2026-11-21' }); daily.ficha.cantidad = 0
    expect(gatewayValidaSolicitud(daily, 'send', now)).toBe(daily)
    daily.modo = 'temporal'; daily.event = 'temporal:' + notice
    expect(gatewayValidaSolicitud(daily, 'send', now)).toBeNull()
  })
  const badCases: Array<[string, (x: any) => void]> = [
    ['campo libre', x => { x.text = 'Mensaje arbitrario' }],
    ['URL de ficha', x => { x.ficha.web = 'https://otro.invalid' }],
    ['otra operación', x => { x.op = 'check' }],
    ['preview', x => { x.environment = 'preview' }],
    ['chat negativo', x => { x.chat = -1 }],
    ['chat fraccionario', x => { x.chat = 1.5 }],
    ['versión distinta', x => { x.version = crypto.randomUUID() }],
    ['evento de otro aviso', x => { x.event = 'temporal:' + crypto.randomUUID() }],
    ['resumen de otra fecha', x => { x.modo = 'diario'; x.event = 'diario:2026-11-20' }],
    ['nonce no UUID', x => { x.nonce = 'not-a-uuid' }],
    ['intento no UUID', x => { x.attempt = 'not-a-uuid' }],
    ['worker no UUID', x => { x.workerVersion = 'main' }],
    ['más de treinta segundos', x => { x.expiresAt++ }],
    ['ventana vacía', x => { x.expiresAt = x.issuedAt }],
    ['caducado', x => { x.issuedAt -= 30000; x.expiresAt -= 30000 }],
    ['futuro mayor de un segundo', x => { x.issuedAt += 1001; x.expiresAt += 1001 }],
    ['nombre con salto', x => { x.ficha.nombre = 'Uno\nOtro' }],
    ['nombre con control C1', x => { x.ficha.nombre = 'Uno\u0085Otro' }],
    ['nombre demasiado largo', x => { x.ficha.nombre = 'a'.repeat(201) }],
    ['cantidad desconocida', x => { x.ficha.cantidad = null }],
    ['cantidad no entera', x => { x.ficha.cantidad = 1.5 }],
    ['cantidad excesiva', x => { x.ficha.cantidad = 100001 }],
    ['fecha fuente futura', x => { x.ficha.fechaDato = new Date(now + 1).toISOString() }],
    ['dato ya vencido', x => { x.ficha.caduca = new Date(now).toISOString() }],
    ['TTL Madrid ampliado', x => { x.ficha.caduca = new Date(now + 240001).toISOString() }],
    ['fecha imposible', x => { x.ficha.fechaDato = '2026-11-31T13:00:00Z' }],
    ['coordenada de otra ciudad', x => { x.ficha.lat = 42.2 }],
    ['coordenadas incompletas', x => { x.ficha.lat = null }],
    ['fuente e identidad diferentes', x => { x.fuente = 'aparcamientos-vigo' }],
    ['objetivo inválido', x => { x.objetivo = 'pmr' }],
  ]
  it.each(badCases)('rechaza %s', (_, mutate) => { const sent = request(); mutate(sent); expect(gatewayValidaSolicitud(sent, 'send', now)).toBeNull() })
  it('acepta sólo las coordenadas y el TTL de la fuente elegida', () => {
    const parking = request(); parking.ficha.lat = null; parking.ficha.lon = null; expect(gatewayValidaSolicitud(parking, 'send', now)).toBe(parking)
    const vigo = request({ fuente: 'aparcamientos-vigo', lugarId: 'parking-vigo-1' }); vigo.ficha.lat = 42.2; vigo.ficha.lon = -8.7; vigo.ficha.caduca = new Date(now + 300000).toISOString()
    expect(gatewayValidaSolicitud(vigo, 'send', now)).toBe(vigo)
    const bici = request({ fuente: 'bicis-zaragoza', lugarId: 'gbfs-zaragoza-1', objetivo: 'anclajes' }); bici.ficha.lat = 41.6; bici.ficha.lon = -.9
    expect(gatewayValidaSolicitud(bici, 'send', now)).toBe(bici); bici.ficha.lat = null; bici.ficha.lon = null
    expect(gatewayValidaSolicitud(bici, 'send', now)).toBeNull()
  })
  it('tolera sólo un segundo en el reloj propio, nunca en la fecha fuente', () => {
    const sent = request({ issuedAt: now + 1000, expiresAt: now + 31000 })
    expect(gatewayValidaSolicitud(sent, 'send', now)).toBe(sent)
    sent.ficha.fechaDato = new Date(now + 1).toISOString(); expect(gatewayValidaSolicitud(sent, 'send', now)).toBeNull()
  })
  it('el desafío Worker es independiente, vigente y vinculado a versión/nonce', async () => {
    const check: GatewayCheck = { schema: 1, environment: 'production', op: 'check', nonce: crypto.randomUUID(), issuedAt: now, expiresAt: now + 30000 }
    const proof = await gatewayChallenge(material, { nonce: check.nonce, issuedAt: now, expiresAt: now + 30000 }, worker)
    expect(await gatewayValidaChallenge(material, proof, check.nonce, worker, now)).toBe(true)
    expect(await gatewayValidaChallenge(material, proof, crypto.randomUUID(), worker, now)).toBe(false)
    expect(await gatewayValidaChallenge(material, proof, check.nonce, crypto.randomUUID(), now)).toBe(false)
    expect(await gatewayValidaChallenge(material, proof, check.nonce, worker, now + 30000)).toBe(false)
    const { signature, ...unsigned } = proof
    expect(await gatewayVerifica(material, GATEWAY_PATH_CHECK, gatewayCanonico(unsigned), signature)).toBe(false)
    const response: GatewayCheckReply = { ...check, op: 'check', requestDigest: await gatewayDigest(check), workerVersion: worker, revision: GATEWAY_REVISION,
      ok: true, bot: { expectedUsername: 'PublicBot', credentialUsername: 'publicbot' }, worker: proof }
    expect(gatewayValidaRespuesta(response, check, response.requestDigest, now)).toBe(response)
    response.bot.credentialUsername = 'DifferentBot'; expect(gatewayValidaRespuesta(response, check, response.requestDigest, now)).toBeNull()
    expect(gatewayValidaSolicitud({ ...check, text: 'free' }, 'check', now)).toBeNull()
  })
})

describe('caller de pasarela sin reintentos de transporte', () => {
  it.each(['enviado', 'incierto', 'baja', 'reintentar'] as const)('acepta sólo una respuesta firmada y vinculada: %s', async estado => {
    const sent = request(); let calls = 0
    const result = await gatewayEnviar(material, sent, { now, fetch: async (url, options) => {
      calls++; expect(url).toBe(GATEWAY_ORIGIN + GATEWAY_PATH_SEND); expect(options?.redirect).toBe('manual'); expect(options?.method).toBe('POST')
      const raw = String(options?.body), signature = new Headers(options?.headers).get(GATEWAY_SIGNATURE_HEADER)!
      expect(await gatewayVerifica(material, GATEWAY_PATH_SEND, raw, signature)).toBe(true)
      expect(JSON.parse(raw)).toEqual(sent)
      return response(sent, { estado, ...(estado === 'reintentar' ? { espera: 90 } : {}) })
    } })
    expect(result).toEqual({ estado, ...(estado === 'reintentar' ? { espera: 90 } : {}) }); expect(calls).toBe(1)
  })
  it.each([301, 302, 307, 401, 403, 409, 429, 500, 503])('HTTP%d no se convierte en rechazo Telegram, aunque el cuerpo esté firmado', async status => {
    const sent = request(); let calls = 0
    const result = await gatewayEnviar(material, sent, { now, fetch: async () => { calls++; return response(sent, { estado: 'reintentar', espera: 90 }, status) } })
    expect(result).toEqual({ estado: 'incierto' }); expect(calls).toBe(1)
  })
  it.each([
    ['nonce ajeno', { nonce: crypto.randomUUID() }],
    ['intento ajeno', { attempt: crypto.randomUUID() }],
    ['hash ajeno', { requestDigest: 'a'.repeat(64) }],
    ['otra versión', { workerVersion: crypto.randomUUID() }],
    ['caducidad alargada', { expiresAt: now + 30001 }],
    ['respuesta antigua', { issuedAt: now - 1001, expiresAt: now + 100 }],
    ['respuesta futura', { issuedAt: now + 1001 }],
    ['reintento sin plazo', { estado: 'reintentar' }],
    ['reintento con espera no entera', { estado: 'reintentar', espera: 60.5 }],
    ['espera fuera de rechazo', { estado: 'enviado', espera: 90 }],
  ] as Array<[string, Partial<GatewaySendReply>]>)('rechaza respuesta firmada pero incoherente: %s', async (_, change) => {
    const sent = request(); expect(await gatewayEnviar(material, sent, { now, fetch: async () => response(sent, change) })).toEqual({ estado: 'incierto' })
  })
  it('respuesta sin firma o alterada no produce un éxito', async () => {
    const sent = request(), original = await response(sent), text = await original.text()
    for (const answer of [new Response(text, { headers: { 'Content-Type': 'application/json' } }),
      new Response(text.replace('enviado', 'baja'), { headers: original.headers })]) {
      expect(await gatewayEnviar(material, sent, { now, fetch: async () => answer })).toEqual({ estado: 'incierto' })
    }
  })
  it('una fuente caducada ni siquiera inicia la petición', async () => {
    const sent = request(); sent.ficha.caduca = new Date(now).toISOString(); let calls = 0
    expect(await gatewayEnviar(material, sent, { now, fetch: async () => { calls++; return response(sent) } })).toEqual({ estado: 'incierto' }); expect(calls).toBe(0)
  })
  it('una excepción de red queda incierta sin segundo intento', async () => {
    let calls = 0; expect(await gatewayEnviar(material, request(), { now, fetch: async () => { calls++; throw Error('fallo simulado') } })).toEqual({ estado: 'incierto' }); expect(calls).toBe(1)
  })
  it('agota el tiempo aunque la descarga no termine y cancela el cuerpo', async () => {
    let cancelled = false, calls = 0
    const result = await gatewayEnviar(material, request(), { now, timeoutMs: 10, fetch: async () => {
      calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true } }), { headers: { 'Content-Type': 'application/json' } })
    } })
    expect(result).toEqual({ estado: 'incierto' }); expect(cancelled).toBe(true); expect(calls).toBe(1)
  })
  it('limita bytes reales, también sin Content-Length', async () => {
    for (const withLength of [false, true]) {
      let cancelled = false
      const result = await gatewayEnviar(material, request(), { now, fetch: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(4097))) }, cancel() { cancelled = true },
      }), { headers: { 'Content-Type': 'application/json', ...(withLength ? { 'Content-Length': '4097' } : {}) } }) })
      expect(result).toEqual({ estado: 'incierto' }); expect(cancelled).toBe(true)
    }
  })
})
