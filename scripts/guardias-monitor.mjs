#!/usr/bin/env node
// guardias-monitor.mjs — avisa por Telegram si algun territorio de guardias no
// se ha refrescado en el ultimo pase diario.
//
// Lo invoca .github/workflows/fetch-guardias.yml JUSTO despues de los 47
// scrapers y del commit, leyendo los ficheros ya actualizados en el runner.
// Un scraper que falla NO reescribe su fichero, asi que su `ts` se queda con la
// fecha de un pase anterior. Regla: si la fecha (UTC) de `ts` no es la de hoy,
// ese territorio no se refresco en este pase -> se lista en el aviso.
//
// Es la contrapartida de la "red de seguridad" del sitio (src/lib/guardias.ts:
// frescuraGuardia): la pagina deja de mostrar el turno viejo como valido, y este
// monitor avisa para arreglar el scraper cuanto antes.
//
// Env vars (secrets del repo, los mismos que usa error-monitor):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// Best-effort: nunca sale con codigo !=0 por un fallo de envio, para no tumbar
// el workflow (los datos ya estan commiteados). Solo informa.

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '..', 'public', 'data')

// Mismo umbral que la web (GUARDIA_STALE_HORAS en src/lib/guardias.ts): un
// territorio esta "sin actualizar" si su ts tiene mas de 30 h (se salto el pase
// diario). Se mide por HORAS, no por fecha de calendario: si un pase cruza la
// medianoche UTC (scrapea a las 23:xx y el monitor corre a las 00:xx del dia
// siguiente), la fecha ya no coincide y daria un falso aviso de "todo viejo".
const STALE_HORAS = 30

// Lee todos los guardias-*.json y devuelve [{territorio, ts, fecha, dias, stale}].
function escanea() {
  const out = []
  for (const f of readdirSync(DATA_DIR)) {
    const m = /^guardias-(.+)\.json$/.exec(f)
    if (!m) continue
    let ts = null
    try { ts = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')).ts || null } catch { /* fichero corrupto */ }
    const t = ts ? Date.parse(ts) : NaN
    const fecha = Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null
    const horas = Number.isFinite(t) ? (Date.now() - t) / 3600000 : Infinity
    const dias = Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null
    out.push({ territorio: m[1], ts, fecha, dias, stale: horas > STALE_HORAS })
  }
  return out
}

function fmtFecha(iso) {
  if (!iso) return 'sin fecha'
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y.slice(2)}`
}

async function enviaTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    console.warn('::warning::TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados; no se envia aviso.')
    return
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
    })
    const j = await res.json().catch(() => ({}))
    if (!j.ok) console.warn('::warning::Telegram rechazo el aviso: ' + JSON.stringify(j).slice(0, 200))
    else console.log('[guardias-monitor] aviso enviado a Telegram.')
  } catch (e) {
    console.warn('::warning::No se pudo enviar el aviso a Telegram: ' + String(e).slice(0, 200))
  }
}

async function main() {
  const files = escanea()
  const total = files.length
  const viejos = files.filter(f => f.stale)
    .sort((a, b) => (b.dias ?? 1e9) - (a.dias ?? 1e9))

  if (viejos.length === 0) {
    console.log(`[guardias-monitor] ${total}/${total} territorios actualizados (<${STALE_HORAS} h). Sin aviso.`)
    return
  }

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const TOP = 25
  const lineas = viejos.slice(0, TOP).map(f =>
    `• ${f.territorio} — ${fmtFecha(f.fecha)}${f.dias != null ? ` (${f.dias} d)` : ''}`
  ).join('\n')
  const extra = viejos.length > TOP ? `\n(+${viejos.length - TOP} mas)` : ''
  const texto =
    `⚠️ ${ts}\n` +
    `Guardias sin actualizar (>${STALE_HORAS} h): ${viejos.length}/${total}\n\n` +
    `${lineas}${extra}\n\n` +
    `La pagina ya oculta estos turnos (aviso de caducado). Revisar los scrapers en fetch-guardias.yml.`

  console.log('[guardias-monitor]\n' + texto)
  await enviaTelegram(texto)
}

main().catch(e => {
  // Nunca tumbamos el workflow por el monitor.
  console.warn('::warning::guardias-monitor fallo: ' + String(e).slice(0, 200))
  process.exit(0)
})
