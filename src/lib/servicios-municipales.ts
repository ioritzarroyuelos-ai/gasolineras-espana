import {validaCatalogoMunicipal,validaIndiceMunicipal,validaResumenMunicipal,MUNICIPALES_MAX_BLOQUE,MUNICIPALES_MAX_INDICE,type CatalogoMunicipal,type IndiceMunicipal,type ResumenMunicipal,type BloqueMunicipal} from '../../scripts/lib/servicios-municipales.mjs'
export type {CatalogoMunicipal,IndiceMunicipal,ResumenMunicipal}
type Assets={fetch:(req:Request)=>Promise<Response>}
type Descriptor={archivo:string;bytes:number;sha256:string}
export class MunicipalesError extends Error {}
const fail=():never=>{throw new MunicipalesError('No se puede comprobar este directorio de proximidad')}
const roots=new WeakMap<Assets,{at:number;promise:Promise<CatalogoMunicipal>}>()
const chunks=new WeakMap<Assets,Map<string,Promise<unknown>>>()

async function readAsset(assets:Assets|undefined,path:string,max:number){
  if(!assets)return fail()
  const r=await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/servicios-municipales/'+path,{signal:AbortSignal.timeout(10000)}))
  if(!r.ok||!r.body)return fail()
  const len=r.headers.get('content-length')
  if(len!==null&&(!/^\d+$/.test(len)||Number(len)>max)){await r.body.cancel();return fail()}
  const reader=r.body.getReader(),parts:Uint8Array[]=[];let total=0
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();return fail()}parts.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(total);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length}return bytes
}
const parse=(bytes:Uint8Array):unknown=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{return fail()}}

export async function cargaCatalogoMunicipal(assets:Assets|undefined,now=Date.now()):Promise<CatalogoMunicipal>{
  if(!assets)return fail()
  const old=roots.get(assets);if(old&&old.at<=now&&now-old.at<30000)return old.promise
  const promise=readAsset(assets,'index.json',MUNICIPALES_MAX_INDICE).then(b=>validaCatalogoMunicipal(parse(b),now))
  const entry={at:now,promise};entry.promise=promise.catch(error=>{if(roots.get(assets)===entry)roots.delete(assets);throw error});roots.set(assets,entry);return entry.promise
}
async function cargaBloque(assets:Assets|undefined,desc:Descriptor,max:number):Promise<unknown>{
  if(!assets)return fail()
  let cache=chunks.get(assets);if(!cache){cache=new Map();chunks.set(assets,cache)}
  const key=desc.archivo+'|'+desc.bytes,old=cache.get(key);if(old){cache.delete(key);cache.set(key,old);return old}
  const promise=(async()=>{const bytes=await readAsset(assets,desc.archivo,max);if(bytes.byteLength!==desc.bytes)return fail();const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(n=>n.toString(16).padStart(2,'0')).join('');if(sha!==desc.sha256)return fail();return parse(bytes)})()
  cache.set(key,promise);while(cache.size>16)cache.delete(cache.keys().next().value!)
  try{return await promise}catch(error){if(cache.get(key)===promise)cache.delete(key);throw error}
}
export async function cargaProvinciaMunicipal(assets:Assets|undefined,provincia:string,now=Date.now()){
  if(!/^\d{2}$/.test(provincia))return null
  const catalogo=await cargaCatalogoMunicipal(assets,now),meta=catalogo.provincias.find(p=>p.id===provincia)
  if(!meta)return null
  const indice=validaIndiceMunicipal(await cargaBloque(assets,meta,MUNICIPALES_MAX_INDICE),provincia)
  if(indice.centros.length!==meta.municipios)return fail()
  return {catalogo,indice}
}
export async function cargaResumenMunicipal(assets:Assets|undefined,ine:string,now=Date.now()){
  if(!/^\d{5}$/.test(ine))return null
  const province=await cargaProvinciaMunicipal(assets,ine.slice(0,2),now)
  if(!province)return null
  const {catalogo,indice}=province,centro=indice.centros.find(m=>m.ine===ine)
  if(!centro)return null
  const desc:BloqueMunicipal=indice.bloques[centro.bloque],raw=await cargaBloque(assets,desc,MUNICIPALES_MAX_BLOQUE)
  if(!Array.isArray(raw)||raw.length!==desc.municipios.length||raw.some((m,n)=>!m||typeof m!=='object'||m.ine!==desc.municipios[n]))return fail()
  const resumen=validaResumenMunicipal(raw.find(m=>m.ine===ine),ine.slice(0,2),now)
  if(resumen.nombre!==centro.nombre||resumen.slug!==centro.slug||resumen.total!==centro.total)return fail()
  return {catalogo,indice,resumen}
}
export function estadoMunicipal(catalogo:CatalogoMunicipal,now=Date.now()){
  return {copiaAntigua:now-Date.parse(catalogo.consultado)>30*3600000||now-Date.parse(catalogo.fechaDatos)>72*3600000,centrosSinRevisar:now-Date.parse(catalogo.centros.consultado)>30*3600000}
}
