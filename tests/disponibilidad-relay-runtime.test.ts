import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
// @ts-expect-error Sólo la prueba local usa tipos Node.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
// @ts-expect-error Sólo la prueba local usa tipos Node.
import { tmpdir } from 'node:os'
// @ts-expect-error Sólo la prueba local usa tipos Node.
import { join } from 'node:path'
import { derivaGatewayKey, gatewayCanonico, gatewayDigest, gatewayFirma, gatewayVerifica, gatewayValidaRespuesta, gatewayValidaChallenge,
  GATEWAY_ORIGIN, GATEWAY_PATH_CHECK, GATEWAY_PATH_SEND, GATEWAY_SIGNATURE_HEADER, type GatewayCheck } from '../scripts/lib/disponibilidad-gateway.mjs'
const miniflareName = 'miniflare'
const { Miniflare, convertV4MiniflareOptions } = await import(miniflareName)
const rootMaterial = 'material-publico-local-para-la-prueba-del-relay'
const derived = await derivaGatewayKey(rootMaterial)
const workerVersion = 'aac6554b-51a4-4a88-8d13-1396cb775dc6'
type Scenario = { copies: number; sends: Array<{ chat_id: number; text: string }>; raw?: string; headers?: Headers;
  results: Array<{ status: number; body: any }>; mutation?: 'body' | 'signature' | 'nonce' | 'version' | 'expired' | 'old-source';
  gatewayStatus?: number; telegramStatus?: number; gate?: Promise<void>; reached?: () => void }
