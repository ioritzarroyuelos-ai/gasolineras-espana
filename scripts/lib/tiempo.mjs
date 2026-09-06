// Lógica pura del vertical "el tiempo", compartida por el robot (Node), el Worker
// (src) y los tests — mismo patrón que scripts/lib/historico-estatico.mjs (tipos en
// tiempo.d.mts). Sin DOM. Las funciones de descarga (bajaAemet/bajaOpenMeteo) usan
// `fetch` global, disponible en Node 22 y en Workers.
//
// De momento: modelo de frescura. El resto (adaptadores AEMET/Open-Meteo, fallback,
// índice de municipios) se añade en las siguientes tareas del plan.

// Umbral de frescura de la predicción: si el dato tiene más de estas horas, la web
// avisa de que puede no estar actualizado (mismo espíritu que la red de seguridad de
// guardias). El tiempo se refresca varias veces al día, así que 12 h es holgado.
export const TIEMPO_STALE_HORAS = 12

/**
 * ¿Es fiable la predicción por su antigüedad?
 * @param {string|null|undefined} ts  timestamp de elaboración (ISO)
 * @param {number} [ahora]            epoch ms (para tests deterministas)
 * @returns {{ fiable: boolean, horas: number }}
 */
export function frescuraTiempo(ts, ahora = Date.now()) {
  const t = ts ? Date.parse(ts) : NaN
  const horas = Number.isFinite(t) ? (ahora - t) / 3600000 : Infinity
  return { fiable: horas <= TIEMPO_STALE_HORAS, horas }
}
