import type {IndicePreciosComparacion,BloquePreciosComparacion} from './precios-comparacion.mjs'
export function preparaComparacionPrecios(snapshot:unknown,dir:string,options?:{now?:Date;previousSnapshot?:unknown;previousMeta?:unknown}):Promise<{comparison:{index:IndicePreciosComparacion;bloques:BloquePreciosComparacion[];artifacts:{archivo:string;content:string}[]};recuperada:boolean;previousId:string|null}>
export function leeComparacionPrevia(dir:string):{index:IndicePreciosComparacion;bloques:BloquePreciosComparacion[]}|null
export function guardaComparacionPrecios(dir:string,result:{index:IndicePreciosComparacion;artifacts:{archivo:string;content:string}[]},previousId?:string|null):void