const scenarios = new Map<number, Scenario>()
let mf: any, pages: any, persist: string, nextChat = 1000
let getMeGate: Promise<void> | null = null, getMeReached: (() => void) | null = null
const calls = { getMe: 0, forbidden: 0 }
async function endpoint(raw: string, headers: Headers) {
  return pages.fetch(GATEWAY_ORIGIN + GATEWAY_PATH_SEND, { method: 'POST', headers, body: raw })
}
async function outbound(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.origin === GATEWAY_ORIGIN && url.pathname === GATEWAY_PATH_SEND) {
    const raw = await request.text(), initial = JSON.parse(raw), scenario = scenarios.get(initial.chat)!
    if (!scenario) throw Error('unknown_local_case')
    scenario.raw = raw; scenario.headers = new Headers(request.headers); scenario.reached?.()
    if (scenario.gate) await scenario.gate
    if (scenario.gatewayStatus) return Response.json({ ok: false, error: 'relay_failure' }, { status: scenario.gatewayStatus })
    let forwarded = raw; const headers = new Headers(request.headers)
    if (scenario.mutation === 'body') forwarded = raw.replace('Lugar público simulado', 'Nombre alterado')
    if (scenario.mutation === 'signature') headers.set(GATEWAY_SIGNATURE_HEADER, '0'.repeat(64))
    if (['nonce', 'version', 'expired', 'old-source'].includes(scenario.mutation || '')) {
      const input = JSON.parse(raw)
      if (scenario.mutation === 'nonce') input.nonce = crypto.randomUUID()
      if (scenario.mutation === 'version') input.workerVersion = crypto.randomUUID()
      if (scenario.mutation === 'expired') { input.issuedAt = Date.now() - 1000; input.expiresAt = Date.now() - 1 }
      if (scenario.mutation === 'old-source') { input.ficha.fechaDato = new Date(Date.now() - 360000).toISOString(); input.ficha.caduca = new Date(Date.now() - 60000).toISOString() }
      forwarded = gatewayCanonico(input); headers.set(GATEWAY_SIGNATURE_HEADER, await gatewayFirma(derived, GATEWAY_PATH_SEND, forwarded))
    }
    scenario.results = await Promise.all(Array.from({ length: scenario.copies }, async () => {
      const response = await endpoint(forwarded, headers)
      return { status: response.status, headers: response.headers, raw: await response.text() }
    })).then(results => results.map(result => ({ ...result, body: JSON.parse(result.raw) })))
    const selected: any = scenario.results.find(result => result.status === 200 && result.body.estado === 'enviado') || scenario.results[0]
    return new Response(selected.raw, { status: selected.status, headers: selected.headers })
  }
  if (url.origin === 'https://api.telegram.org' && url.pathname.endsWith('/getMe')) {
    calls.getMe++
    getMeReached?.(); if (getMeGate) await getMeGate
    return Response.json({ ok: true, result: { id: 12345, is_bot: true, username: 'LocalAvailabilityBot' } })
  }
  if (url.origin === 'https://api.telegram.org' && url.pathname.endsWith('/sendMessage')) {
    const input = await request.json() as { chat_id: number; text: string }, scenario = scenarios.get(input.chat_id)
    if (!scenario) throw Error('unknown_local_chat')
    scenario.sends.push(input)
    if (scenario.telegramStatus) return Response.json({ ok: false, error_code: scenario.telegramStatus, description: 'Explicit local Telegram rejection', parameters: { retry_after: 90 } }, { status: scenario.telegramStatus })
    return Response.json({ ok: true, result: { message_id: 1, chat: { id: input.chat_id } } })
  }
  calls.forbidden++; throw Error('La prueba no permite otras conexiones')
}
async function control(chat: number, op: string, ...args: any[]) {
  const response = await mf.dispatchFetch('https://local-control.invalid', { method: 'POST', body: JSON.stringify({ chat, op, args }) })
  if (!response.ok) throw Error(await response.text())
  return response.json() as Promise<any>
}
async function fixture(options: Partial<Scenario> = {}) {
  const chat = nextChat++, scenario: Scenario = { copies: 1, sends: [], results: [], ...options }; scenarios.set(chat, scenario)
  const state = await control(chat, 'leer')
  expect(await control(chat, 'guardar', 'temporal', { fuente: 'aparcamientos-madrid', lugarId: 'parking-madrid-72', objetivo: 'plazas',
    consentimiento: 'disponibilidad-telegram-v1', version: state.version, peticion: crypto.randomUUID() })).toMatchObject({ ok: true })
  return { chat, scenario, tick: () => control(chat, 'tick'), cancel: () => control(chat, 'cancelar', null), state: () => control(chat, 'leer'), rows: () => control(chat, 'inspect') }
}
beforeAll(async () => {
  persist = await mkdtemp(join(tmpdir(), 'eu-gateway-runtime-'))
  const bundle = async (entry: string) => (await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], logLevel: 'silent' })).outputFiles[0].text
  const [worker, page] = await Promise.all([bundle('tests/fixtures/disponibilidad-relay-worker.mjs'), bundle('tests/fixtures/disponibilidad-relay-pages.ts')])
  mf = new Miniflare({ ...convertV4MiniflareOptions({ workers: [
    { name: 'availability-relay-local', modules: true, script: worker, compatibilityDate: '2026-11-21',
      bindings: { DISPONIBILIDAD_ENABLED: 'true', DISPONIBILIDAD_GATEWAY_KEY: derived, WORKER_VERSION: { id: workerVersion } },
      durableObjects: { DISPONIBILIDAD: { className: 'DisponibilidadRelayPrueba', useSQLite: true } },
      serviceBindings: { CONTROL: { name: 'availability-relay-local', entrypoint: 'DisponibilidadServicio' } }, outboundService: outbound },
    { name: 'availability-pages-local', modules: true, script: page, compatibilityDate: '2026-11-21',
      bindings: { CRON_TOKEN: rootMaterial, DISPONIBILIDAD_ENABLED: 'true', TELEGRAM_BOT_TOKEN: '12345:' + 'a'.repeat(24), TELEGRAM_BOT_USERNAME: 'LocalAvailabilityBot', TELEGRAM_WEBHOOK_SECRET: 'local-unused-webhook' },
      serviceBindings: { DISPONIBILIDAD: { name: 'availability-relay-local', entrypoint: 'DisponibilidadServicio' } }, outboundService: outbound },
  ] }), resourcePersistencePath: persist })
  await mf.ready; pages = await mf.getWorker('availability-pages-local')
}, 30000)
afterAll(async () => {
  await mf?.dispose()
  if (persist) {
    const prefix = join(tmpdir(), 'eu-gateway-runtime-')
    if (!persist.startsWith(prefix) || !/^[a-zA-Z0-9_-]+$/.test(persist.slice(prefix.length))) throw Error('Unsafe local test directory')
    await rm(persist, { recursive: true, force: true })
  }
  expect(calls.forbidden).toBe(0)
}, 15000)

