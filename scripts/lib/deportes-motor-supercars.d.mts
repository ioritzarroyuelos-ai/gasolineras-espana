import type { CompeticionDeportiva, EventoDeportivo, IncidenciaDeportes, TablaDeportiva, ResultadoSesionDeportiva } from './deportes.mjs'
export const fuenteSupercars: string
export const fuenteCronoJerez: string
type SesionJerez = EventoDeportivo & { tipo: string; numero: number; grupo: string }
export function interpretaIndiceSupercars(html: string, ano: number): { rondas: EventoDeportivo[]; puntosUrl: string }
export function interpretaPuntosSupercars(texto: string, fuenteUrl: string, verificadoEn: string): TablaDeportiva[]
export function interpretaSesionesCronoJerez(html: string, ronda: EventoDeportivo, ano: number): SesionJerez[]
export function interpretaResultadoCronoJerez(texto: string, sesion: SesionJerez, ano: number, verificadoEn: string): ResultadoSesionDeportiva
export function ampliaSupercars(c: CompeticionDeportiva, leer: (url: string, headers?: Record<string, string>, pdf?: boolean) => Promise<string|Uint8Array>, ano: number, ahora: number, consultado: string, incidencias: IncidenciaDeportes[]): Promise<void>
