import { pathToFileURL } from 'node:url'

export async function runTelegramDigest(env, fetcher = fetch) {
  if (!env.CRON_TOKEN) throw new Error('CRON_TOKEN no configurado')
  const dryRun = env.DRY_RUN === 'true'
  const response = await fetcher('https://webapp-3ft.pages.dev/api/cron/telegram-check' + (dryRun ? '?dry_run=1' : ''), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Authorization: 'Bearer ' + env.CRON_TOKEN, Accept: 'application/json' },
  })
  let data
  try { data = await response.json() } catch { throw new Error('Respuesta del resumen no válida') }
  if (!response.ok || data.ok !== true) throw new Error('El resumen no terminó correctamente (HTTP ' + response.status + ')')
  if (!dryRun && typeof data.skipped === 'string') throw new Error('Resumen pendiente: la ejecución llegó fuera de la ventana local')
  if (dryRun && (data.dryRun !== true || data.sentChats !== 0 || data.sentMsgs !== 0)) throw new Error('La comprobación no confirmó el modo sin envío')
  return data
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTelegramDigest(process.env).then(data => console.log(JSON.stringify(data)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
