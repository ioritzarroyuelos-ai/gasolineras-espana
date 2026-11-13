export interface ComprobacionTarifa {total?:number[]; pages?:number[]; checks:RegExp[]}
export declare const COMPROBACIONES_TARIFAS: Record<string,ComprobacionTarifa>
export declare function textoTarifas(raw:unknown): string
export declare function compruebaTextoTarifa(id:string,raw:string,ahora?:Date): boolean
export declare function descargaTextoTarifa(url:string,pages?:number[],fetcher?:typeof fetch): Promise<string>
export declare function compruebaFuenteTarifa(fuente:{id:string;url:string},ahora?:Date,descargar?:typeof descargaTextoTarifa,opciones?:{esperar?:(ms:number)=>Promise<void>;respaldo?:((id:string,source:string)=>Promise<Uint8Array>)|null}): Promise<{id:string;url:string;checkedAt:string;intentos:number;via?:'directa'|'respaldo';estado:'verificada'|'cambiada'|'no_disponible';error?:string;codigo?:string;codigoDirecto?:string;codigoRespaldo?:string}>
