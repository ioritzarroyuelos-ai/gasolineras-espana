// Lógica pura de la vertical de política (sin red, sin estado): cálculo del
// cambio de escaños entre encuestas o frente al resultado electoral, la
// ventana de veda electoral (LOREG 69.7) y la derivación del estado de una
// elección. Todo testeable en aislamiento.

import type { EscanosEstim, EstadoEleccion, Sondeo } from './politica-schemas'

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

export type ComparacionEscanos = {
  tipo: 'sube' | 'baja' | 'igual' | 'misma_horquilla' | 'solapado' | 'sin_actual' | 'sin_referencia'
  texto: string
}

function intervalo(valor: EscanosEstim | undefined): { min: number; max: number } | undefined {
  if (valor == null) return
  const rango = typeof valor === 'number' ? { min: valor, max: valor } : valor
  if (!Number.isSafeInteger(rango.min) || !Number.isSafeInteger(rango.max)) return
  if (rango.min < 0 || rango.min > rango.max || rango.max > 1000) return
  return rango
}

// Sirve tanto para comparar dos encuestas como para comparar con el escrutinio.
// La diferencia más pequeña enfrenta el mínimo actual con el máximo anterior.
export function comparaEscanos(
  actual: EscanosEstim | undefined,
  referencia: EscanosEstim | undefined,
): ComparacionEscanos {
  const ahora = intervalo(actual)
  if (!ahora) return { tipo: 'sin_actual', texto: 'Sin dato de escaños' }
  const antes = intervalo(referencia)
  if (!antes) return { tipo: 'sin_referencia', texto: 'Sin referencia' }

  const minimo = ahora.min - antes.max
  const maximo = ahora.max - antes.min
  if (minimo === maximo) {
    if (minimo === 0) return { tipo: 'igual', texto: '＝ Igual' }
    return minimo > 0
      ? { tipo: 'sube', texto: '↑ Sube ' + minimo }
      : { tipo: 'baja', texto: '↓ Baja ' + -minimo }
  }
  if (ahora.min !== ahora.max && antes.min !== antes.max) {
    if (ahora.min === antes.min && ahora.max === antes.max) return { tipo: 'misma_horquilla', texto: '＝ Mismo rango' }
    if (minimo > 0) return { tipo: 'sube', texto: '↑ Sube' }
    if (maximo < 0) return { tipo: 'baja', texto: '↓ Baja' }
    if (minimo === 0) return { tipo: 'solapado', texto: 'Igual o sube' }
    if (maximo === 0) return { tipo: 'solapado', texto: 'Igual o baja' }
    return { tipo: 'solapado', texto: 'Rangos solapados' }
  }
  if (minimo > 0) return { tipo: 'sube', texto: '↑ Sube de ' + minimo + ' a ' + maximo }
  if (maximo < 0) return { tipo: 'baja', texto: '↓ Baja de ' + -maximo + ' a ' + -minimo }
  const desde = minimo === 0 ? '0' : '−' + -minimo
  const hasta = maximo === 0 ? '0' : '+' + maximo
  return { tipo: 'solapado', texto: 'De ' + desde + ' a ' + hasta }
}

function normalizaNombre(nombre?: string): string {
  // Los artículos pueden incluir marcas invisibles de dirección o de ancho cero.
  return (nombre || '').normalize('NFC').replace(/\p{Cf}/gu, '').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function diaDeCampo(fecha?: string): number | undefined {
  // El robot guarda el día de fin en formato AAAA-MM-DD. Date.parse acepta
  // algunos días imposibles trasladándolos al mes siguiente, de ahí la vuelta a ISO.
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return
  const tiempo = Date.parse(fecha + 'T00:00:00Z')
  if (Number.isFinite(tiempo) && new Date(tiempo).toISOString().slice(0, 10) === fecha) return tiempo
}

// Recibe los sondeos de UNA elección completa, antes de paginar. La clave del
// resultado es el propio objeto publicado, incluso si comparte fecha con otro.
export function enlazaSondeosAnteriores(sondeos: readonly Sondeo[]): Map<Sondeo, Sondeo> {
  const series = new Map<string, Map<number, Sondeo[]>>()
  for (const sondeo of sondeos) {
    const empresa = normalizaNombre(sondeo.empresa)
    const medio = normalizaNombre(sondeo.comitente)
    const fin = diaDeCampo(sondeo.campoFin)
    if (!empresa || !medio || fin == null) continue

    const serie = JSON.stringify([empresa, medio])
    const porFecha = series.get(serie) ?? new Map<number, Sondeo[]>()
    const mismoDia = porFecha.get(fin) ?? []
    mismoDia.push(sondeo)
    porFecha.set(fin, mismoDia)
    series.set(serie, porFecha)
  }

  const anteriores = new Map<Sondeo, Sondeo>()
  for (const porFecha of series.values()) {
    let anterior: Sondeo | undefined
    for (const fecha of [...porFecha.keys()].sort((a, b) => a - b)) {
      const dia = porFecha.get(fecha)!
      if (anterior) {
        for (const actual of dia) anteriores.set(actual, anterior)
      }
      // Dos encuestas terminaron el mismo día. Para la siguiente fecha no se
      // elige una al azar ni se retrocede hasta una encuesta más antigua.
      anterior = dia.length === 1 ? dia[0] : undefined
    }
  }
  return anteriores
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
