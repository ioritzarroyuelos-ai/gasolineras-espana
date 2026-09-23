// Lógica pura de la vertical de política (sin red, sin estado): cálculo del
// "sube/baja" de un sondeo frente al resultado de la última elección, la
// ventana de veda electoral (LOREG 69.7) y la derivación del estado de una
// elección. Todo testeable en aislamiento.

import type { EscanosEstim, EstadoEleccion } from './politica-schemas'

const DIA_MS = 86_400_000
// Frescura: si la última comprobación correcta es más vieja que esto, el dato
// se considera desactualizado (cadencia del robot: diaria).
export const STALE_MS = 30 * 3_600_000 // 30 h

export type Cambio =
  | { tipo: 'exacto'; delta: number; direccion: 'sube' | 'baja' | 'igual' }
  | { tipo: 'rango'; min: number; max: number; direccion: 'sube' | 'baja' | 'ambiguo' }
  | { tipo: 'sin_dato' } // el sondeo no da escaños para esa candidatura
  | { tipo: 'desconocido' } // no hay referencia (candidatura nueva/coalición)

// Compara los escaños estimados por un sondeo con los escaños de referencia
// (resultado de la última elección) de esa misma candidatura.
export function calculaCambio(esc: EscanosEstim, ref: number | null | undefined): Cambio {
  if (ref === null || ref === undefined) return { tipo: 'desconocido' }
  if (esc === null) return { tipo: 'sin_dato' }
  if (typeof esc === 'number') {
    const delta = esc - ref
    return { tipo: 'exacto', delta, direccion: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual' }
  }
  // Rango: el cambio también es un rango. Solo hay dirección clara si TODO el
  // rango queda por encima (sube) o por debajo (baja) de la referencia; si lo
  // cruza, es ambiguo y NO se pinta flecha desde un punto medio inventado.
  const min = esc.min - ref
  const max = esc.max - ref
  const direccion = min > 0 ? 'sube' : max < 0 ? 'baja' : 'ambiguo'
  return { tipo: 'rango', min, max, direccion }
}

// Veda electoral (LOREG art. 69.7): prohibida la publicación/difusión/reproducción
// de sondeos durante los cinco días anteriores a la votación. Aplicamos la
// ventana [votación − 5 días, fin del día de la votación] y SOLO cuando hay
// fecha oficial confirmada. Se evalúa con la fecha del servidor en cada request,
// para que la veda entre y salga sola sin depender de que el robot corra.
export function enVeda(ahoraISO: string, fecha: { valor: string | null; confirmada: boolean }): boolean {
  if (!fecha.confirmada || !fecha.valor) return false
  const votacion = Date.parse(fecha.valor.slice(0, 10) + 'T00:00:00Z')
  const ahora = Date.parse(ahoraISO)
  if (Number.isNaN(votacion) || Number.isNaN(ahora)) return false
  const inicio = votacion - 5 * DIA_MS
  const fin = votacion + DIA_MS // incluye todo el día de la votación
  return ahora >= inicio && ahora < fin
}

// Deriva el estado de una elección a partir de su disponibilidad, si tiene
// sondeos y cuándo fue la última comprobación correcta. Un fallo de extracción
// (disponible=false) NUNCA se muestra como "sin_sondeos".
export function estadoEleccion(
  e: { disponible?: boolean; tieneSondeos: boolean; ultimaComprobacionOk?: string | null },
  ahoraISO: string,
): EstadoEleccion {
  if (e.disponible === false) return 'no_disponible'
  const ahora = Date.parse(ahoraISO)
  if (e.ultimaComprobacionOk) {
    const t = Date.parse(e.ultimaComprobacionOk)
    if (!Number.isNaN(t) && !Number.isNaN(ahora) && ahora - t > STALE_MS) return 'desactualizado'
  }
  return e.tieneSondeos ? 'ok' : 'sin_sondeos'
}
