import { readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { obtieneFutbol } from './lib/deportes-futbol.mjs'
import { obtieneBaloncesto } from './lib/deportes-baloncesto.mjs'
import { obtieneMotor } from './lib/deportes-motor.mjs'
import { validarCompeticionDeportiva, conservaCompeticionDeportiva, validarIndiceDeportes, validarAgendaDeportes } from './lib/deportes.mjs'
import { construyeIndiceDeportes } from './lib/deportes-indice.mjs'
import { checkpointFFCV, recuperaEstadoFFCV, seleccionaFuentesDeportes } from './lib/deportes-checkpoint.mjs'
import { recuperaEstadoNovanet, checkpointNovanet, parseaPausasPortales } from './lib/deportes-novanet-estado.mjs'
import { conservaIncidenciasGrupos, conservaGrupoFueraDeTanda } from './lib/deportes-incidencias.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const out = resolve(process.env.DEPORTES_OUTPUT_DIR || join(root, 'public/data/deportes'))
const anteriorDir = resolve(process.env.DEPORTES_PREVIOUS_DIR || join(root, 'public/data/deportes'))
const fuentes = seleccionaFuentesDeportes(process.env.DEPORTES_FUENTES, process.env.DEPORTES_PROGRAMACION)
const checkpointPath = resolve(process.env.DEPORTES_CHECKPOINT_FFCV || join(root, '.tmp/deportes-ffcv-checkpoint.json'))
const checkpointNovanetDir = resolve(process.env.DEPORTES_CHECKPOINT_NOVANET || join(root, '.tmp/deportes-novanet'))
const ahora = Date.now(), fecha = new Date(ahora).toISOString()
const pausasPortales = parseaPausasPortales(process.env.DEPORTES_PORTALES_NO_ANTES)
function lee(path) { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
function escribe(path, data) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path + '.tmp', JSON.stringify(data) + '\n')
  renameSync(path + '.tmp', path)
}
let indiceAnterior = null
try { indiceAnterior = validarIndiceDeportes(lee(join(anteriorDir, 'index.json')), ahora) } catch { /* No previous index, or a corrupt copy: do not trust it. */ }
const estadoFFCV = recuperaEstadoFFCV([
  lee(join(anteriorDir, 'fuentes/ffcv.json')),
  ...(out !== anteriorDir ? [lee(join(out, 'fuentes/ffcv.json'))] : []),
  lee(checkpointPath),
], process.env.DEPORTES_FFCV_NO_ANTES)
const guardarEstadoFFCV = estado => {
  const limpio = checkpointFFCV(estado)
  // Checkpoint first: it survives a later validation/publication failure.
  escribe(checkpointPath, limpio)
  escribe(join(out, 'fuentes/ffcv.json'), limpio)
}
if (fuentes.has('futbol') || process.env.DEPORTES_FFCV_NO_ANTES) guardarEstadoFFCV(estadoFFCV)
// Cada portal conserva su punto de continuación; una interrupción no reinicia
// las consultas ni borra el descanso que haya solicitado la fuente.
const copiasNovanet = new Map()
for (const [dir, patron] of [
  [join(anteriorDir, 'fuentes'), /^novanet-([a-z0-9][a-z0-9-]{0,49})\.json$/],
  ...(out !== anteriorDir ? [[join(out, 'fuentes'), /^novanet-([a-z0-9][a-z0-9-]{0,49})\.json$/]] : []),
  [checkpointNovanetDir, /^([a-z0-9][a-z0-9-]{0,49})\.json$/],
]) {
  let archivos = []
  try { archivos = readdirSync(dir) } catch { /* Primera pasada de este portal. */ }
  for (const archivo of archivos) {
    const id = archivo.match(patron)?.[1]
    if (id) copiasNovanet.set(id, [...(copiasNovanet.get(id) || []), lee(join(dir, archivo))])
  }
}
const estadoNovanet = Object.fromEntries([...copiasNovanet].map(([id, copias]) => [id, recuperaEstadoNovanet(copias)]))
const guardarEstadoNovanet = (id, estado) => {
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(id)) throw Error('Portal de deportes no válido')
  const limpio = checkpointNovanet(estado)
  escribe(join(checkpointNovanetDir, id + '.json'), limpio)
  escribe(join(out, 'fuentes', 'novanet-' + id + '.json'), limpio)
  estadoNovanet[id] = limpio
}
// Persist every requested pause before readers, even when only motor is selected.
// Reusing the full recovered state also preserves cursors without a catalogue.
for (const [id, noConsultarAntes] of Object.entries(pausasPortales)) {
  const previo = estadoNovanet[id] || { version: 1 }
  guardarEstadoNovanet(id, recuperaEstadoNovanet([previo, { ...previo, noConsultarAntes }]))
}
const anteriores = new Map((indiceAnterior?.competiciones || []).flatMap(c => {
  if (!/^[a-z0-9][a-z0-9_-]{0,149}$/.test(c.id)) return []
  try { return [[c.id, validarCompeticionDeportiva(lee(join(anteriorDir, c.id + '.json')), ahora)]] } catch { return [] }
}))
const competiciones = new Map(), incidencias = (indiceAnterior?.incidencias || []).filter(i => !fuentes.has(i.deporte))
const gruposIntentados = new Set()
let bloquesActualizados = 0
for (const [deporte, obtiene] of [['futbol', obtieneFutbol], ['baloncesto', obtieneBaloncesto], ['motor', obtieneMotor]]) {
  if (!fuentes.has(deporte)) continue
  try {
    const salida = await obtiene({ ahora, log: console.log, estadoNovanet, guardarEstadoNovanet, ...(deporte === 'futbol' ? { estadoFFCV, guardarEstadoFFCV,
      gruposPublicadosFutbol: [...anteriores.values()].filter(c => c.deporte === 'futbol').map(c => c.id) } : {}) })
    for (const id of [...(salida.seguimientoGrupos?.intentados || []), ...(salida.seguimientoGrupos?.revisados || []), ...salida.incidencias.map(i => i.id).filter(Boolean)]) gruposIntentados.add(id)
    incidencias.push(...conservaIncidenciasGrupos((indiceAnterior?.incidencias || []).filter(i => i.deporte === deporte), salida.incidencias, salida.seguimientoGrupos))
    for (const c of salida.competiciones) {
      try {
        const validada = validarCompeticionDeportiva(c, Date.now())
        if (validada.deporte !== deporte || competiciones.has(validada.id)) throw Error('Identidad de competición no válida o repetida')
        bloquesActualizados += [validada.agenda, validada.clasificacion].filter(b => b.estado === 'actualizado').length
        competiciones.set(c.id, conservaCompeticionDeportiva(validada, anteriores.get(c.id)))
      } catch (error) {
        gruposIntentados.add(c.id)
        console.error(`${deporte}: competición rechazada ${c.id}: ${error.message}`)
        incidencias.push({ deporte, nombre: c.nombre || 'Competición no disponible', fuenteUrl: c.fuente?.url || 'https://webapp-3ft.pages.dev/deportes/', motivo: 'Los datos recibidos no han pasado la comprobación. Consulta la fuente mientras revisamos esta competición.' })
      }
    }
  } catch (error) {
    console.error(`${deporte}: ${error.message}`)
    incidencias.push({ deporte, nombre: 'Actualización de ' + deporte, fuenteUrl: 'https://webapp-3ft.pages.dev/deportes/', motivo: 'No se ha podido completar la consulta de las fuentes. Se conservan las copias anteriores con su fecha.' })
  }
}
for (const [id, c] of anteriores) if (!competiciones.has(id)) {
  if (!fuentes.has(c.deporte)) { competiciones.set(id, c); continue }
  competiciones.set(id, conservaGrupoFueraDeTanda(c, fecha, gruposIntentados))
}
// Un nombre descubierto en un catálogo no acredita partidos ni clasificación.
const lista = [...competiciones.values()].filter(c => c.agenda.verificadoEn || c.clasificacion.verificadoEn)
if (!lista.length || !bloquesActualizados) throw Error('Ninguna fuente deportiva actualizada; no se publica una copia vacía')
const construidos = construyeIndiceDeportes(lista, incidencias, Date.now())
const indice = validarIndiceDeportes(construidos.indice)
// Validate every page before writing any competition or agenda to the publish directory.
const agendas = Object.fromEntries(Object.entries(construidos.agendas).map(([clave, eventos]) => {
  const [zona, dia] = clave.split('/')
  return [clave, validarAgendaDeportes({ eventos }, indice, dia, zona)]
}))
for (const c of lista) escribe(join(out, c.id + '.json'), c)
for (const [dia, eventos] of Object.entries(agendas)) escribe(join(out, 'agenda', dia + '.json'), { eventos })
escribe(join(out, 'index.json'), indice)
console.log(JSON.stringify({ competiciones: lista.length, eventos: lista.reduce((n, c) => n + c.agenda.eventos.length, 0), tablas: lista.reduce((n, c) => n + c.clasificacion.tablas.length, 0), incidencias: incidencias.length, out }))
