import { createRequire } from 'node:module'
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DATA_REPOSITORY } from './lib/data-clock-protocol.mjs'
import { githubDataRequest } from './lib/github-data-api.mjs'
import { derivaGatewayKey, gatewayCanonico, gatewayDigest, gatewayFirma, gatewayVerifica, gatewayValidaRespuesta, gatewayValidaChallenge, GATEWAY_PATH_CHECK, GATEWAY_SIGNATURE_HEADER } from './lib/disponibilidad-gateway.mjs'

const WORKER = 'espana-util-disponibilidad'
const ORIGIN = 'https://webapp-3ft.pages.dev'
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const flag = value => { if (!['true', 'false'].includes(value)) throw Error('Falta una decisión explícita de activación de disponibilidad'); return value === 'true' }
const gatewayReasons = new Set(['CREDENTIAL_INVALID', 'NETWORK', 'REDIRECT', 'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_409', 'HTTP_429', 'HTTP_503', 'HTTP_OTHER', 'RESPONSE_INVALID', 'SIGNATURE_INVALID', 'WORKER_PROOF_INVALID', 'TIMEOUT'])
const safeReason = error => typeof error?.code === 'string' && error.code.startsWith('GATEWAY_') && gatewayReasons.has(error.code.slice(8)) ? error.code : 'GATEWAY_UNCONFIRMED'
// Estos archivos admiten comentarios de línea completa; cualquier otra sintaxis
// no JSON falla antes de ejecutar Wrangler. No se evalúa código del archivo.
const readConfig = file => JSON.parse(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => !line.trimStart().startsWith('//')).join('\n'))

