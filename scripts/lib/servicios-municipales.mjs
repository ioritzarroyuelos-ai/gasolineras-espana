// Directorio por proximidad a puntos públicos de AEMET. No delimita municipios.
import {SERVICIOS_IDS} from './servicios-catalogo.mjs'
import {SERVICIOS_ID_RE,SERVICIOS_TILE_RE,coordenadasServicio,servicioContienePunto,SERVICIOS_LIMITE_URL,SERVICIOS_LIMITE_ATRIBUCION} from './servicios.mjs'
import {PROVINCIAS_INE} from './provincias-ine.mjs'

export const MUNICIPALES_RADIO_METROS=5000
export const MUNICIPALES_MUESTRA=12
export const MUNICIPALES_MAX_BLOQUE=128*1024
export const MUNICIPALES_MAX_INDICE=128*1024
export const MUNICIPALES_TARGET_BLOQUE=32*1024
const provincias=new Map(PROVINCIAS_INE.map(p=>[p.id,p]))
const fail=()=>{throw Error('Directorio de proximidad no verificable')}
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)
const text=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s)
const slug=s=>typeof s==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)&&s.length<=180
const iso=(s,now)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().replace('.000Z','Z')===s.replace('.000Z','Z')&&Date.parse(s)<=now+300000
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=800000

export function distanciaMunicipal(centro,punto){
  const rad=Math.PI/180,dy=(punto.lat-centro.lat)*rad,dx=(punto.lon-centro.lon)*rad
  return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(Math.sin(dy/2)**2+Math.cos(centro.lat*rad)*Math.cos(punto.lat*rad)*Math.sin(dx/2)**2)))
}

export function fichaMunicipal(p,zona,distancia){
  const row={id:p.id,nombre:p.nombre,categorias:p.categorias,lat:p.lat,lon:p.lon,zona,distanciaM:Math.round(distancia),ubicacion:p.ubicacion}
  for(const key of ['direccion','municipio','fechaEdicion'])if(p[key]!==undefined)row[key]=p[key]
  return row
}

export function validaResumenMunicipal(m,provincia,now=Date.now()){
  const p=provincias.get(provincia)
  if(!p||!object(m)||typeof m.ine!=='string'||!/^\d{5}$/.test(m.ine)||!m.ine.startsWith(provincia)||!text(m.nombre,180)||!slug(m.slug)||m.provincia!==p.name||m.provinciaSlug!==p.slug)fail()
  if(!object(m.centro)||!coordenadasServicio(m.centro.lat,m.centro.lon)||m.radioM!==MUNICIPALES_RADIO_METROS||!positive(m.total)||!object(m.categorias))fail()
  const categorias=Object.entries(m.categorias)
  if(!categorias.length||categorias.length>SERVICIOS_IDS.size||categorias.some(([id,n])=>!SERVICIOS_IDS.has(id)||!positive(n)||n>m.total)||categorias.reduce((n,[,v])=>n+v,0)<m.total)fail()
  if(!Array.isArray(m.lugares)||m.lugares.length!==Math.min(MUNICIPALES_MUESTRA,m.total))fail()
  const ids=new Set(),counts=new Map();let previous=-Infinity
  for(const row of m.lugares){
    if(!object(row)||!SERVICIOS_ID_RE.test(row.id)||ids.has(row.id)||!text(row.nombre,180)||!coordenadasServicio(row.lat,row.lon)||!SERVICIOS_TILE_RE.test(row.zona)||!servicioContienePunto(row.zona,row.lat,row.lon)||!['punto','recinto'].includes(row.ubicacion))fail()
    ids.add(row.id)
    if(!Array.isArray(row.categorias)||!row.categorias.length||row.categorias.length>12||new Set(row.categorias).size!==row.categorias.length||row.categorias.some(id=>!SERVICIOS_IDS.has(id)||!m.categorias[id]))fail()
    for(const id of row.categorias)counts.set(id,(counts.get(id)||0)+1)
    const d=distanciaMunicipal(m.centro,row)
    if(!Number.isInteger(row.distanciaM)||row.distanciaM<0||row.distanciaM>MUNICIPALES_RADIO_METROS||d>MUNICIPALES_RADIO_METROS+.001||Math.abs(row.distanciaM-d)>.501||d<previous-.001)fail()
    previous=d
    if(row.direccion!==undefined&&!text(row.direccion,180)||row.municipio!==undefined&&!text(row.municipio,100)||row.fechaEdicion!==undefined&&!iso(row.fechaEdicion,now))fail()
  }
  for(const [id,count] of counts)if(m.categorias[id]<count)fail()
  return m
}

