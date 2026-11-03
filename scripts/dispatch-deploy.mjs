// Los configuradores usan el mismo despliegue validado y serializado que producción.
import { execFileSync } from 'node:child_process'
const repo = process.env.GITHUB_REPOSITORY
if (!repo) throw Error('Falta GITHUB_REPOSITORY')
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const sha = gh(['api', `repos/${repo}/commits/main`, '--jq', '.sha'])
const green = JSON.parse(gh(['run', 'list', '--repo', repo, '--workflow=ci.yml', '--branch=main', '--commit=' + sha, '--status=success', '--limit=1', '--json=databaseId']))
if (!green.length) throw Error('El main actual todavía no tiene CI verde. Ejecuta CI y vuelve a configurar.')
if (!process.argv.includes('--check')) {
  const started = Date.now() - 2000
  gh(['workflow', 'run', 'deploy.yml', '--repo', repo, '--ref=main'])
  for (let i = 0; i < 90; i++) {
    const runs = JSON.parse(gh(['run', 'list', '--repo', repo, '--workflow=deploy.yml', '--branch=main', '--event=workflow_dispatch', '--commit=' + sha, '--limit=5', '--json=databaseId,createdAt,status,conclusion']))
    const run = runs.find(r => Date.parse(r.createdAt) >= started)
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw Error(`Deploy ${run.databaseId}: ${run.conclusion}`)
      console.log(`Despliegue centralizado completado: ${run.databaseId}`)
      process.exit(0)
    }
    await new Promise(resolve => setTimeout(resolve, 10000))
  }
  throw Error('El despliegue no terminó dentro del plazo; comprueba el workflow Deploy antes de continuar.')
}
console.log('El main actual tiene un artefacto validado.')
