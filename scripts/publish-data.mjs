// Publica únicamente datos mediante PR y pruebas reales; no necesita saltarse main.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const repo = process.env.GITHUB_REPOSITORY
const kind = process.argv[2]
if (process.env.GITHUB_REF !== 'refs/heads/main') throw Error('Los robots solo pueden publicar partiendo de main')
if (!repo || !['prices', 'guardias', 'politica', 'tiempo', 'itv', 'chargers', 'municipios', 'deportes'].includes(kind) || !/^\d+$/.test(process.env.GITHUB_RUN_ID || '')) throw Error('Contexto de publicación no válido')
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const git = args => run('git', args), gh = args => run('gh', [...args, '--repo', repo])
const files = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean)
const output = value => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=' + value + '\n') }
if (!files.length) { output(false); console.log('Sin cambios en los datos'); process.exit(0) }
if (files.some(f => !f.startsWith('public/data/'))) throw Error('El robot intentó publicar un fichero fuera de public/data')
if (!process.env.GH_TOKEN) throw Error('Falta la identidad de la aplicación del robot')
const branch = `datos/${kind}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT || '1'}`
git(['config', 'user.name', 'github-actions[bot]'])
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
git(['switch', '-c', branch])
const title = `chore(data): actualizar ${kind} ${new Date().toISOString().slice(0, 16)}Z`
git(['commit', '-m', title])
const sha = git(['rev-parse', 'HEAD'])
// checkout no conserva GITHUB_TOKEN. Git y gh usan la misma identidad de la App.
run('gh', ['auth', 'setup-git', '--hostname', 'github.com'])
git(['push', '--set-upstream', 'origin', branch])
const url = gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body', 'Actualización automática de datos oficiales. Solo se incorpora tras superar CI (tipos, pruebas, navegador y rendimiento) y Security. Si falla una fuente, se conserva su última copia válida.'])
console.log('Propuesta de datos: ' + url)
// La App dispara pull_request de forma nativa. Los checks de workflow_dispatch
// no satisfacen las reglas de una rama protegida, aunque salgan verdes.
for (let intento = 0; intento < 120; intento++) {
  const checks = ['ci.yml', 'security.yml'].map(workflow => {
    const rows = JSON.parse(gh(['run', 'list', '--workflow', workflow, '--branch', branch, '--commit', sha, '--event', 'pull_request', '--limit', '1', '--json', 'status,conclusion,databaseId']))
    return rows[0]
  })
  const failed = checks.find(c => c?.status === 'completed' && c.conclusion !== 'success')
  if (failed) throw Error(`Los datos quedan en el PR: comprobación ${failed.databaseId} ${failed.conclusion}`)
  if (checks.every(c => c?.status === 'completed' && c.conclusion === 'success')) {
    gh(['pr', 'merge', url, '--squash', '--delete-branch', '--match-head-commit', sha])
    output(true)
    console.log('Datos incorporados tras pasar todas las pruebas. CI → Deploy verificará y publicará main.')
    process.exit(0)
  }
  await new Promise(resolve => setTimeout(resolve, 20000))
}
throw Error('Las comprobaciones no terminaron en 40 minutos; se conserva el PR sin publicar datos sin validar.')
