const SOURCES = [['refugios-cataluna', 'Refugios climáticos de Cataluña'], ['salas-estudio-madrid', 'Salas de estudio de Madrid']]

// La comprobación de descarga no acredita apertura, activación de un refugio
// ni plazas disponibles. Se conserva la fecha del último éxito de cada fuente.
export function serviciosPublicosItems(report) {
  const sources = report?.schema === 1 && Array.isArray(report.fuentes) ? report.fuentes : []
  const checks = SOURCES.map(([id, name]) => {
    const matches = sources.filter(source => source?.id === id)
    const source = matches.length === 1 ? matches[0] : null
    const updatedAt = typeof source?.ultimoExito === 'string' && Number.isFinite(Date.parse(source.ultimoExito)) ? source.ultimoExito : null
    const count = Number.isSafeInteger(source?.total) && source.total > 0 ? source.total : 0
    const issue = !source || source.estado !== 'actual' || !updatedAt || !count
      ? 'No se ha podido renovar este directorio oficial. Se conserva su fecha original de comprobación.' : null
    return { name, updatedAt, count, ...(issue ? { issue } : {}) }
  })
  const failed = checks.filter(check => check.issue)
  const dates = checks.map(check => check.updatedAt)
  return [
    { name: 'Servicios públicos oficiales', updatedAt: dates.every(Boolean) ? dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null,
      count: checks.filter(check => !check.issue).length,
      ...(failed.length ? { issue: failed.length + ' directorios oficiales pendientes de comprobar.' } : {}) },
    ...checks,
  ]
}
