import type { Candidatura, Sondeo } from '../../src/lib/politica-schemas'

export function esSeguimientoSW(s: Sondeo): boolean
export function combinaSeguimiento(principales: readonly Sondeo[], seguimiento: readonly Sondeo[]): Sondeo[]

export function extraeSeguimientoGenerales(
  htmlIngles: string,
  candidaturas: readonly Pick<Candidatura, 'id'>[],
): { sondeos: Sondeo[]; incidencias: string[] }
