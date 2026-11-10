import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { DATA_JOBS, necesitaRecuperacion } from './lib/data-recovery.mjs'
const repo = process.env.GITHUB_REPOSITORY
if (!repo || process.env.GITHUB_REF !== 'refs/heads/main') throw Error('La recuperación solo se ejecuta en main')
const gh = args => execFileSync('gh', [...args, '--repo', repo], {encoding:'utf8'}).trim()
const response = await fetch('https://webapp-3ft.pages.dev/data/service-manifest.json?recovery=' + Date.now(), {signal:AbortSignal.timeout(20000)})
if (!response.ok) throw Error('No se puede comprobar el estado publicado; no se lanzan reintentos a ciegas')
const manifest = await response.json()
if (manifest.schema !== 1 || !Array.isArray(manifest.services)) throw Error('Estado publicado no válido')
for (const job of DATA_JOBS) {
  const workflow = 'fetch-' + job.kind + '.yml'
  const runs = JSON.parse(gh(['run','list','--workflow',workflow,'--branch','main','--limit','10','--json','status,conclusion,createdAt']))
  const decision = necesitaRecuperacion(job, manifest, runs)
  const line = `${job.kind}: ${decision.reason}${decision.retry ? ' → nuevo intento' : ''}`
  console.log(line)
  if (decision.retry) gh(['workflow','run',workflow,'--ref','main'])
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '- '+line+'\n')
}
