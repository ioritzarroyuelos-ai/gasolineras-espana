const SOURCES = [
  ['bizi-zaragoza', 'Bizi Zaragoza', 5 * 60000], ['trafico-cataluna', 'Tráfico de Cataluña', 10 * 60000],
  ['camaras-cataluna', 'Cámaras de Cataluña', 30 * 3600000], ['metro-bilbao', 'Metro Bilbao', 2 * 60000],
]
function timestamp(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return NaN
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN
}
function calendarDay(value) {
  if (typeof value !== 'string' || !/^20\d{6}$/.test(value)) return null
  const formatted = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8)
  const time = Date.parse(formatted + 'T12:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(formatted) ? value : null
}
const madridDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
// Son comprobaciones del robot, no disponibilidad en este instante. Un parte
// válido con cero incidencias cuenta como una comprobación, no una incidencia.
export function movilidadItems(report, directory, now = Date.now()) {
  const sources = report?.schema === 1 && Array.isArray(report.fuentes) ? report.fuentes : []
  const checks = SOURCES.map(([id, name, maxAge]) => {
    const matches = sources.filter(s => s?.id === id), source = matches.length === 1 ? matches[0] : null
    const published = timestamp(source?.fechaDatos), consulted = timestamp(source?.consultado)
    // La antigüedad se mide cuando el robot hizo la comprobación. Un informe
    // válido de ayer no se convierte en un parte en directo al reconstruir hoy.
    // El límite de30h del propio informe lo aplica evaluateServices.
    const issue = source?.estado !== 'actual' || !Number.isInteger(source.total) || source.total < 0
      ? typeof source?.error === 'string' && source.error.trim() ? source.error.slice(0, 300) : 'No se ha podido comprobar esta fuente.'
      : !Number.isFinite(published) || !Number.isFinite(consulted) ? 'No hay fechas originales y de consulta comprobables.'
      : published > consulted || published > now ? 'La fecha original de la fuente es futura o posterior a la consulta.'
      : consulted - published >= maxAge ? 'La fuente ya estaba desactualizada cuando se hizo la comprobación.' : null
    return { name: 'Comprobación · ' + name, updatedAt: typeof source?.consultado === 'string' ? source.consultado : null,
      count: issue ? 0 : 1, ...(issue ? { issue } : {}) }
  })
  const failed = checks.filter(c => c.issue)
  const original = timestamp(directory?.fechaDatos), checked = timestamp(directory?.ts)
  const stations = directory?.estaciones && typeof directory.estaciones === 'object' && !Array.isArray(directory.estaciones) ? Object.values(directory.estaciones) : []
  const directoryValid = directory?.schema === 1 && directory.redId === 'metro-bilbao' && stations.length > 0 && stations.length <= 100 && stations.every(s => s && typeof s.nombre === 'string' && Number.isFinite(s.lat) && Number.isFinite(s.lon))
  const originalValid = Number.isFinite(original) && original <= now && now - original < 72 * 3600000 && original <= checked
  const start = calendarDay(directory?.inicio), end = calendarDay(directory?.fin)
  const parts = Object.fromEntries(madridDate.formatToParts(now).map(part => [part.type, part.value]))
  const today = parts.year + parts.month + parts.day
  const directoryIssue = !directoryValid || !originalValid ? 'No hay un directorio con fecha original comprobable de las últimas 72 horas.'
    : !Number.isFinite(checked) || now - checked >= 30 * 3600000 ? 'La consulta del directorio de Metro Bilbao necesita actualizarse: han pasado 30 horas o falta una fecha válida.'
    : !start || !end || start > end ? 'El calendario de Metro Bilbao no tiene fechas válidas comprobables.'
    : end < today ? 'El calendario publicado de Metro Bilbao ha vencido. Se necesita un directorio que incluya hoy.'
    : start > today ? 'El calendario publicado de Metro Bilbao todavía no incluye hoy.' : null
  return [
    { name: 'Comprobación de movilidad', updatedAt: typeof report?.consultado === 'string' ? report.consultado : null,
      count: sources.length, ...(failed.length ? { issue: failed.length + ' fuentes pendientes de comprobar. Consulta su detalle.' } : {}) },
    { name: 'Directorio de Metro Bilbao', updatedAt: directoryValid && Number.isFinite(checked) ? directory.ts : null,
      count: directoryValid ? stations.length : 0,
      ...(directoryIssue ? { issue: directoryIssue } : {}) },
    ...checks,
  ]
}
