import {SERVICIOS_CATEGORIAS,SERVICIOS_IDS,categoriasServicio} from './servicios-catalogo.mjs'
export const SERVICIOS_TILE_SIZE=0.25
export const SERVICIOS_MAX_TILE_BYTES=2*1024*1024
export const SERVICIOS_TARGET_TILE_BYTES=256*1024
export const SERVICIOS_MAX_TOTAL_BYTES=250*1024*1024
export const SERVICIOS_MAX_POIS=800000
export const SERVICIOS_ID_RE=/^osm-(node|way|relation)-([1-9]\d{0,15})$/
export const SERVICIOS_TILE_RE=/^\d{1,3}-\d{1,4}(?:\.[0-3]){0,4}$/
export const SERVICIOS_LIMITE_URL='https://api-features.ign.es/collections/administrativeunit/items?f=json&nationallevel=https%3A%2F%2Finspire.ec.europa.eu%2Fcodelist%2FAdministrativeHierarchyLevel%2F2ndOrder&limit=30'
export const SERVICIOS_LIMITE_ATRIBUCION='Filtro territorial derivado de Unidades Administrativas de España, CC-BY 4.0 ign.es'
const labels=new Map(SERVICIOS_CATEGORIAS.map(c=>[c.id,c.nombre]))
const text=(v,max=180)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):''
// Las condiciones y contactos no se recortan: cortar el final de un horario
// puede borrar una excepción y convertir una clausura en «abierto».
const completeText=(v,max)=>{if(typeof v!=='string')return '';const s=v.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();return s.length<=max?s:''}
const iso=(v)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v))
const fail=message=>{throw Error('Servicios: '+message)}
export function servicioTileId(lat,lon,depth=0) {
  if(!Number.isInteger(depth)||depth<0||depth>4)fail('profundidad de zona inválida')
  let id=`${Math.floor((lat+90)/SERVICIOS_TILE_SIZE)}-${Math.floor((lon+180)/SERVICIOS_TILE_SIZE)}`
  for(let n=0;n<depth;n++){const [west,south,east,north]=servicioTileBbox(id);id+='.'+((lat>=(south+north)/2?2:0)+(lon>=(west+east)/2?1:0))}
  return id
}
export function servicioTileBbox(id) {
  if(!SERVICIOS_TILE_RE.test(id))fail('identificador de zona inválido')
  const [base,...quadrants]=id.split('.'),[y,x]=base.split('-').map(Number)
  if(y<0||y>=720||x<0||x>=1440)fail('zona fuera del mapa')
  let [west,south,east,north]=[x/4-180,y/4-90,(x+1)/4-180,(y+1)/4-90]
  for(const q of quadrants){const lon=(west+east)/2,lat=(south+north)/2;if(Number(q)%2)west=lon;else east=lon;if(Number(q)>=2)south=lat;else north=lat}
  return [west,south,east,north]
}
export function servicioContienePunto(id,lat,lon) {const [west,south,east,north]=servicioTileBbox(id);return Number.isFinite(lat)&&Number.isFinite(lon)&&lon>=west&&lon<east&&lat>=south&&lat<north}
// Incluye península, Baleares, Canarias, Ceuta y Melilla. El extractor aplica
// además las geometrías administrativas del IGN: las cajas NO prueban el país.
export function coordenadasServicio(lat,lon) {
  return Number.isFinite(lat)&&Number.isFinite(lon)&&((lat>=35&&lat<=44.5&&lon>=-10&&lon<=4.5)||(lat>=27&&lat<=30&&lon>=-19&&lon<=-13))
}
const privateWebKeys=new Set(['key','keyid','accesskey','privatekey','clientkey','consumerkey','auth','authorization','authentication','authcode','authkey','authorizationcode','bearer','jwt','pwd','pass','sig','sid','phpsessid','samlresponse','assertion','awsaccesskeyid','token','accesstoken','refreshtoken','idtoken','csrftoken','secret','clientsecret','appsecret','password','passwd','passphrase','session','sessionid','jsessionid','credential','signature','apikey'])
function parametroPrivado(value,exact=false) {
  const key=value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'')
  return privateWebKeys.has(key)||!exact&&(/token|secret|password|passwd|passphrase|session|credential|signature/.test(key)||/apikey$/.test(key))
}
function enlaceConDatosPrivados(value) {
  // Se comprueba también el texto decodificado: redirect/returnUrl y el hash
  // pueden contener otra URL o parámetros JSON, con varios niveles de escape.
  // Se omite el enlace completo; quitar sólo un parámetro podría dejar una
  // credencial en otra parte o cambiar el destino de una redirección firmada.
  for(let depth=0;depth<8;depth++){
    if(/(?:https?:)?\/\/[^/?#\s]*@/i.test(value))return true
    // La búsqueda no consume el separador: «next=token%3D…» también tiene
    // que comprobar su segundo parámetro al deshacer la codificación.
    for(const match of value.matchAll(/(?=(?:^|[?&#;={\s"'(])([^=:#?&;/"'{}()]{1,80})["']?\s*(?:=|:))/g))if(parametroPrivado(match[1]))return true
    // También se reconocen parámetros de ruta (p. ej. ;jsessionid=…) y los
    // enlaces de acceso /token/valor, sin rechazar un ancla ordinaria #horario.
    for(const match of value.matchAll(/\/([^/?#;]{1,80})(?=\/[^/?#\s])/g))if(parametroPrivado(match[1],true))return true
    let decoded
    try{decoded=decodeURIComponent(value)}catch{
      // Un escape UTF-8 roto no debe ocultar el nombre ASCII de un parámetro.
      decoded=value.replace(/%([a-f0-9]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))
    }
    if(decoded===value)return false
    value=decoded
  }
  // Un enlace anidado más profundamente no se puede verificar con este límite.
  return true
}
export function webServicio(raw) {
  const value=completeText(raw,500)
  if(!value||enlaceConDatosPrivados(value))return undefined
  try {
    const u=new URL(value)
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(u.hostname)||u.hostname.includes(':')||u.href.length>500)return undefined
    return u.href
  }catch{return undefined}
}
export function normalizaServicio(raw) {
  if(!raw||!['node','way','relation'].includes(raw.type)||!/^\d{1,16}$/.test(String(raw.id))||Number(raw.id)<=0||!coordenadasServicio(raw.lat,raw.lon))return null
  const t=raw.tags
  if(!t||typeof t!=='object'||Array.isArray(t)||Object.values(t).some(v=>typeof v!=='string')||t['addr:country']&&t['addr:country'].toUpperCase()!=='ES')return null
  if(['no','private','permit','military'].includes(t.access)||['disused','abandoned','demolished','construction'].some(k=>t[k]&&!['no','false','0'].includes(t[k]))||Object.keys(t).some(k=>/^(?:disused|abandoned|demolished|construction):(?:amenity|shop|leisure|tourism|highway|office)$/.test(k))||t.end_date||t.amenity==='construction')return null
  const categorias=categoriasServicio(t)
  if(!categorias.length)return null
  const nombre=text(t['name:es']||t.name||t.brand||t.operator)||labels.get(categorias[0])+' (sin nombre publicado)'
  const telefono=completeText(t['contact:phone']||t.phone,80)
  const accesoCondicional=Boolean(t['access:conditional']?.trim())
  const horario=accesoCondicional?'':completeText(t.opening_hours,240)
  const calle=text(t['addr:street']||t['addr:place'],140), numero=text(t['addr:housenumber'],20)
  const direccion=text(t['addr:full']||(calle?calle+(numero?', '+numero:''):''))
  const web=webServicio(t['contact:website']||t.website||t.url)
  const fee=t['fee:conditional']?undefined:t.fee
  const p={id:`osm-${raw.type}-${raw.id}`,categorias,nombre,lat:Math.round(raw.lat*1e6)/1e6,lon:Math.round(raw.lon*1e6)/1e6,
    gratis:fee==='no'?true:fee==='yes'?false:null,
    accesible:t['wheelchair:conditional']?'desconocido':({yes:'si',limited:'limitado',no:'no'})[t.wheelchair]||'desconocido',
    acceso:accesoCondicional?'desconocido':({yes:'publico',permissive:'publico',customers:'clientes',private:'privado',no:'privado'})[t.access]||'desconocido',
    fuenteUrl:`https://www.openstreetmap.org/${raw.type}/${raw.id}`,ubicacion:raw.type==='node'?'punto':'recinto'}
  if(direccion)p.direccion=direccion
  const municipio=text(t['addr:city']||t['addr:town']||t['addr:village'],100)
  if(municipio)p.municipio=municipio
  if(/^\d{5}$/.test(t['addr:postcode']||''))p.cp=t['addr:postcode']
  if(telefono&&/^[+\d ()/;.,-]{5,80}$/.test(telefono))p.telefono=telefono
  if(web)p.web=web
  if(horario)p.horario=horario
  if(iso(raw.timestamp))p.fechaEdicion=raw.timestamp
  return p
}
export function validaServicio(p,now=Date.now()) {
  if(!p||!SERVICIOS_ID_RE.test(p.id)||!coordenadasServicio(p.lat,p.lon))fail('punto inválido')
  if(!Array.isArray(p.categorias)||!p.categorias.length||p.categorias.length>12||new Set(p.categorias).size!==p.categorias.length||p.categorias.some(c=>!SERVICIOS_IDS.has(c)))fail('categoría inválida')
  if(typeof p.nombre!=='string'||!p.nombre.trim()||p.nombre.length>180||/[\u0000-\u001f\u007f]/.test(p.nombre))fail('nombre inválido')
  if(![true,false,null].includes(p.gratis)||!['si','limitado','no','desconocido'].includes(p.accesible)||!['publico','clientes','desconocido'].includes(p.acceso)||!['punto','recinto'].includes(p.ubicacion))fail('acceso inválido')
  const [,type,id]=p.id.match(SERVICIOS_ID_RE)
  if(p.fuenteUrl!==`https://www.openstreetmap.org/${type}/${id}`)fail('referencia OSM inválida')
  for(const [key,max] of [['direccion',180],['municipio',100],['cp',5],['telefono',80],['web',500],['horario',240]]){
    if(p[key]!==undefined&&(typeof p[key]!=='string'||p[key].length>max||/[\u0000-\u001f\u007f]/.test(p[key])))fail('campo '+key+' inválido')
  }
  if(p.cp!==undefined&&!/^\d{5}$/.test(p.cp))fail('código postal inválido')
  if(p.telefono!==undefined&&!/^[+\d ()/;.,-]{5,80}$/.test(p.telefono))fail('teléfono inválido')
  if(p.web!==undefined&&webServicio(p.web)!==p.web)fail('web inválida')
  if(p.fechaEdicion!==undefined&&(!iso(p.fechaEdicion)||Date.parse(p.fechaEdicion)>now+300000))fail('fecha de edición inválida')
  return p
}
export function validaServiciosTile(tile,now=Date.now()) {
  if(!tile||tile.schema!==1||!SERVICIOS_TILE_RE.test(tile.id)||!Array.isArray(tile.pois)||tile.pois.length>10000)fail('zona inválida')
  servicioTileBbox(tile.id)
  const ids=new Set()
  for(const p of tile.pois){validaServicio(p,now);if(!servicioContienePunto(tile.id,p.lat,p.lon)||ids.has(p.id))fail('punto duplicado o fuera de su zona');ids.add(p.id)}
  return tile
}
export function validaServiciosIndex(index,now=Date.now()) {
  if(!index||index.schema!==1||index.tileSize!==SERVICIOS_TILE_SIZE||index.licencia!=='ODbL-1.0'||index.atribucion!=='© OpenStreetMap contributors')fail('índice inválido')
  if(!iso(index.ts)||!iso(index.fechaDatos)||Date.parse(index.ts)>now+300000||Date.parse(index.fechaDatos)>Date.parse(index.ts)+300000)fail('fechas del índice inválidas')
  if(!Number.isSafeInteger(index.total)||index.total<1||index.total>SERVICIOS_MAX_POIS||!Array.isArray(index.tiles)||index.tiles.length<1||index.tiles.length>5000)fail('recuento inválido')
  if(!index.categorias||Array.isArray(index.categorias)||Object.entries(index.categorias).some(([k,n])=>!SERVICIOS_IDS.has(k)||!Number.isSafeInteger(n)||n<1||n>index.total)||Object.values(index.categorias).reduce((a,b)=>a+b,0)<index.total)fail('recuento de categorías inválido')
  if(!Array.isArray(index.fuentes)||index.fuentes.length<1||index.fuentes.length>2)fail('fuentes inválidas')
  const sourceIds=new Set()
  for(const f of index.fuentes){
    if(!['espana','canarias'].includes(f.id)||sourceIds.has(f.id)||!/^https:\/\/download\.geofabrik\.de\/(?:europe\/spain\/spain|africa\/canary-islands\/canary-islands)-(?:latest|\d{6})\.osm\.pbf$/.test(f.url)||!iso(f.fechaDatos)||!iso(f.consultado)||Date.parse(f.fechaDatos)>Date.parse(f.consultado)+300000||Date.parse(f.consultado)>Date.parse(index.ts)+300000||!Number.isSafeInteger(f.bytes)||f.bytes<1000||f.bytes>3e9)fail('metadatos de fuente inválidos')
    if(f.url.includes('/africa/')!==(f.id==='canarias'))fail('territorio de fuente incoherente')
    sourceIds.add(f.id)
  }
  if(Date.parse(index.fechaDatos)!==Math.min(...index.fuentes.map(f=>Date.parse(f.fechaDatos))))fail('fecha de extracto incoherente')
  if(index.limiteTerritorial!==undefined){
    const l=index.limiteTerritorial
    if(!l||l.fuenteUrl!==SERVICIOS_LIMITE_URL||l.atribucion!==SERVICIOS_LIMITE_ATRIBUCION||l.licencia!=='CC-BY-4.0'||!iso(l.consultado)||Date.parse(l.consultado)>Date.parse(index.ts)+300000||!Number.isSafeInteger(l.bytes)||l.bytes<1000||l.bytes>200*1024*1024||!/^[a-f0-9]{64}$/.test(l.sha256)||l.administraciones!==19)fail('límite territorial inválido')
  }
  const seen=new Set();let total=0,bytes=0
  for(const tile of index.tiles){
    if(!tile||seen.has(tile.id)||!SERVICIOS_TILE_RE.test(tile.id)||!Number.isSafeInteger(tile.count)||tile.count<1||tile.count>10000||!Number.isSafeInteger(tile.bytes)||tile.bytes<1||tile.bytes>SERVICIOS_MAX_TILE_BYTES||!/^[a-f0-9]{64}$/.test(tile.sha256))fail('resumen de zona inválido')
    if(JSON.stringify(tile.bbox)!==JSON.stringify(servicioTileBbox(tile.id)))fail('límites de zona inválidos')
    seen.add(tile.id);total+=tile.count;bytes+=tile.bytes
  }
  for(const id of seen){let ancestor=id;while(ancestor.includes('.')){ancestor=ancestor.slice(0,ancestor.lastIndexOf('.'));if(seen.has(ancestor))fail('zonas padre e hija solapadas')}}
  if(total!==index.total||bytes>SERVICIOS_MAX_TOTAL_BYTES)fail('totales incoherentes')
  return index
}
