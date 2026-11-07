import type { CompeticionDeportiva, EventoDeportivo, IncidenciaDeportes, ResultadoSesionDeportiva, TablaDeportiva } from './deportes.mjs'
export function interpretaCatalogoFerrari(datos: unknown, ano: number): {sesiones: Array<EventoDeportivo & {sesion: string}>; clasificacion: string|null}
export function interpretaResultadoFerrari(texto: string, sesion: string, fuenteUrl: string, verificadoEn: string): ResultadoSesionDeportiva
export function interpretaPuntosFerrariPaginas(paginas: string[], ano: number, fuenteUrl: string, verificadoEn: string): TablaDeportiva[]
export function ampliaFerrari(c: CompeticionDeportiva, leer: (url: string, headers?: Record<string, string>, pdf?: boolean) => Promise<string|Uint8Array>, ano: number, ahora: number, consultado: string, incidencias: IncidenciaDeportes[]): Promise<void>
