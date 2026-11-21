import type {ServicioPoi} from './lib/servicios.mjs'
import type {ResumenMunicipal,CatalogoMunicipal} from './lib/servicios-municipales.mjs'
export interface CentroMunicipal {ine:string;nombre:string;slug:string;provinciaNombre:string;provinciaSlug:string;lat:number;lng:number;provinciaId?:string}
export function leeArchivoAcotado(path:string,max:number):Promise<Buffer>
export function validaCentrosMunicipales(raw:unknown,now?:number):{fuente:string;generado:string;consultado?:string;total:number;municipios:CentroMunicipal[]}
export function resumeMunicipios(pois:(ServicioPoi&{zona:string})[],centros:CentroMunicipal[]):ResumenMunicipal[]
export function empaquetaMunicipios(rows:ResumenMunicipal[]):{files:Map<string,Buffer>;provincias:CatalogoMunicipal['provincias'];report:{conResultados:number;contenidoSuficiente:number;muestrasDuplicadas:number}}
export function publicaMunicipios(output:string,index:unknown,files:Map<string,Buffer>):Promise<void>
export function generaServiciosMunicipales(options?:{source?:string;municipios?:string;output?:string;now?:number}):Promise<Record<string,unknown>>
