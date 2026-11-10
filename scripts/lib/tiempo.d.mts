// Tipos para scripts/lib/tiempo.mjs (consumidos por el Worker y los tests).

export const TIEMPO_STALE_HORAS: number
export const AEMET_MUNICIPIOS: string
export function urlMunicipioAemet(enlace: unknown, ine: string): string | undefined
export function zonaTiempo(ine: string): 'Atlantic/Canary' | 'Europe/Madrid'

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
  consultado?: string
  urlMunicipio?: string
  versionPeriodos?: number
  fuente: 'AEMET' | 'Open-Meteo'
  dias: DiaPrediccion[]
}

export interface MetaMunicipio { ine: string; nombre: string; provincia: string }
export interface Municipio extends MetaMunicipio { lat: number; lng: number }

export function normalizaAemet(raw: unknown, meta: MetaMunicipio): Prediccion
export function normalizaOpenMeteo(raw: unknown, meta: MetaMunicipio, ahora?: number): Prediccion

export function bajaAemet(ine: string, key: string): Promise<unknown>
export function bajaOpenMeteo(lat: number, lng: number, zona?: string): Promise<unknown>
export function prediccionVigente(pred: Prediccion | null | undefined, ahora?: number): Prediccion | null
export function prediccionSnapshotAnterior(pred: Prediccion | null | undefined, ine: string, ahora?: number): Prediccion | null
export function parteParaSnapshot(muni: MetaMunicipio, leerOpenData: (ine: string) => Promise<unknown>, ahora?: number): Promise<{ pred: Prediccion; motivoRespaldo?: string }>

export interface ResuelveDeps {
  bajaAemet?: (ine: string) => Promise<unknown>
  bajaOpenMeteo?: (lat: number, lng: number, zona: string) => Promise<unknown>
  ahora?: number
}
export function resuelvePrediccion(muni: Municipio, deps?: ResuelveDeps): Promise<Prediccion>

export interface HoraTiempo { fechaHora: string; temperatura: number | null; viento: number | null; cielo?: string }
export interface FranjaLluvia { desde: string; hasta: string; probabilidad: number }
export interface ParteHoras {
  fuente: Prediccion['fuente']
  elaborado: string
  consultado?: string
  urlMunicipio?: string
  horas: HoraTiempo[]
  lluvia: FranjaLluvia[]
}
export function horasVigentes(parte: ParteHoras | null | undefined, ine: string, ahora?: number): ParteHoras | null
export function normalizaHorasOpenMeteo(raw: unknown, ine: string, ahora?: number): ParteHoras
export function resuelveHoras(muni: Municipio, deps?: {
  ahora?: number
  horasAemet?: (ine: string) => Promise<ParteHoras>
  horasOpenMeteo?: (lat: number, lng: number) => Promise<unknown>
}): Promise<ParteHoras>

export const IMPORTANTE_MIN_HAB: number
export function slugTiempo(s: string | null | undefined): string

export interface MunicipioLista {
  ine: string
  nombre: string
  provinciaId: string
  provinciaSlug: string
  provinciaNombre: string
  slug: string
  lat: number | null
  lng: number | null
  pob: number
  imp: boolean
}
export interface ProvinciaIne { id: string; slug: string; name: string }
export function maestroAMunicipios(maestro: unknown[], provincias: ProvinciaIne[]): MunicipioLista[]
export function construyeIndiceMunicipios(municipios: MunicipioLista[]): Array<{ n: string; p: string; u: string }>
