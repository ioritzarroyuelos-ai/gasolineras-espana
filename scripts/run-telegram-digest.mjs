import { pathToFileURL } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

export async function runTelegramDigest(env, fetcher = fetch, options = {}) {
  if (!env.CRON_TOKEN) throw new Error('CRON_TOKEN no configurado')
  const dryRun = env.DRY_RUN === 'true'
  const totals = { ok: true, dryRun, batches: 0, processed: 0, work: 0, eligible: 0, sentChats: 0, sentMsgs: 0, skipped: 0, errors: 0, uncertain: 0, purged: 0 }
  const seen = new Set(), maxBatches = options.maxBatches || 200
  let cursor = null, failed = false
  for (let batch = 0; batch < maxBatches; batch++) {
    const url = new URL('https://webapp-3ft.pages.dev/api/cron/telegram-check')
    if (dryRun) url.searchParams.set('dry_run', '1')
    if (cursor) url.searchParams.set('cursor', cursor)
    let response
    try { response = await fetcher(url.href, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120000), headers: { Authorization: 'Bearer ' + env.CRON_TOKEN, Accept: 'application/json' } }) }
    catch { throw new Error('No se pudo completar la comprobación de precios. No se repite una llamada de resultado incierto.') }
    let data
    try {
      if (!response.body) throw Error()
      const reader = response.body.getReader(), chunks = []; let bytes = 0
      try { for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 16384) { await reader.cancel(); throw Error() } chunks.push(item.value) } }
      finally { reader.releaseLock() }
      const raw = new Uint8Array(bytes); let offset = 0
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length }
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
    } catch { throw new Error('Respuesta de los avisos de precios no válida') }
    if (!dryRun && typeof data.skipped === 'string') throw new Error('Avisos pendientes: la ejecución llegó fuera de la ventana local')
    if (dryRun && (data.dryRun !== true || data.sentChats !== 0 || data.sentMsgs !== 0 || data.purged !== 0)) throw new Error('La comprobación no confirmó el modo sin envío')
    if (![200, 503].includes(response.status) || typeof data.ok !== 'boolean' || data.dryRun !== dryRun || typeof data.inWindow !== 'boolean') throw new Error('Los avisos no terminaron correctamente (HTTP ' + response.status + ')')
    const limits = { processed: 1, chats: 1, work: 2, eligible: 1, sentChats: 1, sentMsgs: 2, skipped: 1, errors: 3, uncertain: 1, purged: 1, deferred: 1 }
    if (Object.entries(limits).some(([key, max]) => !Number.isInteger(data[key]) || data[key] < 0 || data[key] > max) || data.processed > data.chats || data.eligible > data.chats || data.sentChats > data.eligible || data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !/^[a-zA-Z0-9_-]{1,512}$/.test(data.nextCursor))) throw new Error('Contadores o continuación de precios no válidos')
    if (data.ok && (response.status !== 200 || data.errors || data.uncertain) || !data.ok && response.status !== 503) throw new Error('Estado de entrega de precios incoherente')
    totals.batches++
    for (const key of ['processed', 'work', 'eligible', 'sentChats', 'sentMsgs', 'skipped', 'errors', 'uncertain', 'purged']) totals[key] += data[key]
    failed ||= !data.ok
    if (data.nextCursor === null) {
      if (data.deferred) throw new Error('Quedan avisos pendientes sin continuación válida')
      if (failed) throw new Error('Hay avisos de precios pendientes o de entrega incierta. Se ha comprobado el resto de destinatarios.')
      return totals
    }
    if (seen.has(data.nextCursor) || data.processed === 0 && data.work === 0) throw new Error('La continuación de los avisos no avanza')
    seen.add(data.nextCursor); cursor = data.nextCursor
    // El servidor conserva el avance; respetamos una escritura/segundo en KV.
    if (!dryRun) await (options.pause || pause)(1100)
  }
  throw new Error('Se alcanzó el límite de lotes. El avance queda guardado y la comprobación debe continuar.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTelegramDigest(process.env).then(data => console.log(JSON.stringify(data)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
