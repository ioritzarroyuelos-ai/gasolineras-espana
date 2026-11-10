import type { IncidenciaDeportes, SeguimientoGruposDeportes, CompeticionDeportiva } from './deportes.mjs'
export function conservaIncidenciasGrupos(anteriores: IncidenciaDeportes[], actuales: IncidenciaDeportes[], seguimiento?: SeguimientoGruposDeportes): IncidenciaDeportes[]
export function conservaGrupoFueraDeTanda(anterior: CompeticionDeportiva, fecha: string, intentados: Set<string>): CompeticionDeportiva
