import type { ParkingCatalogo, ParkingFuente } from '../src/lib/aparcamientos-datos'
export function parkingApi(): Promise<typeof import('../src/lib/aparcamientos') & typeof import('../src/lib/aparcamientos-datos')>
type Options = { fetcher?: typeof fetch; clock?: () => number; sleep?: (ms: number) => Promise<void> }
export function preparaCatalogoParking(city: ParkingFuente, old?: ParkingCatalogo | null, options?: Options & { api?: Awaited<ReturnType<typeof parkingApi>> }): Promise<ParkingCatalogo>
export function actualizaAparcamientos(options?: Options & { directory?: string }): Promise<{ schema: 1; consultado: string; correcto: boolean; fuentes: Array<{ id: ParkingFuente; nombre: string; estado: 'actual' | 'parcial' | 'conservada' | 'error'; ultimoExito: string | null; fechaDatos: null; total: number; bytes: number; sha256: string | null; error?: string }> }>
