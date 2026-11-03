#!/usr/bin/env node
// Redeploy del main ya validado, exclusivamente a través de GitHub Actions.
// Los cambios de código se publican mediante PR y sus comprobaciones obligatorias.
import { execFileSync } from 'node:child_process'
if (process.argv.length > 2) throw Error('Para publicar cambios, crea un PR desde tu rama y espera las comprobaciones. npm run ship sin argumentos vuelve a publicar el main validado.')
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('Hay cambios locales sin publicar. Abre un PR antes de ejecutar ship; no se publicará esta copia local.')
process.env.GITHUB_REPOSITORY ||= 'ioritzarroyuelos-ai/gasolineras-espana'
await import('./dispatch-deploy.mjs')
