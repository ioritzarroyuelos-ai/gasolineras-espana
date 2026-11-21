export interface ServicioPoi {
  id:string;categorias:string[];nombre:string;lat:number;lon:number;direccion?:string;municipio?:string;cp?:string;telefono?:string;web?:string;horario?:string;
  gratis:boolean|null;accesible:'si'|'limitado'|'no'|'desconocido';acceso:'publico'|'clientes'|'privado'|'desconocido';fechaEdicion?:string;fuenteUrl:string;ubicacion:'punto'|'recinto'
}
export interface ServicioTile {schema:1;id:string;pois:ServicioPoi[]}
export interface ServicioFuente {id:'espana'|'canarias';url:string;fechaDatos:string;consultado:string;bytes:number}
export interface ServicioLimiteTerritorial {fuenteUrl:string;atribucion:string;licencia:'CC-BY-4.0';consultado:string;bytes:number;sha256:string;administraciones:19}
export interface ServiciosIndex {schema:1;ts:string;fechaDatos:string;licencia:'ODbL-1.0';atribucion:string;total:number;categorias:Record<string,number>;tileSize:number;fuentes:ServicioFuente[];limiteTerritorial?:ServicioLimiteTerritorial;tiles:{id:string;bbox:number[];count:number;bytes:number;sha256:string}[]}
export const SERVICIOS_TILE_SIZE:number
export const SERVICIOS_MAX_TILE_BYTES:number
export const SERVICIOS_TARGET_TILE_BYTES:number
export const SERVICIOS_MAX_TOTAL_BYTES:number
export const SERVICIOS_MAX_POIS:number
export const SERVICIOS_ID_RE:RegExp
export const SERVICIOS_TILE_RE:RegExp
export const SERVICIOS_LIMITE_URL:string
export const SERVICIOS_LIMITE_ATRIBUCION:string
export function servicioTileId(lat:number,lon:number,depth?:number):string
export function servicioTileBbox(id:string):number[]
export function servicioContienePunto(id:string,lat:number,lon:number):boolean
export function coordenadasServicio(lat:number,lon:number):boolean
export function webServicio(raw:unknown):string|undefined
export function normalizaServicio(raw:unknown):ServicioPoi|null
export function validaServicio(raw:unknown,now?:number):ServicioPoi
export function validaServiciosTile(raw:unknown,now?:number):ServicioTile
export function validaServiciosIndex(raw:unknown,now?:number):ServiciosIndex
