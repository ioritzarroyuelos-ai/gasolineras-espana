import type { EventoDeportivo, TablaDeportiva, OpcionesDeportes, ResultadoDeportes } from './deportes.mjs'
type GrupoAlava = { codigo: string; nombre: string; categoria: string }
export function gruposAlava(html: string): GrupoAlava[]
export function calendarioAlava(html: string, grupo: GrupoAlava, ahora?: number): { eventos: EventoDeportivo[]; temporada: string }
export function clasificacionAlava(html: string, grupo: GrupoAlava): TablaDeportiva[]
export function obtieneBaloncestoAlava(opciones?: OpcionesDeportes & Record<string, unknown> & { relojAlava?: () => number; duermeAlava?: (ms: number) => Promise<void> }): Promise<ResultadoDeportes>
