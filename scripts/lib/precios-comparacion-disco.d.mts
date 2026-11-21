import type {IndicePreciosComparacion,BloquePreciosComparacion} from './precios-comparacion.mjs'
export function leeComparacionPrevia(dir:string):{index:IndicePreciosComparacion;bloques:BloquePreciosComparacion[]}|null
export function guardaComparacionPrecios(dir:string,result:{index:IndicePreciosComparacion;artifacts:{archivo:string;content:string}[]},previousId?:string|null):void
