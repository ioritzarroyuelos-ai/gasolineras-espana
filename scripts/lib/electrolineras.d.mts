export type Fuente = 'dgt' | 'ocm'

export interface Estacion {
  lat: number
  lng: number
  title: string
  operator: string
  maxKw: number
  connectors: string[]
  points: number
  fuente: Fuente
}

export type FilaCompacta = [
  number, // lat
  number, // lng
  string, // title
  string, // operator
  number, // maxKw
  string, // connectors (CSV)
  number, // points
  Fuente, // fuente
]

export const SCHEMA: readonly string[]

export function inSpain(lat: number, lng: number): boolean
export function mapConnector(raw: string | null | undefined): string
export function kwFromWatts(raw: string | number): number
export function parseSites(xml: string): Estacion[]
export function normalizeOcm(pois: unknown[]): Estacion[]
export function dedup(dgt: Estacion[], ocm: Estacion[]): Estacion[]
export function toCompactRows(stations: Estacion[]): FilaCompacta[]
