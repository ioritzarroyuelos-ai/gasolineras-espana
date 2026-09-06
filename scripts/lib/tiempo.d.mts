// Tipos para scripts/lib/tiempo.mjs (consumidos por el Worker y los tests).

export const TIEMPO_STALE_HORAS: number

export interface Frescura {
  fiable: boolean
  horas: number
}
export function frescuraTiempo(ts: string | null | undefined, ahora?: number): Frescura

export interface DiaPrediccion {
  fecha: string
  tmin: number | null
  tmax: number | null
  cielo: string
  probLluvia: number | null
  viento: number | null
}

export interface Prediccion {
  ine: string
  nombre: string
  provincia: string
  elaborado: string
  fuente: 'AEMET' | 'Open-Meteo'
  dias: DiaPrediccion[]
}

export interface MetaMunicipio { ine: string; nombre: string; provincia: string }
export interface Municipio extends MetaMunicipio { lat: number; lng: number; key?: string }

export function normalizaAemet(raw: unknown, meta: MetaMunicipio): Prediccion
export function normalizaOpenMeteo(raw: unknown, meta: MetaMunicipio): Prediccion

export function bajaAemet(ine: string, key: string): Promise<unknown>
export function bajaOpenMeteo(lat: number, lng: number): Promise<unknown>

export interface ResuelveDeps {
  bajaAemet?: (ine: string) => Promise<unknown>
  bajaOpenMeteo?: (lat: number, lng: number) => Promise<unknown>
  key?: string
  intentos?: number
}
export function resuelvePrediccion(muni: Municipio, deps?: ResuelveDeps): Promise<Prediccion>
