// Tipos para historico-estatico.mjs.
//
// El modulo es JS puro a proposito: corre en Node dentro de GitHub Actions, sin
// paso de compilacion. Estas declaraciones existen para que tsc valide su uso
// desde tests/historico-estatico.test.ts.
//
// Las formas de FicheroProvincia y FicheroMediana son las que lee src/index.tsx
// (StaticHistoryFile, StaticMedianFile); FicheroNacional la consume
// /api/stats/national y el observatorio. Si cambia una, cambia la otra.

export interface FilaSnapshot {
  station_id: string
  provincia: string | null
  fuel_code: string
  cents: number
}

export type Punto = [string, number]
export type PuntoNacional = [string, number, number]

export interface FicheroProvincia {
  v: number
  provincia_id: string
  from: string
  to: string
  days: number
  generated_at: string
  stations: Record<string, Record<string, Punto[]>>
}

export interface FicheroMediana {
  v: number
  provincia_id: string
  from: string
  to: string
  days: number
  generated_at: string
  median: Record<string, Punto[]>
}

export interface FicheroNacional {
  v: number
  from: string
  to: string
  days: number
  generated_at: string
  series: Record<string, PuntoNacional[]>
}

export interface EstadoHistorico {
  provincias: Map<string, FicheroProvincia>
  medianas: Map<string, FicheroMediana>
  nacional: FicheroNacional | null
}

export interface IndexHistorico {
  v: number
  from: string | null
  to: string | null
  days: number
  generated_at: string
  provinces: string[]
  nacional: { from: string; to: string } | null
}

export declare const FUEL_MAP: Record<string, string>
export declare const FUEL_CODES: string[]

export declare function parsePriceString(raw: unknown): number | null
export declare function eurosToCents(euros: number): number
export declare function filasSnapshot(snapshot: unknown): FilaSnapshot[]
export declare function anadePunto(serie: Punto[], fecha: string, cents: number): Punto[]
export declare function medianaInferior(valores: number[]): number | null

export declare function anadeDiaProvincia(
  fichero: FicheroProvincia | null, provKey: string, filas: FilaSnapshot[], fecha: string, ahora?: Date,
): FicheroProvincia
export declare function anadeDiaMediana(
  fichero: FicheroMediana | null, provKey: string, filas: FilaSnapshot[], fecha: string, ahora?: Date,
): FicheroMediana
export declare function anadeDiaNacional(
  fichero: FicheroNacional | null, filas: FilaSnapshot[], fecha: string, ahora?: Date,
): FicheroNacional

export declare function aplicaSnapshot(
  estado: EstadoHistorico, snapshot: unknown, fecha: string, ahora?: Date,
): { estado: EstadoHistorico; resumen: { fecha: string; filas: number; provincias: number } }

export declare function construyeIndex(estado: EstadoHistorico, ahora?: Date): IndexHistorico
