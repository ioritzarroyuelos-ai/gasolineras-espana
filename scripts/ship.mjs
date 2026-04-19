#!/usr/bin/env node
// scripts/ship.mjs — el unico comando que necesitas para llevar local a prod.
//
// Uso:
//   npm run ship -- "mi mensaje de commit"
//   npm run ship                                # sin cambios: empty commit + redeploy
//
// Flujo:
//   1. `git add -A` + commit (si hay cambios) / empty commit (si no)
//   2. `git push origin main`
//   3. Espera a que CI (typecheck + tests + build + E2E + Lighthouse) pase
//   4. Espera a que Deploy (migraciones D1 + Pages + smoke /api/health) pase
//   5. Sonda final a /api/health para confirmar prod viva
//
// Exit code != 0 si falla cualquier paso. Si CI o Deploy rompen, el script
// se detiene y te deja el run_id para abrirlo en GitHub.
//
// Requisitos: `gh` autenticado (`gh auth status`) y `curl` en el PATH. Ambos
// vienen preinstalados en Git for Windows, macOS (gh via brew) y Linux.

import { spawnSync } from 'node:child_process'

const REPO_BRANCH = 'main'
const DEPLOY_URL  = 'https://webapp-3ft.pages.dev'

// ---- Helpers ----
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function runOut(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '')
    process.exit(r.status ?? 1)
  }
  return r.stdout
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Polling: espera a que aparezca un run del `workflow` para el `commit` dado.
// Reintenta cada 4s con dots hasta `timeoutSec`. Github tarda ~10-20s en
// registrar los runs despues del push — por eso hay que esperar.
async function waitForRun({ workflow, commit, label, timeoutSec = 180 }) {
  const start = Date.now()
  while ((Date.now() - start) / 1000 < timeoutSec) {
    const out = runOut('gh', [
      'run', 'list',
      '--workflow', workflow,
      '--branch', REPO_BRANCH,
      '--limit', '10',
      '--json', 'databaseId,headSha,status',
    ])
    const runs = JSON.parse(out)
    const mine = runs.find(r => r.headSha === commit)
    if (mine) return mine.databaseId
    process.stdout.write('.')
    await sleep(4000)
  }
  console.error(`\n[ship] ${label} no aparecio tras ${timeoutSec}s — abortando.`)
  process.exit(1)
}

// ---- Main ----
const rawArgs = process.argv.slice(2).join(' ').trim()
const msg = rawArgs || `chore: redeploy ${new Date().toISOString().replace(/[:.]/g, '-')}`

// Paso 1: commit
const status = runOut('git', ['status', '--porcelain'])
if (status.trim()) {
  console.log('[ship] Cambios detectados — stage + commit')
  run('git', ['add', '-A'])
  run('git', ['commit', '-m', msg])
} else {
  console.log('[ship] Sin cambios — empty commit para reactivar el pipeline')
  run('git', ['commit', '--allow-empty', '-m', msg])
}

// Paso 2: push
console.log('[ship] Push a origin/' + REPO_BRANCH)
run('git', ['push', 'origin', REPO_BRANCH])

const sha = runOut('git', ['rev-parse', 'HEAD']).trim()
console.log(`\n[ship] Commit ${sha.slice(0, 7)} en remoto. Siguiendo el pipeline...\n`)

// Paso 3: CI
process.stdout.write('[ship] Esperando a que CI arranque')
const ciId = await waitForRun({ workflow: 'ci.yml', commit: sha, label: 'CI' })
console.log(`\n[ship] CI run: ${ciId}`)
run('gh', ['run', 'watch', String(ciId), '--exit-status', '--interval', '5'])

// Paso 4: Deploy (se dispara via workflow_run solo si CI quedo verde)
process.stdout.write('\n[ship] Esperando a que Deploy arranque')
const deployId = await waitForRun({ workflow: 'deploy.yml', commit: sha, label: 'Deploy' })
console.log(`\n[ship] Deploy run: ${deployId}`)
run('gh', ['run', 'watch', String(deployId), '--exit-status', '--interval', '5'])

// Paso 5: sonda final
console.log('\n[ship] Deploy verde. Sonda final a /api/health:')
run('curl', ['-fsS', '--max-time', '10', `${DEPLOY_URL}/api/health`])
console.log('\n\n[ship] OK — cambio en prod.')
console.log(`[ship] URL:    ${DEPLOY_URL}`)
console.log(`[ship] Commit: ${sha}`)
