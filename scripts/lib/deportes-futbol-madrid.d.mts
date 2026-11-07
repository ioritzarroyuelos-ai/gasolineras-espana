import type { EventoDeportivo, TablaDeportiva } from './deportes.mjs'
import type { EsperadaNovanet } from './deportes-futbol-novanet.mjs'
export function paginaMadrid(html: string): Record<string, unknown>
export function categoriasMadrid(datos: unknown): Array<{ codigo: string; nombre: string; familia: string; grupos: null }>
export function gruposMadrid(json: string): Array<{ codigo: string; nombre: string }>
export function jornadasMadrid(json: string): Array<{ codigo: string; nombre: string }>
export function parseaAgendaMadrid(json: string, esperada: EsperadaNovanet, fuenteUrl: string): EventoDeportivo[]
export function parseaClasificacionMadrid(html: string, esperada: EsperadaNovanet): TablaDeportiva[]
