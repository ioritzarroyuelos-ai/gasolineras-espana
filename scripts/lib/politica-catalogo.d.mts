export type WikiRef = { lang: 'es' | 'en'; articulo: string }

export interface EleccionCatalogo {
  id: string
  tipo: 'generales' | 'europeas' | 'autonomica'
  nombre: string
  comunidad?: string
  ciudadAutonoma?: boolean
  camara: { nombre: string; escanos: number; mayoria: number }
  ultimaFecha: string
  proxima: { valor: string | null; confirmada: boolean; fuente?: string; anioPrevisto?: number }
  wikiSondeos: WikiRef | null
  wikiResultados: WikiRef
}

export const ELECCIONES: EleccionCatalogo[]
export function eleccionPorId(id: string): EleccionCatalogo | undefined
export function rutasEleccion(e: EleccionCatalogo): { pagina: string; datos: string }
export const RUTAS_CON_VEDA: ReturnType<typeof rutasEleccion>[]
export const RUTAS_SONDEOS_SIN_COPIA: string[]
export function normSiglas(s: string): string
export function colorPartido(siglas: string): string
export function ordenIdeologico(siglas: string): number
