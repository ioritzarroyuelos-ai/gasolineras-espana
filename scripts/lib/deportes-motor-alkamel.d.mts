import type {CompeticionDeportiva, IncidenciaDeportes, ResultadoSesionDeportiva} from './deportes.mjs'
export const fuenteAlkamelEspana: string
export function interpretaIndiceAlkamelEspana(html:string, ano:number): {temporada:string; eventos:Array<{valor:string; nombre:string; seleccionado:boolean}>}
export function interpretaSesionesAlkamelEspana(html:string, temporada:string, evento:string, ano:number, informa?:(motivo:string, fuenteUrl:string)=>void): Array<{competicionId:string; fecha:string; hora:string; sesion:string; fuenteUrl:string}>
export function interpretaResultadoAlkamelEspana(texto:string, sesion:string, fuenteUrl:string, verificadoEn:string): ResultadoSesionDeportiva
export function ampliaEspanaAlkamel(competiciones:CompeticionDeportiva[], leer:(url:string)=>Promise<string>, ano:number, ahora:number, consultado:string, incidencias:IncidenciaDeportes[]):Promise<void>
