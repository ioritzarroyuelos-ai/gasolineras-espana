export interface InformePendiente { empresa: string; url: string; publicacion: string; comprobado: string }
export function urlInformeMoreInCommon(valor: string): string | null
export function fetchInformeMoreInCommon(options: { hoy:string; comprobado:string; userAgent:string; fetchImpl?:typeof fetch; extraer?:(bytes:Uint8Array)=>Promise<string> }): Promise<InformePendiente>
export function informePendienteDeIncorporar(informe:InformePendiente, sondeos:Array<{empresa:string;publicacion?:string}>):InformePendiente | null
export function compruebaInformePendiente(sondeos:Array<{empresa:string;publicacion?:string}>, anterior:InformePendiente | undefined, opciones:Parameters<typeof fetchInformeMoreInCommon>[0]):Promise<{pendiente:InformePendiente | null;error?:string}>
