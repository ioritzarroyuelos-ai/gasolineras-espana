// Lógica pura de la vertical de política (sin red, sin estado): cálculo del
// "sube/baja" de un sondeo frente al resultado de la última elección, la
// ventana de veda electoral (LOREG 69.7) y la derivación del estado de una
// elección. Todo testeable en aislamiento.

import type { EscanosEstim, EstadoEleccion } from './politica-schemas'

const DIA_MS = 86_400_000
// Margen para cubrir la diferencia horaria España↔UTC (UTC+1/+2, con DST) sin
// hacer aritmética de zona horaria: la votación se maneja como 00:00Z, pero la
// ventana legal es en hora peninsular. Ampliar 3 h por ambos lados garantiza que
// NUNCA se difundan sondeos dentro de la franja legal (sobre-cumplimiento; como
// mucho se ocultan ~3 h de más, que es lo seguro). Cubre también Canarias (UTC+0).
const VEDA_MARGEN_MS = 3 * 3_600_000
// Frescura: si la última comprobación correcta es más vieja que esto, el dato
// se considera desactualizado (cadencia del robot: diaria).
export const STALE_MS = 30 * 3_600_000 // 30 h

export type Cambio =
  | { tipo: 'exacto'; delta: number; direccion: 'sube' | 'baja' | 'igual' }
  | { tipo: 'rango'; min: number; max: number; direccion: 'sube' | 'baja' | 'ambiguo' | 'igual' }
  | { tipo: 'sin_dato' } // el sondeo no da escaños para esa candidatura
  | { tipo: 'desconocido' } // no hay referencia (candidatura nueva/coalición)

// Compara los escaños estimados por un sondeo con los escaños de referencia
// (resultado de la última elección) de esa misma candidatura.
export function calculaCambio(esc: EscanosEstim, ref: number | null | undefined): Cambio {
  if (ref === null || ref === undefined) return { tipo: 'desconocido' }
  if (esc === null) return { tipo: 'sin_dato' }
  if (typeof esc === 'number') {
    if (!Number.isFinite(esc) || !Number.isFinite(ref)) return { tipo: 'sin_dato' }
    const delta = esc - ref
    return { tipo: 'exacto', delta, direccion: delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual' }
  }
  if (!Number.isFinite(esc.min) || !Number.isFinite(esc.max) || !Number.isFinite(ref)) return { tipo: 'sin_dato' }
  // Rango: el cambio también es un rango. No inventamos flecha desde un punto
  // medio. Solo es "ambiguo" cuando el rango CRUZA la referencia (puede subir o
  // bajar). Un rango que toca la referencia por un extremo pero no baja/sube del
  // otro tiene dirección: [0,+] = sube (o igual), [-,0] = baja (o igual).
  const min = esc.min - ref
  const max = esc.max - ref
  let direccion: 'sube' | 'baja' | 'ambiguo' | 'igual'
  if (min === 0 && max === 0) direccion = 'igual'
  else if (min >= 0) direccion = 'sube'
  else if (max <= 0) direccion = 'baja'
  else direccion = 'ambiguo'
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
  const inicio = votacion - 5 * DIA_MS - VEDA_MARGEN_MS
  const fin = votacion + DIA_MS + VEDA_MARGEN_MS // incluye todo el día de la votación + margen
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
