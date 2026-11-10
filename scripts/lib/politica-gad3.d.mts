import type { Candidatura, Sondeo, EleccionFile } from '../../src/lib/politica-schemas'
export const GAD3_LISTADO: string
export function descubreGad3(html: string): string[]
export interface FichaGad3 { titulo: string; grafico: string; ppConUpn: boolean; sondeo: Omit<Sondeo, 'datos'> }
export function fichaGad3(html: string, url: string, hoy: string): FichaGad3
export function tablaGad3(html: string, csv: string, ficha: FichaGad3): { candidaturas: Candidatura[]; sondeos: Sondeo[] }
export function fetchGad3(options: { fetchImpl?: typeof fetch; hoy: string; userAgent: string }): Promise<{
  candidaturas: Candidatura[]; sondeos: Sondeo[]; procedencia: NonNullable<EleccionFile['procedenciasAdicionales']>[number]
}>
