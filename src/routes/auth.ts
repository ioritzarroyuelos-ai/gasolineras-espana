// Autenticacion (Google Sign-In) + sync KV cross-device. Extraido de index.tsx
// (B1). registerAuthRoutes(app, deps) registra /api/auth/google, /api/auth/logout,
// /api/me y /api/sync[/:key] (GET/PUT/DELETE). Flujo GIS: el cliente obtiene un ID
// token de Google, el server lo verifica contra el JWKS y emite cookie de sesion
// firmada (HMAC-SHA256). Los datos del usuario se guardan en USER_DATA KV con key
// `u:${sub}:${dataKey}`. Degradacion: sin GOOGLE_CLIENT_ID/SESSION_SECRET -> 503;
// sin USER_DATA -> /api/sync 503 pero el login sigue.
import type { Hono } from 'hono'
import type { Env } from '../index'
import { ingestLimiter, clientKey, slog } from '../lib/runtime'
import {
  verifyGoogleIdToken, signSessionJWT, verifySessionJWT,
  buildSessionCookie, buildLogoutCookie, parseSessionCookie, isSyncableKey,
} from '../lib/auth'

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>): void {

  async function getSessionUser(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
    const secret = c.env.SESSION_SECRET
    if (!secret) return null
    const token = parseSessionCookie(c.req.header('cookie'))
    if (!token) return null
    return verifySessionJWT(token, secret)
  }

  app.post('/api/auth/google', async c => {
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
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const prefix = 'u:' + user.sub + ':'
    const list = await kv.list({ prefix, limit: 100 })
    const out: Record<string, unknown> = {}
    for (const { name } of list.keys) {
      const key = name.slice(prefix.length)
      if (!isSyncableKey(key)) continue
      const val = await kv.get(name, { type: 'json' })
      if (val !== null) out[key] = val
    }
    return c.json({ data: out }, 200, { 'Cache-Control': 'no-store' })
  })

  app.put('/api/sync/:key', async c => {
    const user = await getSessionUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const dataKey = c.req.param('key')
    if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'bad_request' }, 400) }
    // Cap al valor para evitar abuso del KV (256 KB por entrada). Si alguien
    // mete algo gordo lo rechazamos antes de persistir.
    const serialized = JSON.stringify(body)
    if (serialized.length > 256 * 1024) return c.json({ error: 'payload_too_large' }, 413)
    await kv.put('u:' + user.sub + ':' + dataKey, serialized)
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  })

  app.delete('/api/sync/:key', async c => {
    const user = await getSessionUser(c)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const kv = c.env.USER_DATA
    if (!kv) return c.json({ error: 'sync_not_configured' }, 503)
    const dataKey = c.req.param('key')
    if (!isSyncableKey(dataKey)) return c.json({ error: 'bad_key' }, 400)
    await kv.delete('u:' + user.sub + ':' + dataKey)
    return c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' })
  })
}
