import type { EventoDeportivo, TablaDeportiva, ResultadoDeportes, OpcionesDeportes } from './deportes.mjs'
export function listasGalicia(datos: unknown): Array<{ codigo: string; nombre: string }>
export function visorGalicia(html: string): string
export function calendarioGalicia(html: string, grupo: string, fuenteUrl: string, ahora?: number): { eventos: EventoDeportivo[]; temporada: string; anos: number[] }
export function clasificacionGalicia(html: string, grupo: string): TablaDeportiva[]
export function obtieneBaloncestoGalicia(opciones?: OpcionesDeportes & Record<string, unknown>): Promise<ResultadoDeportes>
