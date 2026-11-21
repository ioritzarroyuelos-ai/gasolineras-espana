// Reciente y completo son comprobaciones distintas. Una copia parcial nueva
// debe continuar avisando aunque permita recuperar algunas fichas verificadas.
export const GUARDIAS_MONITOR_HORAS = 30
export function evaluaGuardiaMonitor(data, now = Date.now()) {
  const ts = typeof data?.ts === 'string' ? data.ts : null
  const stamp = ts ? Date.parse(ts) : NaN, age = now - stamp
  const stale = !Number.isFinite(age) || age < -300000 || age > GUARDIAS_MONITOR_HORAS * 3600000
  const incidencias = Array.isArray(data?.incidencias) ? data.incidencias.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()) : []
  if (!Array.isArray(data?.guardias) || !data.guardias.length) incidencias.push('No hay turnos verificables en la copia.')
  return { ts, fecha: Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null,
    dias: Number.isFinite(age) ? Math.floor(Math.max(0, age) / 86400000) : null,
    stale, parcial: incidencias.length > 0, incidencias }
}