describe('pasarela real en workerd, Telegram completamente interceptado', () => {
  it('salud firmada comprueba bot y clave Worker sin inicializar objetos', async () => {
    const before = await control(0, 'constructors'), files = await readdir(persist, { recursive: true }), time = Date.now()
    const request: GatewayCheck = { schema: 1, environment: 'production', op: 'check', nonce: crypto.randomUUID(), issuedAt: time, expiresAt: time + 30000 }
    const raw = gatewayCanonico(request), signature = await gatewayFirma(derived, GATEWAY_PATH_CHECK, raw)
    const response = await pages.fetch(GATEWAY_ORIGIN + GATEWAY_PATH_CHECK, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', [GATEWAY_SIGNATURE_HEADER]: signature } })
    expect(response.status).toBe(200); const responseRaw = await response.text()
    expect(await gatewayVerifica(derived, GATEWAY_PATH_CHECK, responseRaw, response.headers.get(GATEWAY_SIGNATURE_HEADER)!, 'response')).toBe(true)
    const body = JSON.parse(responseRaw)
    expect(gatewayValidaRespuesta(body, request, await gatewayDigest(raw))).not.toBeNull()
    expect(await gatewayValidaChallenge(derived, body.worker, request.nonce, workerVersion)).toBe(true)
    expect(body.bot).toEqual({ expectedUsername: 'LocalAvailabilityBot', credentialUsername: 'LocalAvailabilityBot' })
    expect(await control(0, 'constructors')).toBe(before)
    const userFiles = (list: string[]) => list.filter(name => name.includes('.sqlite') && !name.includes('metadata.sqlite'))
    expect(userFiles(await readdir(persist, { recursive: true }))).toEqual(userFiles(files))
  })
  it('DO → HTTP Pages → claim del mismo DO termina y usa la plantilla real', async () => {
    const f = await fixture(); await f.tick(); expect(f.scenario.sends).toHaveLength(1)
    expect(f.scenario.sends[0].text).toContain('2 plazas libres totales')
    expect(f.scenario.sends[0].text).toContain('No indica plazas PMR libres.')
    expect(f.scenario.sends[0].text).toContain('No es una reserva.')
    expect((await f.state()).avisos[0]).toMatchObject({ activo: false, estado: 'enviado' })
    expect((await f.rows()).find(([key]: [string]) => key.startsWith('recibo:'))[1]).toMatchObject({ estado: 'enviado', claimed: true })
  })
  it('dos POST concurrentes y una repetición sólo producen un sendMessage', async () => {
    const f = await fixture({ copies: 2 }); await f.tick()
    expect(f.scenario.results.map(result => result.status).sort()).toEqual([200, 409]); expect(f.scenario.sends).toHaveLength(1)
    const repeated = await endpoint(f.scenario.raw!, f.scenario.headers!)
    expect(repeated.status).toBe(409); expect(f.scenario.sends).toHaveLength(1)
    expect((await f.state()).avisos[0].estado).toBe('enviado')
  })
  it('cancelar mientras HTTP espera impide el claim y no restaura la suscripción', async () => {
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { entered = resolve })
    const f = await fixture({ gate, reached: entered, copies: 2 }); const pending = f.tick()
    await reached; await f.cancel(); release(); await pending
    expect(f.scenario.results.map(result => result.status)).toEqual([409, 409]); expect(f.scenario.sends).toEqual([])
    expect((await f.state()).avisos).toEqual([])
  })
  it.each(['body', 'signature', 'expired', 'old-source'] as const)('rechaza %s antes de llamar al DO', async mutation => {
    const f = await fixture({ mutation }); await f.tick(); expect(f.scenario.sends).toEqual([])
    expect((await f.rows()).some(([key]: [string]) => key === '_claims')).toBe(false)
    expect((await f.state()).avisos[0].estado).toBe('incierto')
  })
  it.each(['nonce', 'version'] as const)('una solicitud nueva firmada con %s diferente no consume la reserva', async mutation => {
    const f = await fixture({ mutation }); await f.tick(); expect(f.scenario.sends).toEqual([])
    expect((await f.rows()).find(([key]: [string]) => key.startsWith('recibo:'))[1]).toMatchObject({ estado: 'incierto', claimed: false })
  })
  it('si vence durante getMe no reclama ni envía un dato que era válido al salir del DO', async () => {
    const f = await fixture(); await control(f.chat, 'sourceExpiry', 500)
    let release!: () => void
    const reached = new Promise<void>(resolve => { getMeReached = resolve })
    getMeGate = new Promise<void>(resolve => { release = resolve })
    const pending = f.tick()
    try {
      await reached
      const expiry = JSON.parse(f.scenario.raw!).expiresAt
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now() + 10)))
      release(); await pending
      expect(f.scenario.sends).toEqual([])
      expect((await f.rows()).some(([key]: [string]) => key === '_claims')).toBe(false)
      expect((await f.state()).avisos[0].estado).toBe('incierto')
    } finally { release(); getMeGate = null; getMeReached = null }
  })
  it('403 explícito Telegram produce baja, 409 del relay queda incierto', async () => {
    const telegram = await fixture({ telegramStatus: 403 }); await telegram.tick()
    expect(telegram.scenario.sends).toHaveLength(1); expect((await telegram.state()).avisos).toEqual([])
    expect((await telegram.rows()).find(([key]: [string]) => key.startsWith('recibo:'))[1]).toMatchObject({ estado: 'baja', claimed: true })
    const relay = await fixture({ gatewayStatus: 409 }); await relay.tick(); expect(relay.scenario.sends).toEqual([])
    expect((await relay.state()).avisos[0]).toMatchObject({ estado: 'incierto', activo: false })
    await relay.tick(); expect(relay.scenario.sends).toEqual([])
  })
  it('429 explícito Telegram conserva el plazo de reintento, no envía en ráfaga', async () => {
    const f = await fixture({ telegramStatus: 429 }); await f.tick()
    expect(f.scenario.sends).toHaveLength(1)
    const item = (await f.state()).avisos[0]
    expect(item).toMatchObject({ estado: 'reintentando', activo: true })
    expect(Date.parse(item.proxima)).toBeGreaterThan(Date.now() + 290000)
  })
})
