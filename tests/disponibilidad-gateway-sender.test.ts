import { describe, expect, it, vi } from 'vitest'
import { compruebaBotGateway, leeCuerpoGateway } from '../src/lib/disponibilidad-gateway'

const bot = ['123456', 'x'.repeat(32)].join(':')
const env = { TELEGRAM_BOT_TOKEN: bot, TELEGRAM_BOT_USERNAME: 'GasolinerasAlertasBot' }
const identity = (extra: Record<string, unknown> = {}) => ({ ok: true, result: { id: 123456, is_bot: true, username: 'gasolinerasalertasbot', ...extra } })

describe('identidad propia de Pages antes de reclamar un aviso', () => {
  it('consulta sólo getMe, admite campos nuevos y devuelve sólo nombres públicos', async () => {
    const request = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => Response.json(identity({ first_name: bot, description: bot })))
    expect(await compruebaBotGateway(env, request)).toEqual({ ok: true, expectedUsername: 'GasolinerasAlertasBot', credentialUsername: 'gasolinerasalertasbot' })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toBe('https://api.telegram.org/bot' + bot + '/getMe')
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store' })
    expect(request.mock.calls[0][1]).not.toHaveProperty('body')
  })
  it('no confunde otro bot válido con el configurado ni entrega su ID', async () => {
    const result = await compruebaBotGateway(env, async () => Response.json(identity({ username: 'Otro_Bot' })))
    expect(result).toEqual({ ok: false, error: 'bot_identity_mismatch', expectedUsername: 'GasolinerasAlertasBot', credentialUsername: 'Otro_Bot' })
    expect(JSON.stringify(result)).not.toContain(bot)
  })
  it.each([{ id: 0 }, { id: -1 }, { id: 1.5 }, { id: '123456' }, { id: Number.MAX_SAFE_INTEGER + 1 }, { is_bot: false },
    { username: 'a'.repeat(33) }, { username: 'abcd' }, { username: 'Otro_Bot\n' }, { username: '<script>' }])('rechaza identidad inválida sin devolver campos: %j', async extra => {
    expect(await compruebaBotGateway(env, async () => Response.json(identity(extra)))).toEqual({ ok: false, error: 'bot_unavailable' })
  })
  it.each([201, 301, 302, 307, 400, 401, 403, 429, 500])('HTTP%s no verifica identidad aunque el cuerpo parezca correcto', async status => {
    expect(await compruebaBotGateway(env, async () => Response.json(identity(), { status, headers: { location: 'https://example.invalid/' + bot } }))).toEqual({ ok: false, error: 'bot_unavailable' })
  })
  it.each([{ TELEGRAM_BOT_TOKEN: '' }, { TELEGRAM_BOT_TOKEN: '../' + bot }, { TELEGRAM_BOT_USERNAME: 'Nombre\nBot' }])('no consulta red con configuración inválida', async extra => {
    const request = vi.fn()
    expect(await compruebaBotGateway({ ...env, ...extra }, request)).toEqual({ ok: false, error: 'bot_unavailable' })
    expect(request).not.toHaveBeenCalled()
  })
  it('rotación se comprueba de nuevo, sin reutilizar la identidad anterior', async () => {
    const request = vi.fn(async () => Response.json(identity()))
    expect((await compruebaBotGateway(env, request)).ok).toBe(true)
    request.mockImplementation(async () => Response.json(identity({ username: 'Otro_Bot' })))
    expect((await compruebaBotGateway(env, request)).ok).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('no propaga claves, URL, mensajes ni causas de errores externos', async () => {
    const result = await compruebaBotGateway(env, async () => { throw Error('https://api.telegram.org/bot' + bot, { cause: bot }) })
    expect(result).toEqual({ ok: false, error: 'bot_unavailable' })
    expect(JSON.stringify(result)).not.toContain(bot)
  })
  it.each(['json', 'cabecera', 'cuerpo', 'utf8'])('rechaza un cuerpo %s inválido o excesivo', async mode => {
    const response = mode === 'json' ? new Response(bot) : mode === 'cabecera' ? new Response('{}', { headers: { 'content-length': '999999' } })
      : mode === 'utf8' ? new Response(new Uint8Array([255])) : new Response('a'.repeat(16385))
    expect(await compruebaBotGateway(env, async () => response)).toEqual({ ok: false, error: 'bot_unavailable' })
  })
  it('cancela un cuerpo detenido al vencer el límite', async () => {
    const controller = new AbortController(), cancel = vi.fn(), timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const timer = setTimeout(() => controller.abort(), 5)
    try {
      const result = await compruebaBotGateway(env, async () => new Response(new ReadableStream({ cancel })))
      expect(result).toEqual({ ok: false, error: 'bot_unavailable' }); expect(cancel).toHaveBeenCalledOnce()
    } finally { clearTimeout(timer); timeout.mockRestore() }
  })
})

describe('lectura acotada del cuerpo exacto firmado', () => {
  it('cancela también un cuerpo recibido después del plazo', async () => {
    const controller = new AbortController(), cancel = vi.fn(); controller.abort()
    expect(await leeCuerpoGateway(new Response(new ReadableStream({ cancel })), 4096, controller.signal)).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('conserva los espacios y el orden sin volver a serializar JSON', async () => {
    const body = '{ "nonce": "prueba", "schema": 1 }\n'
    expect(await leeCuerpoGateway(new Request('https://example.invalid', { method: 'POST', body }), 4096, AbortSignal.timeout(1000))).toBe(body)
  })
  it.each(['-1', 'NaN', '4097'])('rechaza longitud no válida: %s', async value => {
    expect(await leeCuerpoGateway(new Response('{}', { headers: { 'content-length': value } }), 4096, AbortSignal.timeout(1000))).toBeNull()
  })
})
