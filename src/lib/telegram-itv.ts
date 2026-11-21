import type { Env } from '../index'
import { fechaItvValida } from './itv-recordatorio'
import { verifyTelegramToken } from './auth'

export const ITV_CONSENTIMIENTO = 'itv-telegram-v1'
export const ITV_PREFIX = 'tg-itv:v1:'
const DAY = 86400000
export type ItvKv = NonNullable<Env['USER_DATA']>
export type ItvAviso = { version: 1; id: string; chat: number; fecha: string; consentimiento: typeof ITV_CONSENTIMIENTO; actualizado: string }
export type ItvEvento = { usuario: string; id: string; fecha: string; dias: 7 | 1 }
export type ItvRecibo = { estado: 'pendiente' | 'enviado' | 'reintentar' | 'incierto'; intento: number; reintentarDesde?: number }

export function itvMadrid(now = Date.now()): { fecha: string; hora: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const value = (type: string) => parts.find(part => part.type === type)?.value || ''
  return { fecha: `${value('year')}-${value('month')}-${value('day')}`, hora: Number(value('hour')) }
}
export function itvFechaDesplazada(fecha: string, dias: number): string {
  return new Date(Date.parse(fecha + 'T12:00:00Z') + dias * DAY).toISOString().slice(0, 10)
}
export function itvFechaAdmitida(fecha: unknown, now = Date.now()): fecha is string {
  if (!fechaItvValida(fecha)) return false
  const today = itvMadrid(now).fecha
  return fecha > today && Date.parse(fecha) <= Date.parse(today) + 3660 * DAY
}
export function itvVentanas(fecha: string, now = Date.now()): Array<{ dias: 7 | 1; fecha: string; desde: '08:00'; hasta: '11:59'; zona: 'Europe/Madrid' }> {
  const today = itvMadrid(now)
  return ([7, 1] as const).map(dias => ({ dias, fecha: itvFechaDesplazada(fecha, -dias), desde: '08:00' as const, hasta: '11:59' as const, zona: 'Europe/Madrid' as const }))
    .filter(window => window.fecha > today.fecha || (window.fecha === today.fecha && today.hora < 12))
}
export async function itvChatAutorizado(header: string | undefined, env: Pick<Env, 'SESSION_SECRET' | 'TELEGRAM_BOT_TOKEN'>): Promise<number | null> {
  const token = /^Bearer\s+(.+)$/i.exec(header || '')?.[1]?.trim()
  if (!token) return null
  const chat = await verifyTelegramToken(token, env.SESSION_SECRET || env.TELEGRAM_BOT_TOKEN || '')
  return chat !== null && Number.isSafeInteger(chat) && chat > 0 ? chat : null
}
export async function itvUsuario(chat: number): Promise<string> {
  // Stable pseudonym, NOT authorization or anonymization. Session-key rotation
  // must not prevent /stop from locating and deleting an older reminder.
  const signature = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('espana-util:itv-telegram:v1:' + chat))
  return [...new Uint8Array(signature)].map(n => n.toString(16).padStart(2, '0')).join('')
}
export function itvAvisoKey(usuario: string): string { return ITV_PREFIX + 'usuario:' + usuario }
export function itvEventoKey(event: ItvEvento): string {
  return ITV_PREFIX + 'dia:' + itvFechaDesplazada(event.fecha, -event.dias) + ':' + event.usuario + ':' + event.id + ':' + event.dias
}
export function itvReciboKey(event: ItvEvento): string { return ITV_PREFIX + 'recibo:' + event.usuario + ':' + event.id + ':' + event.dias }
export function itvIntentoKey(event: ItvEvento): string { return itvReciboKey(event) + ':intento' }
export function itvReciboValido(data: unknown): data is ItvRecibo {
  if (!data || typeof data !== 'object') return false
  const item = data as ItvRecibo
  return ['pendiente', 'enviado', 'reintentar', 'incierto'].includes(item.estado) && Number.isFinite(item.intento) &&
    (item.reintentarDesde === undefined || Number.isFinite(item.reintentarDesde))
}
export function itvEventos(usuario: string, aviso: ItvAviso): ItvEvento[] {
  return [7, 1].map(dias => ({ usuario, id: aviso.id, fecha: aviso.fecha, dias: dias as 7 | 1 }))
}
export function itvAvisoValido(data: unknown): data is ItvAviso {
  if (!data || typeof data !== 'object') return false
  const item = data as ItvAviso
  return item.version === 1 && /^[a-f0-9-]{36}$/.test(item.id) && Number.isSafeInteger(item.chat) && item.chat > 0 &&
    fechaItvValida(item.fecha) && item.consentimiento === ITV_CONSENTIMIENTO && Number.isFinite(Date.parse(item.actualizado))
}
export function itvEventoValido(data: unknown): data is ItvEvento {
  if (!data || typeof data !== 'object') return false
  const item = data as ItvEvento
  return /^[a-f0-9]{64}$/.test(item.usuario) && /^[a-f0-9-]{36}$/.test(item.id) && fechaItvValida(item.fecha) && [7, 1].includes(item.dias)
}
export async function itvLeer<T>(kv: ItvKv, key: string): Promise<T | null> {
  const raw = await kv.get(key)
  if (raw === null) return null
  if (typeof raw !== 'string') throw new Error('invalid_kv_value')
  try { return JSON.parse(raw) as T } catch { throw new Error('invalid_kv_value') }
}
export function itvTtl(fecha: string, now = Date.now()): number {
  return Math.max(60, Math.ceil((Date.parse(fecha + 'T23:59:59Z') + 30 * DAY - now) / 1000))
}
export async function borrarItvTelegram(env: Pick<Env, 'USER_DATA' | 'SESSION_SECRET' | 'TELEGRAM_BOT_TOKEN'>, chat: number): Promise<boolean> {
  if (!env.USER_DATA) return false
  const usuario = await itvUsuario(chat)
  const key = itvAvisoKey(usuario), previous = await itvLeer<ItvAviso>(env.USER_DATA, key)
  // Remove the authoritative consent before cleaning the date indexes. A stale
  // index can never authorize a send on its own.
  await env.USER_DATA.delete(key)
  if (itvAvisoValido(previous)) for (const event of itvEventos(usuario, previous)) {
    await env.USER_DATA.delete(itvEventoKey(event))
    // Opaque delivery receipts expire after 30 days; keeping them prevents a
    // stale queue replica from treating a just-cancelled delivery as unsent.
  }
  return itvAvisoValido(previous)
}

