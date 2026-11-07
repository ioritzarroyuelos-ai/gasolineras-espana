import type { CompeticionDeportiva, OpcionesDeportes, ResultadoDeportes } from './deportes.mjs'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
export interface PortalGesdeportiva { id: string; nombre: string; zona: string; url: string; reloj?: string; delegaciones?: boolean }
export const PORTALES_GESDEPORTIVA: PortalGesdeportiva[]
export function documentoGesdeportiva(html: string): import('node-html-parser').HTMLElement
export function formularioGesdeportiva(html: string, campo: string, codigo: string): URLSearchParams
export function grupoGesdeportiva(html: string, contexto: { portal: PortalGesdeportiva; url: string; grupo: string; categoria?: string; delegacion?: string; temporada?: { codigo: string; nombre: string } }, ahora?: number): CompeticionDeportiva
export function obtieneBaloncestoGesdeportiva(opciones?: OpcionesDeportes & { portalesGesdeportiva?: PortalGesdeportiva[]; estadoNovanet?: Record<string, EstadoNovanet>; guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => Promise<unknown> | void; relojGesdeportiva?: () => number; duermeGesdeportiva?: (ms: number) => Promise<void> }): Promise<ResultadoDeportes>
