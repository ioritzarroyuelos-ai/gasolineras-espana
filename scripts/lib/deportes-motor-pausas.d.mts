import type { EstadoNovanet } from './deportes-novanet-estado.mjs'
export interface OpcionesPausasMotor {
  fetcher?: typeof fetch
  reloj?: () => number
  estadoNovanet?: Record<string, EstadoNovanet>
  guardarEstadoNovanet?: (id: string, estado: EstadoNovanet) => void | Promise<void>
}
export function clavePausaMotor(entrada: string | URL | Request): string
export function creaFetchMotorConPausas(opciones?: OpcionesPausasMotor): typeof fetch
