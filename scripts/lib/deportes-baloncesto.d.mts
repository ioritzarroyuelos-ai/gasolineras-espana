import type { EventoDeportivo, TablaDeportiva, ResultadoDeportes, OpcionesDeportes, CompeticionDeportiva } from './deportes.mjs'
export function leerLiteralFeb(texto: string, inicio?: number): any
export function decodificaRespuestaFeb(valor: unknown): any
export function datosPaginaFeb(html: string): { edicion: any; consultas: any[]; doc: any }
export function normalizaPartidosFeb(partidos: unknown, fuenteUrl: string): EventoDeportivo[]
export function normalizaTablaFeb(datos: unknown, id: string, nombre: string): TablaDeportiva
export function datosPaginaAcb(html: string): { data: any; resuelve: (valor: unknown) => any; temporada: string }
export function normalizaCalendarioAcb(html: string, fuenteUrl: string, verificadoEn: string): { eventos: EventoDeportivo[]; temporada: string }
export function normalizaClasificacionAcb(html: string): { tablas: TablaDeportiva[]; temporada: string }
export function normalizaNba(html: string, fechaEsperada?: string): { eventos: EventoDeportivo[]; temporada?: string }
export function obtieneBaloncesto(opciones?: OpcionesDeportes): Promise<ResultadoDeportes>
export function normalizaFinalBaseFeb(html: string, categoria: number, fuenteUrl: string, ahora?: number): CompeticionDeportiva

