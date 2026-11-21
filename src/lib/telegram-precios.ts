import type { Env } from '../index'
import { verifyTelegramToken } from './auth'
import { tgEscapeHtml, FUEL_LABEL } from './telegram'
import { validaIndicePreciosComparacion, validaBloquePreciosComparacion } from '../../scripts/lib/precios-comparacion.mjs'

export const PRECIOS_CONSENTIMIENTO = 'precios-telegram-v1'
export const PRECIOS_PREFIX = 'tg-precios:v1:'
export const PRECIOS_MAX_BYTES = 256 * 1024
export const PRECIOS_UMBRALES = [10, 20, 50, 100] as const
export const PRECIOS_COMBUSTIBLES = ['95', '98', 'diesel', 'diesel_plus'] as const
export type PreciosModo = 'resumen' | 'bajadas'
export type PreciosPreferencia = { version: 1; chat: number; modo: PreciosModo; umbralMilesimas: number; consentimiento: typeof PRECIOS_CONSENTIMIENTO; actualizado: string }
export type PreciosCaptura = { fechaFuente: string; fechaMinisterio: string; consultado: string }
export type PreciosValores = [number | null, number | null, number | null, number | null]
export type PreciosFila = [string, string, string, PreciosValores, PreciosValores]
export type PreciosPareja = { schema: 1; consultado: string; actual: PreciosCaptura; anterior: PreciosCaptura | null; filas: PreciosFila[] }
export type PreciosRecibo = { estado: 'enviado' | 'reintentar' | 'incierto'; intento: number; reintentarDesde?: number }
export type PreciosPlan = { version: 1; fuente: string; partes: string[]; creado: number }
export type PreciosTrabajo = { chat: number; fase: 'preparar' | 'enviar'; offset: number; id: string }
export type PreciosKv = NonNullable<Env['USER_DATA']>
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const iso = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x
const fail = (): never => { throw new Error('price_comparison_unavailable') }

export function preciosMadrid(now = Date.now()): { fecha: string; hora: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  return { fecha: `${parts.year}-${parts.month}-${parts.day}`, hora: Number(parts.hour) }
}
async function leeBytesPrecios(response: Response, maxBytes: number, requireOk = true): Promise<Uint8Array> {
  if (requireOk && !response.ok || !response.body) { await response.body?.cancel(); return fail() }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body.cancel(); return fail() }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); return fail() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
