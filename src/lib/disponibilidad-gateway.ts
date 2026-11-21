import { disponibilidadMensaje } from '../../scripts/lib/disponibilidad.mjs'
import type { GatewaySend } from '../../scripts/lib/disponibilidad-gateway.mjs'

/** Comprobaciones del gateway de producción. No acepta destinos ni texto libre. */
type BotEnv = { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_BOT_USERNAME?: string }
export type GatewayBotIdentity =
  | { ok: true; expectedUsername: string; credentialUsername: string }
  | { ok: false; error: 'bot_unavailable' }
  | { ok: false; error: 'bot_identity_mismatch'; expectedUsername: string; credentialUsername: string }

const username = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(value)

/** Lee un cuerpo acotado, incluidos los que se detienen después de cabeceras. */
export async function leeCuerpoGateway(input: Request | Response, max: number, signal: AbortSignal): Promise<string | null> {
  const length = input.headers.get('content-length')
  if (!input.body || length !== null && (!/^\d+$/.test(length) || Number(length) > max)) {
    if (input.body) void input.body.cancel().catch(() => {})
    return null
  }
  const reader = input.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  let size = 0, raw = ''
  try {
    for (;;) {
      if (signal.aborted) { abort(); return null }
      const part = await reader.read()
      if (signal.aborted) { abort(); return null }
      if (part.done) break
      size += part.value.byteLength
      if (size > max) { abort(); return null }
      raw += decoder.decode(part.value, { stream: true })
    }
    return raw + decoder.decode()
  } catch { abort(); return null }
  finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
}

/** GET de identidad con la credencial de Pages; nunca crea chats ni envía. */
export async function compruebaBotGateway(env: BotEnv, request: typeof fetch = fetch): Promise<GatewayBotIdentity> {
  const bot = env.TELEGRAM_BOT_TOKEN, expected = env.TELEGRAM_BOT_USERNAME
  if (typeof bot !== 'string' || bot.length > 256 || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(bot) || !username(expected)) return { ok: false, error: 'bot_unavailable' }
  try {
    const signal = AbortSignal.timeout(5000)
    const response = await request('https://api.telegram.org/bot' + bot + '/getMe', { method: 'GET', cache: 'no-store', redirect: 'manual', signal })
    if (response.status !== 200) { if (response.body) void response.body.cancel().catch(() => {}); return { ok: false, error: 'bot_unavailable' } }
    const raw = await leeCuerpoGateway(response, 16384, signal)
    if (raw === null) return { ok: false, error: 'bot_unavailable' }
    const data = JSON.parse(raw)
    if (data?.ok !== true || data.result?.is_bot !== true || !Number.isSafeInteger(data.result?.id) || data.result.id <= 0 || !username(data.result.username)) return { ok: false, error: 'bot_unavailable' }
    const identity = { expectedUsername: expected, credentialUsername: data.result.username }
    return expected.toLowerCase() === data.result.username.toLowerCase() ? { ok: true, ...identity } : { ok: false, error: 'bot_identity_mismatch', ...identity }
  } catch { return { ok: false, error: 'bot_unavailable' } }
}

const fuentes = {
  'aparcamientos-madrid': 'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios',
  'aparcamientos-vigo': 'https://datos-ckan.vigo.org/dataset/t-parking-real',
  'bicis-zaragoza': 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad',
} as const

/** Sólo recibe un DTO validado. Los enlaces y la plantilla se crean aquí. */
export function mensajeGateway(input: GatewaySend): string {
  const query = new URLSearchParams({ categorias: input.fuente })
  if (input.ficha.lat !== null && input.ficha.lon !== null) {
    query.set('servicio', input.lugarId)
    query.set('lat', String(input.ficha.lat))
    query.set('lon', String(input.ficha.lon))
  }
  return disponibilidadMensaje(input, {
    nombre: input.ficha.nombre, cantidad: input.ficha.cantidad, fechaDato: input.ficha.fechaDato,
    enlace: 'https://webapp-3ft.pages.dev/cerca?' + query.toString(), fuenteUrl: fuentes[input.fuente],
  })
}
