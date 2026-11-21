import { disponibilidadIdentidad, disponibilidadMadrid } from './disponibilidad.mjs'

export const GATEWAY_ORIGIN = 'https://webapp-3ft.pages.dev'
export const GATEWAY_PATH_CHECK = '/api/telegram/disponibilidad/gateway/check'
export const GATEWAY_PATH_SEND = '/api/telegram/disponibilidad/gateway/send'
export const GATEWAY_REVISION = 'disponibilidad-gateway-v1'
export const GATEWAY_SIGNATURE_HEADER = 'X-EU-Gateway-Signature'
export const GATEWAY_MAX_BYTES = 4096
export const GATEWAY_VENTANA_MS = 30000
const KEY_DOMAIN = 'espana-util:disponibilidad:gateway-key:v1:production:https://webapp-3ft.pages.dev'
const MESSAGE_DOMAIN = 'espana-util:disponibilidad:gateway-message:v1'
const encoder = new TextEncoder()
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
const versionId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const object = value => !!value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
function keys(value, required, optional = []) {
  return object(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}
const baseKeys = ['schema', 'environment', 'nonce', 'issuedAt', 'expiresAt']
const sendKeys = [...baseKeys, 'op', 'chat', 'modo', 'avisoId', 'version', 'event', 'attempt', 'workerVersion', 'fuente', 'lugarId', 'objetivo', 'ficha']
const replyKeys = [...baseKeys, 'op', 'requestDigest', 'workerVersion', 'revision']
function windowShape(value) {
  return Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt) && value.issuedAt >= Date.UTC(2020, 0, 1) &&
    value.expiresAt > value.issuedAt && value.expiresAt - value.issuedAt <= GATEWAY_VENTANA_MS
}
function base(value, now) {
  return object(value) && value.schema === 1 && value.environment === 'production' && uuid(value.nonce) && windowShape(value) &&
    Number.isFinite(now) && value.issuedAt <= now + 1000 && value.expiresAt > now
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null
  const time = Date.parse(value), canonical = value.includes('.') ? value : value.slice(0, -1) + '.000Z'
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : null
}
const sourceRules = {
  'aparcamientos-madrid': { ttl: 300000, bounds: [40.2, 40.7, -3.9, -3.4] },
  'aparcamientos-vigo': { ttl: 360000, bounds: [42.1, 42.4, -8.9, -8.5] },
  'bicis-zaragoza': { ttl: 300000, bounds: [41.4, 41.9, -1.2, -.6] },
}
function validFicha(ficha, request, now) {
  if (!keys(ficha, ['nombre', 'cantidad', 'fechaDato', 'caduca', 'lat', 'lon']) || typeof ficha.nombre !== 'string' || !ficha.nombre.trim() ||
    ficha.nombre.length > 200 || /[\u0000-\u001f\u007f-\u009f\ufffd]/.test(ficha.nombre) ||
    !Number.isSafeInteger(ficha.cantidad) || ficha.cantidad < 0 || ficha.cantidad > 100000 || request.modo === 'temporal' && ficha.cantidad === 0) return false
  const rule = sourceRules[request.fuente], date = timestamp(ficha.fechaDato), expiry = timestamp(ficha.caduca)
  if (!rule || date === null || expiry === null || date > now || date > request.issuedAt || expiry <= now || expiry <= date || expiry > date + rule.ttl) return false
  if (request.fuente !== 'bicis-zaragoza' && ficha.lat === null && ficha.lon === null) return true
  const [south, north, west, east] = rule.bounds
  return Number.isFinite(ficha.lat) && Number.isFinite(ficha.lon) && ficha.lat >= south && ficha.lat <= north && ficha.lon >= west && ficha.lon <= east
}
/** Canonical JSON is used to CREATE envelopes. Received strings are never
 * parsed and reserialized before their signature/digest is checked. */
