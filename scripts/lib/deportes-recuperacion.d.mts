import type { CompeticionDeportiva } from './deportes.mjs'
import type { IndiceDeportes, EventoAgenda } from '../../src/lib/deportes'
export function parseaPRsRecuperacion(valor: unknown): Array<{ numero: number; sha: string }>
export function parseaFechaRecuperacion(valor: unknown, ahora?: number): number
export function validaPRRecuperacion(pr: unknown, objetivo: { numero: number; sha: string }): string
export function combinaRecuperacionDeportiva(actual: CompeticionDeportiva | undefined, recuperada: unknown, tipos?: Array<'agenda' | 'clasificacion'>, ahora?: number): CompeticionDeportiva
export function recuperaDeportesDesdePR(opciones: {
  seleccion: string; desde: string; indiceAnterior: unknown; anteriores: CompeticionDeportiva[];
  token?: string; fetcher?: typeof fetch; ahora?: number;
}): Promise<{ competiciones: CompeticionDeportiva[]; indice: IndiceDeportes; agendas: Record<string, EventoAgenda[]>;
  informe: { desde: string; snapshots: Array<{ pr: number; sha: string; generado: string }>; apartadosRecuperados: number; competicionesNuevas: number; peticiones: number; bytes: number } }>
