// Solo el job de Lighthouse: datos de prueba locales, nunca el artefacto publicado.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fechaHoraLocal } from './lib/fechas.mjs'
const root = resolve('dist')
if (!existsSync(resolve(root, '_worker.js'))) throw Error('Falta el artefacto local de prueba')
const hoy = fechaHoraLocal(new Date()).slice(0, 10)
const manana = fechaHoraLocal(new Date(Date.now() + 86400000)).slice(0, 10)
const guardias = [[40.4168, -3.7038, 'Farmacia de prueba de Lighthouse', 'MADRID', '', '28013',
  hoy + ' 00:00-' + manana + ' 00:00', 'Guardia de prueba']]
mkdirSync(resolve(root, 'data'), { recursive: true })
writeFileSync(resolve(root, 'data/guardias-madrid.json'), JSON.stringify({
  ts: new Date().toISOString(), source: 'fixture local de Lighthouse', territorio: 'madrid', count: 1,
  schema: ['lat','lng','direccion','poblacion','telefono','cp','horarioGuardia','horarioGuardiaDesc'], guardias,
}))
console.log('Lighthouse: escenario municipal con guardia vigente; no se modifica public/data ni el artefacto de producción.')