export async function cargaPreciosComparacion(env: Pick<Env, 'ASSETS'>, now = Date.now()) {
  const get = async (path: string) => {
    const request = new Request('https://webapp-3ft.pages.dev/data/precios-comparacion/' + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) })
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request)
  }
  const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  const index = decode(await leeBytesPrecios(await get('index.json'), 32 * 1024))
  if (!validaIndicePreciosComparacion(index, now)) return fail()
  const cache = new Map<string, PreciosFila[]>()
  return {
    snapshotId: index.snapshotId as string,
    pareja: { schema: 1, consultado: index.consultado, actual: index.actual, anterior: index.anterior, filas: [] } as PreciosPareja,
    async estaciones(ids: string[]): Promise<PreciosPareja> {
      const wanted = new Set(ids.filter(id => /^[1-9]\d{0,8}$/.test(id))), buckets = new Set([...wanted].map(id => String(Number(id) % 32).padStart(2, '0')))
      for (const bucket of buckets) if (!cache.has(bucket)) {
        const descriptor = index.shards[bucket], bytes = await leeBytesPrecios(await get(descriptor.archivo), Math.min(descriptor.bytes, PRECIOS_MAX_BYTES))
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(n => n.toString(16).padStart(2, '0')).join('')
        if (bytes.byteLength !== descriptor.bytes || hash !== descriptor.sha256) return fail()
        const block = decode(bytes)
        if (!validaBloquePreciosComparacion(block, index, bucket)) return fail()
        cache.set(bucket, block.filas)
      }
      const filas = [...buckets].flatMap(bucket => cache.get(bucket) || []).filter(row => wanted.has(row[0]))
      // Cada bloque ya fue validado contra su hash y la identidad de la captura.
      return { schema: 1, consultado: index.consultado, actual: index.actual, anterior: index.anterior, filas }
    },
  }
}
export async function preciosHash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('')
}
export const preciosUsuario = (chat: number) => preciosHash('espana-util:precios-telegram:v1:' + chat)
export const preciosPreferenciaKey = (usuario: string) => PRECIOS_PREFIX + 'preferencia:' + usuario
export async function preciosLeer<T>(kv: PreciosKv, key: string): Promise<T | null> {
  const raw = await kv.get(key)
  if (raw === null) return null
  if (typeof raw !== 'string') throw new Error('invalid_price_record')
  return JSON.parse(raw) as T
}
export function preciosPreferenciaValida(value: unknown): value is PreciosPreferencia {
  if (!object(value)) return false
  return value.version === 1 && Number.isSafeInteger(value.chat) && Number(value.chat) > 0 && typeof value.modo === 'string' && ['resumen', 'bajadas'].includes(value.modo) && PRECIOS_UMBRALES.includes(value.umbralMilesimas as 10) && value.consentimiento === PRECIOS_CONSENTIMIENTO && iso(value.actualizado)
}
export async function preciosPreferencia(kv: PreciosKv, chat: number): Promise<PreciosPreferencia | null> {
  const value = await preciosLeer<PreciosPreferencia>(kv, preciosPreferenciaKey(await preciosUsuario(chat)))
  if (value !== null && (!preciosPreferenciaValida(value) || value.chat !== chat)) throw new Error('invalid_price_preference')
  return value
}
export async function preciosChat(header: string | undefined, env: Env): Promise<number | null> {
  const token = /^Bearer\s+(.+)$/i.exec(header || '')?.[1]?.trim()
  if (!token) return null
  const chat = await verifyTelegramToken(token, env.SESSION_SECRET || env.TELEGRAM_BOT_TOKEN || '')
  return Number.isSafeInteger(chat) && chat! > 0 ? chat : null
}
export async function borrarPreferenciaPrecios(env: Pick<Env, 'USER_DATA'>, chat: number): Promise<void> {
  if (!env.USER_DATA) throw new Error('price_preferences_unavailable')
  await env.USER_DATA.delete(preciosPreferenciaKey(await preciosUsuario(chat)))
  // Los recibos pseudónimos caducan en 3 días y evitan repetir entregas en vuelo.
}
export function preciosReciboValido(value: unknown): value is PreciosRecibo {
  return object(value) && ['enviado', 'reintentar', 'incierto'].includes(String(value.estado)) && Number.isFinite(value.intento) && (value.reintentarDesde === undefined || Number.isFinite(value.reintentarDesde))
}
export function preciosPlanValido(value: unknown): value is PreciosPlan {
  return object(value) && value.version === 1 && typeof value.fuente === 'string' && value.fuente.length <= 150 && Number.isFinite(value.creado) && Array.isArray(value.partes) && value.partes.length > 0 && value.partes.length <= 12 && value.partes.every(x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x))
}
const fechaTexto = (x: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(new Date(x))
const euros = (n: number) => (n / 1000).toFixed(3).replace('.', ',')
function textoMensaje(value: string, max: number): string {
  let text = ''
  for (const char of value) { const escaped = tgEscapeHtml(char); if (text.length + escaped.length > max) return text + '…'; text += escaped }
  return text
}
export function mensajesPrecios(pareja: PreciosPareja, subs: Array<{ station_id: string; fuel_code: string }>, preference: PreciosPreferencia | null): string[] {
  const modo = preference?.modo || 'resumen', threshold = preference?.umbralMilesimas || 10
  if (modo === 'bajadas' && !pareja.anterior) throw new Error('price_reference_unavailable')
  const byId = new Map(pareja.filas.map(row => [row[0], row])), seen = new Set<string>(), lines: string[] = []
  for (const sub of subs) {
    const row = byId.get(sub.station_id), fuel = PRECIOS_COMBUSTIBLES.indexOf(sub.fuel_code as '95'), key = sub.station_id + ':' + sub.fuel_code
    if (!row || fuel < 0 || seen.has(key)) continue
    seen.add(key)
    const actual = row[3][fuel], anterior = row[4][fuel]
    if (modo === 'bajadas' && (actual === null || anterior === null || anterior - actual < threshold)) continue
    const name = textoMensaje(row[1], 90), town = textoMensaje(row[2], 70), label = FUEL_LABEL[sub.fuel_code]
    lines.push(`⛽ <b>${name}</b>${town ? ' — ' + town : ''}\n${label}: ${actual === null ? '<i>sin precio publicado</i>' : '<b>' + euros(actual) + ' €/L</b>'}` +
      (modo === 'bajadas' ? `\nAntes ${euros(anterior!)} €/L · baja ${((anterior! - actual!) / 10).toFixed(1).replace('.', ',')} céntimos/L` : ''))
  }
  if (!lines.length) return []
  const header = modo === 'bajadas' ? `📉 <b>Bajadas en tus gasolineras</b>\nComparación entre ${fechaTexto(pareja.anterior!.fechaFuente)} y ${fechaTexto(pareja.actual.fechaFuente)} (hora peninsular).\n\n`
    : `📋 <b>Tus gasolineras</b>\nPrecios de la fuente: ${fechaTexto(pareja.actual.fechaFuente)} (hora peninsular).\n\n`
  const footer = '\n\nConsulta /precios cuando quieras · /stop cancela todos los avisos del bot.'
  const chunks: string[] = []; let current = ''
  for (const line of lines) {
    const next = current ? current + '\n\n' + line : line
    if (next.length > 3000 && current) { chunks.push(current); current = line } else current = next
  }
  if (current) chunks.push(current)
  if (chunks.length > 12) throw new Error('too_many_price_messages')
  return chunks.map((x, i) => (i === 0 ? header : '') + x + (i === chunks.length - 1 ? footer : ''))
}
/** Sin reintento ciego: sendMessage no ofrece clave de idempotencia. */
export async function enviarPreciosTelegram(bot: string, chat: number, text: string): Promise<{ estado: 'enviado' | 'reintentar' | 'incierto' | 'baja'; espera?: number }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(bot)}/sendMessage`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }) })
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { estado: 'incierto' } }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await leeBytesPrecios(response, 16384, false))) as { ok?: boolean; error_code?: number; parameters?: { retry_after?: number }; description?: string }
    if (response.ok && data.ok === true) return { estado: 'enviado' }
    if (data.ok !== false) return { estado: 'incierto' }
    if (data.error_code === 403 || (data.error_code === 400 && /chat not found|user is deactivated/i.test(data.description || ''))) return { estado: 'baja' }
    const delay = data.parameters?.retry_after
    return { estado: 'reintentar', espera: typeof delay === 'number' && Number.isFinite(delay) ? Math.max(60, Math.min(delay, 86400)) : 3600 }
  } catch { return { estado: 'incierto' } }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function cursorKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('precios-cursor:v1:' + secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function preciosCursor(after: number, secret: string, fecha: string, failed = false, trabajo?: PreciosTrabajo): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)), key = await cursorKey(secret)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ after, fecha, failed, ...(trabajo ? { trabajo } : {}) }))))
  const bytes = new Uint8Array(iv.length + ciphertext.length); bytes.set(iv); bytes.set(ciphertext, iv.length)
  return b64(bytes)
}
export async function preciosLeeCursor(cursor: string | undefined, secret: string, fecha: string): Promise<{ after: number; failed: boolean; trabajo?: PreciosTrabajo }> {
  if (!cursor) return { after: 0, failed: false }
  if (cursor.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw new Error('invalid_cursor')
  try {
    const bytes = Uint8Array.from(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)), key = await cursorKey(secret)
    const data = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))))
    if (!Number.isSafeInteger(data.after) || data.after < 0 || data.fecha !== fecha || typeof data.failed !== 'boolean') throw new Error('invalid_cursor')
    const work = data.trabajo
    if (work !== undefined && (!object(work) || !Number.isSafeInteger(work.chat) || Number(work.chat) <= data.after || !['preparar', 'enviar'].includes(String(work.fase)) || !Number.isInteger(work.offset) || Number(work.offset) < 0 || Number(work.offset) > (work.fase === 'preparar' ? 32 : 12) || typeof work.id !== 'string' || !/^[a-f0-9]{64}$/.test(work.id))) throw new Error('invalid_cursor')
    if (data.after === 0 && !work) throw new Error('invalid_cursor')
    return { after: data.after, failed: data.failed, ...(work ? { trabajo: work as unknown as PreciosTrabajo } : {}) }
  } catch { throw new Error('invalid_cursor') }
}
