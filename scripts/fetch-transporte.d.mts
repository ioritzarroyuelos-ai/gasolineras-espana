import type { MetroCatalogo } from '../src/lib/metro-bilbao'
export const TRANSPORTE_GTFS_URL: string
export const TRANSPORTE_GTFS_FUENTE: string
export function descargaCatalogoMetro(options?: { fetcher?: typeof fetch; now?: number; python?: string }): Promise<MetroCatalogo & { bytes: number; sha256: string; licencia: string; fuenteUrl: string }>
export function main(): Promise<void>