/** A confirmed Telegram rejection can be retried; timeout/invalid responses
 * are ambiguous because sendMessage has no idempotency key. Never blindly retry. */
export async function enviarItvTelegram(bot: string, aviso: ItvAviso, dias: number): Promise<{ estado: 'enviado' | 'reintentar' | 'incierto' | 'baja'; espera?: number }> {
  const text = `📅 <b>Recordatorio de ITV</b>\n\nLa fecha que tú indicaste es el <b>${aviso.fecha.split('-').reverse().join('/')}</b>: quedan ${dias === 1 ? '1 día' : '7 días'}.\n\nComprueba tu documentación y pide cita en tu estación. Esto no es una cita ni un cálculo del plazo legal.\nhttps://webapp-3ft.pages.dev/itv/\n\nPara cancelar todos los avisos del bot: /stop`
  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(bot)}/sendMessage`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: aviso.chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    // Workers no admite redirect:'error'. No seguir el destino ni interpretar
    // su cuerpo como confirmación de Telegram; tampoco repetir un envío dudoso.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      return { estado: 'incierto' }
    }
    const data = await response.json() as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number }; description?: string }
    if (response.ok && data.ok === true) return { estado: 'enviado' }
    if (data.ok !== false) return { estado: 'incierto' }
    if (data.error_code === 403 || (data.error_code === 400 && /chat not found|user is deactivated/i.test(data.description || ''))) return { estado: 'baja' }
    const delay = data.parameters?.retry_after
    return { estado: 'reintentar', espera: typeof delay === 'number' && Number.isFinite(delay) ? Math.max(60, Math.min(delay, 86400)) : 3600 }
  } catch { return { estado: 'incierto' } }
}
