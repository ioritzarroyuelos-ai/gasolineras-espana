import type { FuentePublica, IndicePublicos, ManifestPublicos } from './lib/servicios-publicos.mjs'
export interface PublicosIO { fetch?: typeof fetch; now?: number }
export function descargaRefugios(io?: PublicosIO): Promise<FuentePublica>
export function descargaSalasMadrid(io?: PublicosIO): Promise<FuentePublica>
export function compruebaContinuidadPublica(previous: FuentePublica | null, next: FuentePublica): void
export function particionaFuentePublica(data: FuentePublica, now?: number): { manifest: ManifestPublicos; artifacts: Array<{ archivo: string; raw: string }> }
export function actualizaServiciosPublicos(options?: PublicosIO & { dir?: string }): Promise<{ index: IndicePublicos; failed: boolean }>
