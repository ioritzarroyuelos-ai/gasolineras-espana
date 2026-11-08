import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import { signSessionJWT, isValidSyncValue, isSyncableKey } from '../src/lib/auth'

// Endpoint tests de auth tras extraerlo a src/routes/auth.ts (B1). Sin secretos
// en el env (SESSION_SECRET/GOOGLE_CLIENT_ID/USER_DATA ausentes) verificamos la
// degradacion documentada: 503 sin config, 401 sin sesion, {user:null} en /api/me.

type AnyApp = Hono<{ Bindings: Record<string, unknown> }>

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('cuenta compartida y aislamiento de favoritos', () => {
  const secret = 'test-session-secret-not-for-production'
  async function setup(sub = 'account-a') {
    const saved = new Map<string, string>()
    const kv = {
      get: vi.fn(async (key: string) => saved.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => { saved.set(key, value) }),
      delete: vi.fn(async (key: string) => { saved.delete(key) }),
      list: vi.fn(() => { throw new Error('sync must not list keys') }),
    }
    const token = await signSessionJWT({ sub, email: sub + '@example.test' }, secret)
    const headers = { cookie: 'gs_session=' + token, 'X-Account-Id': sub, 'Content-Type': 'application/json' }
    return { saved, kv, headers, env: { SESSION_SECRET: secret, GOOGLE_CLIENT_ID: 'public.apps.googleusercontent.com', USER_DATA: kv } }
  }

  it('publica solo configuración pública, incluso sin servicios disponibles', async () => {
    const { env } = await setup()
    const res = await app.request('/api/auth/config', {}, env)
    expect(await res.json()).toEqual({ clientId: env.GOOGLE_CLIENT_ID, available: true, syncAvailable: true })
    expect(res.headers.get('cache-control')).toBe('no-store')
    const missing = await app.request('/api/auth/config', {}, {})
    expect(await missing.json()).toEqual({ clientId: '', available: false, syncAvailable: false })
  })

  it.each(['/api/auth/config', '/api/auth/google', '/api/me', '/api/sync', '/api/sync/gs_favs_v1'])(
    'no permite cachear el rechazo de origen previo a la ruta %s', async path => {
      const res = await app.request(path, { headers: { origin: 'https://malicious.example' } }, {})
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
    },
  )

  it('no permite cachear el límite global previo a la ruta de sincronización', async () => {
    const { apiLimiter } = await import('../src/lib/runtime')
    const limited = vi.spyOn(apiLimiter, 'check').mockReturnValue({ allowed: false, remaining: 0, retryAfterSec: 7 })
    try {
      const res = await app.request('/api/sync', {}, {})
      expect(res.status).toBe(429)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('retry-after')).toBe('7')
    } finally { limited.mockRestore() }
  })

  it('recupera las cinco claves de la cuenta, conservando null y sin listar KV', async () => {
    const { env, headers, saved, kv } = await setup()
    const data = {
      gs_favs_v1: [{ id: '123', rotulo: 'Favorita' }],
      gs_profile_v1: { version: 2, fuel: 'Precio Gasolina 95 E5', litres: 50 },
      'eu-deportes-favoritos-v1': [{ id: 'liga', nombre: 'La Liga', url: '/deportes/competicion/la-liga' }],
      'eu-mi-dia-v1': { version: 1, visible: ['deportes'], order: ['deportes', 'tiempo'] },
      'espana-util-municipio': null,
    }
    for (const [key, value] of Object.entries(data)) saved.set('u:account-a:' + key, JSON.stringify(value))
    saved.set('u:account-b:gs_favs_v1', '[{"id":"private-b"}]')
    saved.set('u:account-a:gs_tg_chat_v1', '"private-link"')
    const res = await app.request('/api/sync', { headers }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data })
    expect(kv.get).toHaveBeenCalledTimes(5)
    expect(kv.list).not.toHaveBeenCalled()
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['GET', 'PUT', 'DELETE'])('rechaza %s de otra cuenta antes de tocar KV', async method => {
    const { env, headers, kv } = await setup('account-b')
    headers['X-Account-Id'] = 'account-a'
    const res = await app.request(method === 'GET' ? '/api/sync' : '/api/sync/gs_favs_v1', {
      method, headers, ...(method === 'PUT' ? { body: '[]' } : {}),
    }, env)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'account_changed' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(kv.get).not.toHaveBeenCalled()
    expect(kv.put).not.toHaveBeenCalled()
    expect(kv.delete).not.toHaveBeenCalled()
  })

  it('admite cliente legado y persiste [] para que no vuelvan los favoritos borrados', async () => {
    const { env, headers, saved } = await setup()
    saved.set('u:account-a:gs_favs_v1', '[{"id":"123"}]')
    const res = await app.request('/api/sync/gs_favs_v1', {
      method: 'PUT', headers: { cookie: headers.cookie, 'Content-Type': 'application/json' }, body: '[]',
    }, env)
    expect(res.status).toBe(200)
    expect(saved.get('u:account-a:gs_favs_v1')).toBe('[]')
  })

  it.each([
    ['espana-util-municipio', '28079'], ['espana-util-municipio', null],
    ['eu-mi-dia-v1', { version: 1, visible: [], order: ['tiempo', 'gasolineras', 'deportes', 'farmacias', 'itv', 'politica'] }],
    ['eu-deportes-favoritos-v1', [{ id: 'liga', nombre: 'La Liga', url: '/deportes/competicion/la-liga' }]],
  ])('guarda %s con su formato del cliente', async (key, value) => {
    const { env, headers, saved } = await setup()
    const res = await app.request('/api/sync/' + key, { method: 'PUT', headers, body: JSON.stringify(value) }, env)
    expect(res.status).toBe(200)
    expect(saved.get('u:account-a:' + key)).toBe(JSON.stringify(value))
  })

  it.each([
    ['espana-util-municipio', 'Madrid'], ['espana-util-municipio', 28079],
    ['eu-mi-dia-v1', { version: 1, visible: ['unknown'], order: [] }],
    ['eu-mi-dia-v1', { version: 1, visible: ['tiempo', 'tiempo'], order: [] }],
    ['eu-deportes-favoritos-v1', [{ id: 'x', nombre: 'X', url: 'https://malicious.test' }]],
    ['eu-deportes-favoritos-v1', [{ id: 'x', nombre: 'X', url: '/deportes/competicion/\\evil' }]],
    ['gs_favs_v1', { id: '123' }], ['gs_profile_v1', { litres: 0 }],
    ['gs_tg_chat_v1', '123'], ['gs_settings_v1', {}],
  ])('rechaza %s inválido sin sobrescribir lo anterior', async (key, value) => {
    const { env, headers, saved, kv } = await setup()
    saved.set('u:account-a:' + key, '"previous"')
    const res = await app.request('/api/sync/' + key, { method: 'PUT', headers, body: JSON.stringify(value) }, env)
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(kv.put).not.toHaveBeenCalled()
    expect(saved.get('u:account-a:' + key)).toBe('"previous"')
  })

  it.each(['get', 'put', 'delete'] as const)('no devuelve éxito ni datos vacíos cuando falla KV.%s', async operation => {
    const { env, headers, kv } = await setup()
    kv[operation].mockRejectedValueOnce(new Error('temporary unavailable'))
    const method = operation === 'get' ? 'GET' : operation === 'put' ? 'PUT' : 'DELETE'
    const res = await app.request(operation === 'get' ? '/api/sync' : '/api/sync/gs_favs_v1', {
      method, headers, ...(method === 'PUT' ? { body: '[]' } : {}),
    }, env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'sync_unavailable' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('no trata JSON guardado dañado como una cuenta vacía', async () => {
    const { env, headers, saved } = await setup()
    saved.set('u:account-a:gs_favs_v1', '{invalid')
    const res = await app.request('/api/sync', { headers }, env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'sync_unavailable' })
  })

  it('rechaza cuerpos excesivos y errores de sesión sin caché', async () => {
    const { env, headers } = await setup()
    const res = await app.request('/api/sync/gs_favs_v1', { method: 'PUT', headers, body: 'x'.repeat(301 * 1024) }, env)
    expect(res.status).toBe(413)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const unauth = await app.request('/api/sync', {}, {})
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get('cache-control')).toBe('no-store')
  })

  it('limita las listas al tamaño permitido y mantiene solo las cinco claves', () => {
    expect(isValidSyncValue('gs_favs_v1', Array.from({ length: 501 }, (_, id) => ({ id })))).toBe(false)
    expect(isValidSyncValue('eu-deportes-favoritos-v1', Array.from({ length: 51 }, (_, id) => ({ id: String(id), nombre: 'X', url: '/deportes/competicion/x' })))).toBe(false)
    expect(isSyncableKey('gs_tg_chat_v1')).toBe(false)
    expect(isSyncableKey('gs_settings_v1')).toBe(false)
  })

})

describe('rutas /api/auth y /api/sync tras extraer a src/routes/auth.ts (B1)', () => {
  it('POST /api/auth/google -> 503 sin GOOGLE_CLIENT_ID/SESSION_SECRET', async () => {
    const res = await app.request('/api/auth/google', { method: 'POST', body: '{}' }, {})
    expect(res.status).toBe(503)
  })

  it('POST /api/auth/logout -> 200 y limpia cookie', async () => {
    const res = await app.request('/api/auth/logout', { method: 'POST' }, {})
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') || '').not.toBe('')
  })

  it('GET /api/me -> 200 {user:null} sin sesion', async () => {
    const res = await app.request('/api/me', {}, {})
    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({ user: null })
  })

  it('GET /api/sync -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync', {}, {})
    expect(res.status).toBe(401)
  })

  it('PUT /api/sync/:key -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync/gs_favs_v1', { method: 'PUT', body: '[]' }, {})
    expect(res.status).toBe(401)
  })

  it('DELETE /api/sync/:key -> 401 sin sesion', async () => {
    const res = await app.request('/api/sync/gs_favs_v1', { method: 'DELETE' }, {})
    expect(res.status).toBe(401)
  })
})
