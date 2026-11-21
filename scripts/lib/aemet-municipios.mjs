import {createHash,randomUUID} from 'node:crypto'
import {writeFile,rename,mkdir,rm} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {maestroAMunicipios} from './tiempo.mjs'
import {PROVINCIAS_INE} from './provincias-ine.mjs'
import {validaCentrosMunicipales,leeArchivoAcotado} from '../gen-servicios-municipales.mjs'
export const AEMET_MAESTRO_URL='https://opendata.aemet.es/opendata/api/maestro/municipios'
const legal='https://www.aemet.es/es/nota_legal',ua='EspanaUtil/municipios (+https://webapp-3ft.pages.dev)'
const sha=v=>createHash('sha256').update(v).digest('hex')
const contenido=rows=>JSON.stringify([...rows].sort((a,b)=>a.ine.localeCompare(b.ine,'en')))
export function urlDatosMaestro(raw){
  try{const u=new URL(raw);return u.protocol==='https:'&&u.hostname==='opendata.aemet.es'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/opendata\/sh\/[A-Za-z0-9_-]{4,120}$/.test(u.pathname)?u.href:null}catch{return null}
}
async function cuerpo(response,max){
  if(!response.ok||!response.body)throw Error('AEMET no entrega una respuesta válida')
  const len=response.headers.get('content-length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>max)){await response.body.cancel();throw Error('Respuesta de AEMET demasiado grande')}
  const reader=response.body.getReader(),parts=[];let total=0
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>max){await reader.cancel();throw Error('Respuesta de AEMET demasiado grande')}parts.push(value)}}finally{reader.releaseLock()}
  return Buffer.concat(parts.map(v=>Buffer.from(v)),total)
}
async function descargaJson(url,key,max,fetcher){
  // La clave sólo se envía al endpoint inicial exacto; nunca a las descargas.
  const r=await fetcher(url,{redirect:'manual',headers:{'User-Agent':ua,Accept:'application/json',...(url===AEMET_MAESTRO_URL?{api_key:key}:{})},signal:AbortSignal.timeout(15000)})
  const bytes=await cuerpo(r,max),charset=/charset=([^;\s]+)/i.exec(r.headers.get('content-type')||'')?.[1]?.toLowerCase()
  let text
  if(charset==='utf-8'||charset==='utf8')text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  else if(charset==='iso-8859-1'||charset==='latin1'||charset==='windows-1252')text=new TextDecoder('iso-8859-1').decode(bytes)
  else{try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{text=new TextDecoder('iso-8859-1').decode(bytes)}}
  return {raw:JSON.parse(text),bytes,modified:r.headers.get('last-modified')}
}
export function preparaMaestroMunicipios(raw,previous,{consultado,fechaDatos=null,metadatos=null,sha256}={}){
  const now=Date.parse(consultado)
  if(!Number.isFinite(now)||!Array.isArray(raw)||raw.length<7000||raw.length>10000)throw Error('Cobertura del maestro AEMET no válida')
  const municipios=maestroAMunicipios(raw,PROVINCIAS_INE).sort((a,b)=>a.ine.localeCompare(b.ine,'en'))
  if(municipios.length!==raw.length)throw Error('El maestro incluye fichas sin normalizar')
  if(fechaDatos!==null&&(!Number.isFinite(Date.parse(fechaDatos))||Date.parse(fechaDatos)>now))throw Error('Fecha original del maestro no válida')
  if(new Set(municipios.map(m=>m.provinciaId)).size!==52)throw Error('Falta alguna provincia en el maestro')
  const current={generado:consultado,consultado,fechaDatos,fuente:'AEMET maestro/municipios',fuenteUrl:AEMET_MAESTRO_URL,licenciaUrl:legal,atribucion:'Fuente: AEMET',total:municipios.length,municipios,sha256,metadatos}
  validaCentrosMunicipales(current,now)
  let prior=null;try{prior=validaCentrosMunicipales(previous,now)}catch{}
  if(prior&&municipios.length<prior.total*.99)throw Error('Pérdida de cobertura inesperada en el maestro')
  if(prior&&contenido(prior.municipios)===contenido(municipios)){
    current.generado=prior.generado
    // Una nueva consulta del mismo contenido no cambia la fecha de la copia.
    if(fechaDatos===null&&previous.fechaDatos&&Number.isFinite(Date.parse(previous.fechaDatos))&&Date.parse(previous.fechaDatos)<=now)current.fechaDatos=previous.fechaDatos
  }
  return current
}
async function atomico(path,data){await mkdir(dirname(path),{recursive:true});const temp=resolve(dirname(path),'.aemet-'+randomUUID()+'.json');try{await writeFile(temp,JSON.stringify(data));await rename(temp,path)}finally{await rm(temp,{force:true})}}
export async function actualizaMaestroMunicipios({output,statusPath,key,fetcher=fetch,now=Date.now()}={}){
  const consultado=new Date(now).toISOString();let previous=null
  try{previous=JSON.parse(await leeArchivoAcotado(output,4*1024*1024));validaCentrosMunicipales(previous,now);if(previous.total<7000||new Set(previous.municipios.map(m=>m.provinciaId)).size!==52)throw Error('Catálogo previo incompleto')}catch{previous=null}
  try{
    if(typeof key!=='string'||!key.trim())throw Error('No se dispone de la clave de AEMET')
    const first=await descargaJson(AEMET_MAESTRO_URL,key,256*1024,fetcher),dataUrl=urlDatosMaestro(first.raw?.datos),metadataUrl=first.raw?.metadatos===undefined?null:urlDatosMaestro(first.raw.metadatos)
    if(!dataUrl||first.raw.estado!==200||first.raw.metadatos!==undefined&&!metadataUrl)throw Error('AEMET no facilita archivos del maestro comprobables')
    const payload=await descargaJson(dataUrl,'',8*1024*1024,fetcher)
    const metadata=metadataUrl?await descargaJson(metadataUrl,'',128*1024,fetcher):null
    const mod=payload.modified?Date.parse(payload.modified):NaN
    if(payload.modified&&!Number.isFinite(mod))throw Error('AEMET publica una fecha original no interpretable')
    const current=preparaMaestroMunicipios(payload.raw,previous,{consultado,fechaDatos:Number.isFinite(mod)?new Date(mod).toISOString():null,metadatos:metadata?.raw??null,sha256:sha(payload.bytes)})
    await atomico(output,current)
    const status={schema:1,estado:'actual',consultado,ultimoExito:consultado,fechaDatos:current.fechaDatos,total:current.total}
    await atomico(statusPath,status);return {correcto:true,status}
  }catch{
    // Un fallo no reescribe nombres, puntos o fecha del catálogo anterior.
    const status={schema:1,estado:previous?'conservada':'error',consultado,ultimoExito:previous?.consultado||previous?.generado||null,fechaDatos:previous?.fechaDatos||null,total:previous?.total||0,error:'No se ha podido comprobar el maestro de municipios de AEMET. Se conserva la última copia válida cuando existe.'}
    await atomico(statusPath,status);return {correcto:false,status}
  }
}
