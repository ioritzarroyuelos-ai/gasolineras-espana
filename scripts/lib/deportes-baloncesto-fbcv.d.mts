import type { ResultadoDeportes, OpcionesDeportes } from './deportes.mjs'
export function esLigaNacionalOW(nombre: unknown): boolean
export function basePublicaFbcv(html: string, federacion?: string): string
export function basePublicaBaleares(javascript: string): string
export function categoriasFbcv(datos: unknown, temporada: string, zona: string, genero: string): Array<{ codigo: string; nombre: string; familia: string; grupos: null }>
export function obtieneBaloncestoFbcv(opciones?: OpcionesDeportes & Record<string, unknown>, fuenteId?: string): Promise<ResultadoDeportes>
export function obtieneBaloncestoOtrasOW(opciones?: OpcionesDeportes & Record<string, unknown>): Promise<ResultadoDeportes>
