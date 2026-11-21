export const AEMET_MAESTRO_URL:string
export function urlDatosMaestro(raw:unknown):string|null
export function preparaMaestroMunicipios(raw:unknown,previous:unknown,options:{consultado:string;fechaDatos?:string|null;metadatos?:unknown;sha256?:string}):Record<string,any>
export function actualizaMaestroMunicipios(options:{output:string;statusPath:string;key?:string;fetcher?:typeof fetch;now?:number}):Promise<{correcto:boolean;status:Record<string,any>}>
