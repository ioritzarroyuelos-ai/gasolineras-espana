import type { HTMLElement } from 'node-html-parser'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
import type { OpcionesFutbol } from './deportes-futbol.mjs'
import type { EventoDeportivo, TablaDeportiva, ResultadoDeportes, CompeticionDeportiva } from './deportes.mjs'
export interface EsperadaNovanet { fuenteId?: string; nombre?: string; competicion: string; grupo: string; jornada?: string; temporada: string }
export const FUENTES_NOVANET: Array<{ id: string; nombre: string; zona: string; base: string; primaria: string }>
export function parseaCatalogoNovanet(html: string): Omit<NonNullable<EstadoNovanet['catalogo']>, 'verificadoEn'>
export function parseaSelectorNovanet(html: string, nombre: string): Array<{ codigo: string; nombre: string }>
export function numeroVisualNovanet(nodo: HTMLElement, mapa?: number[]): number
export function parseaAgendaNovanet(html: string, esperada: EsperadaNovanet, fuenteUrl: string): EventoDeportivo[]
export function parseaJornadasPaginaNovanet(html: string, esperada: EsperadaNovanet): Array<{ codigo: string; nombre: string }>
export function parseaClasificacionNovanet(html: string, esperada: EsperadaNovanet, fuenteUrl: string): TablaDeportiva[]
export function categoriaDuplicadaNovanet(categoria: { nombre: string; familia: string }, fuenteId: string): boolean
export function idGrupoNovanet(fuenteId: string, categoria: { nombre: string; familia: string }, grupo: { codigo: string; nombre: string }): string
export function eligeReintentoNovanet(fuenteId: string, estado: EstadoNovanet, ahora: number, cubiertos?: string[]): { categoria: number; grupo: number } | null
export function fusionaCompeticionesFutbol(anteriores: CompeticionDeportiva[], nuevas: CompeticionDeportiva[]): CompeticionDeportiva[]
export function obtieneNovanet(opciones?: OpcionesFutbol): Promise<ResultadoDeportes & { rfefResueltas: string[]; fuentesIntentadas: string[]; estadisticas: Array<{ fuente: string; peticiones: number; bytes: number }> }>
