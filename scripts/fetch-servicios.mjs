// Descarga nacional diaria en Actions. Nunca consulta Overpass por visitante.
// El PBF sólo es temporal: publicamos POI compactos con atribución ODbL.
import {createReadStream,createWriteStream} from 'node:fs'
import {mkdir,readFile,writeFile,rename,rm,mkdtemp} from 'node:fs/promises'
import {resolve,dirname,basename,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {Readable,Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {OSM_TAG_FILTERS} from './lib/servicios-catalogo.mjs'
import {normalizaServicio,servicioTileId,servicioTileBbox,validaServicio,validaServiciosIndex,validaServiciosTile,SERVICIOS_MAX_TILE_BYTES,SERVICIOS_TARGET_TILE_BYTES,SERVICIOS_MAX_TOTAL_BYTES,SERVICIOS_MAX_POIS,SERVICIOS_TILE_SIZE,SERVICIOS_LIMITE_URL,SERVICIOS_LIMITE_ATRIBUCION} from './lib/servicios.mjs'
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const SOURCE_PREFIX={espana:'https://download.geofabrik.de/europe/spain/spain-',canarias:'https://download.geofabrik.de/africa/canary-islands/canary-islands-'}
export const SERVICIOS_FUENTES=Object.entries(SOURCE_PREFIX).map(([id,prefix])=>({id,url:prefix+'latest.osm.pbf',minCount:id==='espana'?5000:1000,maxBytes:id==='espana'?2500000000:150000000}))
const hash=text=>createHash('sha256').update(text).digest('hex')
// Explicit source files only: no environment, credentials, generated data or
// repository-wide scan. The workflow pins the Node/Python reader dependencies.
export const SERVICIOS_PRODUCTOR_ARCHIVOS=Object.freeze([
  'scripts/fetch-servicios.mjs','scripts/lib/servicios.mjs',
  'scripts/lib/servicios-catalogo.mjs','scripts/osm-servicios.py',
  '.github/workflows/fetch-servicios.yml',
])
export function productorServiciosValido(value) {
  return Boolean(value&&value.version===1&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256))
}
export async function huellaProductorServicios(root=ROOT,io={}) {
  const files=await Promise.all(SERVICIOS_PRODUCTOR_ARCHIVOS.map(async name=>{
    const source=await (io.readFile||readFile)(resolve(root,name),'utf8')
    if(typeof source!=='string')throw Error('No se pudo leer un archivo del productor')
    return [name,source.replace(/\r\n/g,'\n')]
  }))
  return {version:1,sha256:hash(JSON.stringify({version:1,files}))}
}
export function urlExtractoPermitida(url,id) {return Object.hasOwn(SOURCE_PREFIX,id)&&typeof url==='string'&&url.startsWith(SOURCE_PREFIX[id])&&/^(?:latest|\d{6})\.osm\.pbf$/.test(url.slice(SOURCE_PREFIX[id].length))}
// A dated name is a publisher-version identity, not a cryptographic guarantee
// that a remote PBF can never be replaced. This optimization trusts Geofabrik's
// dated downloads (technical.html recommends them for resumable downloads).
// A same-size "latest" file is deliberately never treated as the same extract.
export function mismoExtractoPublicado(anterior,actual) {return Boolean(anterior&&actual&&urlExtractoPermitida(actual.url,actual.id)&&/\d{6}\.osm\.pbf$/.test(actual.url)&&anterior.id===actual.id&&anterior.url===actual.url&&anterior.bytes===actual.bytes)}
export function consultaSnapshotSinCambios(previous,fuentesActuales,productor,ts=new Date().toISOString()) {
  const now=Date.parse(ts)
  if(!Number.isFinite(now)||!productorServiciosValido(productor)||!productorServiciosValido(previous?.productor)||previous.productor.sha256!==productor.sha256)return null
  const boundaryAge=now-Date.parse(previous.limiteTerritorial?.consultado)
  if(!Number.isFinite(boundaryAge)||boundaryAge < -300000||boundaryAge>=30*86400000)return null
  if(!Array.isArray(previous.fuentes)||!Array.isArray(fuentesActuales)||fuentesActuales.length!==SERVICIOS_FUENTES.length||previous.fuentes.length!==SERVICIOS_FUENTES.length)return null
  if(new Set(fuentesActuales.map(f=>f.id)).size!==SERVICIOS_FUENTES.length)return null
  for(const source of fuentesActuales){
    const old=previous.fuentes.find(f=>mismoExtractoPublicado(f,source))
    const age=now-Date.parse(old?.fechaDatos)
    if(!old||!Number.isFinite(age)||age < -300000||age>72*3600000)return null
  }
  const index={...previous,ts,fuentes:previous.fuentes.map(f=>({...f,consultado:ts}))}
  validaServiciosIndex(index,now)
  return index
}
export async function peticionExtracto(source,method='GET',io={}) {
  const fetcher=io.fetch||fetch;let url=source.url
  for(let n=0;n<4;n++){
    if(!urlExtractoPermitida(url,source.id))throw Error('Destino de extracto no permitido')
    const r=await fetcher(url,{method,redirect:'manual',headers:{'User-Agent':'EspanaUtil/servicios (+https://webapp-3ft.pages.dev)','Accept':'application/octet-stream'},signal:AbortSignal.timeout(method==='HEAD'?30000:12*60000)})
    if(r.status>=300&&r.status<400){
      const location=r.headers.get('location');await r.body?.cancel()
      if(!location)throw Error('Redirección del extracto sin destino')
      url=new URL(location,url).href;continue
    }
    if(!r.ok){await r.body?.cancel();const error=Error('Geofabrik HTTP '+r.status);error.status=r.status;error.url=url;throw error}
    const bytes=Number(r.headers.get('content-length'))
    if(!Number.isSafeInteger(bytes)||bytes<1000||bytes>source.maxBytes){await r.body?.cancel();throw Error('Tamaño de extracto no válido')}
    return {response:r,url,bytes}
  }
  throw Error('Demasiadas redirecciones del extracto')
}
export function extractosRecientesDelIndice(html,source,now=Date.now()) {
  if(typeof html!=='string'||Buffer.byteLength(html)>2*1024*1024||!Object.hasOwn(SOURCE_PREFIX,source.id)||!Number.isFinite(now))throw Error('Índice oficial de extractos no válido')
  const base=new URL('./index.html',SOURCE_PREFIX[source.id]),today=new Date(now),midnight=Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())
  const recent=new Map(Array.from({length:3},(_,age)=>[new Date(midnight-age*86400000).toISOString().slice(2,10).replaceAll('-',''),age]))
  const candidates=new Map();let links=0
  const markup=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
  for(const match of markup.matchAll(/<a\b[^>]{0,4096}?\shref\s*=\s*(?:"([^"]{1,2048})"|'([^']{1,2048})'|([^\s"'<>]{1,2048}))/gi)){
    if(++links>10000)throw Error('Índice oficial con demasiados enlaces')
    let url;try{url=new URL(match[1]||match[2]||match[3],base).href}catch{continue}
    if(!urlExtractoPermitida(url,source.id))continue
    const date=/-(\d{6})\.osm\.pbf$/.exec(url)?.[1]
    if(recent.has(date))candidates.set(url,recent.get(date))
  }
  return [...candidates].sort((a,b)=>a[1]-b[1]).slice(0,3).map(([url])=>url)
}
async function leeIndiceOficialExtractos(source,io) {
  const url=new URL('./index.html',SOURCE_PREFIX[source.id]).href
  const response=await (io.fetch||fetch)(url,{redirect:'error',headers:{'Accept':'text/html','User-Agent':'EspanaUtil/servicios (+https://webapp-3ft.pages.dev)'},signal:AbortSignal.timeout(30000)})
  const declared=response.headers.get('content-length')
  if(!response.ok||!response.body||!/^text\/html\b/i.test(response.headers.get('content-type')||'')||declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>2*1024*1024)){
    await response.body?.cancel();throw Error('No se pudo comprobar el índice oficial de Geofabrik')
  }
  const reader=response.body.getReader(),decoder=new TextDecoder('utf8',{fatal:true});let size=0,html=''
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw Error('Índice oficial de Geofabrik demasiado grande')}html+=decoder.decode(value,{stream:true})}
    return html+decoder.decode()
  }finally{reader.releaseLock()}
}
export async function compruebaExtracto(source,io={}) {
  let missing
  try{return await peticionExtracto(source,'HEAD',io)}catch(error){
    // A publication race may leave latest pointing at an absent dated file.
    // Authentication, server errors and unsafe redirects are not fallback cases.
    if(error.status!==404||source.url!==SOURCE_PREFIX[source.id]+'latest.osm.pbf')throw error
    missing=error.url
  }
  const html=await leeIndiceOficialExtractos(source,io)
  for(const url of extractosRecientesDelIndice(html,source,io.now??Date.now())){
    if(url===missing)continue
    try{
      const checked=await peticionExtracto({...source,url},'HEAD',io)
      if(checked.url!==url)throw Error('El extracto fechado cambió de destino')
      console.log('Geofabrik '+source.id+': latest no disponible; se comprobará la fecha original de la copia publicada '+url.split('/').at(-1)+'.')
      return checked
    }catch(error){if(error.status!==404)throw error}
  }
  throw Error('Geofabrik no ofrece un extracto publicado comprobable de los últimos tres días')
}
export async function descargaExtracto(source,file,io={},checked) {
  if(checked&&(source.url!==checked.url||!urlExtractoPermitida(checked.url,source.id)||!Number.isSafeInteger(checked.bytes)))throw Error('Comprobación de extracto no válida')
  const result=await peticionExtracto(source,'GET',io)
  if(checked&&(result.url!==checked.url||result.bytes!==checked.bytes)){await result.response.body?.cancel();throw Error('El extracto cambió desde la comprobación; no se utiliza otra versión')}
  if(!result.response.body)throw Error('Extracto vacío')
  let received=0
  const guard=new Transform({transform(chunk,_encoding,done){received+=chunk.length;done(received>source.maxBytes?Error('Extracto supera el límite'):null,chunk)}})
  await pipeline(Readable.fromWeb(result.response.body),guard,createWriteStream(file,{flags:'wx'}))
  if(received!==result.bytes)throw Error('Descarga incompleta del extracto')
  return {url:result.url,bytes:received}
}
export async function descargaLimiteTerritorial(file,consultado,io={}) {
  const response=await (io.fetch||fetch)(SERVICIOS_LIMITE_URL,{redirect:'error',headers:{'Accept':'application/geo+json','User-Agent':'EspanaUtil/servicios (+https://webapp-3ft.pages.dev)'},signal:AbortSignal.timeout(5*60000)})
  if(!response.ok||!response.body||!/(?:application\/(?:geo\+)?json)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('IGN no entregó la geometría territorial')}
  let bytes=0;const digest=createHash('sha256')
  const guard=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;digest.update(chunk);done(bytes>200*1024*1024?Error('Límite territorial demasiado grande'):null,chunk)}})
  await pipeline(Readable.fromWeb(response.body),guard,createWriteStream(file,{flags:'wx'}))
  if(bytes<1000)throw Error('Límite territorial vacío')
  return {fuenteUrl:SERVICIOS_LIMITE_URL,atribucion:SERVICIOS_LIMITE_ATRIBUCION,licencia:'CC-BY-4.0',consultado,bytes,sha256:digest.digest('hex'),administraciones:19}
}
export async function* lineasServicios(file) {
  // readline también trata U+2028 como salto; dentro de un JSON es parte de
  // una dirección válida. El formato NDJSON separa registros sólo con LF.
  let pending=''
  for await(const chunk of createReadStream(file,{encoding:'utf8'})){
    pending+=chunk
    let end
    while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(Buffer.byteLength(line)>64000)throw Error('Registro demasiado grande');yield line}
    if(Buffer.byteLength(pending)>64000)throw Error('Registro demasiado grande')
  }
  if(pending)yield pending
}
export async function leePois(file,now=Date.now()) {
  const rows=new Map();let lines=0,rejected=0
  for await(const line of lineasServicios(file)){
    if(++lines>1500000||Buffer.byteLength(line)>64000)throw Error('Extracto intermedio supera sus límites')
    const poi=normalizaServicio(JSON.parse(line))
    if(!poi){rejected++;continue}
    validaServicio(poi,now)
    const previous=rows.get(poi.id)
    if(!previous||Date.parse(poi.fechaEdicion||'1970-01-01')>=Date.parse(previous.fechaEdicion||'1970-01-01'))rows.set(poi.id,poi)
    if(rows.size>SERVICIOS_MAX_POIS)throw Error('Demasiados puntos; no se publica una muestra truncada')
  }
  return {pois:[...rows.values()],rejected,lines}
}
export function preparaSnapshot(pois,fuentes,ts=new Date().toISOString(),limiteTerritorial,productor) {
  if(productor!==undefined&&!productorServiciosValido(productor))throw Error('Huella del productor inválida')
  const unique=new Map(),now=Date.parse(ts)
  for(const p of pois){validaServicio(p,now);const old=unique.get(p.id);if(!old||Date.parse(p.fechaEdicion||'1970-01-01')>=Date.parse(old.fechaEdicion||'1970-01-01'))unique.set(p.id,p)}
  const groups=new Map(),counts={}
  for(const p of [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id))){
    const tile=servicioTileId(p.lat,p.lon)
    if(!groups.has(tile))groups.set(tile,[])
    groups.get(tile).push(p)
    for(const c of p.categorias)counts[c]=(counts[c]||0)+1
  }
  const files=new Map(),tiles=[];let totalBytes=0
  function partition(id,points){
    const content=JSON.stringify({schema:1,id,pois:points}),bytes=Buffer.byteLength(content),depth=id.split('.').length-1
    if((bytes>SERVICIOS_TARGET_TILE_BYTES||points.length>10000)&&depth<4){
      const children=new Map()
      for(const p of points){const child=servicioTileId(p.lat,p.lon,depth+1);if(!children.has(child))children.set(child,[]);children.get(child).push(p)}
      for(const [child,items] of [...children.entries()].sort(([a],[b])=>a.localeCompare(b)))partition(child,items)
      return
    }
    if(bytes>SERVICIOS_MAX_TILE_BYTES||points.length>10000)throw Error('Zona '+id+' demasiado densa; no se publica un extracto truncado')
    validaServiciosTile({schema:1,id,pois:points},now)
    totalBytes+=bytes;if(totalBytes>SERVICIOS_MAX_TOTAL_BYTES)throw Error('El conjunto supera el tamaño permitido')
    files.set(id,content);tiles.push({id,bbox:servicioTileBbox(id),count:points.length,bytes,sha256:hash(content)})
  }
  for(const [id,points] of [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)))partition(id,points)
  const index={schema:1,ts,fechaDatos:new Date(Math.min(...fuentes.map(f=>Date.parse(f.fechaDatos)))).toISOString(),licencia:'ODbL-1.0',atribucion:'© OpenStreetMap contributors',total:unique.size,categorias:Object.fromEntries(Object.entries(counts).sort(([a],[b])=>a.localeCompare(b))),tileSize:SERVICIOS_TILE_SIZE,fuentes,...(limiteTerritorial?{limiteTerritorial}:{}),...(productor?{productor:{version:1,sha256:productor.sha256}}:{}),tiles}
  validaServiciosIndex(index,now)
  return {index,files}
}
// Compatibility reader used ONLY to establish continuity during a rebuild.
// It validates schema-1 metadata and checksums, without interpreting old POI
// fields against the current catalog/normalizer. It never serves or republishes
// those old POI. Normal readers and guardaSnapshot retain full validation.
function validaIndiceProductorAnterior(index,now) {
  const fail=()=>{throw Error('Copia anterior con estructura inválida')}
  const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))
  if(!index||index.schema!==1||index.tileSize!==0.25||index.licencia!=='ODbL-1.0'||index.atribucion!=='© OpenStreetMap contributors')fail()
  if(!iso(index.ts)||!iso(index.fechaDatos)||Date.parse(index.ts)>now+300000||Date.parse(index.fechaDatos)>Date.parse(index.ts)+300000)fail()
  if(!Number.isSafeInteger(index.total)||index.total<1||index.total>SERVICIOS_MAX_POIS||!Array.isArray(index.tiles)||index.tiles.length<1||index.tiles.length>5000)fail()
  if(!index.categorias||Array.isArray(index.categorias)||Object.entries(index.categorias).some(([key,n])=>!/^[-a-z0-9]{1,80}$/.test(key)||!Number.isSafeInteger(n)||n<1||n>index.total)||Object.values(index.categorias).reduce((a,b)=>a+b,0)<index.total)fail()
  if(!Array.isArray(index.fuentes)||index.fuentes.length<1||index.fuentes.length>2)fail()
  const sourceIds=new Set()
  for(const source of index.fuentes){
    if(!source||sourceIds.has(source.id)||!urlExtractoPermitida(source.url,source.id)||!iso(source.fechaDatos)||!iso(source.consultado)||Date.parse(source.fechaDatos)>Date.parse(source.consultado)+300000||Date.parse(source.consultado)>Date.parse(index.ts)+300000||!Number.isSafeInteger(source.bytes)||source.bytes<1000||source.bytes>3e9)fail()
    sourceIds.add(source.id)
  }
  if(Date.parse(index.fechaDatos)!==Math.min(...index.fuentes.map(source=>Date.parse(source.fechaDatos))))fail()
  if(index.limiteTerritorial!==undefined){
    const limit=index.limiteTerritorial
    if(!limit||typeof limit.fuenteUrl!=='string'||!limit.fuenteUrl.startsWith('https://api-features.ign.es/')||typeof limit.atribucion!=='string'||!limit.atribucion||limit.licencia!=='CC-BY-4.0'||!iso(limit.consultado)||Date.parse(limit.consultado)>Date.parse(index.ts)+300000||!Number.isSafeInteger(limit.bytes)||limit.bytes<1000||limit.bytes>200*1024*1024||!/^[a-f0-9]{64}$/.test(limit.sha256)||limit.administraciones!==19)fail()
  }
  const seen=new Set();let count=0,bytes=0
  for(const tile of index.tiles){
    if(!tile||typeof tile.id!=='string'||seen.has(tile.id)||!Number.isSafeInteger(tile.count)||tile.count<1||tile.count>10000||!Number.isSafeInteger(tile.bytes)||tile.bytes<1||tile.bytes>SERVICIOS_MAX_TILE_BYTES||!/^[a-f0-9]{64}$/.test(tile.sha256)||JSON.stringify(tile.bbox)!==JSON.stringify(servicioTileBbox(tile.id)))fail()
    seen.add(tile.id);count+=tile.count;bytes+=tile.bytes
  }
  for(const id of seen){let ancestor=id;while(ancestor.includes('.')){ancestor=ancestor.slice(0,ancestor.lastIndexOf('.'));if(seen.has(ancestor))fail()}}
  if(count!==index.total||bytes>SERVICIOS_MAX_TOTAL_BYTES)fail()
}
export async function leeSnapshot(dir,now=Date.now(),options={}) {
  let index
  try{index=JSON.parse(await readFile(join(dir,'index.json'),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}
  if(index.productor!==undefined&&!productorServiciosValido(index.productor))throw Error('Huella del productor anterior inválida')
  if(options.allowOldProducer!==undefined&&!productorServiciosValido(options.allowOldProducer))throw Error('Huella del productor actual inválida')
  const rebuilding=Boolean(options.allowOldProducer&&(!index.productor||index.productor.sha256!==options.allowOldProducer.sha256))
  if(rebuilding)validaIndiceProductorAnterior(index,now)
  else validaServiciosIndex(index,now)
  for(const entry of index.tiles){
    const content=await readFile(join(dir,'tiles',entry.id+'.json'))
    if(content.length!==entry.bytes||hash(content)!==entry.sha256)throw Error('Copia anterior corrupta: '+entry.id)
    const tile=rebuilding?JSON.parse(content):validaServiciosTile(JSON.parse(content),now)
    if(!tile||tile.schema!==1||tile.id!==entry.id||!Array.isArray(tile.pois)||tile.pois.length!==entry.count)throw Error('Índice anterior incoherente')
  }
  return index
}
export async function guardaSnapshot(snapshot,outputDir) {
  const out=resolve(outputDir),parent=dirname(out)
  if(basename(out)!=='servicios')throw Error('El destino debe ser una carpeta servicios')
  await mkdir(parent,{recursive:true})
  const stage=await mkdtemp(join(parent,'.servicios-nuevo-')),backup=out+'.anterior-'+Date.now()
  // Todas las rutas de sustitución están dentro del padre del destino nombrado.
  if(dirname(stage)!==parent||dirname(backup)!==parent)throw Error('Destino temporal inesperado')
  let saved=false
  try{
    validaServiciosIndex(snapshot.index)
    if(snapshot.files.size!==snapshot.index.tiles.length)throw Error('Ficheros e índice incoherentes')
    const allowed=new Set(snapshot.index.tiles.map(t=>t.id))
    await mkdir(join(stage,'tiles'))
    for(const [id,content] of snapshot.files){if(!allowed.has(id))throw Error('Fichero de zona inesperado');await writeFile(join(stage,'tiles',id+'.json'),content)}
    await writeFile(join(stage,'index.json'),JSON.stringify(snapshot.index))
    await leeSnapshot(stage)
    try{await rename(out,backup);saved=true}catch(error){if(error.code!=='ENOENT')throw error}
    try{await rename(stage,out)}catch(error){if(saved)await rename(backup,out);throw error}
    if(saved)await rm(backup,{recursive:true,force:true})
  }catch(error){await rm(stage,{recursive:true,force:true});throw error}
}
export function coberturaRegionalServicios(index) {
  const counts={espana:0,canarias:0}
  for(const tile of index.tiles){
    const [west,south,east,north]=tile.bbox
    // Los índices ya están validados. Se incluye la celda de borde exterior
    // de 0,25°: cambiar la profundidad del quadtree no cambia la región.
    const canarias=west>=-19&&east<=-12.75&&south>=27&&north<=30.25
    counts[canarias?'canarias':'espana']+=tile.count
  }
  return counts
}
export function validaContinuidadServicios(previous,next) {
  if(!previous)return
  if(next.total<previous.total*0.7)throw Error('Caída de cobertura superior al 30%; se conserva la copia válida')
  const before=coberturaRegionalServicios(previous),after=coberturaRegionalServicios(next)
  for(const region of ['espana','canarias']){
    if(before[region]>0&&after[region]<before[region]*0.7)throw Error('Caída de cobertura superior al 30% en '+(region==='canarias'?'Canarias':'España sin Canarias')+'; se conserva la copia válida')
  }
}
export async function main() {
  const out=resolve(process.env.SERVICIOS_OUTPUT_DIR||join(ROOT,'public/data/servicios'))
  const now=Date.now(),ts=new Date(now).toISOString()
  const productor=await huellaProductorServicios()
  const previous=await leeSnapshot(out,now,{allowOldProducer:productor})
  const workRoot=join(ROOT,'.tmp');await mkdir(workRoot,{recursive:true})
  const temporary=await mkdtemp(join(workRoot,'servicios-fetch-')),filters=join(temporary,'filters.json')
  await writeFile(filters,JSON.stringify(OSM_TAG_FILTERS))
  const sources=[],all=[]
  try{
    for(const source of SERVICIOS_FUENTES){
      const file=join(temporary,source.id+'.osm.pbf'),rows=join(temporary,source.id+'.ndjson')
      console.log('Consultando extracto '+source.id+'…')
      const checked=await compruebaExtracto(source)
      // Sólo omitimos ambas descargas si todo el snapshot validado corresponde
      // a las mismas versiones publicadas y al mismo código del productor.
      sources.push({source,checked,file,rows})
    }
    const index=consultaSnapshotSinCambios(previous,sources.map(s=>({id:s.source.id,url:s.checked.url,bytes:s.checked.bytes})),productor,ts)
    if(index){
      await writeFile(join(out,'index.json.tmp'),JSON.stringify(index));await rename(join(out,'index.json.tmp'),join(out,'index.json'))
      console.log('Extractos y productor sin cambios: se conserva cada fecha de datos y sólo se registra la consulta.')
      return
    }
    const boundary=join(temporary,'limite-territorial.geojson')
    const limiteTerritorial=await descargaLimiteTerritorial(boundary,ts)
    const provenance=[]
    for(const {source,checked,file,rows} of sources){
      const downloaded=await descargaExtracto({...source,url:checked.url},file,{},checked)
      const result=spawnSync(process.env.SERVICIOS_PYTHON||'python',['scripts/osm-servicios.py','--input',file,'--output',rows,'--filters',filters,'--boundary',boundary],{cwd:ROOT,encoding:'utf8',timeout:20*60000,maxBuffer:1024*1024})
      if(result.status!==0)throw Error('No se pudo procesar '+source.id+': '+String(result.stderr||result.error||'').slice(0,500))
      const meta=JSON.parse(result.stdout.trim()),fecha=Date.parse(meta.fechaDatos)
      if(!Number.isFinite(fecha)||fecha>now+300000||now-fecha>72*3600000)throw Error('Fecha original de '+source.id+' no vigente')
      const parsed=await leePois(rows,now)
      if(parsed.pois.length<source.minCount)throw Error('Extracto '+source.id+' incompleto: '+parsed.pois.length+' servicios')
      if(meta.sinGeometria>Math.max(100,meta.candidatos*0.03))throw Error('Demasiadas geometrías ausentes en '+source.id)
      for(const p of parsed.pois)all.push(p)
      provenance.push({id:source.id,url:downloaded.url,fechaDatos:new Date(fecha).toISOString(),consultado:ts,bytes:downloaded.bytes})
      console.log(JSON.stringify({fuente:source.id,fechaDatos:meta.fechaDatos,servicios:parsed.pois.length,descartados:parsed.rejected,sinGeometria:meta.sinGeometria,fueraTerritorio:meta.fueraTerritorio}))
      await rm(file);await rm(rows)
    }
    const snapshot=preparaSnapshot(all,provenance,ts,limiteTerritorial,productor)
    validaContinuidadServicios(previous,snapshot.index)
    await guardaSnapshot(snapshot,out)
    console.log('Servicios: '+snapshot.index.total+' puntos en '+snapshot.index.tiles.length+' zonas. Fuente: OpenStreetMap, ODbL-1.0.')
  }finally{if(dirname(temporary)===workRoot)await rm(temporary,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1})
