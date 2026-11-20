// La cadencia cuenta desde el inicio efectivo, no desde el final del trabajo.
export const DATA_JOBS = [
  {kind:'prices', service:'gasolineras', item:'Precios del Ministerio', maxHours:24, intervalHours:12},
  {kind:'chargers', service:'gasolineras', item:'Directorio de recarga eléctrica', maxHours:30, intervalHours:24},
  {kind:'guardias', service:'farmacias', maxHours:30, intervalHours:24},
  {kind:'tiempo', service:'tiempo', maxHours:12, intervalHours:3},
  {kind:'itv', service:'itv', maxHours:30, intervalHours:24},
  {kind:'politica', service:'politica', maxHours:30, intervalHours:24},
  {kind:'deportes', service:'deportes', maxHours:24, intervalHours:1},
]
export function necesitaRecuperacion(job, manifest, runs, now = Date.now()) {
  if (runs.some(r => r.status !== 'completed')) return {retry:false, reason:'Ya hay una actualización en marcha o esperando'}
  // En prices sólo permanece el cron vigilante: no cuenta como descarga.
  const effective = runs.filter(r=>r.conclusion!=='skipped' && !(job.kind==='prices' && r.event==='schedule'))
  const started = r=>Date.parse(r.run_started_at || r.startedAt || r.createdAt || r.created_at)
  if (effective.some(r=>!Number.isFinite(started(r)) || started(r)>now+300000)) return {retry:false,reason:'No se puede comprobar la fecha de la última ejecución'}
  effective.sort((a,b)=>started(b)-started(a))
  const last = effective[0], age = last ? (now - started(last)) / 3600000 : Infinity
  const items = manifest.services?.find(s => s.id === job.service)?.items?.filter(i => !job.item || i.name === job.item) || []
  const stale = !items.length || items.some(i => !i.updatedAt || !Number.isFinite(Date.parse(i.updatedAt)) || now - Date.parse(i.updatedAt) > job.maxHours * 3600000 || Date.parse(i.updatedAt) > now + 300000)
  const failed = last && last.conclusion !== 'success'
  const minimum = job.kind==='deportes' ? 1 : failed || stale ? 4 : job.intervalHours
  // Unos segundos de cola no deben hacer perder un pulso entero de15min.
  // Los reintentos no deportivos mantienen4h estrictas; Retry-After es aparte.
  const tolerance = job.kind==='deportes' || (!failed && !stale) ? 1/60 : 0
  if (age < minimum-tolerance) return {retry:false,reason:'Se respeta el intervalo de '+minimum+' horas desde el último inicio'}
  return {retry:true,reason:!last?'Sin ejecución efectiva previa':failed?'Reintento limitado tras fallo':stale?'Hay copias publicadas pendientes de renovar':'Se ha cumplido la cadencia de '+job.intervalHours+' horas'}
}
