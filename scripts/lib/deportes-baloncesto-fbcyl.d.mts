import type { ResultadoDeportes, OpcionesDeportes } from './deportes.mjs'
export function opcionesFbcyl(html: string, selector?: string): Array<{ codigo: string; nombre: string }>
export function contextoFbcyl(html: string): { temporada: { codigo: string; nombre: string }; territorios: Array<{ codigo: string; nombre: string }>; generos: string[] }
export function basePublicaFbcyl(html: string): string
export function obtieneBaloncestoFbcyl(opciones?: OpcionesDeportes & Record<string, unknown>): Promise<ResultadoDeportes>
