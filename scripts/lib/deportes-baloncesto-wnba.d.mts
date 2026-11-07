import type { EventoDeportivo, TablaDeportiva, ResultadoDeportes, OpcionesDeportes } from './deportes.mjs'
export function descubreTemporadaWnba(html: string): { temporada: string; equipos: string[] }
export function normalizaTablaWnba(html: string, contexto: { temporada: string; equipos: string[] }): TablaDeportiva[]
export function normalizaCalendarioWnba(datos: unknown, temporada: string, ahora?: number): EventoDeportivo[]
export function obtieneWnba(opciones?: OpcionesDeportes): Promise<ResultadoDeportes>
