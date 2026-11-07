import type { EventoDeportivo, TablaDeportiva, ResultadoDeportes, OpcionesDeportes, CompeticionDeportiva } from './deportes.mjs'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
export function leerLiteralFeb(texto: string, inicio?: number): any
export function codigoFuncion(texto: string, simbolo: string): string | undefined
export function decodificaRespuestaFeb(valor: unknown): any
export function datosPaginaFeb(html: string): { edicion: any; consultas: any[]; doc: any }
export function normalizaPartidosFeb(partidos: unknown, fuenteUrl: string): EventoDeportivo[]
export function normalizaTablaFeb(datos: unknown, id: string, nombre: string): TablaDeportiva
export function datosPaginaAcb(html: string): { data: any; resuelve: (valor: unknown) => any; temporada: string }
export function normalizaCalendarioAcb(html: string, fuenteUrl: string, verificadoEn: string): { eventos: EventoDeportivo[]; temporada: string }
export function normalizaClasificacionAcb(html: string): { tablas: TablaDeportiva[]; temporada: string }
export function normalizaNba(html: string, fechaEsperada?: string): { eventos: EventoDeportivo[]; temporada?: string }
export function normalizaClasificacionNba(datos: unknown, temporada: string): TablaDeportiva[]
export function enlacesEquiposNba(html: string): string[]
export function normalizaClasificacionEquiposNba(paginas: Array<{ url: string; html: string }>, temporada: string): TablaDeportiva[]
export function obtieneClasificacionEquiposNba(temporada: string, opciones?: OpcionesDeportes): Promise<TablaDeportiva[]>
export function compruebaLeaguePassEspana(html: string): boolean
export function obtieneBaloncesto(opciones?: OpcionesDeportes & { estadoNovanet?: Record<string, EstadoNovanet>; guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => void | Promise<void> }): Promise<ResultadoDeportes>
export function normalizaFinalBaseFeb(html: string, categoria: number, fuenteUrl: string, ahora?: number): CompeticionDeportiva

