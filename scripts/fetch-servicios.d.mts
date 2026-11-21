import type {ServicioPoi,ServicioFuente,ServicioLimiteTerritorial,ServiciosIndex} from './lib/servicios.mjs'
export interface FuenteExtracto {id:'espana'|'canarias';url:string;minCount:number;maxBytes:number}
export interface SnapshotServicios {index:ServiciosIndex;files:Map<string,string>}
export const SERVICIOS_FUENTES:FuenteExtracto[]
export function urlExtractoPermitida(url:unknown,id:string):boolean
export function mismoExtractoPublicado(anterior:{id:string;url:string;bytes:number}|undefined,actual:{id:string;url:string;bytes:number}):boolean
export function peticionExtracto(source:FuenteExtracto,method?:string,io?:{fetch?:typeof fetch}):Promise<{response:Response;url:string;bytes:number}>
export function descargaExtracto(source:FuenteExtracto,file:string,io?:{fetch?:typeof fetch}):Promise<{url:string;bytes:number}>
export function descargaLimiteTerritorial(file:string,consultado:string,io?:{fetch?:typeof fetch}):Promise<ServicioLimiteTerritorial>
export function lineasServicios(file:string):AsyncGenerator<string>
export function leePois(file:string,now?:number):Promise<{pois:ServicioPoi[];rejected:number;lines:number}>
export function preparaSnapshot(pois:ServicioPoi[],fuentes:ServicioFuente[],ts?:string,limiteTerritorial?:ServicioLimiteTerritorial):SnapshotServicios
export function leeSnapshot(dir:string,now?:number):Promise<ServiciosIndex|null>
export function guardaSnapshot(snapshot:SnapshotServicios,outputDir:string):Promise<void>
export function coberturaRegionalServicios(index:Pick<ServiciosIndex,'tiles'>):{espana:number;canarias:number}
export function validaContinuidadServicios(previous:Pick<ServiciosIndex,'tiles'|'total'>|null,next:Pick<ServiciosIndex,'tiles'|'total'>):void
export function main():Promise<void>
