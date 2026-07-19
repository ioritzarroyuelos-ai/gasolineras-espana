// Tipos para observatorio-precalculo.mjs.
//
// El modulo es JS puro a proposito: corre en Node dentro de GitHub Actions, sin
// paso de compilacion. Estas declaraciones existen para que tsc valide su uso
// desde tests/observatorio-precalculo.test.ts.
//
// La forma de ObservatorioPreCalc es la que consume observatorioFromPre() en
// src/lib/observatorio.ts. Si cambia una, cambia la otra.

export interface ProvinciaPreCalc {
  id: string
  precio: number
  estaciones: number
}

export interface MarcaPreCalc {
  marca: string
  precio: number
  estaciones: number
}

export interface FuelPreCalc {
  nacional: number | null
  provincias: ProvinciaPreCalc[]
  marcas: MarcaPreCalc[]
}

export interface ObservatorioPreCalc {
  v: number
  generatedAt: string
  fechaMinisterio?: string
  totalEstaciones: number
  g95: FuelPreCalc
  diesel: FuelPreCalc
}

export declare const OBS_FUEL: { g95: string; diesel: string }
export declare const MIN_ESTACIONES_MARCA: number

export declare function parsePrecio(v: unknown): number | null
export declare function median(values: number[]): number
export declare function normalizaMarca(raw: unknown): string | null

/** Devuelve null si el snapshot no trae estaciones. */
export declare function construyeObservatorio(
  snap: { Fecha?: string; ListaEESSPrecio?: unknown[] } | null
): ObservatorioPreCalc | null
