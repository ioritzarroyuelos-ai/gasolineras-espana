import type { ResultadoDeportes, OpcionesDeportes, EventoDeportivo, TablaDeportiva } from './deportes.mjs'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
export const CALENDARIO_CEUTA: string
export interface TemporadaCeuta { id: string; nombre: string; desde: string; hasta: string }
export interface GrupoCeuta { id: string; nombre: string; competicion: string; tipo: string }
export function conexionPublicaCeuta(html: string): string
export function temporadaCeuta(datos: unknown, ahora?: number): TemporadaCeuta
export function gruposCeuta(datos: unknown): GrupoCeuta[]
export function calendarioCeuta(datos: unknown, grupo: GrupoCeuta, temporada: TemporadaCeuta, ahora?: number): { eventos: EventoDeportivo[]; equipos: Map<string, string> }
export function clasificacionCeuta(datos: unknown, grupo: GrupoCeuta, equipos?: Map<string, string>): TablaDeportiva[]
export function obtieneBaloncestoCeuta(opciones?: OpcionesDeportes & { relojCeuta?: () => number; duermeCeuta?: (ms: number) => Promise<void>; estadoNovanet?: Record<string, EstadoNovanet>; guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => void | Promise<void> }): Promise<ResultadoDeportes>
