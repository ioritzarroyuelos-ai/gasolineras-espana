import type { EventoDeportivo, OpcionesDeportes, ResultadoSesionDeportiva, TablaDeportiva } from './deportes.mjs'
export const clasificacionesRfedaHtml: Array<{id: string; url: string; marca: string}>
export function interpretaClasificacionesRfedaHtml(html: string, marca: string, ano: number, fuenteUrl: string, verificadoEn: string): TablaDeportiva[]
export function leerPdfMotor(url: string, opciones?: OpcionesDeportes): Promise<Uint8Array>
export function interpretaClasificacionTcrPdf(datos: Uint8Array, ano: number, fuenteUrl: string, verificadoEn: string): Promise<TablaDeportiva[]>
export function interpretaPaginasClasificacionTcr(paginas: string[], ano: number, fuenteUrl: string, verificadoEn: string): TablaDeportiva[]
export function rondasTcr(html: string, ano: number): Array<{id: string; nombre: string; rango: string; fuenteUrl: string; documentos: Array<{nombre: string; url: string}>}>
export function rondasCerx(html: string, ano: number): EventoDeportivo[]
export function interpretaResultadoTcrTexto(texto: string, sesion: string, ano: number, fuenteUrl: string, verificadoEn: string): ResultadoSesionDeportiva
export function interpretaResultadoTcrPdf(datos: Uint8Array, sesion: string, ano: number, fuenteUrl: string, verificadoEn: string): Promise<ResultadoSesionDeportiva>
