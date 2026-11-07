import type { EventoDeportivo, TablaDeportiva, OpcionesDeportes, ResultadoDeportes } from './deportes.mjs'
export function temporadaEuro(datos: any, codigo: string, ahora?: number): any
export function calendarioEuro(datos: any, temporada: any, fuenteUrl: string, ahora?: number): EventoDeportivo[]
export function clasificacionEuro(datos: any, calendario: any): TablaDeportiva[]
export function objetosFiba(html: string): { doc: any; objetos: any[] }
export function paginaFiba(html: string, codigo: string): any
export function calendarioFiba(pagina: any, fuenteUrl: string, ahora?: number): EventoDeportivo[]
export function clasificacionFiba(pagina: any): TablaDeportiva[]
export function obtieneBaloncestoEuropa(opciones?: OpcionesDeportes): Promise<ResultadoDeportes>
