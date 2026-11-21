export function abiertoServicio(horario:unknown,lat:number,lon:number,now?:number):boolean|null
export interface PlazoServicio {absoluto:number;monotono:number}
export function plazoServicio(caduca:string,evaluadoEn:string,inicioWall:number,inicioMono:number):PlazoServicio|null
export function restanteServicio(plazo:PlazoServicio|null,nowWall?:number,nowMono?:number):number
export function vigenteServicio(plazo:PlazoServicio|null,nowWall?:number,nowMono?:number):boolean
export function biciServicioActual(poi:{actualizado?:string|null;caduca?:string|null;estado?:string}|null,now?:number):boolean
export function zonasServicios(bounds:{south:number;north:number;west:number;east:number}):string[]
export function distanciaServicio(a:{lat:number;lon:number}|null,b:{lat:number;lon:number}|null):number|null
export function enlacesServicio(poi:{lat:number;lon:number}):{google:string;apple:string;waze:string}|null
