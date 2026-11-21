const DAYS=['Su','Mo','Tu','We','Th','Fr','Sa']
// Un reloj de dispositivo atrasado, o corregido durante la visita, no puede
// prolongar una disponibilidad que el servidor evaluó por última vez. El inicio
// se captura ANTES de pedir datos para descontar también toda la espera de red.
export function plazoServicio(caduca,evaluadoEn,inicioWall,inicioMono) {
  const expiry=Date.parse(caduca),evaluated=Date.parse(evaluadoEn),duration=expiry-evaluated
  if(![expiry,evaluated,inicioWall,inicioMono].every(Number.isFinite)||inicioMono<0||duration<=0)return null
  return {absoluto:Math.min(expiry,inicioWall+duration),monotono:inicioMono+duration}
}
export function restanteServicio(plazo,nowWall=Date.now(),nowMono=performance.now()) {
  if(!plazo||![plazo.absoluto,plazo.monotono,nowWall,nowMono].every(Number.isFinite)||nowMono<0)return 0
  return Math.max(0,Math.min(plazo.absoluto-nowWall,plazo.monotono-nowMono))
}
export function vigenteServicio(plazo,nowWall=Date.now(),nowMono=performance.now()) {
  return restanteServicio(plazo,nowWall,nowMono)>0
}
export function biciServicioActual(poi,now=Date.now()) {
  const updated=Date.parse(poi?.actualizado),expiry=Date.parse(poi?.caduca)
  return !!poi && ['operativa','cerrada'].includes(poi.estado) && Number.isFinite(updated) && Number.isFinite(expiry) && updated<=now && now-updated<300000 && now<expiry
}
// Subconjunto deliberadamente cerrado de opening_hours. Festivos, citas,
// estaciones y reglas ambiguas conservan el texto y no entran en «Abierto».
export function abiertoServicio(horario, lat, lon, now=Date.now()) {
  if(typeof horario!=='string'||!horario.trim()||horario.length>512||!Number.isFinite(now))return null
  const value=horario.trim()
  if(value==='24/7')return true
  if(value==='off'||value==='closed')return false
  const rules=[],occupied=new Set()
  for(const part of value.split(';')) {
    if(!part.trim())return null
    const split=part.trim().match(/^((?:(?:Su|Mo|Tu|We|Th|Fr|Sa)(?:-(?:Su|Mo|Tu|We|Th|Fr|Sa))?)(?:,(?:Su|Mo|Tu|We|Th|Fr|Sa)(?:-(?:Su|Mo|Tu|We|Th|Fr|Sa))?)*)\s+(.+)$/)
    const dayText=split?.[1],hours=split?.[2]||part.trim(),days=[]
    if(dayText)for(const range of dayText.split(',')) {
      const [a,b=a]=range.split('-');let day=DAYS.indexOf(a),end=DAYS.indexOf(b)
      if(day<0||end<0)return null
      for(let n=0;n<7;n++,day=(day+1)%7){days.push(day);if(day===end)break}
    } else days.push(0,1,2,3,4,5,6)
    for(const day of days){if(occupied.has(day))return null;occupied.add(day)}
    const spans=[]
    if(hours!=='off'&&hours!=='closed')for(const span of hours.split(',')) {
      const m=span.trim().match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/)
      if(!m)return null
      const [,h1,m1,h2,m2]=m.map(Number),start=h1*60+m1,end=h2*60+m2
      if(h1>23||m1>59||h2>24||m2>59||(h2===24&&m2!==0)||start===end)return null
      spans.push([start,end])
    }
    rules.push({days,spans})
  }
  if(rules.some(r=>!r.spans.length)&&rules.some(r=>r.spans.some(([a,b])=>a>b)))return null
  const zone=lat>=27&&lat<=30&&lon>=-19&&lon<=-13?'Atlantic/Canary':'Europe/Madrid'
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now)
  const field=t=>parts.find(p=>p.type===t)?.value
  const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(field('weekday')),minutes=Number(field('hour'))*60+Number(field('minute'))
  if(day<0||!Number.isFinite(minutes))return null
  return rules.some(r=>r.spans.some(([a,b])=>a<b?r.days.includes(day)&&minutes>=a&&minutes<b:(r.days.includes(day)&&minutes>=a)||(r.days.includes((day+6)%7)&&minutes<b)))
}

export function zonasServicios(bounds) {
  if(!bounds||![bounds.south,bounds.north,bounds.west,bounds.east].every(Number.isFinite)||bounds.south>bounds.north||bounds.west>bounds.east)return []
  const south=Math.max(27,bounds.south),north=Math.min(44.5,bounds.north),west=Math.max(-19,bounds.west),east=Math.min(5,bounds.east)
  if(south>north||west>east)return []
  const y0=Math.floor((south+90)*4),y1=Math.floor((north+90)*4),x0=Math.floor((west+180)*4),x1=Math.floor((east+180)*4)
  if((y1-y0+1)*(x1-x0+1)>9)return []
  const result=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)result.push(y+'-'+x)
  return result
}

export function distanciaServicio(a,b) {
  if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite))return null
  const rad=n=>n*Math.PI/180,dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon)
  return 6371*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2)))
}

export function enlacesServicio(poi) {
  if(!poi||![poi.lat,poi.lon].every(Number.isFinite)||poi.lat<27||poi.lat>44.5||poi.lon< -19||poi.lon>5)return null
  const ll=poi.lat+','+poi.lon
  return {google:'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(ll),apple:'https://maps.apple.com/?daddr='+encodeURIComponent(ll),waze:'https://www.waze.com/ul?ll='+encodeURIComponent(ll)+'&navigate=yes'}
}
