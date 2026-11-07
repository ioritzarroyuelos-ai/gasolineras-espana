import type { EventoDeportivo, OpcionesDeportes, ResultadoDeportes, TablaDeportiva } from './deportes.mjs'
export interface GrupoGipuzkoa { temporadaId: string; referencia: string; referenciaNombre: string; categoria: string; grupo: string; nombre: string }
export function horaGipuzkoa(fecha: string, hora: string): string | null
export function descubreGipuzkoa(html: string, ahora?: number): { temporada: string; temporadaId: string; referencias: Array<{ id: string; nombre: string }>; ultima: string; proxima: string }
export function gruposGipuzkoa(html: string, temporadaId: string, referencia: { id: string; nombre: string }): GrupoGipuzkoa[]
export function calendarioGipuzkoa(html: string, grupo: GrupoGipuzkoa, temporada: string, ahora?: number): EventoDeportivo[]
export function clasificacionGipuzkoa(html: string, grupo: GrupoGipuzkoa): TablaDeportiva[]
export function obtieneBaloncestoTerritorial(opciones?: OpcionesDeportes): Promise<ResultadoDeportes>
