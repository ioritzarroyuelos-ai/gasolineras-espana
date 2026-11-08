// Autenticacion (Google Sign-In) + sync KV cross-device. Extraido de index.tsx
// (B1). registerAuthRoutes(app, deps) registra /api/auth/google, /api/auth/logout,
// /api/me y /api/sync[/:key] (GET/PUT/DELETE). Flujo GIS: el cliente obtiene un ID
// token de Google, el server lo verifica contra el JWKS y emite cookie de sesion
// firmada (HMAC-SHA256). Los datos del usuario se guardan en USER_DATA KV con key
// `u:${sub}:${dataKey}`. Degradacion: sin GOOGLE_CLIENT_ID/SESSION_SECRET -> 503;
// sin USER_DATA -> /api/sync 503 pero el login sigue.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { ingestLimiter, clientKey, slog, jsonBodyLimit } from '../lib/runtime'
import {
  verifyGoogleIdToken, signSessionJWT, verifySessionJWT,
  buildSessionCookie, buildLogoutCookie, parseSessionCookie, isSyncableKey,
  SYNCABLE_KEYS, isValidSyncValue,
} from '../lib/auth'

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>): void {

  // Includes validation, body-limit and unavailable-service responses.
  for (const path of ['/api/auth/*', '/api/me', '/api/sync', '/api/sync/*']) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
      c.header('Cache-Control', 'no-store')
    })
  }

  app.get('/api/auth/config', c => {
    const available = !!(c.env.GOOGLE_CLIENT_ID && c.env.SESSION_SECRET)
    return c.json({ clientId: available ? c.env.GOOGLE_CLIENT_ID : '', available, syncAvailable: available && !!c.env.USER_DATA })
  })

  async function getSessionUser(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
    const secret = c.env.SESSION_SECRET
    if (!secret) return null
    const token = parseSessionCookie(c.req.header('cookie'))
    if (!token) return null
    return verifySessionJWT(token, secret)
  }

  app.post('/api/auth/google', jsonBodyLimit(8 * 1024), async c => {
    const rl = ingestLimiter.check(clientKey(c))
    if (!rl.allowed) return c.json({ error: 'rate limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
    const clientId = c.env.GOOGLE_CLIENT_ID
    const secret = c.env.SESSION_SECRET
    if (!clientId || !secret) return c.json({ error: 'auth_not_configured' }, 503)

    let body: { credential?: string }
    try { body = await c.req.json() } catch { return c.json({ error: 'bad_request' }, 400) }
    const credential = typeof body?.credential === 'string' ? body.credential : ''
    if (!credential || credential.length > 4000) return c.json({ error: 'bad_request' }, 400)

    let payload: { sub: string; email?: string; name?: string; picture?: string } | null
    try {
      payload = await verifyGoogleIdToken(credential, clientId)
    } catch (e) {
      slog('warn', 'auth.google_verify_fail', { err: String(e).slice(0, 200) })
      return c.json({ error: 'invalid_token' }, 401)
    }
    if (!payload) return c.json({ error: 'invalid_token' }, 401)

    const token = await signSessionJWT({
      sub: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      picture: payload.picture || '',
    }, secret)

    return c.json(
      { user: { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture } },
      200,
      { 'Set-Cookie': buildSessionCookie(token), 'Cache-Control': 'no-store' },
    )
  })

  app.post('/api/auth/logout', c => {
    return c.json({ ok: true }, 200, { 'Set-Cookie': buildLogoutCookie(), 'Cache-Control': 'no-store' })
  })

  app.get('/api/me', async c => {
    const secret = c.env.SESSION_SECRET
    if (!secret) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store' })
    const token = parseSessionCookie(c.req.header('cookie'))
    if (!token) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store' })
    const payload = await verifySessionJWT(token, secret)
    if (!payload) return c.json({ user: null }, 200, { 'Cache-Control': 'no-store', 'Set-Cookie': buildLogoutCookie() })
    return c.json({
      user: { sub: payload.sub, email: payload.email, name: payload.name, picture: payload.picture },
    }, 200, { 'Cache-Control': 'no-store' })
  })

  app.get('/api/sync', async c => {
    const user = await getSessionUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const expected = c.req.header('X-Account-Id')
    if (expected !== undefined && expected !== user.sub) return c.json({ error: 'account_changed' }, 409)
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const prefix = 'u:' + user.sub + ':'
    const out: Record<string, unknown> = {}
    try {
      // Text distinguishes an explicit JSON null (forgotten municipality)
      // from a missing key. Never turn a failed read into an empty snapshot.
      await Promise.all([...SYNCABLE_KEYS].map(async key => {
        const raw = await kv.get(prefix + key)
        if (raw !== null) {
          if (typeof raw !== 'string') throw new Error('invalid_sync_value')
          out[key] = JSON.parse(raw)
        }
      }))
    } catch {
      slog('warn', 'auth.sync_read_fail', {})
      return c.json({ error: 'sync_unavailable' }, 503)
    }
    return c.json({ data: out }, 200, { 'Cache-Control': 'no-store' })
  })

  app.put('/api/sync/:key', jsonBodyLimit(300 * 1024), async c => {
    const user = await getSessionUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const expected = c.req.header('X-Account-Id')
    if (expected !== undefined && expected !== user.sub) return c.json({ error: 'account_changed' }, 409)
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const dataKey = c.req.param('key')
    if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'bad_request' }, 400) }
    // Cap al valor para evitar abuso del KV (256 KB por entrada). Si alguien
    // mete algo gordo lo rechazamos antes de persistir.
    const serialized = JSON.stringify(body)
    if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) return c.json({ error: 'payload_too_large' }, 413)
    if (!isValidSyncValue(dataKey, body)) return c.json({ error: 'bad_value' }, 400)
    try {
      await kv.put('u:' + user.sub + ':' + dataKey, serialized)
    } catch {
      slog('warn', 'auth.sync_write_fail', {})
      return c.json({ error: 'sync_unavailable' }, 503)
    }
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  })

  app.delete('/api/sync/:key', async c => {
    const user = await getSessionUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const expected = c.req.header('X-Account-Id')
    if (expected !== undefined && expected !== user.sub) return c.json({ error: 'account_changed' }, 409)
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const dataKey = c.req.param('key')
    if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
    try {
      await kv.delete('u:' + user.sub + ':' + dataKey)
    } catch {
      slog('warn', 'auth.sync_delete_fail', {})
      return c.json({ error: 'sync_unavailable' }, 503)
    }
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  })
}