export function gatewayCanonico(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(gatewayCanonico).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + gatewayCanonico(value[key])).join(',') + '}'
  throw Error('invalid_gateway_json')
}
const hexOf = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('')
export async function gatewayDigest(value) {
  return hexOf(await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : gatewayCanonico(value))))
}
async function keyFromBytes(bytes) { return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) }
async function keyFromHex(value) {
  if (!hex(value)) throw Error('invalid_gateway_key')
  return keyFromBytes(Uint8Array.from(value.match(/../g), part => parseInt(part, 16)))
}
export async function derivaGatewayKey(cron) {
  if (typeof cron !== 'string' || !cron || encoder.encode(cron).byteLength > 4096) throw Error('invalid_gateway_root')
  return hexOf(await crypto.subtle.sign('HMAC', await keyFromBytes(encoder.encode(cron)), encoder.encode(KEY_DOMAIN)))
}
function frame(path, raw, role) {
  if (![GATEWAY_PATH_CHECK, GATEWAY_PATH_SEND].includes(path) || !['request', 'response', 'worker'].includes(role) ||
    typeof raw !== 'string' || encoder.encode(raw).byteLength > GATEWAY_MAX_BYTES) throw Error('invalid_gateway_frame')
  return encoder.encode(gatewayCanonico([MESSAGE_DOMAIN, role, 'POST', GATEWAY_ORIGIN, path, 1, raw]))
}
async function sign(key, path, raw, role) { return hexOf(await crypto.subtle.sign('HMAC', await keyFromHex(key), frame(path, raw, role))) }
async function verify(key, path, raw, signature, role) {
  try {
    if (!hex(signature)) return false
    return await crypto.subtle.verify('HMAC', await keyFromHex(key), Uint8Array.from(signature.match(/../g), part => parseInt(part, 16)), frame(path, raw, role))
  } catch { return false }
}
export async function gatewayFirma(key, path, raw, role = 'request') {
  if (!['request', 'response'].includes(role)) throw Error('invalid_gateway_role')
  return sign(key, path, raw, role)
}
export async function gatewayVerifica(key, path, raw, signature, role = 'request') {
  return ['request', 'response'].includes(role) && verify(key, path, raw, signature, role)
}
/** Returns the SAME object. No normalization may change the signed body. */
export function gatewayValidaSolicitud(value, op, now = Date.now()) {
  try {
    if (!['check', 'send'].includes(op) || !base(value, now) || value.op !== op || encoder.encode(gatewayCanonico(value)).byteLength > GATEWAY_MAX_BYTES) return null
    if (op === 'check') return keys(value, [...baseKeys, 'op']) ? value : null
    if (!keys(value, sendKeys) || !Number.isSafeInteger(value.chat) || value.chat <= 0 || !['diario', 'temporal'].includes(value.modo) ||
      !uuid(value.avisoId) || value.version !== value.avisoId || !uuid(value.attempt) || !versionId(value.workerVersion) ||
      !disponibilidadIdentidad(value.fuente, value.lugarId, value.objetivo) || !validFicha(value.ficha, value, now)) return null
    const event = value.modo === 'diario' ? 'diario:' + disponibilidadMadrid(value.issuedAt).fecha : 'temporal:' + value.avisoId
    return value.event === event ? value : null
  } catch { return null }
}
export async function gatewayChallenge(key, challenge, workerVersion) {
  if (!keys(challenge, ['nonce', 'issuedAt', 'expiresAt']) || !uuid(challenge.nonce) || !windowShape(challenge) || !versionId(workerVersion)) throw Error('invalid_gateway_challenge')
  const proof = { schema: 1, environment: 'production', nonce: challenge.nonce, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt, workerVersion }
  return { ...proof, signature: await sign(key, GATEWAY_PATH_CHECK, gatewayCanonico(proof), 'worker') }
}
export async function gatewayValidaChallenge(key, proof, nonce, expectedVersion, now = Date.now()) {
  if (!keys(proof, [...baseKeys, 'workerVersion', 'signature']) || !base(proof, now) || proof.nonce !== nonce ||
    !versionId(proof.workerVersion) || expectedVersion !== undefined && proof.workerVersion !== expectedVersion) return false
  const { signature, ...payload } = proof
  return verify(key, GATEWAY_PATH_CHECK, gatewayCanonico(payload), signature, 'worker')
}
export function gatewayValidaRespuesta(value, request, requestDigest, now = Date.now()) {
  try {
    if (!base(value, now) || value.op !== request.op || value.nonce !== request.nonce || !hex(requestDigest) || value.requestDigest !== requestDigest ||
      value.revision !== GATEWAY_REVISION || !versionId(value.workerVersion) || value.issuedAt < request.issuedAt - 1000 ||
      value.expiresAt > request.expiresAt || encoder.encode(gatewayCanonico(value)).byteLength > GATEWAY_MAX_BYTES) return null
    if (request.op === 'send') {
      if (!keys(value, [...replyKeys, 'estado', 'attempt'], ['espera']) || value.attempt !== request.attempt || value.workerVersion !== request.workerVersion ||
        !['enviado', 'incierto', 'baja', 'reintentar'].includes(value.estado)) return null
      if (value.estado === 'reintentar') {
        if (!Number.isSafeInteger(value.espera) || value.espera < 60 || value.espera > 86400) return null
      } else if (own(value, 'espera')) return null
      return value
    }
    const username = name => typeof name === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(name)
    if (!keys(value, [...replyKeys, 'ok', 'bot', 'worker']) || value.ok !== true || !keys(value.bot, ['expectedUsername', 'credentialUsername']) ||
      !username(value.bot.expectedUsername) || !username(value.bot.credentialUsername) || value.bot.expectedUsername.toLowerCase() !== value.bot.credentialUsername.toLowerCase() ||
      !keys(value.worker, [...baseKeys, 'workerVersion', 'signature']) || !base(value.worker, now) || !hex(value.worker.signature) ||
      value.worker.nonce !== request.nonce || value.worker.issuedAt !== request.issuedAt || value.worker.expiresAt !== request.expiresAt || value.worker.workerVersion !== value.workerVersion) return null
    return value
  } catch { return null }
}
const cancel = body => { if (body) void body.cancel().catch(() => {}) }
async function readRaw(response, signal) {
  const length = response.headers.get('content-length')
  if (response.status !== 200 || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
    length !== null && (!/^\d+$/.test(length) || Number(length) > GATEWAY_MAX_BYTES)) { cancel(response.body); throw Error('invalid_gateway_reply') }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let raw = '', size = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) throw Error('gateway_timeout')
      const next = await reader.read()
      if (signal.aborted) throw Error('gateway_timeout')
      if (next.done) break
      size += next.value.byteLength
      if (size > GATEWAY_MAX_BYTES) { abort(); throw Error('gateway_reply_large') }
      raw += decoder.decode(next.value, { stream: true })
    }
    return raw + decoder.decode()
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
}
/** A relay failure is NOT a Telegram rejection. There are no transport retries. */
export async function gatewayEnviar(key, request, io = {}) {
  const uncertain = () => ({ estado: 'incierto' })
  const clock = () => typeof io.now === 'function' ? io.now() : io.now ?? Date.now()
  const controller = new AbortController()
  let timer
  try {
    if (!hex(key) || !gatewayValidaSolicitud(request, 'send', clock())) return uncertain()
    const raw = gatewayCanonico(request), digest = await gatewayDigest(raw), signature = await gatewayFirma(key, GATEWAY_PATH_SEND, raw)
    if (!gatewayValidaSolicitud(request, 'send', clock())) return uncertain()
    const configuredTimeout = Number.isFinite(io.timeoutMs) ? Math.max(1, Math.min(io.timeoutMs, 20000)) : 20000
    const timeoutMs = Math.max(1, Math.min(configuredTimeout, request.expiresAt - clock()))
    const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(uncertain()) }, timeoutMs) })
    return await Promise.race([timeout, (async () => {
      const response = await (io.fetch ?? fetch)(GATEWAY_ORIGIN + GATEWAY_PATH_SEND, { method: 'POST', cache: 'no-store', redirect: 'manual', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', [GATEWAY_SIGNATURE_HEADER]: signature }, body: raw })
      if (controller.signal.aborted) { cancel(response.body); return uncertain() }
      const replyRaw = await readRaw(response, controller.signal)
      if (!await gatewayVerifica(key, GATEWAY_PATH_SEND, replyRaw, response.headers.get(GATEWAY_SIGNATURE_HEADER) || '', 'response')) return uncertain()
      const reply = gatewayValidaRespuesta(JSON.parse(replyRaw), request, digest, clock())
      if (!reply || controller.signal.aborted) return uncertain()
      return { estado: reply.estado, ...(reply.estado === 'reintentar' ? { espera: reply.espera } : {}) }
    })()])
  } catch { return uncertain() }
  finally { clearTimeout(timer) }
}
