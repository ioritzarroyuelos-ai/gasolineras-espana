import type { EstadoFFCV } from './deportes-futbol.mjs'
export const HORARIO_DEPORTES_COMPLETO: string
export function seleccionaFuentesDeportes(fuentes?: string, programacion?: string): Set<'futbol' | 'baloncesto' | 'motor'>
export function recuperaEstadoFFCV(candidatos: unknown[], noAntes?: string): EstadoFFCV
export function checkpointFFCV(estado: unknown, ahora?: number): EstadoFFCV & { guardadoEn: string }
