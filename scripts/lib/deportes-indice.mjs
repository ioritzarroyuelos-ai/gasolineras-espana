export const ZONAS_DEPORTES = { madrid: 'Europe/Madrid', canarias: 'Atlantic/Canary' }
export function diaDeporte(fecha, zona = 'madrid') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONAS_DEPORTES[zona] || ZONAS_DEPORTES.madrid, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fecha))
}
export function diasDeporte(ahora) {
  const hoy = diaDeporte(ahora)
  return Array.from({ length: 22 }, (_, i) => new Date(Date.parse(hoy + 'T12:00:00Z') + (i - 7) * 86400000).toISOString().slice(0, 10))
}
export function construyeIndiceDeportes(competiciones, incidencias, ahora = Date.now()) {
  const dias = diasDeporte(ahora)
  const agendas = Object.fromEntries(Object.keys(ZONAS_DEPORTES).flatMap(zona => dias.map(dia => [`${zona}/${dia}`, []])))
  const resumen = competiciones.map(c => {
    for (const e of c.agenda.eventos) {
      for (const zona of Object.keys(ZONAS_DEPORTES)) {
        const primero = e.inicio ? diaDeporte(e.inicio, zona) : e.fecha
        if (!primero) continue
        const ultimo = e.inicio ? primero : e.finFecha || primero
        for (const dia of dias) if (dia >= primero && dia <= ultimo) agendas[`${zona}/${dia}`].push({
          ...e, competicionId: c.id, competicion: c.nombre, deporte: c.deporte,
          temporada: c.temporada, grupo: c.grupo, fuenteUrl: e.fuenteUrl || c.agenda.fuenteUrl,
          verificadoEn: c.agenda.verificadoEn, conservado: c.agenda.estado === 'conservado',
        })
      }
    }
    const participantes = [...new Set([
      ...c.agenda.eventos.flatMap(e => [e.local, e.visitante].filter(Boolean)),
      ...c.clasificacion.tablas.flatMap(t => t.filas.map(f => f.nombre)),
    ])].sort((a, b) => a.localeCompare(b, 'es'))
    const { eventos, ...agenda } = c.agenda
    const { tablas, ...clasificacion } = c.clasificacion
    return { ...c, agenda: { ...agenda, total: eventos.length }, clasificacion: { ...clasificacion, total: tablas.length }, participantes }
  })
  for (const eventos of Object.values(agendas)) eventos.sort((a, b) =>
    (a.inicio || '9999').localeCompare(b.inicio || '9999') || a.competicion.localeCompare(b.competicion, 'es') || a.nombre.localeCompare(b.nombre, 'es'))
  resumen.sort((a, b) => a.deporte.localeCompare(b.deporte) || a.nombre.localeCompare(b.nombre, 'es') || (a.grupo || '').localeCompare(b.grupo || '', 'es', { numeric: true }))
  return { indice: { version: 1, generado: new Date(ahora).toISOString(), dias, competiciones: resumen, incidencias }, agendas }
}
