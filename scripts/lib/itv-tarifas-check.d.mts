export interface ComprobacionTarifa {total?:number[]; pages?:number[]; checks:RegExp[]}
export declare const COMPROBACIONES_TARIFAS: Record<string,ComprobacionTarifa>
export declare function textoTarifas(raw:unknown): string
export declare function compruebaTextoTarifa(id:string,raw:string,ahora?:Date): boolean
export declare function descargaTextoTarifa(url:string,pages?:number[],fetcher?:typeof fetch): Promise<string>
export declare function compruebaFuenteTarifa(fuente:{id:string;url:string},ahora?:Date,descargar?:typeof descargaTextoTarifa): Promise<{id:string;url:string;checkedAt:string;estado:'verificada'|'cambiada'|'no_disponible';error?:string}>
