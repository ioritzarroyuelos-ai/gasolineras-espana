// Precomputo de gasolineras (M5): agregados compactos para que el SSR no parsee
// stations.json (~12 MB, 12.000 estaciones) en cada peticion. Corre en el robot
// (scripts/fetch-prices.mjs) sobre el mismo snapshot descargado.
//
// SLICE 1: resumen nacional (media/min/max/count por combustible, IGUAL que
// statsNacional) + recuento de estaciones por provincia (IGUAL que la ruta
// /gasolineras/). NO son medianas ni llevan los umbrales del observatorio: ese
// es OTRO contrato (observatorio-precalculo.mjs). La logica se REPLICA a proposito
// aqui (Node) porque src/lib/municipios.ts (edge) no comparte sistema de tipos;
// tests/gasolineras-precalculo.test.ts compara ambas salidas y falla si divergen.

// Mismos nombres de campo del Ministerio que src/lib/municipios.ts::statsNacional.
const FIELD = {
  '95':          'Precio Gasolina 95 E5',
  '98':          'Precio Gasolina 98 E5',
  'diesel':      'Precio Gasoleo A',
  'diesel_plus': 'Precio Gasoleo Premium',
}

// Replica EXACTA de statsNacional(): min/max/count por combustible y media =
// suma/n (NO mediana). Mismo parseo, mismo orden de suma (para que el float
// coincida bit a bit con el camino edge).
export function nacionalStatsFrom(stations) {
  const stats = {}
  if (!Array.isArray(stations)) return { stats, stationCount: 0 }
  const agg = {}
  for (const k of Object.keys(FIELD)) agg[k] = { min: Infinity, max: -Infinity, sum: 0, n: 0 }
  let stationCount = 0
  for (const s of stations) {
    stationCount++
    for (const fuelCode of Object.keys(FIELD)) {
      const raw = s[FIELD[fuelCode]]
      if (!raw) continue
      const n = parseFloat(String(raw).replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) continue
      const a = agg[fuelCode]
      if (n < a.min) a.min = n
      if (n > a.max) a.max = n
      a.sum += n
      a.n++
    }
  }
  for (const fuelCode of Object.keys(agg)) {
    const a = agg[fuelCode]
    if (a.n === 0) continue
    stats[fuelCode] = { min: a.min, max: a.max, avg: a.sum / a.n, count: a.n }
  }
  return { stats, stationCount }
}

// Recuento de estaciones por IDProvincia (TODAS las estaciones con provincia,
// tengan precio o no). Igual que el bloque de la ruta /gasolineras/. OJO: NO se
// deriva de los municipios (esos descartan registros sin municipio).
export function provinciaCountsFrom(stations) {
  const counts = {}
  if (!Array.isArray(stations)) return counts
  for (const s of stations) {
    const id = s['IDProvincia']
    if (id) counts[id] = (counts[id] || 0) + 1
  }
  return counts
}

// snap: respuesta cruda del Ministerio { Fecha, ListaEESSPrecio: [...] }.
// Devuelve null si no hay estaciones (para no escribir un fichero vacio que
// dejaria la home/portada sin datos).
export function construyeGasolineras(snap) {
  const stations = snap?.ListaEESSPrecio
  if (!Array.isArray(stations) || !stations.length) return null
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    fechaMinisterio: typeof snap.Fecha === 'string' ? snap.Fecha : undefined,
    nacionalStats: nacionalStatsFrom(stations),
    provinciaCounts: provinciaCountsFrom(stations),
  }
}
