// Los horarios diarios se anclan a UTC; una descarga nocturna no aplaza mañana.
// Los intervalos cuentan desde el inicio efectivo, no desde el final del trabajo.
export const DATA_JOBS = [
  {kind:'prices', service:'gasolineras', item:'Precios del Ministerio', maxHours:24, scheduleUtc:['07:00','19:00']},
  {kind:'chargers', service:'gasolineras', item:'Directorio de recarga eléctrica', maxHours:30, scheduleUtc:['05:15']},
  {kind:'guardias', service:'farmacias', maxHours:30, scheduleUtc:['05:45']},
  {kind:'tiempo', service:'tiempo', maxHours:12, intervalHours:3},
  {kind:'itv', service:'itv', maxHours:30, scheduleUtc:['04:17']},
  {kind:'politica', service:'politica', maxHours:30, scheduleUtc:['04:20']},
  {kind:'deportes', service:'deportes', maxHours:24, intervalHours:1},
  {kind:'servicios', service:'servicios', item:'Comprobación del directorio', maxHours:30, scheduleUtc:['08:17']},
  {kind:'municipios', workflow:'gen-tiempo-municipios.yml', service:'municipios', item:'Maestro de AEMET', maxHours:30, scheduleUtc:['08:07']},
  {kind:'servicios-municipales', service:'servicios-municipales', item:'Derivación del directorio', maxHours:30, scheduleUtc:['09:27']},
  {kind:'transporte', service:'transporte', item:'Comprobación de movilidad', maxHours:30, scheduleUtc:['08:47']},
  {kind:'servicios-publicos', service:'servicios', item:'Servicios públicos oficiales', maxHours:30, scheduleUtc:['08:57']},
  {kind:'aparcamientos', service:'servicios', item:'Catálogos de aparcamientos oficiales', maxHours:30, scheduleUtc:['09:07']},
  {kind:'telegram', workflow:'cron-telegram-check.yml', scheduleLocal:{zone:'Europe/Madrid',startHour:8,endHour:12}, runTitle:'Telegram · resumen diario'},
  {kind:'telegram-itv', workflow:'cron-telegram-itv.yml', scheduleLocal:{zone:'Europe/Madrid',startHour:8,endHour:12}, intervalHours:1, runTitle:'Telegram · recordatorios ITV'},
]
function localParts(time, zone) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]))
  return {day:p.year+'-'+p.month+'-'+p.day,hour:Number(p.hour)}
}
function telegramDecision(job,runs,now) {
  const slot=job.scheduleLocal,today=localParts(now,slot.zone)
  if(today.hour<slot.startHour||today.hour>=slot.endHour)return {retry:false,reason:'Fuera de la ventana diaria de Telegram (08:00–12:00, Madrid)'}
  // Una comprobación sin envío nunca cubre el resumen. Tampoco lo cubre
  // una pasada de otro día o iniciada fuera de la ventana de entrega.
  const starts=r=>Date.parse(r.run_started_at||r.startedAt||r.createdAt||r.created_at)
  const eligible=runs.filter(r=>r.display_title===job.runTitle&&r.conclusion!=='skipped').filter(r=>{
    const t=starts(r)
    if(!Number.isFinite(t)||t>now+300000)return false
    const local=localParts(t,slot.zone)
    return local.day===today.day&&local.hour>=slot.startHour&&local.hour<slot.endHour
  }).sort((a,b)=>starts(b)-starts(a))
  if(!job.intervalHours&&eligible.some(r=>r.conclusion==='success'))return {retry:false,reason:'El resumen de hoy ya se ha comprobado dentro de su ventana'}
  if(eligible[0]&&now-starts(eligible[0])<3600000)return {retry:false,reason:'Se respeta una hora entre reintentos de Telegram'}
  return {retry:true,reason:eligible.length?'Reintento del resumen diario dentro de su ventana':'Resumen diario pendiente dentro de su ventana'}
}
function latestScheduledSlot(job, now) {
  const day = Math.floor(now/86400000)*86400000
  return Math.max(...job.scheduleUtc.map(time=>{
    const [hours,minutes]=time.split(':').map(Number), today=day+(hours*60+minutes)*60000
    return today<=now?today:today-86400000
  }))
}
export function necesitaRecuperacion(job, manifest, runs, now = Date.now()) {
  if (runs.some(r => r.status !== 'completed')) return {retry:false, reason:'Ya hay una actualización en marcha o esperando'}
  if (job.scheduleLocal) return telegramDecision(job,runs,now)
  // En prices sólo permanece el cron vigilante: no cuenta como descarga.
  const effective = runs.filter(r=>r.conclusion!=='skipped' && !(job.kind==='prices' && r.event==='schedule'))
  const started = r=>Date.parse(r.run_started_at || r.startedAt || r.createdAt || r.created_at)
  if (effective.some(r=>!Number.isFinite(started(r)) || started(r)>now+300000)) return {retry:false,reason:'No se puede comprobar la fecha de la última ejecución'}
  effective.sort((a,b)=>started(b)-started(a))
  const last = effective[0], age = last ? (now - started(last)) / 3600000 : Infinity
  const items = manifest.services?.find(s => s.id === job.service)?.items?.filter(i => !job.item || i.name === job.item) || []
  const stale = !items.length || items.some(i => !i.updatedAt || !Number.isFinite(Date.parse(i.updatedAt)) || now - Date.parse(i.updatedAt) > job.maxHours * 3600000 || Date.parse(i.updatedAt) > now + 300000)
  const failed = last && last.conclusion !== 'success'
  if (!last) return {retry:true,reason:'Sin ejecución efectiva previa'}
  if (job.scheduleUtc && !failed && !stale) {
    const slot=latestScheduledSlot(job,now)
    // Una pasada manual posterior al horario lo cubre; la de ayer no cubre hoy.
    const due=started(last)<slot
    return {retry:due,reason:due?'Horario UTC pendiente: '+new Date(slot).toISOString():'El último horario UTC ya está cubierto'}
  }
  const minimum = job.kind==='deportes' ? 1 : failed || stale ? 4 : job.intervalHours
  // Unos segundos de cola no deben hacer perder un pulso entero de15min.
  // Los reintentos no deportivos mantienen4h estrictas; Retry-After es aparte.
  const tolerance = job.kind==='deportes' || (!failed && !stale) ? 1/60 : 0
  if (age < minimum-tolerance) return {retry:false,reason:'Se respeta el intervalo de '+minimum+' horas desde el último inicio'}
  return {retry:true,reason:failed?'Reintento limitado tras fallo':stale?'Hay copias publicadas pendientes de renovar':'Se ha cumplido la cadencia de '+job.intervalHours+' horas'}
}
