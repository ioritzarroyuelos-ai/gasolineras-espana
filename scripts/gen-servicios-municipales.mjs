// Derivación diaria de datos comprobados. No consulta ni registra GPS de usuarios.
import {open,mkdir,writeFile,rename,readdir,rm,lstat} from 'node:fs/promises'
import {resolve,dirname,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'
import {validaServiciosIndex,validaServiciosTile,SERVICIOS_MAX_TILE_BYTES} from './lib/servicios.mjs'
import {PROVINCIAS_INE} from './lib/provincias-ine.mjs'
import {distanciaMunicipal,fichaMunicipal,validaResumenMunicipal,validaIndiceMunicipal,validaCatalogoMunicipal,contenidoMunicipalSuficiente,MUNICIPALES_RADIO_METROS,MUNICIPALES_MUESTRA,MUNICIPALES_TARGET_BLOQUE,MUNICIPALES_MAX_BLOQUE,MUNICIPALES_MAX_INDICE} from './lib/servicios-municipales.mjs'
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const provincias=new Map(PROVINCIAS_INE.map(p=>[p.id,p]))

export async function leeArchivoAcotado(path,max){
  const file=await open(path,'r')
  try{
    const stat=await file.stat();if(!stat.isFile()||stat.size>max)throw Error('Archivo de entrada demasiado grande o no regular')
    const parts=[];let total=0
    for(;;){const buffer=Buffer.alloc(Math.min(65536,max-total+1)),{bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;total+=bytesRead;if(total>max)throw Error('Archivo de entrada creció fuera del límite');parts.push(buffer.subarray(0,bytesRead))}
    return Buffer.concat(parts,total)
  }finally{await file.close()}
}
export function validaCentrosMunicipales(raw,now=Date.now()){
  if(raw?.fuente!=='AEMET maestro/municipios'||!Array.isArray(raw.municipios)||raw.municipios.length<1||raw.municipios.length>10000||raw.total!==raw.municipios.length||!Number.isFinite(Date.parse(raw.generado))||Date.parse(raw.generado)>now+300000)throw Error('Catálogo de puntos AEMET inválido')
  if(raw.consultado!==undefined&&(!Number.isFinite(Date.parse(raw.consultado))||Date.parse(raw.consultado)<Date.parse(raw.generado)||Date.parse(raw.consultado)>now+300000))throw Error('Consulta del catálogo AEMET inválida')
  if(raw.fechaDatos!=null&&(!Number.isFinite(Date.parse(raw.fechaDatos))||Date.parse(raw.fechaDatos)>now||Date.parse(raw.fechaDatos)>Date.parse(raw.consultado||raw.generado)))throw Error('Fecha original del catálogo AEMET inválida')
  const seen=new Set()
  for(const m of raw.municipios){
    const p=provincias.get(m.provinciaId)
    if(!p||typeof m.ine!=='string'||!/^\d{5}$/.test(m.ine)||!m.ine.startsWith(p.id)||seen.has(m.ine)||typeof m.nombre!=='string'||!m.nombre.trim()||m.nombre.length>180||typeof m.slug!=='string'||!(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).test(m.slug)||m.provinciaSlug!==p.slug||m.provinciaNombre!==p.name||!Number.isFinite(m.lat)||!Number.isFinite(m.lng)||!((m.lat>=35&&m.lat<=44.5&&m.lng>=-10&&m.lng<=4.5)||(m.lat>=27&&m.lat<=30&&m.lng>=-19&&m.lng<=-13)))throw Error('Punto municipal AEMET inválido o repetido')
    seen.add(m.ine)
  }
  return raw
}

export function resumeMunicipios(pois,centros){
  const grid=new Map(),step=.05,ids=new Set(),radius=MUNICIPALES_RADIO_METROS,R=6371008.8,rad=Math.PI/180
  for(const p of pois){if(ids.has(p.id))throw Error('Punto OSM repetido');ids.add(p.id);const key=Math.floor(p.lat/step)+','+Math.floor(p.lon/step);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(p)}
  const output=[]
  for(const m of centros){
    const centro={lat:m.lat,lon:m.lng},dy=radius/R/rad,dx=Math.asin(Math.sin(radius/R)/Math.cos(m.lat*rad))/rad,near=[]
    for(let y=Math.floor((m.lat-dy)/step);y<=Math.floor((m.lat+dy)/step);y++)for(let x=Math.floor((m.lng-dx)/step);x<=Math.floor((m.lng+dx)/step);x++)for(const p of grid.get(y+','+x)||[]){const d=distanciaMunicipal(centro,p);if(d<=radius)near.push({p,d})}
    // Ausencia en OSM, no ausencia del servicio ni fallo de descarga.
    if(!near.length)continue
    near.sort((a,b)=>a.d-b.d||(a.p.id<b.p.id?-1:a.p.id>b.p.id?1:0))
    const categorias={};for(const {p} of near)for(const c of p.categorias)categorias[c]=(categorias[c]||0)+1
    output.push({ine:m.ine,nombre:m.nombre,slug:m.slug,provincia:m.provinciaNombre,provinciaSlug:m.provinciaSlug,centro,radioM:radius,total:near.length,categorias,lugares:near.slice(0,MUNICIPALES_MUESTRA).map(({p,d})=>fichaMunicipal(p,p.zona,d))})
  }
  return output.sort((a,b)=>a.ine.localeCompare(b.ine,'en'))
}

export function empaquetaMunicipios(rows){
  const files=new Map(),descriptors=[],report={conResultados:rows.length,contenidoSuficiente:0,muestrasDuplicadas:0},signatures=new Set()
  const add=(kind,obj,max)=>{const data=Buffer.from(JSON.stringify(obj));if(data.length>max)throw Error('Partición municipal demasiado grande');const sha256=hash(data),archivo=kind+'/'+sha256+'.json';files.set(archivo,data);return {archivo,bytes:data.length,sha256}}
  for(const provincia of provincias.keys()){
    const group=rows.filter(m=>m.ine.startsWith(provincia));if(!group.length)continue
    const blocks=[];let current=[]
    for(const m of group){
      validaResumenMunicipal(m,provincia)
      const sig=m.lugares.map(p=>p.id).sort().join(',');if(signatures.has(sig))report.muestrasDuplicadas++;signatures.add(sig)
      if(contenidoMunicipalSuficiente(m))report.contenidoSuficiente++
      if(current.length&&(Buffer.byteLength(JSON.stringify([...current,m]))>MUNICIPALES_TARGET_BLOQUE||current.length>=128)){blocks.push(current);current=[]}
      current.push(m)
    }
    if(current.length)blocks.push(current)
    const index={schema:1,provincia,bloques:[],centros:[]}
    for(const [number,block] of blocks.entries()){
      index.bloques.push({...add('bloques',block,MUNICIPALES_MAX_BLOQUE),municipios:block.map(m=>m.ine)})
      index.centros.push(...block.map(m=>({ine:m.ine,nombre:m.nombre,slug:m.slug,total:m.total,bloque:number})))
    }
    validaIndiceMunicipal(index,provincia)
    descriptors.push({id:provincia,...add('provincias',index,MUNICIPALES_MAX_INDICE),municipios:group.length})
  }
  return {files,provincias:descriptors,report}
}

function child(root,path){const full=resolve(root,path);if(!full.startsWith(root+sep))throw Error('Ruta de salida fuera del directorio');return full}
export async function publicaMunicipios(output,index,files){
  const root=resolve(output);await mkdir(root,{recursive:true});if((await lstat(root)).isSymbolicLink())throw Error('La salida no puede ser un enlace')
  // Los archivos con hash son inmutables. La referencia raíz cambia al final.
  for(const [path,data] of files){if(!/^(bloques|provincias)\/[a-f0-9]{64}\.json$/.test(path))throw Error('Artefacto municipal inválido');const dest=child(root,path);await mkdir(dirname(dest),{recursive:true});try{await writeFile(dest,data,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e;const existing=await leeArchivoAcotado(dest,Math.max(MUNICIPALES_MAX_BLOQUE,MUNICIPALES_MAX_INDICE));if(!existing.equals(data))throw Error('Artefacto con hash inconsistente')}}
  const temporary=child(root,'.index-'+randomUUID()+'.json')
  try{await writeFile(temporary,JSON.stringify(index));await rename(temporary,child(root,'index.json'))}finally{await rm(temporary,{force:true})}
  // Limpieza sólo después de publicar la referencia completa, por archivo y con
  // ruta verificada. Nunca borra directorios ajenos ni una copia todavía usada.
  for(const kind of ['bloques','provincias']){const dir=child(root,kind);await mkdir(dir,{recursive:true});for(const entry of await readdir(dir,{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{64}\.json$/.test(entry.name)&&!files.has(kind+'/'+entry.name))await rm(child(root,kind+'/'+entry.name))}
}

export async function generaServiciosMunicipales({source=resolve(ROOT,'public/data/servicios'),municipios=resolve(ROOT,'public/data/tiempo/municipios.json'),output=resolve(ROOT,'public/data/servicios-municipales'),now=Date.now()}={}){
  const sourceBytes=await leeArchivoAcotado(resolve(source,'index.json'),2*1024*1024),index=validaServiciosIndex(JSON.parse(sourceBytes),now)
  const centrosBytes=await leeArchivoAcotado(municipios,4*1024*1024),centros=validaCentrosMunicipales(JSON.parse(centrosBytes),now),pois=[]
  if(centros.total<7000||new Set(centros.municipios.map(m=>m.provinciaId)).size!==52)throw Error('El catálogo nacional de puntos está incompleto')
  for(const meta of index.tiles){const bytes=await leeArchivoAcotado(resolve(source,'tiles',meta.id+'.json'),SERVICIOS_MAX_TILE_BYTES);if(bytes.length!==meta.bytes||hash(bytes)!==meta.sha256)throw Error('Integridad OSM no verificable');const tile=validaServiciosTile(JSON.parse(bytes),now);if(tile.id!==meta.id||tile.pois.length!==meta.count)throw Error('Recuento OSM incoherente');pois.push(...tile.pois.map(p=>({...p,zona:meta.id})))}
  if(pois.length!==index.total)throw Error('Cobertura OSM incompleta')
  const rows=resumeMunicipios(pois,centros.municipios),packed=empaquetaMunicipios(rows)
  const catalog={schema:1,radioM:MUNICIPALES_RADIO_METROS,muestra:MUNICIPALES_MUESTRA,consultado:index.ts,fechaDatos:index.fechaDatos,centros:{fuente:centros.fuente,generado:centros.generado,consultado:centros.consultado||centros.generado,sha256:hash(centrosBytes)},fuente:{url:'https://www.openstreetmap.org/copyright',licencia:index.licencia,atribucion:index.atribucion,indexSha256:hash(sourceBytes)},totalPuntos:index.total,totalCentros:centros.total,conResultados:rows.length,sinResultados:centros.total-rows.length,provincias:packed.provincias}
  if(index.limiteTerritorial)catalog.limiteTerritorial={fuenteUrl:index.limiteTerritorial.fuenteUrl,atribucion:index.limiteTerritorial.atribucion,licencia:index.limiteTerritorial.licencia}
  catalog.centros.fechaDatos=centros.fechaDatos??null
  validaCatalogoMunicipal(catalog,now)
  await publicaMunicipios(output,catalog,packed.files)
  return {...packed.report,sinResultados:catalog.sinResultados,archivos:packed.files.size+1,bytes:[...packed.files.values()].reduce((n,b)=>n+b.length,0)+Buffer.byteLength(JSON.stringify(catalog)),consultado:catalog.consultado,fechaDatos:catalog.fechaDatos}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={};for(let n=0;n<args.length;n+=2){const key={'--source':'source','--municipios':'municipios','--output':'output'}[args[n]];if(!key||!args[n+1])throw Error('Argumentos de generación municipal inválidos');options[key]=resolve(args[n+1])}
  generaServiciosMunicipales(options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1})
}
