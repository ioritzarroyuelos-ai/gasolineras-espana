import {validaCatalogoMunicipal} from './servicios-municipales.mjs'
const record=(name,updatedAt,count,issue)=>({name,updatedAt:updatedAt||null,count,...(issue?{issue}:{})})
export function estadoDerivacionMunicipal(raw,now=Date.now()){
  try{const data=validaCatalogoMunicipal(raw,now);return [record('Derivación del directorio',data.consultado,1,now-Date.parse(data.fechaDatos)>72*3600000?'La copia de OpenStreetMap tiene más de 72 horas.':undefined)]}catch{return [record('Derivación del directorio',null,0,'No hay un resumen de proximidad comprobable.')]}
}
export function estadoMaestroMunicipal(raw,catalog,now=Date.now()){
  const name='Maestro de AEMET',consulta=Date.parse(raw?.consultado),ultimo=Date.parse(raw?.ultimoExito)
  const dates=Number.isFinite(consulta)&&Number.isFinite(ultimo)&&ultimo<=consulta&&consulta<=now+300000
  const fecha=raw?.fechaDatos===null||typeof raw?.fechaDatos==='string'&&Number.isFinite(Date.parse(raw.fechaDatos))&&Date.parse(raw.fechaDatos)<=ultimo
  const valid=raw?.schema===1&&['actual','conservada','error'].includes(raw.estado)&&Number.isInteger(raw.total)&&raw.total>=7000&&raw.total<=10000&&dates&&fecha&&(raw.estado!=='actual'||raw.consultado===raw.ultimoExito)
  const sourceMatches=catalog?.fuente==='AEMET maestro/municipios'&&Array.isArray(catalog.municipios)&&catalog.total===raw?.total&&catalog.total===catalog.municipios.length&&(catalog.consultado||catalog.generado)===raw?.ultimoExito
  const issue=!valid||!sourceMatches?'No se puede comprobar una revisión coherente del maestro de municipios.':raw.estado!=='actual'?'La consulta de AEMET falló; se conserva el último catálogo válido.':undefined
  return [record(name,Number.isFinite(ultimo)?raw.ultimoExito:null,valid&&sourceMatches?raw.total:0,issue)]
}
