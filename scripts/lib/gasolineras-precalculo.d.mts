// Tipos para gasolineras-precalculo.mjs (M5).
//
// El modulo es JS puro a proposito (corre en Node dentro de GitHub Actions, sin
// paso de compilacion). Estas declaraciones existen para que tsc valide su uso
// desde tests/gasolineras-precalculo.test.ts.
//
// nacionalStats tiene la MISMA forma que devuelve statsNacional() en
// src/lib/municipios.ts. Si cambia una, cambia la otra (el test lo verifica).

export interface FuelStat {
  min: number
  max: number
  avg: number
  count: number
}

export interface NacionalStats {
  stats: Record<string, FuelStat>
  stationCount: number
}

export interface GasolinerasPreCalc {
  v: number
  generatedAt: string
  fechaMinisterio?: string
  nacionalStats: NacionalStats
  provinciaCounts: Record<string, number>
}

export declare function nacionalStatsFrom(stations: unknown[]): NacionalStats
export declare function provinciaCountsFrom(stations: unknown[]): Record<string, number>

/** Devuelve null si el snapshot no trae estaciones. */
export declare function construyeGasolineras(
  snap: { Fecha?: string; ListaEESSPrecio?: unknown[] } | null
): GasolinerasPreCalc | null
