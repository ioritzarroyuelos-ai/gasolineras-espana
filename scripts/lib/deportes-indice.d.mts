import type { CompeticionDeportiva, IncidenciaDeportes } from './deportes.mjs'
import type { IndiceDeportes, EventoAgenda } from '../../src/lib/deportes'
export const ZONAS_DEPORTES: Record<string, string>
export function diaDeporte(fecha: string | number, zona?: string): string
export function diasDeporte(ahora: number): string[]
export function construyeIndiceDeportes(competiciones: CompeticionDeportiva[], incidencias: IncidenciaDeportes[], ahora?: number): { indice: IndiceDeportes; agendas: Record<string, EventoAgenda[]> }
