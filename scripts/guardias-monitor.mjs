#!/usr/bin/env node
// guardias-monitor.mjs — avisa por Telegram si algun territorio de guardias no
// se ha refrescado en el ultimo pase diario.
//
// Lo invoca .github/workflows/fetch-guardias.yml JUSTO despues de los 47
// scrapers y del commit, leyendo los ficheros ya actualizados en el runner.
// Un scraper puede conservar su copia anterior o publicar cobertura parcial.
// Se avisa tanto de antigüedad excesiva como de incidencias pendientes: una
// consulta reciente no prueba que se haya recuperado toda la provincia.
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
import { evaluaGuardiaMonitor, GUARDIAS_MONITOR_HORAS } from './lib/guardias-monitor.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '..', 'public', 'data')

// Mismo umbral que la web (GUARDIA_STALE_HORAS en src/lib/guardias.ts): un
// territorio esta "sin actualizar" si su ts tiene mas de 30 h (se salto el pase
// diario). Se mide por HORAS, no por fecha de calendario: si un pase cruza la
// medianoche UTC (scrapea a las 23:xx y el monitor corre a las 00:xx del dia
// siguiente), la fecha ya no coincide y daria un falso aviso de "todo viejo".
const STALE_HORAS = GUARDIAS_MONITOR_HORAS

// Lee todos los guardias-*.json y devuelve [{territorio, ts, fecha, dias, stale}].
function escanea() {
  const out = []
  for (const f of readdirSync(DATA_DIR)) {
    const m = /^guardias-(.+)\.json$/.exec(f)
    if (!m) continue
    let data = null
    try { data = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')) } catch { /* fichero corrupto */ }
    out.push({ territorio: m[1], ...evaluaGuardiaMonitor(data) })
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
  const parciales = files.filter(f => f.parcial)
  const pendientes = [...viejos, ...parciales.filter(f => !f.stale)]

  if (pendientes.length === 0) {
    console.log(`[guardias-monitor] ${total}/${total} territorios recientes (<${STALE_HORAS} h), sin incidencias declaradas. Sin aviso.`)
    return
  }

  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  const TOP = 25
  const lineas = pendientes.slice(0, TOP).map(f =>
    `• ${f.territorio} — ${fmtFecha(f.fecha)}${f.stale ? ' · sin actualizar' : ''}${f.parcial ? ' · cobertura parcial o incidencia pendiente' : ''}`
  ).join('\n')
  const extra = pendientes.length > TOP ? `\n(+${pendientes.length - TOP} mas)` : ''
  const texto =
    `⚠️ ${ts}\n` +
    `Guardias pendientes: ${pendientes.length}/${total}. Sin actualizar: ${viejos.length}; con incidencias: ${parciales.length}.\n\n` +
    `${lineas}${extra}\n\n` +
    `Una consulta reciente no garantiza cobertura completa. Revisar los avisos de cada fuente y los scrapers en fetch-guardias.yml.`

  console.log('[guardias-monitor]\n' + texto)
  await enviaTelegram(texto)
}

main().catch(e => {
  // Nunca tumbamos el workflow por el monitor.
  console.warn('::warning::guardias-monitor fallo: ' + String(e).slice(0, 200))
  process.exit(0)
})
