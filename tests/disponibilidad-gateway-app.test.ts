import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'
import type { Env } from '../src/index'
import { derivaGatewayKey, gatewayCanonico, gatewayChallenge, gatewayFirma, gatewayVerifica,
  GATEWAY_ORIGIN, GATEWAY_PATH_CHECK, GATEWAY_SIGNATURE_HEADER, GATEWAY_REVISION } from '../scripts/lib/disponibilidad-gateway.mjs'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('pasarela integrada en la aplicación completa', () => {
  it('separa la IP compartida del Worker del cupo visitante y sigue rechazando firmas ausentes o inválidas', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-11-21T14:30:00Z')
    const cron = 'fixture-root-without-credentials', key = await derivaGatewayKey(cron)
    const version = '10000000-0000-4000-8000-000000000001'
    const token = ['123456', 'x'.repeat(32)].join(':')
    const binding = {
      estado: vi.fn(async () => ({ schema: 1, revision: 'disponibilidad-v1', gatewayRevision: GATEWAY_REVISION,
        versionId: version, habilitado: false, configurado: true })),
      gatewayChallenge: vi.fn(async (input: { nonce: string; issuedAt: number; expiresAt: number }) => gatewayChallenge(key, input, version)),
      claimGateway: vi.fn(), leer: vi.fn(), guardar: vi.fn(), cancelar: vi.fn(), comprobar: vi.fn(),
    }
    const env = { CRON_TOKEN: cron, TELEGRAM_BOT_TOKEN: token, TELEGRAM_BOT_USERNAME: 'GasolinerasAlertasBot',
      DISPONIBILIDAD_ENABLED: 'false', DISPONIBILIDAD: binding } as unknown as Env
    const network = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      if (String(input) !== 'https://api.telegram.org/bot' + token + '/getMe' || options?.method !== 'GET') throw Error('Unexpected network request')
      return Response.json({ ok: true, result: { id: 123456, is_bot: true, username: 'GasolinerasAlertasBot' } })
    })
    vi.stubGlobal('fetch', network)
    const sharedHeaders = { host: 'webapp-3ft.pages.dev', 'cf-connecting-ip': '203.0.113.41' }
    const check = async (invalid?: 'absent' | 'invalid') => {
      const issuedAt = Date.now(), raw = gatewayCanonico({ schema: 1, environment: 'production', op: 'check',
        nonce: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + 30000 })
      const signature = invalid === 'invalid' ? '0'.repeat(64) : await gatewayFirma(key, GATEWAY_PATH_CHECK, raw)
      return app.request(GATEWAY_ORIGIN + GATEWAY_PATH_CHECK, { method: 'POST', body: raw,
        headers: { ...sharedHeaders, 'Content-Type': 'application/json', ...(invalid === 'absent' ? {} : { [GATEWAY_SIGNATURE_HEADER]: signature }) } }, env)
    }
    for (let i = 0; i < 130; i++) {
      const response = await check(), raw = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.has('X-RateLimit-Limit')).toBe(false)
      expect(await gatewayVerifica(key, GATEWAY_PATH_CHECK, raw, response.headers.get(GATEWAY_SIGNATURE_HEADER)!, 'response')).toBe(true)
    }
    for (const invalid of ['absent', 'invalid'] as const) expect((await check(invalid)).status).toBe(401)
    expect(network).toHaveBeenCalledTimes(130)
    expect(binding.claimGateway).not.toHaveBeenCalled(); expect(binding.leer).not.toHaveBeenCalled()
    const visitor = () => app.request(GATEWAY_ORIGIN + '/api/telegram/config', { headers: sharedHeaders }, env)
    const first = await visitor()
    expect(first.status).toBe(200); expect(first.headers.get('X-RateLimit-Remaining')).toBe('119')
    for (let i = 1; i < 120; i++) expect((await visitor()).status).toBe(200)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await visitor()).status).toBe(429)
    expect(warning).toHaveBeenCalledOnce()
    expect((await check()).status).toBe(200)
    expect(network).toHaveBeenCalledTimes(131)
    const stateCalls = binding.estado.mock.calls.length
    expect((await check('absent')).status).toBe(401)
    expect((await check('invalid')).status).toBe(401)
    expect(binding.estado).toHaveBeenCalledTimes(stateCalls)
    expect(network).toHaveBeenCalledTimes(131)
    expect((await app.request(GATEWAY_ORIGIN + GATEWAY_PATH_CHECK + '/extra', { method: 'POST', headers: sharedHeaders }, env)).status).toBe(429)
    for (const method of ['claimGateway', 'leer', 'guardar', 'cancelar', 'comprobar'] as const) expect(binding[method]).not.toHaveBeenCalled()
  })
})
