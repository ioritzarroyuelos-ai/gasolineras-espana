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

// Omitir un grupo por cupo no es una consulta ni un fallo. Sólo un intento
// identificado puede cambiar la fecha de consulta; la de verificación no cambia.
export function conservaGrupoFueraDeTanda(anterior, fecha, intentados) {
  if (!intentados.has(anterior.id)) return anterior
  const copia = { ...anterior, comprobadoEn: fecha }
  for (const k of ['agenda', 'clasificacion']) copia[k] = { ...anterior[k], consultado: fecha,
    estado: anterior[k].verificadoEn ? 'conservado' : 'no_disponible',
    aviso: 'No se ha podido volver a comprobar esta competición. Consulta la fuente antes de organizarte.',
  }
  return copia
}
