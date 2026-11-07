import type { ResultadoDeportes, OpcionesDeportes, EventoDeportivo, TablaDeportiva } from './deportes.mjs'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
export const PAGINA_CONSELL: string
export interface CursoConsejo { portal: string; temporada: string; codigo: string; url: string }
export interface GrupoConsejo { codigo: string; nombre: string; grupo: string; fase: string; url: string; genero?: 'masculino' | 'femenino' | 'mixto' }
export function descubreConsejos(html: string): CursoConsejo[]
export function catalogoConsejo(html: string, origen: string, esperada: CursoConsejo): GrupoConsejo[]
export function identidadConsejo(html: string, grupo: Pick<GrupoConsejo, 'codigo' | 'url'>, curso: CursoConsejo): { jornada: string }
export function agendaConsejo(calendario: string, resultados: string, contexto: { portal: string; url: string; temporada: string }, ahora?: number): EventoDeportivo[]
export function clasificacionConsejo(html: string, grupo: string): TablaDeportiva[]
export function obtieneBaloncestoConsejos(opciones?: OpcionesDeportes & { relojConsejos?: () => number; duermeConsejos?: (ms: number) => Promise<void>; estadoNovanet?: Record<string, EstadoNovanet>; guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => void | Promise<void> }): Promise<ResultadoDeportes>
