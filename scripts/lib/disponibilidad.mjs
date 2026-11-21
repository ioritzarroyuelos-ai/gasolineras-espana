export const DISPONIBILIDAD_CONSENTIMIENTO = 'disponibilidad-telegram-v1'
export const DISPONIBILIDAD_INTERVALO = 5 * 60000
export const DISPONIBILIDAD_VENTANA = 60 * 60000
export const DISPONIBILIDAD_DIARIO_ESPERA = 30 * 60000
export const DISPONIBILIDAD_CAMBIOS_DIA = 12
export const DISPONIBILIDAD_RETENCION = 30 * 86400000
export async function disponibilidadSeudonimo(chat) {
  if (!Number.isSafeInteger(chat) || chat <= 0) throw Error('invalid_chat')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('espana-util:disponibilidad:v1:' + chat))
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')
}
const uuid = x => typeof x === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x)
const object = x => !!x && typeof x === 'object' && !Array.isArray(x)
const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export function disponibilidadMadrid(now = Date.now()) {
  const p = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]))
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }
}
export function disponibilidadIdentidad(fuente, id, objetivo) {
  if (typeof id !== 'string') return false
  if (fuente === 'aparcamientos-madrid') return /^parking-madrid-[1-9]\d{0,8}$/.test(id) && objetivo === 'plazas'
  if (fuente === 'aparcamientos-vigo') return /^parking-vigo-[1-9]\d{0,8}$/.test(id) && objetivo === 'plazas'
  return fuente === 'bicis-zaragoza' && /^gbfs-zaragoza-[a-zA-Z0-9_-]{1,100}$/.test(id) && ['bicis', 'anclajes'].includes(objetivo)
}
export function disponibilidadSolicitud(input, modo) {
  if (!object(input) || !['diario', 'temporal'].includes(modo) || Object.keys(input).some(k => !['fuente', 'lugarId', 'objetivo', 'hora', 'consentimiento', 'version', 'peticion'].includes(k))) return false
  return disponibilidadIdentidad(input.fuente, input.lugarId, input.objetivo) && input.consentimiento === DISPONIBILIDAD_CONSENTIMIENTO && uuid(input.version) && uuid(input.peticion) &&
    (modo === 'diario' ? typeof input.hora === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.hora) : input.hora === undefined)
}
/** Hora local explícita. En primavera se usa el primer minuto existente;
 * en otoño se elige la primera ocurrencia y el recibo diario evita repetir. */