const descriptor=(d,kind,max)=>object(d)&&typeof d.sha256==='string'&&/^[a-f0-9]{64}$/.test(d.sha256)&&d.archivo===kind+'/'+d.sha256+'.json'&&Number.isInteger(d.bytes)&&d.bytes>=2&&d.bytes<=max
export function validaCatalogoMunicipal(index,now=Date.now()){
  if(!object(index)||index.schema!==1||index.radioM!==MUNICIPALES_RADIO_METROS||index.muestra!==MUNICIPALES_MUESTRA||!iso(index.consultado,now)||!iso(index.fechaDatos,now)||Date.parse(index.fechaDatos)>now||Date.parse(index.fechaDatos)>Date.parse(index.consultado))fail()
  if(!object(index.centros)||index.centros.fuente!=='AEMET maestro/municipios'||!iso(index.centros.generado,now)||!iso(index.centros.consultado,now)||Date.parse(index.centros.generado)>Date.parse(index.centros.consultado)||!/^[a-f0-9]{64}$/.test(index.centros.sha256))fail()
  if(index.centros.fechaDatos!=null&&(!iso(index.centros.fechaDatos,now)||Date.parse(index.centros.fechaDatos)>Date.parse(index.centros.consultado)||Date.parse(index.centros.fechaDatos)>now))fail()
  if(!object(index.fuente)||index.fuente.url!=='https://www.openstreetmap.org/copyright'||index.fuente.licencia!=='ODbL-1.0'||index.fuente.atribucion!=='© OpenStreetMap contributors'||!/^[a-f0-9]{64}$/.test(index.fuente.indexSha256))fail()
  if(index.limiteTerritorial!==undefined&&(!object(index.limiteTerritorial)||index.limiteTerritorial.fuenteUrl!==SERVICIOS_LIMITE_URL||index.limiteTerritorial.atribucion!==SERVICIOS_LIMITE_ATRIBUCION||index.limiteTerritorial.licencia!=='CC-BY-4.0'))fail()
  if(!positive(index.totalPuntos)||!Number.isInteger(index.totalCentros)||index.totalCentros<1||index.totalCentros>10000||!Number.isInteger(index.conResultados)||index.conResultados<0||index.conResultados>index.totalCentros||!Number.isInteger(index.sinResultados)||index.sinResultados!==index.totalCentros-index.conResultados)fail()
  if(!Array.isArray(index.provincias)||index.provincias.length>52)fail()
  const seen=new Set();let total=0
  for(const p of index.provincias){if(!provincias.has(p.id)||seen.has(p.id)||!descriptor(p,'provincias',MUNICIPALES_MAX_INDICE)||!Number.isInteger(p.municipios)||p.municipios<1||p.municipios>1000)fail();seen.add(p.id);total+=p.municipios}
  if(total!==index.conResultados)fail()
  return index
}

export function validaIndiceMunicipal(index,provincia){
  if(!provincias.has(provincia)||!object(index)||index.schema!==1||index.provincia!==provincia)fail()
  if(!Array.isArray(index.bloques)||index.bloques.length>100)fail()
  const seen=new Set(),files=new Set()
  for(const b of index.bloques){
    if(!descriptor(b,'bloques',MUNICIPALES_MAX_BLOQUE)||files.has(b.archivo)||!Array.isArray(b.municipios)||!b.municipios.length||b.municipios.length>128)fail()
    files.add(b.archivo)
    for(const ine of b.municipios){if(typeof ine!=='string'||!/^\d{5}$/.test(ine)||!ine.startsWith(provincia)||seen.has(ine))fail();seen.add(ine)}
  }
  if(!Array.isArray(index.centros)||index.centros.length!==seen.size||index.centros.length>1000)fail()
  const centers=new Set()
  for(const m of index.centros){if(!object(m)||!seen.has(m.ine)||centers.has(m.ine)||!text(m.nombre,180)||!slug(m.slug)||!positive(m.total)||!Number.isInteger(m.bloque)||!index.bloques[m.bloque]?.municipios.includes(m.ine))fail();centers.add(m.ine)}
  return index
}

// Es un umbral editorial conservador del proyecto, no una regla de Google.
// Las páginas más escasas siguen siendo consultables, fuera del sitemap.
export function contenidoMunicipalSuficiente(m){
  return m.total>=6&&m.lugares.filter(p=>!p.nombre.includes('(sin nombre publicado)')).length>=4&&Object.keys(m.categorias).length>=3
}
