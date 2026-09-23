export type WikiRef = { lang: 'es' | 'en'; articulo: string }

export interface EleccionCatalogo {
  id: string
  tipo: 'generales' | 'europeas' | 'autonomica'
  nombre: string
  comunidad?: string
  ciudadAutonoma?: boolean
  camara: { nombre: string; escanos: number; mayoria: number }
  ultimaFecha: string
  proxima: { valor: string | null; confirmada: boolean }
  wikiSondeos: WikiRef | null
  wikiResultados: WikiRef
}

export const ELECCIONES: EleccionCatalogo[]
export function eleccionPorId(id: string): EleccionCatalogo | undefined
export function normSiglas(s: string): string
export function colorPartido(siglas: string): string
