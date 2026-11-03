import { monitorMessage } from './lib/monitor-message.mjs'
const { CRON_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env
const origin = process.env.PUBLIC_ORIGIN || 'https://webapp-3ft.pages.dev'
async function json(url, options = {}, allowDegraded = false) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
  if (!res.ok && !(allowDegraded && res.status === 503)) throw new Error(`Consulta rechazada (HTTP ${res.status})`)
  return res.json()
}
async function main() {
  if (!CRON_TOKEN || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) throw new Error('Falta configuración del monitor')
  const headers = { Authorization: `Bearer ${CRON_TOKEN}` }
  const errors = await json(`${origin}/api/admin/errors?unnotified=1&limit=100`, { headers })
  let status = null
  try { status = await json(`${origin}/api/status`, {}, true) } catch { console.warn('No se pudo consultar el estado del servicio') }
  const message = monitorMessage(errors.errors, status, new Date().toISOString(), origin)
  const sent = await json(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, disable_web_page_preview: true }),
  })
  if (sent.ok !== true) throw new Error('Telegram no confirmó la entrega')
  const fingerprints = errors.errors.map(e => e.fingerprint)
  if (fingerprints.some(f => !/^[a-f0-9]{1,16}$/.test(f))) throw new Error('Identificadores de error inválidos')
  if (fingerprints.length) {
    const q = new URLSearchParams({ fingerprints: fingerprints.join(','), before: String(Date.parse(errors.ts)) })
    await json(`${origin}/api/admin/errors/ack?${q}`, { method: 'POST', headers })
  }
  console.log(`Monitor entregado; ${fingerprints.length} errores reconocidos`)
}
main().catch(() => { console.error('ERROR: el monitor no pudo completar la consulta, el envío o el reconocimiento; no se muestran credenciales.'); process.exitCode = 1 })
