export type DisponibilidadModo = 'diario' | 'temporal'
export type DisponibilidadFuente = 'aparcamientos-madrid' | 'aparcamientos-vigo' | 'bicis-zaragoza'
export type DisponibilidadObjetivo = 'plazas' | 'bicis' | 'anclajes'
export interface DisponibilidadSolicitud { fuente: DisponibilidadFuente; lugarId: string; objetivo: DisponibilidadObjetivo; hora?: string; consentimiento: 'disponibilidad-telegram-v1'; version: string; peticion: string }
export const DISPONIBILIDAD_CONSENTIMIENTO: 'disponibilidad-telegram-v1'
export const DISPONIBILIDAD_INTERVALO: number
export const DISPONIBILIDAD_VENTANA: number
export const DISPONIBILIDAD_DIARIO_ESPERA: number
export const DISPONIBILIDAD_CAMBIOS_DIA: number
export const DISPONIBILIDAD_RETENCION: number
export function disponibilidadSeudonimo(chat: number): Promise<string>
export function disponibilidadMadrid(now?: number): { fecha: string; hora: string }
export function disponibilidadIdentidad(fuente: unknown, id: unknown, objetivo: unknown): boolean
export function disponibilidadSolicitud(input: unknown, modo: unknown): input is DisponibilidadSolicitud
export function disponibilidadProximoDiario(hora: string, now: number, diaExcluido?: string): number
export function disponibilidadClaveEvento(item: { modo: DisponibilidadModo; id: string }, now: number): string
export function disponibilidadCifraVigente(item: unknown, now: number): boolean
export function disponibilidadMensaje(item: { modo: DisponibilidadModo; objetivo: DisponibilidadObjetivo }, ficha: { nombre: string; cantidad: number; fechaDato: string; enlace: string; fuenteUrl: string }): string
export function disponibilidadEnviar(bot: string, chat: number, text: string, request?: typeof fetch): Promise<{ estado: 'enviado' | 'incierto' | 'reintentar' | 'baja'; espera?: number }>
