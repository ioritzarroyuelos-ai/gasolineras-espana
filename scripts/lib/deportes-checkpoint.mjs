import { normalizaEstadoFFCV } from './deportes-ffcv-estado.mjs'

export const HORARIO_DEPORTES_COMPLETO = '23 */4 * * *'
export const HORARIO_DEPORTES_FUTBOL = '23 1-3,5-7,9-11,13-15,17-19,21-23 * * *'
const deportes = ['futbol', 'baloncesto', 'motor']
const instante = valor => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(valor) && Number.isFinite(Date.parse(valor)) && new Date(valor.slice(0, 10)).toISOString().slice(0, 10) === valor.slice(0, 10) && Number(valor.slice(11, 13)) < 24 ? new Date(valor).toISOString() : null
const masTarde = fechas => fechas.filter(Boolean).sort().at(-1) || null

export function seleccionaFuentesDeportes(fuentes = '', programacion = '') {
  if (!fuentes && programacion && ![HORARIO_DEPORTES_COMPLETO, HORARIO_DEPORTES_FUTBOL].includes(programacion)) throw Error('Horario deportivo no reconocido')
  const seleccion = fuentes ? fuentes === 'todos' ? deportes : fuentes.split(',').map(v => v.trim()) : programacion === HORARIO_DEPORTES_FUTBOL ? ['futbol'] : deportes
  if (!seleccion.length || seleccion.some(f => !deportes.includes(f))) throw Error('Selección de deportes no válida')
  return new Set(seleccion)
}

/** Merge public progress and an interrupted run's checkpoint without shortening a pause. */
export function recuperaEstadoFFCV(candidatos, noAntes = '') {
  if (noAntes && !instante(noAntes)) throw Error('La pausa FFCV debe ser una fecha ISO con zona horaria')
  const copias = candidatos.filter(v => v && v.version === 1).map(valor => {
    const estado = normalizaEstadoFFCV(valor)
    const fecha = instante(valor.guardadoEn) || masTarde([estado.ultimoExito, estado.ventana.desde, estado.catalogo?.verificadoEn]) || ''
    return { estado, fecha }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.estado.ventana.peticiones - b.estado.ventana.peticiones)
  const estado = copias.at(-1)?.estado || normalizaEstadoFFCV(null)
  // A checkpoint containing only a pause must not discard an existing verified catalogue.
  if (!estado.catalogo) {
    const conCatalogo = [...copias].reverse().find(c => c.estado.catalogo)?.estado
    if (conCatalogo) { estado.catalogo = conCatalogo.catalogo; estado.cursor = conCatalogo.cursor; estado.verificados = conCatalogo.verificados; estado.ultimoExito = conCatalogo.ultimoExito }
  }
  estado.noConsultarAntes = masTarde([...copias.map(c => c.estado.noConsultarAntes), instante(noAntes)])
  const ventanas = copias.map(c => c.estado.ventana).filter(v => v.desde).sort((a, b) => a.desde.localeCompare(b.desde))
  const ultima = ventanas.at(-1)
  if (ultima) estado.ventana = { desde: ultima.desde, peticiones: Math.max(...ventanas.filter(v => v.desde === ultima.desde).map(v => v.peticiones)) }
  return normalizaEstadoFFCV(estado)
}

export function checkpointFFCV(estado, ahora = Date.now()) {
  return { ...normalizaEstadoFFCV(estado), guardadoEn: new Date(ahora).toISOString() }
}
