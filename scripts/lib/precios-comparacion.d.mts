export type PreciosCuatro = [number|null,number|null,number|null,number|null]
export type FilaPrecio = [string,string,string,PreciosCuatro,PreciosCuatro]
export interface MetaPrecio {fechaFuente:string;fechaMinisterio:string;consultado:string}
export interface IndicePreciosComparacion {schema:1;consultado:string;snapshotId:string;actual:MetaPrecio;anterior:MetaPrecio|null;shards:Record<string,{archivo:string;bytes:number;sha256:string;total:number}>}
export interface BloquePreciosComparacion {schema:1;snapshotId:string;bucket:string;filas:FilaPrecio[]}
export const CUBOS_PRECIOS: number
export const MAX_BLOQUE_PRECIOS_BYTES: number
export function cuboPrecio(id:string):string
export function validaIndicePreciosComparacion(value:unknown,now?:number):value is IndicePreciosComparacion
export function validaBloquePreciosComparacion(value:unknown,index:IndicePreciosComparacion,bucket:string):value is BloquePreciosComparacion
export function construyePreciosComparacion(snapshot:unknown,opts?:{now?:Date;previousSnapshot?:unknown;previousMeta?:unknown;previousBundle?:unknown}):Promise<{index:IndicePreciosComparacion;bloques:BloquePreciosComparacion[];artifacts:{archivo:string;content:string}[]}>