export function disponibilidadProximoDiario(hora, now, diaExcluido = '') {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora) || !Number.isFinite(now)) throw Error('invalid_schedule')
  const today = disponibilidadMadrid(now).fecha
  for (let day = 0; day < 3; day++) {
    const date = new Date(Date.parse(today + 'T12:00:00Z') + day * 86400000).toISOString().slice(0, 10)
    if (date <= diaExcluido) continue
    const original = Date.parse(date + 'T' + hora + ':00Z')
    for (let shift = 0; shift <= 120; shift++) {
      const wanted = new Date(original + shift * 60000).toISOString().slice(11, 16)
      const matches = [120, 60, 0].map(offset => original + shift * 60000 - offset * 60000)
        .filter(candidate => { const part = disponibilidadMadrid(candidate); return part.fecha === date && part.hora === wanted })
      // Si la hora existe pero ya pasó, el siguiente día, no minutos después.
      if (matches.length) {
        const first = Math.min(...matches)
        if (first > now) return first
        break
      }
    }
  }
  throw Error('invalid_schedule')
}
export function disponibilidadClaveEvento(item, now) {
  return item.modo === 'diario' ? 'diario:' + disponibilidadMadrid(now).fecha : 'temporal:' + item.id
}
export function disponibilidadCifraVigente(item, now) {
  return item?.estado === 'actual' && Number.isSafeInteger(item.cantidad) && item.cantidad >= 0 && item.cantidad <= 100000 &&
    typeof item.fechaDato === 'string' && Number.isFinite(Date.parse(item.fechaDato)) && Date.parse(item.fechaDato) <= now &&
    typeof item.caduca === 'string' && Number.isFinite(Date.parse(item.caduca)) && Date.parse(item.caduca) > now &&
    Date.parse(item.caduca) - Date.parse(item.fechaDato) <= 6 * 60000
}
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
export function disponibilidadMensaje(item, ficha) {
  const label = item.objetivo === 'plazas' ? 'plazas libres totales' : item.objetivo === 'bicis' ? 'bicicletas para alquilar' : 'anclajes para devolver'
  const time = disponibilidadMadrid(Date.parse(ficha.fechaDato))
  return `🔔 <b>${item.modo === 'diario' ? 'Resumen diario de disponibilidad' : 'Disponibilidad encontrada'}</b>\n\n<b>${escape(ficha.nombre)}</b>\n${ficha.cantidad} ${label}.\nDato de la fuente: ${time.fecha.split('-').reverse().join('/')} a las ${time.hora} (hora peninsular).\n\n${item.objetivo === 'plazas' ? 'No indica plazas PMR libres. ' : ''}La disponibilidad puede cambiar durante el trayecto. No es una reserva.\n${escape(ficha.enlace)}\nFuente: ${escape(ficha.fuenteUrl)}\n\n${item.modo === 'temporal' ? 'Este aviso temporal termina aquí. ' : ''}Puedes cancelar sólo disponibilidad en «Gestionar mis avisos» de Cerca de ti. /stop cancela todos los avisos del bot.`
}
/** Sólo un rechazo explícito permite repetir. Una redirección o un cuerpo
 * desconocido puede ocultar una entrega ya aceptada por Telegram. */
export async function disponibilidadEnviar(bot, chat, text, request = fetch) {
  try {
    const signal = AbortSignal.timeout(10000)
    const response = await request(`https://api.telegram.org/bot${encodeURIComponent(bot)}/sendMessage`, {
      method: 'POST', redirect: 'manual', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const length = response.headers.get('content-length')
    if (response.status >= 300 && response.status < 400 || length !== null && (!/^\d+$/.test(length) || Number(length) > 16384) || !response.body) { await response.body?.cancel(); return { estado: 'incierto' } }
    const reader = response.body.getReader(); let raw = '', size = 0; const decoder = new TextDecoder('utf-8', { fatal: true })
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      for (;;) { if (signal.aborted) { abort(); return { estado: 'incierto' } }; const { done, value } = await reader.read(); if (signal.aborted) { abort(); return { estado: 'incierto' } }; if (done) break; size += value.byteLength; if (size > 16384) { abort(); return { estado: 'incierto' } }; raw += decoder.decode(value, { stream: true }) }
    } catch { abort(); return { estado: 'incierto' }
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
    const data = JSON.parse(raw + decoder.decode())
    if (response.status === 200 && data.ok === true && object(data.result) && Number.isSafeInteger(data.result.message_id) && data.result.message_id > 0 && object(data.result.chat) && data.result.chat.id === chat) return { estado: 'enviado' }
    // Esta función sólo consulta el endpoint fijo de Telegram. Un error del
    // gateway nunca pasa por aquí: su HTTP409 no demuestra rechazo del bot.
    // Ni un 5xx ni un cuerpo que contradiga HTTP permiten repetir el mensaje.
    if (response.status < 400 || response.status >= 500 || data.ok !== false || data.error_code !== response.status) return { estado: 'incierto' }
    if (data.error_code === 403 || data.error_code === 400 && typeof data.description === 'string' && /chat not found|user is deactivated/i.test(data.description)) return { estado: 'baja' }
    const delay = data.parameters?.retry_after
    return { estado: 'reintentar', espera: Number.isSafeInteger(delay) && delay > 0 ? Math.max(60, Math.min(delay, 86400)) : 300 }
  } catch { return { estado: 'incierto' } }
}
