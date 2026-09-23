#!/usr/bin/env node
// politica-monitor.mjs — avisa por Telegram si el robot de política (fetch-politica)
// tuvo fallos o avisos en su último pase. Lo invoca .github/workflows/fetch-politica.yml
// como paso final (if: always()), leyendo politica-run.json que deja el robot.
//
// Contrapartida inmediata del error-monitor de 8 h (que además vigila la frescura
// del dato en producción). Aquí avisamos al instante de lo que falló en ESTE pase.
//
// Env vars (secrets del repo, los mismos que el resto de monitores):
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//   GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID (los pone Actions)
// Best-effort: nunca sale con código !=0 (los datos, si los hubo, ya se commitearon).

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUN = resolve(__dirname, '..', 'politica-run.json')

async function enviaTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chat = process.env.TELEGRAM_CHAT_ID
  if (!token || !chat) {
    console.warn('::warning::TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados; no se envía aviso.')
    return
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
    })
    const j = await res.json().catch(() => ({}))
    if (!j.ok) console.warn('::warning::Telegram rechazó el aviso: ' + JSON.stringify(j).slice(0, 200))
    else console.log('[politica-monitor] aviso enviado a Telegram.')
  } catch (e) {
    console.warn('::warning::No se pudo enviar el aviso: ' + String(e).slice(0, 200))
  }
}

function runLink() {
  const s = process.env.GITHUB_SERVER_URL, r = process.env.GITHUB_REPOSITORY, id = process.env.GITHUB_RUN_ID
  return s && r && id ? `\n${s}/${r}/actions/runs/${id}` : ''
}

async function main() {
  const ts = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

  if (!existsSync(RUN)) {
    await enviaTelegram(`⚠️ ${ts}\nRobot de política: no se generó parte (politica-run.json). El proceso falló antes de escribir datos.${runLink()}`)
    return
  }

  let run
  try {
    run = JSON.parse(readFileSync(RUN, 'utf8'))
  } catch {
    await enviaTelegram(`⚠️ ${ts}\nRobot de política: parte ilegible (politica-run.json corrupto).${runLink()}`)
    return
  }

  const fallos = run.fallos || []
  // Solo avisamos si hay fallos duros. Las "revisiones" (incidencias/caídas de
  // cobertura) se registran en el log del run, no saturan Telegram.
  if (fallos.length === 0) {
    console.log(`[politica-monitor] ${run.escritas}/${run.total} elecciones OK. Sin fallos; no se avisa.`)
    return
  }

  const TOP = 20
  const lineas = fallos.slice(0, TOP).map((f) => `• ${f.id} — ${f.motivo}`).join('\n')
  const extra = fallos.length > TOP ? `\n(+${fallos.length - TOP} más)` : ''
  const texto =
    `⚠️ ${ts}\n` +
    `Robot de política: ${fallos.length} elección(es) con fallo de ${run.total}.\n` +
    `Se conservó el último dato bueno de cada una.\n\n` +
    `${lineas}${extra}${runLink()}`

  console.log('[politica-monitor]\n' + texto)
  await enviaTelegram(texto)
}

main().catch((e) => {
  console.warn('::warning::politica-monitor falló: ' + String(e).slice(0, 200))
  process.exit(0)
})
