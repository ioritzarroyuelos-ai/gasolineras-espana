import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signTelegramToken } from '../src/lib/auth'
import { borrarDisponibilidadTelegram, type DisponibilidadBinding } from '../src/lib/disponibilidad-telegram'
import { disponibilidadSeudonimo } from '../scripts/lib/disponibilidad.mjs'
import { registerTelegramDisponibilidadRoutes } from '../src/routes/telegram-disponibilidad'
import type { Env } from '../src/index'

const version = '10000000-0000-4000-8000-000000000001'
const valid = { fuente: 'aparcamientos-vigo', lugarId: 'parking-vigo-4763', objetivo: 'plazas', consentimiento: 'disponibilidad-telegram-v1', version, peticion: version }
let auth: string
beforeEach(async () => { auth = await signTelegramToken(10, 'prueba-local'); })
function fixture() {
  const stub = { leer: vi.fn(async () => ({ status: 200, ok: true, version, avisos: [] })), guardar: vi.fn(async (_chat: number, _mode: string, _input: unknown) => ({ status: 200, ok: true, version, avisos: [] })),
    cancelar: vi.fn(async (_chat: number, _mode?: string | null) => ({ status: 200, ok: true, avisos: [] })), comprobar: vi.fn(async () => ({ status: 200, ok: true, dryRun: true, enviados: 0 })) }
  const binding = { ...stub, estado: vi.fn(async () => ({ schema: 1, revision: 'disponibilidad-v1', gatewayRevision: 'disponibilidad-gateway-v1', versionId: 'version-de-prueba', habilitado: true, configurado: true })) }
  const env = { SESSION_SECRET: 'prueba-local', DISPONIBILIDAD: binding, DISPONIBILIDAD_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'prueba', TELEGRAM_BOT_USERNAME: 'prueba_bot', TELEGRAM_WEBHOOK_SECRET: 'prueba-webhook' } satisfies Env
  const app = new Hono<{ Bindings: Env }>(); registerTelegramDisponibilidadRoutes(app)
  const call = (method = 'GET', suffix = '', body?: unknown, token = auth) => app.request('https://webapp-3ft.pages.dev/api/telegram/disponibilidad' + suffix, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env)
  return { app, env, stub, binding, call }
}
describe('API de disponibilidad vinculada al Telegram firmado', () => {
  it('config apagada sin binding o sin activar explícitamente', async () => {
    const f = fixture()
    for (const changed of [{ DISPONIBILIDAD: undefined }, { DISPONIBILIDAD_ENABLED: 'false' }, { TELEGRAM_WEBHOOK_SECRET: undefined }]) {
      const response = await f.app.request('https://webapp-3ft.pages.dev/api/telegram/disponibilidad/config', {}, { ...f.env, ...changed })
      expect((await response.json()).available).toBe(false)
    }
    expect((await (await f.call('GET', '/config')).json()).available).toBe(true)
    f.env.DISPONIBILIDAD_ENABLED = 'false'
    f.binding.estado.mockResolvedValue({ schema: 1, revision: 'disponibilidad-v1', gatewayRevision: 'disponibilidad-gateway-v1', versionId: 'version-de-prueba', habilitado: false, configurado: false })
    expect(await (await f.call('GET', '/config')).json()).toMatchObject({ available: false, manageAvailable: true, serviceEnabled: false })
    expect(f.stub.leer).not.toHaveBeenCalled(); expect(f.stub.guardar).not.toHaveBeenCalled()
    f.binding.estado.mockRejectedValue(Error('caído'))
    expect((await (await f.call('GET', '/config')).json()).available).toBe(false)
  })
  it('no permite leer, crear, cancelar o probar con chatId ni token falso', async () => {
    const f = fixture()
    for (const [method, path, body] of [['GET', '', undefined], ['PUT', '/temporal', valid], ['DELETE', '/diario', undefined], ['POST', '/dry-run', undefined]] as const) expect((await f.call(method, path, body, '10')).status).toBe(401)
    expect(f.stub.leer).not.toHaveBeenCalled(); expect(f.stub.guardar).not.toHaveBeenCalled(); expect(f.stub.cancelar).not.toHaveBeenCalled(); expect(f.stub.comprobar).not.toHaveBeenCalled()
  })
  it('usa sólo el chat firmado y un nombre opaco de objeto, sin coordenadas', async () => {
    const f = fixture(), response = await f.call('PUT', '/temporal', valid)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(f.stub.guardar).toHaveBeenCalledWith(10, 'temporal', valid)
    expect(await disponibilidadSeudonimo(10)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rechaza GPS, cifras, chat ajeno, consentimiento ausente y cruce de fuente', async () => {
    const f = fixture()
    for (const fields of [{ lat: 40.4 }, { cantidad: 1 }, { chatId: 20 }, { consentimiento: null }, { fuente: 'aparcamientos-madrid' }]) expect((await f.call('PUT', '/temporal', { ...valid, ...fields })).status).toBe(400)
    expect(f.stub.guardar).not.toHaveBeenCalled()
  })
  it('permite cancelar aunque esté pausada la activación, sólo el modo indicado', async () => {
    const f = fixture(); f.env.DISPONIBILIDAD_ENABLED = 'false'
    expect((await f.call('DELETE', '/diario')).status).toBe(200)
    expect(f.stub.cancelar).toHaveBeenCalledWith(10, 'diario')
    expect((await f.call('PUT', '/temporal', valid)).status).toBe(503)
  })
  it('dry-run firmado no toca guardar ni cancelar', async () => {
    const f = fixture(); const response = await f.call('POST', '/dry-run')
    expect(await response.json()).toMatchObject({ dryRun: true, enviados: 0 }); expect(f.stub.guardar).not.toHaveBeenCalled(); expect(f.stub.cancelar).not.toHaveBeenCalled()
  })
  it('fallo de RPC devuelve error genérico y no falsa confirmación', async () => {
    const f = fixture(); f.stub.cancelar.mockRejectedValue(new Error('detalle privado'))
    const response = await f.call('DELETE', '/temporal')
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('privado')
  })
  it('objetos separados por chat y /stop cancela ambos modos del chat correcto', async () => {
    const f = fixture()
    expect(await disponibilidadSeudonimo(10)).not.toBe(await disponibilidadSeudonimo(20))
    await borrarDisponibilidadTelegram({ DISPONIBILIDAD: f.binding }, 10)
    expect(f.stub.cancelar).toHaveBeenCalledWith(10)
    expect(await borrarDisponibilidadTelegram({}, 10)).toBe(false)
    const broken: DisponibilidadBinding = { ...f.binding, cancelar: async () => ({ status: 503, ok: false }) }
    await expect(borrarDisponibilidadTelegram({ DISPONIBILIDAD: broken }, 10)).rejects.toThrow('availability_cancel_pending')
  })
})
