import type { CompeticionDeportiva, OpcionesDeportes, ResultadoDeportes } from './deportes.mjs'
type ContextoAragon = { territorio: string; categoria: { codigo: string; nombre: string }; grupo: { codigo: string; nombre: string }; temporada: { codigo: string; nombre: string }; url: string }
export function catalogoAragon(html: string, territorio: string): any
export function formularioAragon(html: string, campo: string, codigo: string): URLSearchParams
export function grupoAragon(html: string, contexto: ContextoAragon, ahora?: number): CompeticionDeportiva
export function obtieneBaloncestoAragon(opciones?: OpcionesDeportes & Record<string, unknown>): Promise<ResultadoDeportes>