async function readJson(response, max, signal, raw = false) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > max) { await response.body?.cancel(); throw Error('Respuesta de comprobación no válida') }
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  let size = 0, text = ''
  try {
    while (true) {
      if (signal.aborted) throw Error('Consulta agotada')
      const next = await reader.read()
      if (signal.aborted) throw Error('Consulta agotada')
      if (next.done) break
      size += next.value.byteLength
      if (size > max) { abort(); throw Error('Respuesta demasiado grande') }
      text += decoder.decode(next.value, { stream: true })
    }
    const complete = text + decoder.decode()
    return raw ? complete : JSON.parse(complete)
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
}
export async function verificaBotDisponibilidad(env, io = {}) {
  const signal = AbortSignal.timeout(io.timeoutMs ?? 15000), fetcher = io.fetch || fetch
  const now = () => typeof io.now === 'function' ? io.now() : Date.now()
  let reason = 'CREDENTIAL_INVALID'
  try {
    const key = await derivaGatewayKey(env.CRON_TOKEN)
    const issuedAt = now()
    const body = { schema: 1, environment: 'production', op: 'check', nonce: crypto.randomUUID(), issuedAt, expiresAt: issuedAt + 30000 }
    const raw = gatewayCanonico(body), digest = await gatewayDigest(raw)
    const signature = await gatewayFirma(key, GATEWAY_PATH_CHECK, raw)
    reason = 'NETWORK'
    const response = await fetcher(ORIGIN + GATEWAY_PATH_CHECK, { method: 'POST', redirect: 'manual', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', [GATEWAY_SIGNATURE_HEADER]: signature }, body: raw })
    if (response.status !== 200) {
      const status = response.status
      reason = status >= 300 && status < 400 ? 'REDIRECT' : [400, 401, 403, 409, 429, 503].includes(status) ? 'HTTP_' + status : 'HTTP_OTHER'
      await response.body?.cancel(); throw Error('Pasarela no confirmada')
    }
    reason = 'RESPONSE_INVALID'
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw Error('Formato no confirmado')
    const received = await readJson(response, 4096, signal, true)
    reason = 'SIGNATURE_INVALID'
    if (!await gatewayVerifica(key, GATEWAY_PATH_CHECK, received, response.headers.get(GATEWAY_SIGNATURE_HEADER), 'response')) throw Error('Firma no confirmada')
    reason = 'RESPONSE_INVALID'
    const data = JSON.parse(received)
    if (received !== gatewayCanonico(data)) throw Error('Respuesta no canónica')
    const checked = gatewayValidaRespuesta(data, body, digest, now())
    if (!checked || checked.op !== 'check') throw Error('Respuesta no confirmada')
    reason = 'WORKER_PROOF_INVALID'
    if (!await gatewayValidaChallenge(key, checked.worker, body.nonce, io.expectedVersion, now()) || checked.worker.workerVersion !== checked.workerVersion) throw Error('Worker no confirmado')
    io.publicIdentity?.({ expectedUsername: checked.bot.expectedUsername, credentialUsername: checked.bot.credentialUsername })
    return { ok: true, versionId: checked.workerVersion, revision: checked.revision }
  } catch {
    const code = 'GATEWAY_' + (signal.aborted ? 'TIMEOUT' : reason)
    throw Object.assign(Error('No se pudo confirmar la pasarela del bot de la web [' + code + ']'), { code })
  }
}
async function cloudflare(env, path, fetcher) {
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN) throw Error('Cuenta de despliegue no válida')
  const signal = AbortSignal.timeout(15000)
  try {
    const response = await fetcher('https://api.cloudflare.com/client/v4/accounts/' + env.CLOUDFLARE_ACCOUNT_ID + '/workers/scripts' + path,
      { headers: { Authorization: 'Bearer ' + env.CLOUDFLARE_API_TOKEN }, redirect: 'manual', signal })
    const data = await readJson(response, 2 * 1024 * 1024, signal)
    if (data.success !== true) throw Error('Respuesta incorrecta')
    return data
  } catch { throw Error('Cloudflare no confirmó el estado del servicio de disponibilidad') }
}
export async function disponibilidadExiste(env, fetcher = fetch) {
  const data = await cloudflare(env, '', fetcher)
  if (!Array.isArray(data.result) || data.result.some(item => typeof item?.id !== 'string') || data.result_info?.total_pages > 1) throw Error('Inventario de Workers incompleto')
  return data.result.some(item => item.id === WORKER)
}
export async function disponibilidadVersion(env, fetcher = fetch) {
  const data = await cloudflare(env, '/' + WORKER + '/deployments', fetcher)
  const rows = data.result?.deployments
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !Number.isFinite(Date.parse(row.created_on)))) throw Error('No se pudo identificar la versión publicada')
  const latest = [...rows].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0]
  if (latest.versions?.length !== 1 || latest.versions[0].percentage !== 100 || !uuid(latest.versions[0].version_id)) throw Error('La versión publicada no es única')
  return latest.versions[0].version_id
}
function checkConfig(raw) {
  if (raw.name !== WORKER || raw.main !== 'workers/disponibilidad.mjs' || raw.workers_dev !== false || raw.preview_urls !== false ||
    raw.routes?.length || raw.route || raw.triggers?.crons?.length || raw.env || raw.containers ||
    raw.version_metadata?.binding !== 'WORKER_VERSION' || raw.observability?.traces?.enabled !== false ||
    JSON.stringify(raw.durable_objects?.bindings) !== JSON.stringify([{ name: 'DISPONIBILIDAD', class_name: 'DisponibilidadUsuario' }]) ||
    JSON.stringify(raw.migrations) !== JSON.stringify([{ tag: 'v1', new_sqlite_classes: ['DisponibilidadUsuario'] }])) throw Error('Configuración privada SQLite de disponibilidad no válida')
}
export async function deployDisponibilidad(env = process.env, io = {}) {
  const requestedEnabled = flag(env.DISPONIBILIDAD_ENABLED)
  let enabled = requestedEnabled, state = requestedEnabled ? 'ready' : 'paused', reason = null
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== DATA_REPOSITORY || !/^[a-f0-9]{40}$/.test(env.VALIDATED_SHA || '')) throw Error('Despliegue de disponibilidad fuera del CI autorizado')
  let gatewayKey
  const root = resolve(import.meta.dirname, '..'), config = resolve(root, 'wrangler.disponibilidad.jsonc'), raw = readConfig(config)
  checkConfig(raw)
  let checkout
  try {
    checkout = io.checkout ? io.checkout() : { sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      origin: execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim() }
  } catch { throw Error('No se pudo comprobar el checkout validado') }
  if (checkout.sha !== env.VALIDATED_SHA || !['https://github.com/' + DATA_REPOSITORY, 'https://github.com/' + DATA_REPOSITORY + '.git', 'git@github.com:' + DATA_REPOSITORY + '.git'].includes(checkout.origin)) throw Error('Checkout distinto del repositorio o commit validado')
  const api = io.request || githubDataRequest
  const assertMain = async () => { const current = await api('/repos/' + DATA_REPOSITORY + '/commits/main', { token: env.GH_TOKEN }); if (current.sha !== env.VALIDATED_SHA) throw Error('Main avanzó; no se publica el servicio anterior') }
  await assertMain()
  const ci = await api('/repos/' + DATA_REPOSITORY + '/actions/workflows/ci.yml/runs?branch=main&status=success&head_sha=' + env.VALIDATED_SHA + '&per_page=10', { token: env.GH_TOKEN })
  if (!ci.workflow_runs?.some(run => run.head_sha === env.VALIDATED_SHA && run.head_branch === 'main' && run.conclusion === 'success' && ['push', 'workflow_run', 'workflow_dispatch'].includes(run.event))) throw Error('Falta CI verde del commit exacto')
  if (requestedEnabled) {
    try { await (io.bot || verificaBotDisponibilidad)(env, { fetch: io.fetch }) }
    catch (error) { enabled = false; state = 'degraded'; reason = safeReason(error) }
  }
  if (state !== 'degraded') {
    try { gatewayKey = await derivaGatewayKey(env.CRON_TOKEN) }
    catch { enabled = false; state = 'degraded'; reason = 'GATEWAY_CREDENTIAL_INVALID' }
  }
  const exists = await (io.exists || disponibilidadExiste)(env)
  const cli = resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin/wrangler.js')
  const childEnv = { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'warn', WRANGLER_WRITE_LOGS: 'false' }
  for (const name of ['CRON_TOKEN', 'DISPONIBILIDAD_GATEWAY_KEY', 'TELEGRAM_BOT_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'DATA_APP_PRIVATE_KEY']) delete childEnv[name]
  const run = io.run || spawnSync
  const command = (args, input) => {
    let result
    try { result = run(process.execPath, [cli, ...args], { cwd: root, env: childEnv, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 }) }
    catch { throw Error('No se completó Wrangler para disponibilidad') }
    if (result.status !== 0) throw Error('No se completó Wrangler para disponibilidad (' + args[0] + ')')
  }
  const temp = resolve(root, '.tmp', 'disponibilidad-deploy.jsonc')
  mkdirSync(dirname(temp), { recursive: true })
  const prepared = { ...raw, main: resolve(root, raw.main) }; delete prepared.$schema
  const write = value => writeFileSync(temp, JSON.stringify({ ...prepared, vars: { ...raw.vars, DISPONIBILIDAD_ENABLED: value } }))
  try {
    // Una primera instalación no recibe secretos ni puede enviar mensajes.
    // En actualizaciones no se apaga el Worker previo como paso intermedio.
    if (!exists) { await assertMain(); write('false'); command(['deploy', '--config', temp]) }
    // La fase pausada prepara sólo la clave derivada, nunca la clave del bot.
    // Para activar, el preflight anterior debe probar la misma clave en Pages y Worker.
    if (state !== 'degraded') {
      await assertMain()
      write(exists ? String(enabled) : 'false')
      command(['secret', 'bulk', '--config', temp], JSON.stringify({ DISPONIBILIDAD_GATEWAY_KEY: gatewayKey }))
    }
    await assertMain()
    if (exists || enabled) { write(String(enabled)); command(['deploy', '--config', temp]) }
    const versionId = await (io.version || disponibilidadVersion)(env)
    if (!uuid(versionId)) throw Error('Versión de disponibilidad no válida')
    return { worker: WORKER, revision: env.VALIDATED_SHA, requestedEnabled, enabled, state, reason, versionId }
  } finally { try { unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
export async function verificaDisponibilidad(env = process.env, versionId, io = {}) {
  const enabled = flag(env.DISPONIBILIDAD_ENABLED)
  const state = env.DISPONIBILIDAD_STATE || (enabled ? 'ready' : 'paused')
  if (!['ready', 'paused', 'degraded'].includes(state) || enabled && state !== 'ready' || !enabled && state === 'ready') throw Error('Estado efectivo de disponibilidad no válido')
  if (!uuid(versionId)) throw Error('Versión esperada de disponibilidad no válida')
  const fetcher = io.fetch || fetch, sleep = io.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const signal = AbortSignal.timeout(10000)
      const response = await fetcher(ORIGIN + '/api/telegram/disponibilidad/config', { cache: 'no-store', redirect: 'manual', signal })
      const data = await readJson(response, 8192, signal)
      if (data.serviceVersion === versionId && data.manageAvailable === true && data.serviceEnabled === enabled && data.available === enabled) {
        if (state === 'degraded') return { versionId, enabled, state, reason: 'GATEWAY_UNCONFIRMED' }
        try {
          await (io.bot || verificaBotDisponibilidad)(env, { fetch: fetcher, expectedVersion: versionId })
          return { versionId, enabled, state, reason: null }
        } catch (error) {
          // A paused, version-confirmed service cannot send. Keep independent
          // data publications flowing and report that its connection is unready.
          if (!enabled) return { versionId, enabled, state: 'degraded', reason: safeReason(error) }
          throw error
        }
      }
    } catch { /* Se espera la propagación, sin crear objetos ni enviar mensajes. */ }
    if (attempt < 5) await sleep(10000)
  }
  throw Error('Pages no confirma la versión y el estado esperados de disponibilidad')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--check-bot' && process.argv.length === 3) {
    await verificaBotDisponibilidad(process.env, { publicIdentity: identity => console.log(JSON.stringify({ event: 'public-bot-identity', ...identity })) })
    console.log(JSON.stringify({ event: 'disponibilidad-bot-check', ok: true }))
  } else if (process.argv[2] === '--verify' && process.argv.length === 4) {
    const result = await verificaDisponibilidad(process.env, process.argv[3])
    if (result.state === 'degraded') console.log('::warning::Disponibilidad pausada: conexión no confirmada [' + result.reason + ']. El resto de datos puede actualizarse.')
    console.log(JSON.stringify({ event: 'disponibilidad-health', ...result }))
  } else if (process.argv.length === 2) {
    const result = await deployDisponibilidad()
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'version_id=' + result.versionId + '\nenabled=' + result.enabled + '\nstate=' + result.state + '\n')
    if (result.state === 'degraded') console.log('::warning::Disponibilidad pausada: conexión no confirmada [' + result.reason + ']. Se conserva la clave existente y no se habilitan envíos.')
    console.log(JSON.stringify({ event: 'disponibilidad-deploy', ...result }))
  } else throw Error('Argumentos de publicación de disponibilidad no válidos')
}
