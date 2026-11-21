import { pathToFileURL } from 'node:url'

async function readBatch(response) {
  if (![200, 503].includes(response.status) || !response.body) throw Error('El recordatorio no devolvió un lote comprobable')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let text = '', size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > 16384) { await reader.cancel(); throw Error('El lote de recordatorios supera el límite') }
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch { throw Error('Respuesta de recordatorios no válida') }
  finally { reader.releaseLock() }
}

export async function runTelegramItv(env, fetcher = fetch, maxBatches = 200) {
  if (!env.CRON_TOKEN) throw Error('CRON_TOKEN no configurado')
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 200) throw Error('Límite de lotes no válido')
  const dryRun = env.DRY_RUN === 'true', seen = new Set()
  const totals = { dryRun, batches: 0, processed: 0, eligible: 0, sent: 0, skipped: 0, errors: 0, uncertain: 0 }
  let cursor = null
  for (let n = 0; n < maxBatches; n++) {
    const url = new URL('https://webapp-3ft.pages.dev/api/cron/telegram-itv')
    if (dryRun) url.searchParams.set('dry_run', '1')
    if (cursor) url.searchParams.set('cursor', cursor)
    let response
    try { response = await fetcher(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: 'Bearer ' + env.CRON_TOKEN, Accept: 'application/json' } }) }
    catch { throw Error('No se pudo comprobar la entrega de recordatorios; el siguiente intento conservará los recibos existentes') }
    const data = await readBatch(response)
    if (data.dryRun !== dryRun || typeof data.inWindow !== 'boolean' || typeof data.ok !== 'boolean') throw Error('El lote no confirma su modo de ejecución')
    if (!dryRun && !data.inWindow) throw Error('Recordatorios pendientes: fuera de la ventana local')
    for (const key of ['processed', 'eligible', 'sent', 'skipped', 'errors', 'uncertain']) {
      if (!Number.isInteger(data[key]) || data[key] < 0 || data[key] > 5) throw Error('Contadores de recordatorios no válidos')
      totals[key] += data[key]
    }
    if (dryRun && data.sent !== 0) throw Error('La comprobación no confirmó cero envíos')
    if (data.sent > data.eligible || data.eligible > data.processed || data.processed > 5) throw Error('El lote excede los destinatarios comprobados')
    if ((!data.ok || response.status === 503) && data.errors + data.uncertain === 0) throw Error('Fallo de recordatorios sin detalle comprobable')
    totals.batches++
    cursor = data.nextCursor
    if (cursor === null) {
      if (totals.errors || totals.uncertain) throw Error('Recordatorios pendientes: ' + totals.errors + ' errores y ' + totals.uncertain + ' entregas sin confirmación')
      return totals
    }
    if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || seen.has(cursor)) throw Error('No se puede continuar la paginación de recordatorios')
    seen.add(cursor)
  }
  throw Error('Quedan recordatorios por revisar tras el límite de lotes; el reloj reintentará los pendientes')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTelegramItv(process.env).then(data => console.log(JSON.stringify(data)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
