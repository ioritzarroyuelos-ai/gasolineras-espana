import { describe, it, expect } from 'vitest'
import {
  base64urlEncode,
  base64urlDecode,
  base64urlEncodeString,
  base64urlDecodeString,
  signSessionJWT,
  verifySessionJWT,
  buildSessionCookie,
  buildLogoutCookie,
  parseSessionCookie,
  isSyncableKey,
  SESSION_COOKIE_NAME,
} from '../src/lib/auth'

describe('base64url', () => {
  it('encodes / decodes binary roundtrip', () => {
    const bytes = new Uint8Array([0, 255, 127, 64, 32, 16, 8, 4, 2, 1])
    const encoded = base64urlEncode(bytes)
    const decoded = base64urlDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })

  it('encodes / decodes utf-8 string roundtrip', () => {
    const s = 'hola, €, 日本 🎉'
    expect(base64urlDecodeString(base64urlEncodeString(s))).toBe(s)
  })

  it('output has no +, /, or = chars', () => {
    const e = base64urlEncode(new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]))
    expect(e).not.toMatch(/[+/=]/)
  })
})

describe('signSessionJWT / verifySessionJWT', () => {
  const secret = 'test-secret-that-is-long-enough-to-be-realistic'

  it('roundtrips a valid token', async () => {
    const now = 1700000000
    const token = await signSessionJWT(
      { sub: 'user-123', email: 'a@b.com', name: 'Alice', picture: 'https://x/y.png' },
      secret,
      now,
    )
    const payload = await verifySessionJWT(token, secret, now + 10)
    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-123')
    expect(payload!.email).toBe('a@b.com')
    expect(payload!.name).toBe('Alice')
    expect(payload!.picture).toBe('https://x/y.png')
    expect(payload!.iat).toBe(now)
    expect(payload!.exp).toBeGreaterThan(now)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signSessionJWT({ sub: 'u', email: 'a@b.com' }, secret, 1700000000)
    const payload = await verifySessionJWT(token, 'other-secret-that-also-is-realistic', 1700000000)
    expect(payload).toBeNull()
  })

  it('rejects a tampered payload', async () => {
    const token = await signSessionJWT({ sub: 'u', email: 'a@b.com' }, secret, 1700000000)
    const parts = token.split('.')
    // Cambia el sub en el payload sin re-firmar
    const tampered = parts[0] + '.' + base64urlEncodeString(JSON.stringify({ sub: 'evil', email: 'a@b.com', iat: 1, exp: 2_000_000_000 })) + '.' + parts[2]
    const payload = await verifySessionJWT(tampered, secret, 1700000000)
    expect(payload).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await signSessionJWT({ sub: 'u', email: 'a@b.com', iat: 1, exp: 100 }, secret, 1)
    const payload = await verifySessionJWT(token, secret, 1000)
    expect(payload).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifySessionJWT('', secret)).toBeNull()
    expect(await verifySessionJWT('x.y', secret)).toBeNull()
    expect(await verifySessionJWT('a.b.c.d', secret)).toBeNull()
    expect(await verifySessionJWT('not-base64.not-base64.notb64', secret)).toBeNull()
  })

  it('rejects a non-HS256 header', async () => {
    // Construye un header con alg:none (ataque clasico alg=none)
    const noneHeader = base64urlEncodeString(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const body = base64urlEncodeString(JSON.stringify({ sub: 'u', email: 'a@b.com', iat: 1, exp: 2_000_000_000 }))
    const fakeToken = `${noneHeader}.${body}.`
    const payload = await verifySessionJWT(fakeToken, secret, 1)
    expect(payload).toBeNull()
  })
})

describe('cookie helpers', () => {
  it('buildSessionCookie uses HttpOnly + Secure + SameSite=Lax', () => {
    const c = buildSessionCookie('abc.def.ghi')
    expect(c).toContain(`${SESSION_COOKIE_NAME}=abc.def.ghi`)
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Secure')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Max-Age=')
  })

  it('buildLogoutCookie expires the cookie', () => {
    const c = buildLogoutCookie()
    expect(c).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(c).toContain('Max-Age=0')
  })

  it('parseSessionCookie reads the session', () => {
    expect(parseSessionCookie(`${SESSION_COOKIE_NAME}=abc; other=y`)).toBe('abc')
    expect(parseSessionCookie(`a=1; ${SESSION_COOKIE_NAME}=tok123; c=3`)).toBe('tok123')
    expect(parseSessionCookie('other=y')).toBeNull()
    expect(parseSessionCookie(null)).toBeNull()
    expect(parseSessionCookie(undefined)).toBeNull()
  })
})

describe('isSyncableKey', () => {
  it('accepts known keys', () => {
    expect(isSyncableKey('gs_profile_v1')).toBe(true)
    expect(isSyncableKey('gs_diary_v1')).toBe(true)
    expect(isSyncableKey('gs_favs_v1')).toBe(true)
  })

  it('rejects unknown keys', () => {
    expect(isSyncableKey('evil')).toBe(false)
    expect(isSyncableKey('../../etc/passwd')).toBe(false)
    expect(isSyncableKey('')).toBe(false)
    expect(isSyncableKey('gs_profile_v2')).toBe(false)
  })
})
