export interface FichaMunicipal {id:string;nombre:string;categorias:string[];lat:number;lon:number;zona:string;distanciaM:number;ubicacion:'punto'|'recinto';direccion?:string;municipio?:string;fechaEdicion?:string}
export interface ResumenMunicipal {ine:string;nombre:string;slug:string;provincia:string;provinciaSlug:string;centro:{lat:number;lon:number};radioM:5000;total:number;categorias:Record<string,number>;lugares:FichaMunicipal[]}
export interface BloqueMunicipal {archivo:string;bytes:number;sha256:string;municipios:string[]}
export interface CentroIndiceMunicipal {ine:string;nombre:string;slug:string;total:number;bloque:number}
export interface IndiceMunicipal {schema:1;provincia:string;bloques:BloqueMunicipal[];centros:CentroIndiceMunicipal[]}
export interface CatalogoMunicipal {schema:1;radioM:5000;muestra:12;consultado:string;fechaDatos:string;centros:{fuente:'AEMET maestro/municipios';generado:string;consultado:string;fechaDatos?:string|null;sha256:string};fuente:{url:'https://www.openstreetmap.org/copyright';licencia:'ODbL-1.0';atribucion:'© OpenStreetMap contributors';indexSha256:string};limiteTerritorial?:{fuenteUrl:string;atribucion:string;licencia:'CC-BY-4.0'};totalPuntos:number;totalCentros:number;conResultados:number;sinResultados:number;provincias:{id:string;archivo:string;bytes:number;sha256:string;municipios:number}[]}
export const MUNICIPALES_RADIO_METROS:number
export const MUNICIPALES_MUESTRA:number
export const MUNICIPALES_MAX_BLOQUE:number
export const MUNICIPALES_MAX_INDICE:number
export const MUNICIPALES_TARGET_BLOQUE:number
export function distanciaMunicipal(centro:{lat:number;lon:number},punto:{lat:number;lon:number}):number
export function fichaMunicipal(p:import('./servicios.mjs').ServicioPoi,zona:string,distancia:number):FichaMunicipal
export function validaResumenMunicipal(m:unknown,provincia:string,now?:number):ResumenMunicipal
export function validaIndiceMunicipal(m:unknown,provincia:string):IndiceMunicipal
export function validaCatalogoMunicipal(m:unknown,now?:number):CatalogoMunicipal
export function contenidoMunicipalSuficiente(m:ResumenMunicipal):boolean
