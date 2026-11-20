export declare const HISTORICO_TIMEOUT_MS: number
export declare function descargaSnapshotHistorico(iso: string, opciones?: {
  intentos?: number
  fetcher?: typeof fetch
  esperar?: (ms: number) => Promise<void>
  anotar?: (mensaje: string) => void
}): Promise<{ Fecha: string; ListaEESSPrecio: Record<string,string>[] } | null>
