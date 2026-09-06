// Tipos para scripts/lib/tiempo.mjs (consumidos por el Worker y los tests).
// Se irá ampliando conforme el plan añada adaptadores, índice, etc.

export const TIEMPO_STALE_HORAS: number

export interface Frescura {
  fiable: boolean
  horas: number
}

export function frescuraTiempo(ts: string | null | undefined, ahora?: number): Frescura
