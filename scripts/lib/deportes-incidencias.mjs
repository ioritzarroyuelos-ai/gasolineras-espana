/** A catalogue entry is not a fresh check: keep its group warning until its turn. */
export function conservaIncidenciasGrupos(anteriores, actuales, seguimiento) {
  const conocidos = new Set(seguimiento?.conocidos || [])
  const revisados = new Set(seguimiento?.revisados || [])
  const pendientes = anteriores.filter(i => i.id && conocidos.has(i.id) && !revisados.has(i.id))
  const unicas = new Map()
  for (const i of [...pendientes, ...actuales]) {
    const clave = JSON.stringify([i.deporte, i.id, i.nombre, i.fuenteUrl, i.motivo])
    unicas.set(clave, i)
  }
  return [...unicas.values()]
}
