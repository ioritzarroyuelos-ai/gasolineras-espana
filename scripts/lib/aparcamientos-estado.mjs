const SOURCES = [['madrid', 'Comprobación · Aparcamientos Madrid'], ['vigo', 'Comprobación · Aparcamientos Vigo']]
function timestamp(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null
  const n = Date.parse(value)
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 19) === value.slice(0, 19) ? n : null
}
// Este estado acredita la comprobación de un directorio, no plazas libres.
// Nunca sustituye la caducidad por fila que aplica la API de ocupación.
export function aparcamientosItems(report, now = Date.now()) {
  const checked = timestamp(report?.consultado)
  const sources = report?.schema === 1 && checked !== null && checked <= now && Array.isArray(report.fuentes) ? report.fuentes : []
  const checks = SOURCES.map(([id, name]) => {
    const found = sources.filter(source => source?.id === id), source = found.length === 1 ? found[0] : null
    const success = timestamp(source?.ultimoExito)
    const updatedAt = success !== null && checked !== null && success <= checked ? source.ultimoExito : null
    const count = Number.isSafeInteger(source?.total) && source.total > 0 ? source.total : 0
    const issue = !source || !updatedAt || !count || source.estado !== 'actual'
      ? 'La comprobación del catálogo o de sus servicios está pendiente. Cada ficha conserva su última fecha verificada.' : null
    return { name, updatedAt, count, ...(issue ? { issue } : {}) }
  })
  const dates = checks.map(check => check.updatedAt), failed = checks.filter(check => check.issue)
  return [{ name: 'Catálogos de aparcamientos oficiales', updatedAt: dates.every(Boolean) ? dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null,
    count: checks.filter(check => !check.issue).length, ...(failed.length ? { issue: failed.length + ' catálogos de aparcamientos pendientes de comprobar.' } : {}) }, ...checks]
}
