// Auth helpers: verifica Google ID tokens (RS256 contra el JWKS de Google) y
// firma/valida sesiones propias (HMAC-SHA256). Todo corre sobre Web Crypto,
// disponible nativamente en Cloudflare Workers sin dependencias.
//
// Flujo:
//   1) Frontend obtiene un ID token de Google Identity Services (One Tap).
//   2) Server verifica firma + claims (aud, iss, exp) con verifyGoogleIdToken().
//   3) Server emite sesion propia con signSessionJWT() -> cookie HttpOnly.
//   4) Requests posteriores validan con verifySessionJWT().

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
export const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60  // 30 dias
export const SESSION_COOKIE_NAME = 'gs_session'

// ---- base64url ----
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function base64urlEncodeString(s: string): string {
  return base64urlEncode(new TextEncoder().encode(s))
}

export function base64urlDecodeString(s: string): string {
  return new TextDecoder().decode(base64urlDecode(s))
}

// ---- JWT HMAC-SHA256 (sesion propia) ----
export type SessionPayload = {
  sub: string        // Google user id (opaco, estable)
  email: string
  name?: string
  picture?: string
  iat: number        // issued at (seconds since epoch)
  exp: number        // expires at (seconds since epoch)
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signSessionJWT(
  payload: Omit<SessionPayload, 'iat' | 'exp'> & { iat?: number; exp?: number },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const iat = payload.iat ?? nowSeconds
  const exp = payload.exp ?? iat + SESSION_TTL_SECONDS
  const body: SessionPayload = { ...payload, iat, exp }
  const header = { alg: 'HS256', typ: 'JWT' }
  const h = base64urlEncodeString(JSON.stringify(header))
  const b = base64urlEncodeString(JSON.stringify(body))
  const data = `${h}.${b}`
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${base64urlEncode(new Uint8Array(sig))}`
}

export async function verifySessionJWT(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts
  try {
    const header = JSON.parse(base64urlDecodeString(h)) as { alg?: string; typ?: string }
    if (header.alg !== 'HS256') return null
    const key = await hmacKey(secret)
    const sigBytes = base64urlDecode(s)
    const dataBytes = new TextEncoder().encode(`${h}.${b}`)
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer,
    )
    if (!ok) return null
    const payload = JSON.parse(base64urlDecodeString(b)) as SessionPayload
    if (!payload.sub || typeof payload.exp !== 'number') return null
    if (nowSeconds >= payload.exp) return null
    return payload
  } catch {
    return null
  }
}

// ---- Google ID token (RS256) ----
type JWK = {
  kty: string
  kid: string
  use?: string
  alg?: string
  n: string
  e: string
}

type JWKSResponse = { keys: JWK[] }

// Cache del JWKS: Google rota cada ~6h y el header cache-control suele decir
// max-age ~20000s. Revalidamos cada 10 min en memoria, pero mantenemos las
// claves viejas durante 24h por si llega un token firmado antes de la rotacion.
type JWKSCacheEntry = { jwk: JWK; fetchedAt: number }
const jwksCache = new Map<string, JWKSCacheEntry>()
const JWKS_REVALIDATE_MS = 10 * 60 * 1000
const JWKS_STALE_MS = 24 * 60 * 60 * 1000

export type JWKSFetcher = () => Promise<JWKSResponse>

const defaultJWKSFetcher: JWKSFetcher = async () => {
  // Nota: el objeto `cf` (para cacheTtl/cacheEverything en Workers) no esta
  // en el tipo estandar de RequestInit. Se pasa sin tiparlo y Cloudflare lo
  // lee. Ver https://developers.cloudflare.com/workers/runtime-apis/request/
  const init: RequestInit & { cf?: Record<string, unknown> } = {
    cf: { cacheTtl: 3600, cacheEverything: true },
  }
  const res = await fetch(GOOGLE_JWKS_URL, init)
  if (!res.ok) throw new Error(`jwks-fetch-${res.status}`)
  return res.json() as Promise<JWKSResponse>
}

async function getJWKByKid(kid: string, fetcher: JWKSFetcher): Promise<JWK> {
  const now = Date.now()
  const cached = jwksCache.get(kid)
  if (cached && now - cached.fetchedAt < JWKS_REVALIDATE_MS) return cached.jwk

  try {
    const jwks = await fetcher()
    for (const k of jwks.keys) {
      jwksCache.set(k.kid, { jwk: k, fetchedAt: now })
    }
    const fresh = jwksCache.get(kid)
    if (fresh) return fresh.jwk
  } catch (e) {
    if (cached && now - cached.fetchedAt < JWKS_STALE_MS) return cached.jwk
    throw e
  }
  if (cached && now - cached.fetchedAt < JWKS_STALE_MS) return cached.jwk
  throw new Error(`jwks-kid-not-found-${kid}`)
}

async function importRSAPublicKey(jwk: JWK): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

export type GoogleIdTokenPayload = {
  iss: string
  sub: string
  aud: string
  exp: number
  iat: number
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  locale?: string
  nbf?: number
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
  opts: { fetcher?: JWKSFetcher; nowSeconds?: number; clockSkewSeconds?: number } = {},
): Promise<GoogleIdTokenPayload> {
  if (typeof idToken !== 'string') throw new Error('id-token-missing')
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('id-token-malformed')
  const [h, b, s] = parts

  let header: { alg?: string; kid?: string; typ?: string }
  try { header = JSON.parse(base64urlDecodeString(h)) }
  catch { throw new Error('id-token-header-invalid') }
  if (header.alg !== 'RS256') throw new Error('id-token-alg-unsupported')
  if (!header.kid) throw new Error('id-token-kid-missing')

  let payload: GoogleIdTokenPayload
  try { payload = JSON.parse(base64urlDecodeString(b)) }
  catch { throw new Error('id-token-payload-invalid') }

  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) throw new Error('id-token-iss-invalid')
  if (payload.aud !== expectedClientId) throw new Error('id-token-aud-mismatch')
  if (!payload.sub) throw new Error('id-token-sub-missing')

  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000)
  const skew = opts.clockSkewSeconds ?? 60
  if (typeof payload.exp !== 'number' || now >= payload.exp + skew) throw new Error('id-token-expired')
  if (typeof payload.nbf === 'number' && now + skew < payload.nbf) throw new Error('id-token-not-yet-valid')
  if (typeof payload.iat === 'number' && now + skew < payload.iat) throw new Error('id-token-iat-future')

  const jwk = await getJWKByKid(header.kid, opts.fetcher ?? defaultJWKSFetcher)
  const key = await importRSAPublicKey(jwk)
  const sigBytes = base64urlDecode(s)
  const dataBytes = new TextEncoder().encode(`${h}.${b}`)
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
    dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer,
  )
  if (!ok) throw new Error('id-token-signature-invalid')

  return payload
}

// ---- Cookie helpers ----
export function buildSessionCookie(token: string, opts: { secure?: boolean; maxAge?: number } = {}): string {
  const maxAge = opts.maxAge ?? SESSION_TTL_SECONDS
  const secure = opts.secure ?? true
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function buildLogoutCookie(opts: { secure?: boolean } = {}): string {
  const secure = opts.secure ?? true
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function parseSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null
  const re = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`)
  const m = cookieHeader.match(re)
  return m ? decodeURIComponent(m[1]) : null
}

// ---- Validacion de user-data keys sincronizables ----
// Allowlist explicito: solo sincronizamos claves conocidas del cliente. Evita
// que un atacante con sesion valida guarde basura arbitraria en la KV.
export const SYNCABLE_KEYS = new Set<string>([
  'gs_profile_v1',
  'gs_diary_v1',
  'gs_favs_v1',
  'gs_alerts_v1',
  'gs_tg_chat_v1',
  'gs_settings_v1',
])

export function isSyncableKey(key: string): boolean {
  return SYNCABLE_KEYS.has(key)
}
