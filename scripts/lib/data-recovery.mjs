// El reintento tiene límites propios y respeta los procesos que siguen activos.
export const DATA_JOBS = [
  {kind:'prices', service:'gasolineras', item:'Precios del Ministerio', maxHours:24},
  {kind:'chargers', service:'gasolineras', item:'Directorio de recarga eléctrica', maxHours:30},
  {kind:'guardias', service:'farmacias', maxHours:30},
  {kind:'tiempo', service:'tiempo', maxHours:12},
  {kind:'itv', service:'itv', maxHours:30},
  {kind:'politica', service:'politica', maxHours:30},
  {kind:'deportes', service:'deportes', maxHours:24},
]
export function necesitaRecuperacion(job, manifest, runs, now = Date.now()) {
  if (runs.some(r => r.status !== 'completed')) return {retry:false, reason:'Ya hay una actualización en marcha o esperando'}
  const last = runs[0]
  const age = last ? (now - Date.parse(last.createdAt)) / 3600000 : Infinity
  if (age < 4) return {retry:false, reason:'Se respeta un mínimo de cuatro horas entre intentos de recuperación'}
  const items = manifest.services?.find(s => s.id === job.service)?.items?.filter(i => !job.item || i.name === job.item) || []
  const stale = !items.length || items.some(i => !i.updatedAt || !Number.isFinite(Date.parse(i.updatedAt)) || now - Date.parse(i.updatedAt) > job.maxHours * 3600000 || Date.parse(i.updatedAt) > now + 300000)
  const failed = last && last.conclusion !== 'success'
  return {retry:stale || Boolean(failed) || age > job.maxHours, reason:stale ? 'Hay copias publicadas pendientes de renovar' : failed ? 'La última actualización no terminó correctamente' : age > job.maxHours ? 'Falta una ejecución reciente' : 'Actualización comprobada'}
}
