import type { CompeticionDeportiva, EventoDeportivo, IncidenciaDeportes, ResultadoSesionDeportiva, TablaDeportiva } from './deportes.mjs'
export function interpretaRondasGb3(datos: unknown, ano: number, ahora: number): {eventos: EventoDeportivo[]; sesiones: Map<string, Record<string, unknown>>; rondas: Array<Record<string, unknown>>}
export function interpretaPilotosGb3(datos: unknown, ano: number, fuenteUrl: string, verificadoEn: string): TablaDeportiva
export function interpretaEquiposGb3(html: string, rondas: Array<Record<string, unknown>>, fuenteUrl: string, verificadoEn: string): TablaDeportiva
export function interpretaResultadoGb3(datos: unknown, sesion: Record<string, unknown>, ano: number, fuenteUrl: string, verificadoEn: string): ResultadoSesionDeportiva
export function ampliaGb3(c: CompeticionDeportiva, leer: (url: string) => Promise<string>, ano: number, ahora: number, consultado: string, incidencias: IncidenciaDeportes[]): Promise<void>
