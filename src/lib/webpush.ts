// Web Push desde Cloudflare Workers / Pages (Ship 23).
//
// Implementacion minima — usa Web Crypto API (subtle) para:
//   1. Firmar el JWT VAPID (ES256 = ECDSA-P256-SHA256).
//   2. Envia POST al endpoint del push service sin payload cifrado.
//
// Decision: NO enviamos payload. Si lo hicieramos, tendriamos que implementar
// aes128gcm segun RFC 8188 (HTTP Encrypted Content-Encoding), que son ~200
// lineas mas de crypto. Sin payload, el Service Worker muestra una notif
// generica "Revisa tus gasolineras favoritas — hay bajadas" y al abrir la
// app el usuario ve en la UI cual. Da el 80% del valor con el 20% del codigo.
//
// VAPID keys — generacion (una sola vez):
//   openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
//   openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
//   # Luego extraer los dos valores como JWK {x,y,d} con un script aparte.
// En Cloudflare Pages:
//   - VAPID_PUBLIC_KEY  = base64url del punto publico sin comprimir (65 bytes = 0x04|X|Y)
//   - VAPID_PRIVATE_KEY = base64url de la componente d (32 bytes)
//   - VAPID_SUBJECT     = "mailto:alguien@tudominio.com"
//
// Uso:
//   const ok = await sendWebPush(endpoint, {
//     publicKey: env.VAPID_PUBLIC_KEY,
//     privateKey: env.VAPID_PRIVATE_KEY,
//     subject: env.VAPID_SUBJECT
//   })

export interface VapidConfig {
  publicKey:  string   // base64url
  privateKey: string   // base64url
  subject:    string   // "mailto:..."
}

// Convierte un ArrayBuffer a base64url (sin padding, URL-safe).
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Decodifica base64url a Uint8Array. Tolera padding ausente.
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Importa la clave privada VAPID como CryptoKey para firmar.
// La privateKey VAPID es solo la componente `d` (32 bytes). Para subtle.importKey
// necesitamos reconstruir el JWK con x,y,d. Extraemos x,y de la publicKey
// (formato punto no-comprimido: 0x04 | X(32) | Y(32)).
async function importVapidPrivateKey(publicKeyB64: string, privateKeyB64: string): Promise<CryptoKey> {
  const pubBytes = b64urlDecode(publicKeyB64)
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('VAPID public key inesperada (se esperaba punto no-comprimido de 65 bytes)')
  }
  const x = pubBytes.slice(1, 33)
  const y = pubBytes.slice(33, 65)
  const d = b64urlDecode(privateKeyB64)
  if (d.length !== 32) throw new Error('VAPID private key inesperada (32 bytes base64url)')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(x),
    y: b64url(y),
    d: b64url(d),
    ext: true,
  }
  return crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
}

// Construye y firma el JWT VAPID para un audience (origen del push service).
// - Header: {typ:"JWT", alg:"ES256"}
// - Payload: {aud, exp (<=24h), sub}
// - Signature: ECDSA-P256-SHA256 sobre base64url(header).base64url(payload)
async function signVapidJWT(aud: string, cfg: VapidConfig, ttlSeconds = 60 * 60 * 12): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud,
    exp: now + ttlSeconds,
    sub: cfg.subject,
  }
  const enc = new TextEncoder()
  const h = b64url(enc.encode(JSON.stringify(header)))
  const p = b64url(enc.encode(JSON.stringify(payload)))
  const toSign = enc.encode(h + '.' + p)
  const key = await importVapidPrivateKey(cfg.publicKey, cfg.privateKey)
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    key,
    toSign
  )
  // subtle.sign devuelve raw (r||s) de 64 bytes — el formato correcto para JWS ES256.
  return h + '.' + p + '.' + b64url(sig)
}

// Extrae el origen (scheme+host+port) del endpoint para usarlo como `aud` del JWT.
function originOf(endpoint: string): string {
  try {
    const u = new URL(endpoint)
    return u.origin
  } catch {
    return endpoint
  }
}

// Resultado de enviar un push.
// - ok=true: el push service acepto (201 Created).
// - status=410 Gone: suscripcion muerta — el caller debe borrarla de D1.
// - status=404/400/etc: error transitorio o de config; caller decide.
export type PushResult =
  | { ok: true; status: number }
  | { ok: false; status: number; gone: boolean; bodyText?: string }

// Envia un push (sin payload) a un endpoint con VAPID. El Service Worker
// mostrara una notif generica porque no hay body cifrado.
// TTL=60 => si no se entrega en 60s, el push service descarta.
export async function sendWebPush(endpoint: string, cfg: VapidConfig, ttlSeconds = 60): Promise<PushResult> {
  const aud = originOf(endpoint)
  const jwt = await signVapidJWT(aud, cfg)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': String(ttlSeconds),
      'Authorization': `vapid t=${jwt}, k=${cfg.publicKey}`,
      'Content-Length': '0',
      // Sin body cifrado — push service entrega "push event" sin data.
    },
  })
  if (res.ok) return { ok: true, status: res.status }
  // 404 Not Found / 410 Gone => suscripcion expirada o revocada, purgar.
  const gone = res.status === 410 || res.status === 404
  let bodyText: string | undefined
  try { bodyText = (await res.text()).slice(0, 200) } catch {}
  return { ok: false, status: res.status, gone, bodyText }
}

// Genera un par VAPID nuevo (utilidad, NO llamar en runtime — solo una vez
// al setup para obtener los valores a meter como secret). La idea es usar
// este helper en tests o scripts aparte.
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error('JWK incompleta')
  // Reconstruir el punto publico no-comprimido (0x04 | X | Y)
  const x = b64urlDecode(jwk.x)
  const y = b64urlDecode(jwk.y)
  const pub = new Uint8Array(65)
  pub[0] = 0x04
  pub.set(x, 1)
  pub.set(y, 33)
  return {
    publicKey: b64url(pub),
    privateKey: jwk.d!,  // ya viene base64url
  }
}
