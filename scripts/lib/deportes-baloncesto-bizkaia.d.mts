import type { CompeticionDeportiva, OpcionesDeportes, ResultadoDeportes } from './deportes.mjs'
export interface ContextoBaloncestoOW {
  id: string
  temporada: { codigo: string; nombre: string }
  categoria: { codigo: string; nombre: string; familia: string }
  grupo: { codigo: string; nombre: string }
  zona: string
  fuenteUrl: string
  fuenteNombre: string
  territorio?: string
}
export function basePublicaBizkaia(html: string): { base: string; zona: string }
export function respuestaBaloncestoOW(raw: string): unknown
export function temporadaBaloncestoOW(datos: unknown, ahora?: number): { codigo: string; nombre: string }
export function grupoBaloncestoOW(datos: unknown[], contexto: ContextoBaloncestoOW, ahora?: number): CompeticionDeportiva
export function obtieneBaloncestoBizkaia(opciones?: OpcionesDeportes & {
  estadoNovanet?: Record<string, unknown>
  guardarEstadoNovanet?: (id: string, estado: unknown) => void | Promise<void>
  relojBizkaia?: () => number
  duermeBizkaia?: (ms: number) => Promise<void>
}): Promise<ResultadoDeportes>
