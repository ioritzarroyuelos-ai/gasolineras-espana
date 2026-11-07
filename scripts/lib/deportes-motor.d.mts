import type { EmisionDeportiva, EventoDeportivo, OpcionesDeportes, ResultadoDeportes, TablaDeportiva } from './deportes.mjs'
import type { EstadoNovanet } from './deportes-novanet-estado.mjs'

export interface RondaFormula {
  id: string
  nombre: string
  lugar: string
  jornada: string
  fecha: string
  finFecha: string
  fuenteUrl: string
  ganadores: Record<string, string>
}
export function interpretaRangoMotor(texto: string, ano: number): { fecha: string; finFecha: string }
export function objetosFormula(html: string): Record<string, unknown>[]
export function interpretaCalendarioFormula(html: string, base: string, ano: number, id: string): RondaFormula[]
export function interpretaSesionesFormula(html: string, ronda: RondaFormula, ahora?: number): EventoDeportivo[]
export function interpretaClasificacionMotor(html: string, tipo: string, ano: number): TablaDeportiva[]
export function interpretaCalendarioAcademy(html: string, ano: number, ahora?: number): EventoDeportivo[]
export function interpretaClasificacionAcademy(html: string, ano: number): TablaDeportiva[]
export function interpretaCalendarioEspanaMotor(html: string, id: string, ano: number, ahora?: number): EventoDeportivo[]
export function interpretaCalendarioRfeda(html: string, ano: number, ahora?: number): Array<{ id: string; nombre: string; eventos: EventoDeportivo[] }>
export function interpretaEmisionMotor(html: string, id: string, ano: number, verificadoEn: string): EmisionDeportiva
export function obtieneMotor(opciones?: OpcionesDeportes & { estadoNovanet?: Record<string, EstadoNovanet>; guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => void | Promise<void> }): Promise<ResultadoDeportes>
