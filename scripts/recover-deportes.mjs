import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validarIndiceDeportes } from './lib/deportes.mjs'
import { recuperaDeportesDesdePR } from './lib/deportes-recuperacion.mjs'

const out = fileURLToPath(new URL('../public/data/deportes/', import.meta.url)), ahora = Date.now()
const lee = ruta => JSON.parse(readFileSync(ruta, 'utf8'))
const indiceAnterior = validarIndiceDeportes(lee(join(out, 'index.json')), ahora)
const anteriores = indiceAnterior.competiciones.map(c => lee(join(out, c.id + '.json')))
if (process.env.DEPORTES_FFCV_NO_ANTES || process.env.DEPORTES_PORTALES_NO_ANTES) throw Error('La recuperación no puede combinarse con cambios de pausa de las fuentes')
const salida = await recuperaDeportesDesdePR({ seleccion: process.env.DEPORTES_RECUPERAR_PRS, desde: process.env.DEPORTES_RECUPERAR_DESDE, indiceAnterior, anteriores, token: process.env.GH_TOKEN, ahora })
if (!process.argv.includes('--dry-run') && salida.informe.apartadosRecuperados) {
  function escribe(ruta, dato) {
    mkdirSync(dirname(ruta), { recursive: true })
    writeFileSync(ruta + '.tmp', JSON.stringify(dato) + '\n'); renameSync(ruta + '.tmp', ruta)
  }
  // All snapshots and rebuilt pages are validated before touching public data.
  for (const c of salida.competiciones) escribe(join(out, c.id + '.json'), c)
  for (const [clave, eventos] of Object.entries(salida.agendas)) escribe(join(out, 'agenda', clave + '.json'), { eventos })
  escribe(join(out, 'index.json'), salida.indice)
}
console.log(JSON.stringify({ modo: 'recuperacion-sin-consultar-federaciones', ...salida.informe }))
