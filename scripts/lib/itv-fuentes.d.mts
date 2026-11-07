import type { EstacionITV } from '../../src/lib/itv'

export interface FuenteItv {
  id: 'dgt' | 'industria' | 'gva'
  nombre: string
  url: string
  descarga?: string
}
export interface MetaItv extends FuenteItv {
  consultado: string
  ultimoExito?: string
  publicado?: string
  estado?: 'actualizada' | 'conservada'
}
export interface EstacionFuente extends EstacionITV {
  codigo: string
  idFuente?: string
}
export interface IncidenciaItv {
  id: string
  idFuente?: string
  codigo: string
  prov: string
  motivo: string
  fuenteUrl: string
}
export interface DatosFuente {
  estaciones: EstacionFuente[]
  excluidas: Array<{codigo: string; prov: string; motivo: string}>
}
export interface ParteFuenteItv extends MetaItv, DatosFuente {
  estado: 'actualizada' | 'conservada'
  error?: string
}
export const FUENTES_ITV: FuenteItv[]
export function coordenadasItv(lat: unknown, lng: unknown): {lat:number|null;lng:number|null}
export function leeCsvItv(texto: string): Array<Record<string,string>>
export function estacionesDgt(geojson: unknown, meta: MetaItv): DatosFuente
export function estacionesGva(csv: string, meta: MetaItv): DatosFuente
export function estacionesIndustria(filas: unknown[][], meta: MetaItv, ahora?: number): DatosFuente
export function combinaFuentesItv(fuentes: Array<DatosFuente & {id:string}>, incidencias?: IncidenciaItv[]): EstacionFuente[]
export function conservaDatosPreviosItv<T extends EstacionFuente>(estaciones: T[], anteriores?: EstacionFuente[], ahora?: number): T[]
export function migraCopiaDgt(snapshot: {generatedAt?:string;estaciones?:EstacionITV[]}): ParteFuenteItv
export function actualizaFuenteItv(fuente: FuenteItv, anterior: ParteFuenteItv|null, opciones?: {ahora?:number;fetcher?:typeof fetch}): Promise<ParteFuenteItv>
