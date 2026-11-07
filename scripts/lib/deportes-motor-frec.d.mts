import type { CompeticionDeportiva, EventoDeportivo, IncidenciaDeportes, TablaDeportiva } from './deportes.mjs'
export function interpretaCalendarioFrec(datos: unknown, ano: number): EventoDeportivo[]
export function documentosFrec(html: string, ano: number): {equipos: string[]; documentos: Array<{id: string; nombre: string; fuenteUrl: string}>}
export function interpretaPuntosFrec(texto: string, tipo: string, equipos: string[], eventos: EventoDeportivo[], fuenteUrl: string, verificadoEn: string): TablaDeportiva
export function obtieneFrec(leer: (url: string, headers?: Record<string, string>, pdf?: boolean) => Promise<string|Uint8Array>, ano: number, consultado: string, incidencias: IncidenciaDeportes[]): Promise<CompeticionDeportiva>

export function interpretaSesionesFrec(html: string, rondas: EventoDeportivo[], ano: number): EventoDeportivo[]
