export type CausaOW = { nombre: string; codigo?: string; mensaje: string }
export type PeticionOW = { etapa: string; url: string; http?: number; bytes?: number; ms?: number; causa?: CausaOW[] }
export const FUENTES_DIAGNOSTICO_OW: ReadonlyArray<{ id: string; pagina: string; fede?: string }>
export function causaSeguraOW(error: unknown): CausaOW[]
export function diagnosticaFuenteOW(id: string, opciones?: { fetcher?: typeof fetch; reloj?: () => number; grupoFbcyl?: string }): Promise<{ id: string; correcto: boolean; peticiones: PeticionOW[]; causa?: CausaOW[] }>
